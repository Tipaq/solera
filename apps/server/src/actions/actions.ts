import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import { conversations, projectActions, projects, worktrees, type Db, type ProjectActionRow } from '@solera/db'
import {
  MAX_ACTIONS_PER_PROJECT,
  resolveActionUrl,
  type ActionPlacement,
  type ActionRunDto,
  type ActionRunTrigger,
  type CreateProjectActionBody,
  type ProjectActionDto,
  type ProjectActionRunResult,
  type ProjectActionServiceState,
  type ServiceActionControl,
  type TerminalDto,
  type UpdateProjectActionBody,
} from '@solera/protocol'
import type { Config } from '../config.js'
import { HttpError, badRequest, conflict, notFound } from '../http/errors.js'
import { systemdUnits, type ServiceUnits, type ServiceUnitState } from '../services/apps.js'
import { processOrigins } from '../services/origins.js'
import type { TerminalManager } from '../terminals/terminal-manager.js'
import type { Environments } from '../environments/environments.js'
import { hostEnvironment } from '../environments/host.js'
import { closeOrphanRuns, finishRun, latestRuns, startRun } from './runs.js'
import { readGitHead } from '../git.js'
import { ServedReader, treeOf, type ProjectTree } from './served.js'

/**
 * Actions de projet : stockage, et exécution dans un terminal ou une unité systemd.
 *
 * Partagé entre les routes et les demandes des agents (`register_action`,
 * `run_action`) : les deux doivent refuser la même chose, et un agent ne doit pas
 * pouvoir faire passer pour relue une commande qu'il vient d'écrire.
 */

/** Nom d'unité tiré de l'identifiant seul : renommer l'action ne perd pas l'unité qui tourne. */
export function actionUnit(actionId: string): string {
  return `solera-app-action-${actionId.slice(0, 8)}.service`
}

/** Le terminal de lecture du journal d'un service se range sous cette clé, à part de l'action. */
const logsKey = (actionId: string) => `${actionId}:logs`

export function listActionRows(db: Db, projectIds: string[]): ProjectActionRow[] {
  if (projectIds.length === 0) return []
  return db
    .select()
    .from(projectActions)
    .where(inArray(projectActions.projectId, projectIds))
    .orderBy(asc(projectActions.createdAt))
    .all()
}

export function loadAction(db: Db, actionId: string): ProjectActionRow {
  const row = db.select().from(projectActions).where(eq(projectActions.id, actionId)).get()
  if (!row) throw notFound('action_not_found', 'Action not found.')
  return row
}

/** Ce qu'une personne vient de relire : la relecture suivante s'y comparera. */
function reviewed(row: Pick<ProjectActionRow, 'kind' | 'command' | 'subdir' | 'url'>, at: number) {
  return {
    approvedAt: at,
    approvedKind: row.kind,
    approvedCommand: row.command,
    approvedSubdir: row.subdir,
    approvedUrl: row.url,
  }
}

/**
 * Le placement et sa branche, tels qu'ils s'écrivent : une tâche suit toujours, une
 * branche fixée ne vaut que pour `branch`, qui ne va pas sans elle ; une instance par
 * arbre n'existe pas encore.
 */
function placed(kind: ProjectActionRow['kind'], placement: ActionPlacement, pinnedBranch: string | null | undefined) {
  if (kind === 'task') return { placement: 'follow' as const, pinnedBranch: null }
  if (placement === 'per-worktree') {
    throw badRequest('action_placement_unsupported', 'One instance per worktree is not available yet.')
  }
  if (placement !== 'branch') return { placement, pinnedBranch: null }
  if (!pinnedBranch) throw badRequest('action_branch_required', 'Choose the branch this service always runs on.')
  return { placement, pinnedBranch }
}

const neverReviewed = {
  approvedAt: null,
  approvedKind: null,
  approvedCommand: null,
  approvedSubdir: null,
  approvedUrl: null,
}

