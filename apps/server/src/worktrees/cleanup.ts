import { rm, stat } from 'node:fs/promises'
import { and, inArray, isNull } from 'drizzle-orm'
import { cards, conversations, type Db, type ProjectRow } from '@solera/db'
import type {
  WorktreeCleanupPlanDto,
  WorktreeCleanupResultDto,
  WorktreeStatusDto,
  WorktreeStatusListDto,
} from '@solera/protocol'
import { GitError, deleteBranch, removeWorktree } from '../git.js'
import { controlServiceApp, scanServiceApps, serviceAppsAvailable } from '../services/apps.js'
import { processOrigins, type ProcessOrigins } from '../services/origins.js'
import { readProcessHost } from '../services/ownership.js'
import { scanServiceProcesses, stopServiceProcess, type ServiceProcess } from '../services/processes.js'
import type { TerminalManager } from '../terminals/terminal-manager.js'
import { HttpError } from '../http/errors.js'
import { listWorktrees } from './assess.js'
import { markWorktreeGone } from './gone.js'
import type { WorktreeStatusService } from './status-service.js'

/**
 * Les sessions qui vivent dans l'arbre : leur cwd y est (`worktree_id`). Ce sont elles
 * que le nettoyage range, faute de quoi elles repartiraient à la racine du projet sans le
 * dire (carte #61). Celles qui n'y ont qu'écrit ou cité un chemin, souvent une session
 * de la racine qui orchestre les autres, ne sont pas touchées.
 */
function residents(tree: WorktreeStatusDto): string[] {
  return tree.conversations.filter((entry) => entry.link === 'worktree').map((entry) => entry.id)
}

/**
 * Les sessions non archivées qui vivent hors de l'arbre mais y ont écrit, souvent une
 * session de la racine qui l'a créé. Le nettoyage ne les range pas : elles continuent,
 * et leur CLI est relancé sans l'arbre à leur prochain message (`recycleIfTreesGone`).
 * La confirmation les nomme, pour que ce redémarrage ne surprenne personne.
 */
function linkedOutside(db: Db, tree: WorktreeStatusDto): { id: string; title: string; running: boolean }[] {
  const ids = tree.conversations.filter((entry) => entry.link === 'edited').map((entry) => entry.id)
  if (ids.length === 0) return []
  return db
    .select({ id: conversations.id, title: conversations.title, status: conversations.status })
    .from(conversations)
    .where(and(inArray(conversations.id, ids), isNull(conversations.archivedAt)))
    .all()
    .map(({ id, title, status }) => ({ id, title, running: isBusy(status) }))
}

/**
 * Les sessions liées à l'arbre qui travaillent en ce moment, qu'elles y vivent ou y
 * écrivent par chemins absolus (`create_worktree`) : le nettoyage les attend toutes,
 * plutôt que de retirer un dossier sous un agent qui s'en sert.
 */
function busyIn(db: Db, tree: WorktreeStatusDto): { id: string; title: string }[] {
  const ids = tree.conversations.map((entry) => entry.id)
  if (ids.length === 0) return []
  return db
    .select({ id: conversations.id, title: conversations.title, status: conversations.status })
    .from(conversations)
    .where(and(inArray(conversations.id, ids), isNull(conversations.archivedAt)))
    .all()
    .filter((row) => isBusy(row.status))
    .map(({ id, title }) => ({ id, title }))
}

/** Ce que le nettoyage demande au gestionnaire de sessions pour celles qu'il range. */
export interface CleanupSessions {
  dropCheckpoints(conversationId: string): Promise<void>
  /** Arrête le CLI s'il est au repos ; faux s'il tourne. */
  releaseRunner(conversationId: string): Promise<boolean>
}

/**
 * Nettoyer un chantier en un geste : arrêter ce qui y tourne, ranger ses sessions,
 * retirer l'arbre et sa branche.
 *
 * Deux temps, le plan puis l'exécution, parce que rien ici ne doit partir en silence :
 * la confirmation montre ce que le plan a trouvé, et l'exécution refait les mêmes
 * recherches au moment d'agir plutôt que de se fier à une liste qui a pu vieillir.
 */