/** `agentConversationId` null : créée depuis l'interface, donc relue d'office. */
export function createAction(
  db: Db,
  projectId: string,
  body: CreateProjectActionBody,
  agentConversationId: string | null,
): ProjectActionRow {
  const existing = db
    .select({ n: count() })
    .from(projectActions)
    .where(eq(projectActions.projectId, projectId))
    .get()
  if ((existing?.n ?? 0) >= MAX_ACTIONS_PER_PROJECT) {
    throw conflict('too_many_actions', `At most ${MAX_ACTIONS_PER_PROJECT} actions per project.`, {
      max: MAX_ACTIONS_PER_PROJECT,
    })
  }
  const now = Date.now()
  const fields = {
    kind: body.kind,
    command: body.command,
    subdir: body.subdir || null,
    url: body.url || null,
  }
  const row: ProjectActionRow = {
    id: randomUUID(),
    projectId,
    label: body.label,
    description: body.description || null,
    ...fields,
    ...placed(body.kind, body.placement ?? 'follow', body.pinnedBranch),
    ...(agentConversationId ? neverReviewed : reviewed(fields, now)),
    agentConversationId,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(projectActions).values(row).run()
  return row
}

/**
 * Une modification par l'interface vaut relecture. Par un agent, elle remet l'action
 * en `proposed` dès qu'elle touche à ce qui s'exécute : renommer un bouton ne change
 * rien au risque, changer sa commande si. Ce qui avait été relu reste noté, pour
 * montrer l'écart et y revenir au refus.
 */
export function updateAction(
  db: Db,
  row: ProjectActionRow,
  patch: UpdateProjectActionBody,
  agentConversationId: string | null,
): ProjectActionRow {
  const next: ProjectActionRow = {
    ...row,
    label: patch.label ?? row.label,
    description: patch.description === undefined ? row.description : patch.description || null,
    kind: patch.kind ?? row.kind,
    command: patch.command ?? row.command,
    subdir: patch.subdir === undefined ? row.subdir : patch.subdir || null,
    url: patch.url === undefined ? row.url : patch.url || null,
    ...placed(
      patch.kind ?? row.kind,
      patch.placement ?? row.placement,
      patch.pinnedBranch === undefined ? row.pinnedBranch : patch.pinnedBranch,
    ),
    updatedAt: Date.now(),
  }
  // L'URL compte avec ce qui s'exécute : c'est un lien qu'on suivra sans le relire.
  const executionChanged =
    next.kind !== row.kind || next.command !== row.command || next.subdir !== row.subdir || next.url !== row.url
  if (agentConversationId) {
    next.agentConversationId = agentConversationId
    if (executionChanged) next.approvedAt = null
  } else {
    Object.assign(next, reviewed(next, next.updatedAt))
  }
  db.update(projectActions).set(next).where(eq(projectActions.id, row.id)).run()
  return next
}

/** Valider sans lancer : la relecture et le lancement sont deux gestes. */
export function approveAction(db: Db, row: ProjectActionRow): ProjectActionRow {
  const approval = reviewed(row, Date.now())
  // Gardé par `updatedAt` : un agent qui réécrit la commande pendant qu'on la lit ne
  // doit pas faire valider ce qu'on n'a pas vu.
  const written = db.update(projectActions)
    .set(approval)
    .where(and(eq(projectActions.id, row.id), eq(projectActions.updatedAt, row.updatedAt)))
    .run()
  if (written.changes === 0) throw changedMeanwhile()
  return { ...row, ...approval }
}

/**
 * Refuser ce qu'un agent propose : revenir à la commande relue en dernier. Une action
 * qui n'a jamais été relue n'a rien où revenir, elle disparaît : c'est à l'appelant de
 * la supprimer (null).
 */
export function rejectAction(db: Db, row: ProjectActionRow): ProjectActionRow | null {
  if (row.approvedAt) throw conflict('action_not_proposed', 'This action has nothing to review.')
  if (row.approvedCommand === null) return null
  const now = Date.now()
  const next: ProjectActionRow = {
    ...row,
    kind: row.approvedKind ?? row.kind,
    command: row.approvedCommand,
    subdir: row.approvedSubdir,
    url: row.approvedUrl,
    approvedAt: now,
    updatedAt: now,
  }
  const written = db.update(projectActions)
    .set(next)
    .where(and(eq(projectActions.id, row.id), eq(projectActions.updatedAt, row.updatedAt)))
    .run()
  if (written.changes === 0) throw changedMeanwhile()
  return next
}

/** La relecture portait sur une version que quelqu'un a réécrite depuis : à relire. */
function changedMeanwhile() {
  return conflict('action_changed', 'This action changed while you were reviewing it.')
}

export function deleteAction(db: Db, actionId: string): void {
  db.delete(projectActions).where(eq(projectActions.id, actionId)).run()
}

function toDto(
  row: ProjectActionRow,
  service: ProjectActionServiceState | null,
  terminal: TerminalDto | null,
  agentConversationTitle: string | null,
  runs: ActionRunDto[],
): ProjectActionDto {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    description: row.description,
    kind: row.kind,
    command: row.command,
    subdir: row.subdir,
    url: row.url,
    placement: row.placement,
    pinnedBranch: row.pinnedBranch,
    status: row.approvedAt ? 'approved' : 'proposed',
    approved:
      row.approvedCommand === null
        ? null
        : { kind: row.approvedKind ?? row.kind, command: row.approvedCommand, subdir: row.approvedSubdir, url: row.approvedUrl },
    agentConversationId: row.agentConversationId,
    agentConversationTitle,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    service,
    lastRun: terminal
      ? { terminalId: terminal.id, alive: terminal.alive, exitCode: terminal.exitCode, startedAt: terminal.createdAt }
      : null,
    runs,
  }
}