export class WorktreeCleanup {
  private readonly origins: ProcessOrigins

  constructor(
    private readonly db: Db,
    dataDirectory: string,
    private readonly status: WorktreeStatusService,
    private readonly terminals: TerminalManager,
    private readonly sessions: CleanupSessions,
  ) {
    this.origins = processOrigins(dataDirectory)
  }

  /**
   * L'arbre désigné par son chemin, s'il appartient bien au projet : connu de git ou de
   * la base, jamais un dossier quelconque. C'est la seule garde entre une route et un
   * `rm -rf`. Relu à l'instant et non tiré du cache : la branche et l'état qu'on montre,
   * ou sur lesquels on agit, doivent être ceux de maintenant.
   */
  private async locate(
    project: ProjectRow,
    path: string,
  ): Promise<{ tree: WorktreeStatusDto; list: WorktreeStatusListDto } | null> {
    this.status.invalidate(project.id)
    const list = await this.status.current(project)
    const tree = list.worktrees.find((entry) => entry.path === path)
    return tree ? { tree, list } : null
  }

  async plan(project: ProjectRow, path: string): Promise<WorktreeCleanupPlanDto | null> {
    const found = await this.locate(project, path)
    if (!found) return null
    const { tree, list } = found

    const linked = residents(tree)
    const open = linked.length
      ? this.db
          .select({ id: conversations.id, title: conversations.title, cardId: conversations.cardId, status: conversations.status })
          .from(conversations)
          .where(and(inArray(conversations.id, linked), isNull(conversations.archivedAt)))
          .all()
      : []

    // La carte d'une session rattachée, si elle n'est pas déjà sortie du board.
    const cardIds = [...new Set(open.map((c) => c.cardId).filter((id): id is string => id !== null))]
    const card = cardIds.length
      ? this.db
          .select({ id: cards.id, number: cards.number, title: cards.title, column: cards.column })
          .from(cards)
          .where(inArray(cards.id, cardIds))
          .all()
          .find((entry) => entry.column !== 'done' && entry.column !== 'abandoned') ?? null
      : null

    return {
      path: tree.path,
      name: tree.name,
      branch: tree.branch,
      state: tree.state,
      modified: tree.modified,
      untracked: tree.untracked,
      ahead: tree.ahead,
      unmergedCommits: tree.unmergedCommits,
      branchDeletable: tree.branch !== null && tree.branch !== list.base,
      conversations: open.map(({ id, title }) => ({ id, title })),
      busy: busyIn(this.db, tree),
      restarted: linkedOutside(this.db, tree),
      services: (await this.servicesUnder(path)).map((s) => ({ id: s.id, label: s.label, kind: s.kind })),
      terminals: this.terminals.underCwd(path).length,
      card: card ? { id: card.id, number: card.number, title: card.title } : null,
    }
  }

  async run(
    project: ProjectRow,
    options: { path: string; deleteBranch: boolean; stopServices: boolean },
  ): Promise<WorktreeCleanupResultDto | null> {
    const found = await this.locate(project, options.path)
    if (!found) return null
    const { tree, list } = found
    const base = list.base
    const result: WorktreeCleanupResultDto = { removed: false, branchDeleted: false, archived: 0, stopped: 0 }

    // Une session qui travaille dans l'arbre ne le perd pas sous elle : on attend la fin
    // de son tour plutôt que de l'interrompre. Relu ici, le plan a pu vieillir.
    const ids = residents(tree)
    const busy = busyIn(this.db, tree)
    if (busy.length > 0) {
      throw new HttpError(409, 'worktree_busy', 'A session is working in this worktree ({title}).', {
        title: busy[0]!.title,
      })
    }

    // Ce qui tourne dedans d'abord : un serveur dont le dossier disparaît sous lui ne
    // s'arrête pas proprement, il se met en échec.
    if (options.stopServices) {
      for (const service of await this.servicesUnder(tree.path)) {
        if (await service.stop()) result.stopped += 1
      }
    }
    for (const id of this.terminals.underCwd(tree.path)) this.terminals.close(id)

    // Archivée, la session est rangée avant que son cwd disparaisse : elle ne reprendra
    // pas à la racine en silence. Ses demandes en attente sont retirées au balayage.
    if (ids.length > 0) {
      result.archived = this.db
        .update(conversations)
        .set({ archivedAt: Date.now() })
        .where(and(inArray(conversations.id, ids), isNull(conversations.archivedAt)))
        .run().changes
      // Les captures de tour vivent dans le dépôt de l'arbre : à retirer avant lui. Le
      // CLI resté chaud aussi, dont le cwd va disparaître : aucune ne travaille, le
      // refus plus haut l'a vérifié. Les sessions de la racine liées à l'arbre gardent
      // le leur, relancé à leur prochain tour sans l'arbre (`recycleIfTreesGone`).
      for (const id of ids) {
        await this.sessions.dropCheckpoints(id).catch(() => undefined)
        await this.sessions.releaseRunner(id).catch(() => false)
      }
    }

    // `worktree remove --force` retire aussi une entrée dont le dossier a disparu, et
    // elle seule : pas de `prune`, qui purgerait en silence les autres arbres perdus.
    try {
      await removeWorktree(project.workspacePath, tree.path, true)
    } catch (err) {
      if (!(err instanceof GitError)) throw err
      // Git refuse un arbre qu'il connaît encore (verrouillé, sous-module) : on s'arrête
      // là, son refus dit pourquoi. Le dossier ne part seul que si git ne le connaît
      // plus, une entrée de la base seulement.
      const known = (await listWorktrees(project.workspacePath)).some((entry) => entry.path === tree.path)
      if (known) {
        throw new HttpError(409, 'worktree_remove_refused', 'Git refused to remove this worktree: {reason}', {
          reason: err.message,
        })
      }
      if (await stat(tree.path).then((s) => s.isDirectory()).catch(() => false)) {
        await rm(tree.path, { recursive: true, force: true })
      }
    }
    result.removed = true

    if (options.deleteBranch && tree.branch && tree.branch !== base) {
      await deleteBranch(project.workspacePath, tree.branch)
        .then(() => { result.branchDeleted = true })
        .catch(() => undefined)
    }

    if (tree.id) markWorktreeGone(this.db, tree.id)
    this.status.forget(project.id)
    return result
  }

  /**
   * Les apps `solera-app-*` et les processus suivis dont le répertoire est dans
   * l'arbre, chacun avec la façon de l'arrêter.
   */
  private async servicesUnder(path: string): Promise<{ id: string; label: string; kind: 'app' | 'process'; stop: () => Promise<boolean> }[]> {
    if (process.platform !== 'linux') return []
    const prefix = `${path}/`
    const under = (cwd: string | null) => cwd !== null && (cwd === path || cwd.startsWith(prefix))
    const found: { id: string; label: string; kind: 'app' | 'process'; stop: () => Promise<boolean> }[] = []

    if (await serviceAppsAvailable()) {
      for (const app of await scanServiceApps(this.origins)) {
        if (!under(app.cwd) || !['active', 'activating', 'reloading'].includes(app.state)) continue
        found.push({
          id: app.id,
          label: app.description || app.unit,
          kind: 'app',
          stop: () => controlServiceApp(app.unit, 'stop').then(() => true, () => false),
        })
      }
    }
    let processes: ServiceProcess[] = []
    try {
      processes = await scanServiceProcesses(this.origins)
    } catch {
      return found
    }
    const host = await readProcessHost()
    for (const service of processes) {
      if (!under(service.cwd) || !service.origin || service.kind === 'launcher' || service.kind === 'helper') continue
      found.push({
        id: service.id,
        label: service.command ?? service.name,
        kind: 'process',
        stop: async () => stopServiceProcess(service, this.origins, host),
      })
    }
    return found
  }
}

/** Un tour en cours, ou arrêté sur une demande qui le reprendra sans prévenir. */
function isBusy(status: string): boolean {
  return status === 'running' || status === 'awaiting_input'
}