/** Ce qui décide d'un lancement, en plus de l'action et du dossier. */
export interface ActionRunOptions {
  /** Qui l'a lancée : un clic par défaut. */
  trigger?: ActionRunTrigger
  /** Ajoutés à la commande relue, chacun cité pour le shell. */
  args?: string[]
  /** Un service qui tourne depuis un autre arbre y est arrêté, puis démarré ici. */
  switch?: boolean
}

const SERVICE_RUNNING = ['active', 'activating', 'reloading']

export class ActionRunner {
  private readonly served = new ServedReader()

  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly terminals: TerminalManager,
    private readonly environments: Environments,
    /** systemd, sauf dans les tests. */
    private readonly units: ServiceUnits = systemdUnits,
  ) {
    // Construit après la relecture des terminaux : aucun ne tourne plus d'avant.
    closeOrphanRuns(db, terminals.live().map((terminal) => terminal.id))
  }

  private shell(): string {
    return process.env.SHELL || '/bin/sh'
  }

  /**
   * L'état des unités, lu en une passe pour toute la liste, et ce que sert chacune de
   * celles qui tournent.
   */
  private async serviceStates(rows: ProjectActionRow[]): Promise<Map<string, ProjectActionServiceState>> {
    const states = new Map<string, ProjectActionServiceState>()
    const services = rows.filter((row) => row.kind === 'service')
    if (services.length === 0 || !(await this.units.available())) return states
    const apps = await this.units.scan(processOrigins(this.config.paths.data))
    const byUnit = new Map<string, ServiceUnitState>(apps.map((app) => [app.unit, app]))
    const trees = this.projectTrees([...new Set(services.map((row) => row.projectId))])
    await Promise.all(services.map(async (row) => {
      const unit = actionUnit(row.id)
      const app = byUnit.get(unit)
      const state = app?.state ?? 'inactive'
      const cwd = app?.cwd ?? null
      const running = cwd !== null && SERVICE_RUNNING.includes(state)
      states.set(row.id, {
        unit,
        state,
        cwd,
        ports: app?.ports ?? [],
        startedAt: app?.startedAt ?? null,
        served: running ? await this.served.read(cwd, treeOf(cwd, trees.get(row.projectId) ?? [])) : null,
      })
    }))
    return states
  }

  /** Les arbres de chaque projet : sa racine, puis ses worktrees Solera encore là. */
  private projectTrees(projectIds: string[]): Map<string, ProjectTree[]> {
    const trees = new Map<string, ProjectTree[]>()
    for (const project of this.db
      .select({ id: projects.id, path: projects.workspacePath })
      .from(projects)
      .where(inArray(projects.id, projectIds))
      .all()) {
      trees.set(project.id, [{ path: project.path, worktreeId: null, root: true }])
    }
    for (const worktree of this.db
      .select({ id: worktrees.id, projectId: worktrees.projectId, path: worktrees.path })
      .from(worktrees)
      .where(and(inArray(worktrees.projectId, projectIds), isNull(worktrees.removedAt)))
      .all()) {
      trees.get(worktree.projectId)?.push({ path: worktree.path, worktreeId: worktree.id, root: false })
    }
    return trees
  }

  async toDtos(rows: ProjectActionRow[]): Promise<ProjectActionDto[]> {
    const states = await this.serviceStates(rows)
    const authors = [...new Set(rows.map((row) => row.agentConversationId).filter((id) => id !== null))]
    const titles = new Map(
      authors.length === 0
        ? []
        : this.db
            .select({ id: conversations.id, title: conversations.title })
            .from(conversations)
            .where(inArray(conversations.id, authors))
            .all()
            .map((entry) => [entry.id, entry.title]),
    )
    const runs = latestRuns(this.db, rows.map((row) => row.id))
    return rows.map((row) =>
      toDto(
        row,
        states.get(row.id) ?? null,
        this.terminals.latestForAction(row.projectId, row.id),
        row.agentConversationId ? (titles.get(row.agentConversationId) ?? null) : null,
        runs.get(row.id) ?? [],
      ),
    )
  }

  async toDto(row: ProjectActionRow): Promise<ProjectActionDto> {
    return (await this.toDtos([row]))[0]!
  }

  /** Le dossier d'exécution : le worktree donné, plus le sous-dossier de l'action. */
  private async cwdFor(row: ProjectActionRow, base: string): Promise<string> {
    const cwd = row.subdir ? join(base, row.subdir) : base
    const isDir = await stat(cwd).then((s) => s.isDirectory(), () => false)
    if (!isDir) {
      throw new HttpError(409, 'action_cwd_missing', 'The directory {path} does not exist.', { path: cwd })
    }
    return cwd
  }

  /**
   * L'arbre où un service tourne d'après son placement ; pour une tâche, et un service
   * qui suit, celui d'où on le lance. Une branche fixée tourne à la racine quand elle y
   * est. Ailleurs, refus : le worktree d'une session qui l'aurait sortie disparaît à sa
   * fusion, et le service avec ; il faudra un worktree dédié, tenu par Solera.
   */
  private async placedBase(row: ProjectActionRow, requested: string): Promise<string> {
    if (row.kind !== 'service' || row.placement === 'follow') return requested
    const project = this.db
      .select({ path: projects.workspacePath })
      .from(projects)
      .where(eq(projects.id, row.projectId))
      .get()
    if (!project) throw notFound('project_not_found', 'Project not found.')
    if (row.placement === 'root') return project.path
    const branch = row.pinnedBranch ?? ''
    if ((await readGitHead(project.path))?.branch !== branch) {
      throw conflict('action_branch_needs_worktree', 'The project root is not on {branch}, and no worktree is kept for it yet.', { branch })
    }
    return project.path
  }

  /**
   * Lance l'action. Une exécution qui tourne encore dans le même dossier est rendue
   * telle quelle plutôt que doublée, d'où qu'on l'ait lancée : deux serveurs de dev se
   * disputeraient le port, deux suites de tests la base. Des `args` n'y changent rien :
   * la réponse dit `alreadyRunning`, à l'appelant de le montrer.
   *
   * Une tâche d'un autre worktree ne bloque pas : chacun a son arbre. Un service, si :
   * il n'a qu'une unité, et la rendre en silence ferait croire qu'on voit cet arbre-ci
   * quand il en sert un autre. Il est refusé avec ce qu'il sert, et `switch` le bascule.
   *
   * Lancée dans un terminal, elle écrit un passage, clos à la sortie du terminal.
   */
  async run(
    row: ProjectActionRow,
    requested: string,
    conversationId: string | null,
    { trigger = 'manual', args = [], switch: switching = false }: ActionRunOptions = {},
  ): Promise<ProjectActionRunResult> {
    // « Relancer seulement les échecs » vise une commande qui finit ; un service relancé
    // avec d'autres arguments serait une autre commande que celle relue.
    if (args.length > 0 && row.kind === 'service') {
      throw conflict('action_args_task_only', 'Extra arguments only apply to a task.')
    }
    const cwd = await this.cwdFor(row, await this.placedBase(row, requested))
    const command = args.length > 0 ? `${row.command} ${args.map(shellQuote).join(' ')}` : row.command
    const origin = processOrigins(this.config.paths.data).environment(row.projectId, conversationId)

    // Un service tourne sous systemd, sur l'hôte : lancé depuis un environnement confiné,
    // il en sortirait. Il passe alors par un terminal, que l'environnement confine.
    const confined = (conversationId ? this.environments.ofConversation(conversationId) : this.environments.ofProject(row.projectId)).confined
    if (row.kind === 'service' && !confined && (await this.units.available())) {
      const current = (await this.serviceStates([row])).get(row.id)!
      if (SERVICE_RUNNING.includes(current.state)) {
        if (current.cwd === cwd) return { terminal: null, service: current, alreadyRunning: true }
        if (!switching) throw runningElsewhere(row, current)
        await this.units.stop(current.unit)
      }
      await this.units.start({
        unit: current.unit,
        description: row.label,
        cwd,
        shell: this.shell(),
        command,
        env: origin,
      })
      return { terminal: null, service: (await this.serviceStates([row])).get(row.id)!, alreadyRunning: false }
    }

    const previous = this.terminals.liveForAction(row.projectId, row.id, cwd)
    if (previous) return { terminal: previous, service: null, alreadyRunning: true }
    // Dans l'environnement de la session qui la lance, et hors session dans celui du
    // projet : comme un terminal.
    await this.environments.prepare(this.environments.terminalEnvironment(row.projectId, conversationId), row.projectId, { cwd })
    const environment = await this.environments.forTerminal(row.projectId, conversationId, cwd)
    let terminal: ReturnType<TerminalManager['open']>
    // Le passage est écrit juste après l'ouverture, dans le même tour de boucle : la
    // sortie du terminal, même immédiate, arrive après.
    let runId: string | null = null
    try {
      terminal = this.openTerminal(row.projectId, cwd, { environment, conversationId }, {
        command,
        title: row.label,
        actionId: row.id,
        env: origin,
        onExit: (end) => {
          if (runId) finishRun(this.db, runId, end)
        },
      })
    } catch (err) {
      // Un conteneur éphémère démarré pour rien ne doit pas rester.
      await environment.close().catch(() => undefined)
      throw err
    }
    runId = startRun(this.db, { actionId: row.id, projectId: row.projectId, trigger, conversationId, terminalId: terminal.id, cwd })
    return { terminal, service: null, alreadyRunning: false }
  }

  private openTerminal(...args: Parameters<TerminalManager['open']>) {
    try {
      return this.terminals.open(...args)
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'too_many_terminals') {
        throw conflict('too_many_terminals', err.message)
      }
      throw err
    }
  }

  /** Arrêter ou relancer un service ; repli sur son terminal sans systemd. */
  async control(row: ProjectActionRow, op: ServiceActionControl, base: string): Promise<ProjectActionRunResult> {
    if (row.kind !== 'service') throw conflict('action_not_service', 'Only service actions can be stopped or restarted.')
    if (await this.units.available()) {
      const current = (await this.serviceStates([row])).get(row.id)!
      if (current.state === 'inactive' || current.state === 'failed') {
        if (op === 'stop') return { terminal: null, service: current, alreadyRunning: false }
        return this.run(row, base, null)
      }
      await this.units.control(current.unit, op)
      return { terminal: null, service: current, alreadyRunning: false }
    }
    const previous = this.terminals.latestForAction(row.projectId, row.id)
    if (previous) this.terminals.close(previous.id)
    if (op === 'stop') return { terminal: null, service: null, alreadyRunning: false }
    return this.run(row, previous?.cwd ?? base, null)
  }

  /** Le journal d'un service, suivi dans un terminal du panneau. */
  async logs(row: ProjectActionRow, base: string): Promise<ProjectActionRunResult> {
    if (row.kind !== 'service' || !(await this.units.available())) {
      throw conflict('action_no_logs', 'Only services run by systemd have a journal.')
    }
    const key = logsKey(row.id)
    const previous = this.terminals.latestForAction(row.projectId, key)
    if (previous?.alive) return { terminal: previous, service: null, alreadyRunning: true }
    // Le journal d'une unité de l'hôte se lit sur l'hôte, quel que soit l'environnement.
    const terminal = this.openTerminal(row.projectId, base, { environment: hostEnvironment, conversationId: null }, {
      command: `journalctl --user -u ${actionUnit(row.id)} -f -n 200 -o cat`,
      title: `${row.label} · logs`,
      actionId: key,
    })
    return { terminal, service: null, alreadyRunning: false }
  }

  /** À la suppression : une unité orpheline tournerait sans bouton pour l'arrêter. */
  async forget(row: ProjectActionRow): Promise<void> {
    if (row.kind === 'service' && (await this.units.available())) {
      await this.units.control(actionUnit(row.id), 'stop').catch(() => undefined)
    }
  }
}

/**
 * Le refus d'un service qui tourne depuis un autre arbre, avec de quoi dire lequel et
 * ouvrir celui qui tourne plutôt que de le basculer.
 */
function runningElsewhere(row: ProjectActionRow, current: ProjectActionServiceState): HttpError {
  const served = current.served
  // Des chaînes, comme tout `params` : vide quand on ne sait pas.
  return conflict('service_running_elsewhere', '{label} already runs from {cwd}: switch it to run it here.', {
    label: row.label,
    cwd: current.cwd ?? '',
    worktreeId: served?.worktreeId ?? '',
    root: served?.root ? 'true' : '',
    branch: served?.branch ?? '',
    head: served?.head ?? '',
    dirtyFiles: served?.dirtyFiles ?? 0,
    ports: current.ports.map((port) => `:${port}`).join(' '),
    href: resolveActionUrl(row.url, current.ports) ?? '',
  })
}

/** Un argument cité pour un shell POSIX : passé tel quel, espaces et `$` compris. */
function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`
}
