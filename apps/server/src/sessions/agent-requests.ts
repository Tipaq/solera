import { randomUUID } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { Cron } from 'croner'
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import {
  agentRequests,
  cardNotes,
  conversationPaths,
  cards,
  conversations,
  projects,
  scheduledTasks,
  worktrees,
  type AgentRequestRow,
  type ConversationRow,
  type ProjectRow,
} from '@solera/db'
import {
  DEFAULT_CHECK_TIMEOUT_SECONDS,
  DEFAULT_SCHEDULE_DURATION_MINUTES,
  MAX_CHECK_SCRIPT_CHARS,
  MAX_CHECK_TIMEOUT_SECONDS,
  MIN_CHECK_TIMEOUT_SECONDS,
  checkScriptSchema,
  checkTimeoutSchema,
  MAX_SCHEDULE_DURATION_MINUTES,
  MAX_SCHEDULE_NAME_CHARS,
  MAX_SCHEDULE_PROMPT_CHARS,
  MIN_SCHEDULE_DURATION_MINUTES,
  agentConfigSchema,
  agentKindSchema,
  cardColumnSchema,
  defaultConfigFor,
  formatSessionMessage,
  parseAgentConfig,
  readProjectDefaults,
  scheduleCadenceSchema,
  type ScheduleCadence,
  type AgentConfig,
  type AgentKind,
  type AgentModelDto,
  type CardColumn,
  type WorktreeState,
} from '@solera/protocol'
import type { AgentRegistry } from '../agents/registry.js'
import { advanceCardOnLaunch, createCard } from '../cards/create.js'
import { createConversation } from '../conversations/create.js'
import { moveConversation } from '../conversations/move.js'
import { conversationVisibleTo, inProject } from '../conversations/scope.js'
import type { EventLog } from '../events/event-log.js'
import { readGitStatus } from '../git.js'
import { DecisionRefusal, type DecisionDeposit, type Decisions } from '../decisions/decisions.js'
import type { AppContext } from '../http/context.js'
import { describeHttpError, HttpError } from '../http/errors.js'
import { assertUsableWorkspace, insertProject } from '../projects/create.js'
import { defaultBase } from '../worktrees/assess.js'
import type { WorktreeStatusService } from '../worktrees/status-service.js'
import { createScheduledTask } from '../scheduler/tasks.js'
import { readUserSettings } from '../settings/user-settings.js'
import { createWorktree } from '../worktrees/create.js'
import type { SessionManager } from './session-manager.js'

/**
 * Traite les demandes que les sessions adressent au daemon par le serveur MCP :
 * lancer une autre session, créer une carte, planifier une tâche, lire le catalogue des
 * modèles, déclarer un projet, demander le rangement d'une conversation ou celui de
 * cartes du board, demander une décision.
 *
 * Le serveur MCP n'a que la base. Il dépose la demande et attend que ce balayage y
 * écrive le résultat ; plus court que celui du relais, parce qu'ici un agent est
 * suspendu à la réponse.
 *
 * Les deux rangements font exception à ce rythme : l'agent apprend tout de suite que sa
 * demande est déposée, et c'est un clic, plus tard, qui l'accorde.
 *
 * Pour une **conversation**, la promesse vit alors dans la ligne (`accepted_at`) et non
 * en mémoire, pour survivre à un redémarrage du serveur, et c'est ce même balayage qui
 * l'applique — il tente, et le refus de `releaseRunner` devient la condition de réessai :
 * le déplacement a lieu dès que la conversation se tait.
 *
 * Une **décision** suit le même rythme : déposée tout de suite, tranchée plus tard par la
 * route, et c'est ce balayage qui la fait échoir ou la retire d'une session archivée
 * (`decisions/decisions.ts`).
 *
 * Pour des **cartes**, rien à attendre ni à relâcher : le clic applique lui-même, dans
 * une transaction, et ce balayage ne revoit jamais la demande. C'est le seul écart de
 * fond entre les deux, et il vient de ce qu'une carte n'héberge aucun process.
 *
 * Toutes les réponses sont du texte rédigé pour le modèle, en français comme le reste
 * des outils : c'est lui qui les lit, et une erreur doit lui dire quoi corriger.
 */

const POLL_MS = 500

/**
 * Au-delà, une demande n'est plus traitée : le serveur MCP qui l'attendait a rendu la
 * main depuis longtemps, et lancer une session dont personne n'a l'identifiant serait
 * pire que ne rien lancer.
 */
const STALE_MS = 5 * 60 * 1000

/**
 * Profondeur maximale d'une chaîne de lancements : l'utilisateur ouvre une session, qui
 * en lance une, qui peut en lancer une dernière. Au-delà, chaque étage s'éloigne d'une
 * personne qui regarde, et c'est ainsi qu'un essaim se forme sans que personne l'ait voulu.
 */
export const MAX_LAUNCH_DEPTH = 2

/** Lancements réussis par session et par heure. */
export const LAUNCHES_PER_HOUR = 6

/** Une mission plus longue tient dans un fichier que la mission cite. */
export const MAX_LAUNCH_PROMPT_CHARS = 20000

const HOUR_MS = 60 * 60 * 1000

/**
 * Cadence la plus serrée qu'un agent peut poser. L'interface descend plus bas, mais là
 * une personne a choisi : une tâche à la minute créée sur un malentendu brûlerait un
 * quota entier avant que quiconque la voie.
 */
export const MIN_AGENT_SCHEDULE_MINUTES = 15

/** Tâches par projet au-delà desquelles un agent n'en ajoute plus. */
export const MAX_AGENT_SCHEDULES_PER_PROJECT = 20

/**
 * Projets qu'une session peut déclarer en une heure.
 *
 * La borne sert ici et nulle part ailleurs, parce que `create_project` est la seule des
 * deux écritures de rangement qui n'attend pas de clic : un agent pris dans une boucle
 * d'erreur poserait cinquante projets avant que quiconque les voie. Le déplacement, lui,
 * est tenu par son invariant — une demande en attente à la fois.
 */
export const PROJECTS_PER_HOUR = 1

/**
 * Cartes qu'une seule demande de déplacement peut porter. Doit rester d'accord avec
 * `MAX_CARD_MOVES` de `apps/server/src/mcp/solera-mcp.mjs`, qui le dit à l'agent.
 *
 * Une liste existe pour le cas qui a ouvert la carte #54 — treize cartes finies restées
 * en « en cours » — et vingt le couvre largement. Au-delà, ce n'est plus une proposition
 * qu'une personne relit avant de cliquer.
 */
export const MAX_CARD_MOVES = 20

/** Au-delà, la raison n'est plus une phrase et la demande ne se lit plus d'un coup. */
export const MAX_CARD_MOVE_REASON_CHARS = 500

/** Les colonnes en toutes lettres, pour le texte rendu à l'agent. */
const COLUMN_WORDS: Record<CardColumn, string> = {
  todo: 'à faire',
  in_progress: 'en cours',
  review: 'à vérifier',
  done: 'terminé',
  abandoned: 'abandonné',
}

/** Les genres dont le résultat change une liste de l'interface. */
const CHANGES_LISTS = new Set<AgentRequestRow['kind']>([
  'start_session',
  'create_card',
  'create_project',
  'move_conversation',
  'request_card_move',
])


class Refusal extends Error {}

/** Doit rester d'accord avec `createWorktreeBodySchema` du protocole : le nom sert aussi de dossier. */
function assertWorktreeName(name: string): void {
  if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.split('/').includes('..') || name.startsWith('/') || name.endsWith('/')) {
    throw new Refusal(`Nom de worktree invalide « ${name} » : lettres, chiffres, . _ - / seulement, comme une branche git.`)
  }
}

/** L'état d'un arbre dit à un agent, avec ce qu'il implique pour lui. */
const WORKTREE_STATE_WORDS: Record<WorktreeState, string> = {
  missing: 'introuvable (dossier disparu)',
  unreadable: 'illisible (git n’a pas pu le juger)',
  dirty: 'non commité',
  unmerged: 'commité, à fusionner',
  empty: 'sans travail encore (aucun commit propre)',
  merged: 'fusionné, rien à garder (à nettoyer)',
}

/**
 * Le fil que `move_conversation` déplace : celui que l'agent a nommé, ou le sien.
 *
 * Relu de la charge plutôt que stocké en colonne : c'est l'argument de l'outil, et la
 * demande n'en normalise rien. Le dépôt et le balayage qui applique doivent lire la même
 * chose, d'où cette fonction et non deux ternaires.
 */
function filingTargetId(request: AgentRequestRow): string {
  const payload = JSON.parse(request.payload) as { conversation?: unknown }
  return typeof payload.conversation === 'string' && payload.conversation.trim()
    ? payload.conversation.trim()
    : request.conversationId
}

interface StartSessionPayload {
  prompt?: unknown
  title?: unknown
  agent?: unknown
  model?: unknown
  effort?: unknown
  worktree?: unknown
  card?: unknown
}

export class AgentRequests {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private logger: FastifyBaseLogger | null = null

  constructor(
    private readonly ctx: AppContext,
    private readonly sessions: SessionManager,
    private readonly registry: AgentRegistry,
    private readonly log: EventLog,
    /** Les décisions ; sans elles, `request_decision` est refusé. */
    private readonly decisions?: Decisions,
    /** Avancement des worktrees ; sans lui, `list_worktrees` est refusé. */
    private readonly worktreeStatus?: WorktreeStatusService,
  ) {}

  start(logger: FastifyBaseLogger): void {
    this.logger = logger
    this.decisions?.setLogger(logger)
    this.timer = setInterval(() => void this.sweep(), POLL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async sweep(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const pending = this.ctx.db
        .select()
        .from(agentRequests)
        .where(isNull(agentRequests.settledAt))
        .orderBy(asc(agentRequests.createdAt))
        .limit(20)
        .all()

      for (const request of pending) {
        if (request.createdAt < Date.now() - STALE_MS) {
          this.settle(request, "Demande expirée : Solera ne l'a pas traitée à temps.", true)
          continue
        }
        await this.handle(request)
      }

      await this.applyFilings()
      // Les échéances des décisions, sur le même balayage que les rangements accordés :
      // une requête indexée sur le genre et la clôture, vide la plupart du temps.
      this.decisions?.sweep()
    } finally {
      this.busy = false
    }
  }

  private async handle(request: AgentRequestRow): Promise<void> {
    try {
      const payload = JSON.parse(request.payload) as Record<string, unknown>
      // La conversation d'abord, son projet ensuite et seulement pour les genres qui en
      // ont besoin : un fil libre dépose lui aussi des demandes, et `project_id` est
      // alors nul des deux côtés. `inProject` et non `eq`, parce que `project_id = NULL`
      // ne rend jamais vrai en SQL — la demande semblerait venir d'une autre session.
      const requester = this.ctx.db
        .select()
        .from(conversations)
        .where(and(eq(conversations.id, request.conversationId), inProject(request.projectId)))
        .get()
      if (!requester) throw new Refusal("La session qui demande n'existe plus dans ce projet.")

      // Les trois genres qui ne parlent pas d'un projet passent avant qu'on en exige
      // un : un fil libre en dépose aussi. Les mettre après `requireProject` les lui
      // refuserait, alors que déclarer un projet est justement ce qu'il a à faire.
      if (request.kind === 'create_card') {
        this.settle(request, this.createCard(requester, payload), false)
        return
      }
      if (request.kind === 'create_project') {
        this.settle(request, await this.createProject(request, requester, payload), false)
        return
      }
      if (request.kind === 'move_conversation') {
        this.settle(request, await this.requestFiling(request, requester, payload), false)
        return
      }

      if (request.kind === 'request_decision') {
        const deposit = this.requestDecision(request, requester, payload)
        this.settle(request, deposit.text, false)
        deposit.announce()
        return
      }

      const project = this.requireProject(request.projectId)
      // Après `requireProject`, à la différence des trois ci-dessus : une carte
      // appartient à un projet, et un fil libre n'a aucun board à proposer de ranger.
      // C'est aussi pourquoi `request_card_move` n'entre pas dans `FREE_THREAD_TOOLS`.
      if (request.kind === 'request_card_move') {
        this.settle(request, this.requestCardMove(request, requester, project, payload), false)
        return
      }
      if (request.kind === 'start_session') {
        const { text, launchedId } = await this.startSession(request, requester, project, payload)
        this.settle(request, text, false, launchedId)
      } else if (request.kind === 'schedule_task') {
        this.settle(request, await this.scheduleTask(requester, project, payload), false)
      } else if (request.kind === 'create_worktree') {
        this.settle(request, await this.createWorktreeFor(requester, project, payload), false)
      } else if (request.kind === 'list_worktrees') {
        this.settle(request, await this.listWorktrees(requester, project), false)
      } else {
        this.settle(request, await this.listModels(requester, project, payload), false)
      }
    } catch (err) {
      if (!(err instanceof Refusal) && !(err instanceof HttpError)) {
        this.logger?.warn({ err, request: request.id, kind: request.kind }, 'demande d’agent en échec')
      }
      // Un rangement refusé d'entrée n'attend plus rien : sans cette clôture il tiendrait
      // indéfiniment la place de l'unique demande en attente de la conversation.
      if (
        request.kind === 'move_conversation' ||
        request.kind === 'request_card_move' ||
        request.kind === 'request_decision'
      ) {
        this.closeFiling(request.id)
      }
      this.settle(request, describeHttpError(err), true)
    }
  }

  /**
   * Le projet d'une demande qui en exige un.
   *
   * Séparé du préambule depuis que `project_id` est nullable : les genres d'avant le fil
   * libre parlent tous d'un projet, et c'est à eux de le réclamer plutôt qu'à la colonne
   * de l'imposer à ceux qui viendront.
   */
  private requireProject(projectId: string | null): ProjectRow {
    const project = projectId
      ? this.ctx.db.select().from(projects).where(eq(projects.id, projectId)).get()
      : null
    if (!project) {
      throw new Refusal(
        projectId
          ? "Le projet n'existe plus."
          : "Cette conversation n'appartient à aucun projet, et cet outil en demande un. Range-la dans un projet pour t'en servir.",
      )
    }
    return project
  }

  /**
   * Écrit la réponse rendue à l'agent, et signale les listes que la demande a changées.
   *
   * `lists` plutôt que `lists-changed` du hub : ce dernier est posé par un hook indexé
   * sur des URL de routes, que le daemon ne traverse pas. Sans ce signal, une carte ou un
   * projet créés par un agent n'apparaissent qu'au prochain rechargement.
   */
  private settle(
    request: AgentRequestRow,
    result: string,
    isError: boolean,
    launchedId: string | null = null,
  ): void {
    this.ctx.db
      .update(agentRequests)
      .set({ settledAt: Date.now(), result, isError, launchedConversationId: launchedId })
      .where(eq(agentRequests.id, request.id))
      .run()
    if (!isError && CHANGES_LISTS.has(request.kind)) this.notifyLists(request.conversationId)
  }

  private notifyLists(conversationId: string): void {
    this.sessions.statusBus.emit('lists', { conversationId })
  }

  /** La section « À décider » de ces comptes se relit : une demande les attend. */
  private notifyAwaiting(userIds: string[]): void {
    if (userIds.length > 0) this.sessions.statusBus.emit('awaiting', { userIds })
  }

  // --- start_session -------------------------------------------------------------

  private async startSession(
    request: AgentRequestRow,
    requester: ConversationRow,
    project: ProjectRow,
    payload: StartSessionPayload,
  ): Promise<{ text: string; launchedId: string }> {
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : ''
    if (!prompt) throw new Refusal('Le paramètre `prompt` est requis : la mission de la nouvelle session.')
    if (prompt.length > MAX_LAUNCH_PROMPT_CHARS) {
      throw new Refusal(
        `Mission trop longue (${prompt.length} caractères, ${MAX_LAUNCH_PROMPT_CHARS} au plus). Mets le détail dans un fichier et cite-le.`,
      )
    }

    this.assertLaunchAllowed(requester, request.id)

    const agent = this.parseAgent(payload.agent, requester.agent)
    const config = await this.launchConfig(agent, project, requester.userId, payload)
    const worktreeId = await this.launchTree(requester, project, payload.worktree)
    const card = this.launchCard(project.id, payload.card)
    const title =
      typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim().slice(0, 200) : undefined

    const row = await createConversation(this.ctx.db, this.sessions, {
      projectId: project.id,
      userId: requester.userId,
      agent,
      config,
      worktreeId,
      cardId: card?.id ?? null,
      title,
      titleSource: prompt,
      origin: null,
      firstMessage: {
        clientMessageId: randomUUID(),
        text: formatSessionMessage({
          kind: 'launch',
          from: requester.id,
          title: requester.title,
          agent: requester.agent,
          messageId: request.id,
          body: prompt,
        }),
        attachments: [],
        mentions: [],
        skills: [],
      },
    })
    if (card) advanceCardOnLaunch(this.ctx, card.id, requester.userId)

    const tree = worktreeId
      ? (this.ctx.db.select({ name: worktrees.name }).from(worktrees).where(eq(worktrees.id, worktreeId)).get()
          ?.name ?? worktreeId)
      : null
    const lines = [
      `Session lancée : « ${row.title} », id ${row.id}.`,
      `CLI ${agent}, modèle ${describeModel(config)}, effort ${describeEffort(config)}.`,
      tree ? `Elle travaille dans le worktree « ${tree} ».` : 'Elle travaille à la racine du projet.',
      card ? `Rattachée à la carte #${card.number} « ${card.title} ».` : null,
      describePermissions(config),
      "L'utilisateur la voit dans Solera. Pour être prévenu de sa fin : notify_when_done avec ce même id, puis termine ton tour si tu n'as rien d'autre à faire.",
    ]
    return { text: lines.filter(Boolean).join('\n'), launchedId: row.id }
  }

  /**
   * Garde-fous d'un lancement : profondeur de la chaîne et cadence.
   *
   * La chaîne se remonte par les demandes elles-mêmes, qui gardent la session née de
   * chacune : pas de colonne à ajouter aux conversations pour une question que seul ce
   * module pose.
   */
  private assertLaunchAllowed(requester: ConversationRow, requestId: string): void {
    let depth = 0
    let current = requester.id
    while (depth <= MAX_LAUNCH_DEPTH) {
      const parent = this.ctx.db
        .select({ from: agentRequests.conversationId })
        .from(agentRequests)
        .where(eq(agentRequests.launchedConversationId, current))
        .get()
      if (!parent) break
      depth += 1
      current = parent.from
    }
    if (depth >= MAX_LAUNCH_DEPTH) {
      throw new Refusal(
        `Refusé : cette session a elle-même été lancée par une session qui l'avait été (${depth} niveaux). Au-delà de ${MAX_LAUNCH_DEPTH}, plus de lancement en chaîne. Crée plutôt une carte avec create_card, ou propose à l'utilisateur de lancer la session lui-même.`,
      )
    }

    const [recent] = this.ctx.db
      .select({ total: count() })
      .from(agentRequests)
      .where(
        and(
          eq(agentRequests.conversationId, requester.id),
          eq(agentRequests.kind, 'start_session'),
          eq(agentRequests.isError, false),
          ne(agentRequests.id, requestId),
          gt(agentRequests.createdAt, Date.now() - HOUR_MS),
        ),
      )
      .all()
    if ((recent?.total ?? 0) >= LAUNCHES_PER_HOUR) {
      throw new Refusal(
        `Refusé : cette session a déjà lancé ${LAUNCHES_PER_HOUR} sessions dans l'heure. Crée des cartes avec create_card pour le reste, l'utilisateur les lancera.`,
      )
    }
  }

  private parseAgent(value: unknown, fallback: AgentKind): AgentKind {
    if (value === undefined || value === null || value === '') return fallback
    const parsed = agentKindSchema.safeParse(typeof value === 'string' ? value.toLowerCase() : value)
    if (!parsed.success) {
      throw new Refusal(`CLI inconnu « ${String(value)} ». Valeurs possibles : ${agentKindSchema.options.join(', ')}.`)
    }
    return parsed.data
  }

  /**
   * La configuration d'une session lancée : celle que l'interface proposerait pour ce
   * CLI dans ce projet, préréglage du projet puis défauts du compte, avec le modèle et
   * l'effort demandés par-dessus.
   *
   * Rien d'autre n'est réglable par l'agent, et surtout pas les permissions : une
   * session lancée par une autre n'a pas plus de latitude que celle que l'utilisateur
   * aurait ouverte d'un clic.
   */
  private async launchConfig(
    agent: AgentKind,
    project: ProjectRow,
    userId: string,
    payload: StartSessionPayload,
  ): Promise<AgentConfig> {
    const base =
      readProjectDefaults(project.defaultConfig)[agent] ??
      readUserSettings(this.ctx.db, userId).agentDefaults[agent] ??
      defaultConfigFor(agent)

    const requestedModel = typeof payload.model === 'string' ? payload.model.trim() : ''
    const requestedEffort = typeof payload.effort === 'string' ? payload.effort.trim().toLowerCase() : ''
    if (!requestedModel && !requestedEffort) {
      return this.registry.adapter(agent).resolveDefaults(base)
    }

    const catalog = await this.registry
      .adapter(agent)
      .models()
      .then((listing) => listing.models)
      .catch((): AgentModelDto[] => [])

    let config: AgentConfig = { ...base }
    if (requestedModel) {
      const model = matchModel(catalog, requestedModel)
      if (!model && catalog.length > 0) {
        throw new Refusal(
          `Modèle « ${requestedModel} » inconnu pour ${agent}. Disponibles : ${catalog.map(nameModel).join(', ')}.`,
        )
      }
      config = { ...config, model: model?.value ?? requestedModel }
    }

    // Le modèle effectif, une fois les défauts résolus : c'est lui qui dit quels
    // niveaux d'effort existent.
    config = await this.registry.adapter(agent).resolveDefaults(config)

    const model = catalog.find((entry) => entry.value === config.model) ?? catalog.find((entry) => entry.isDefault)
    const efforts = model?.efforts.map((entry) => entry.value) ?? []
    const current = effortOf(config)
    if (!requestedEffort && model?.defaultEffort && efforts.length > 0 && !efforts.includes(current)) {
      // Le modèle demandé ne connaît pas l'effort des défauts : son propre défaut, comme
      // le fait le sélecteur de l'interface, plutôt qu'un lancement qui échouerait.
      config = withEffort(config, model.defaultEffort)
    }

    if (requestedEffort) {
      const effort = matchEffort(efforts, requestedEffort)
      if (!effort) {
        throw new Refusal(
          efforts.length === 0
            ? `Le modèle ${config.model} ne règle pas d'effort : omets le paramètre \`effort\`.`
            : `Effort « ${requestedEffort} » inconnu pour ${config.model}. Niveaux : ${efforts.join(', ')}.`,
        )
      }
      config = withEffort(config, effort)
    }

    const parsed = agentConfigSchema.safeParse(config)
    if (!parsed.success) throw new Refusal(`Configuration refusée : ${parsed.error.issues[0]?.message ?? 'invalide'}.`)
    return parsed.data
  }

  /**
   * Où travaille la session lancée.
   *
   * Par défaut dans le même arbre que celle qui lance : c'est ce qu'on attend pour
   * « continue ça dans une autre session ». Un bug sans rapport mérite souvent son
   * worktree, que l'agent nomme ; `@root` désigne la racine du projet.
   */
  private async launchTree(
    requester: ConversationRow,
    project: ProjectRow,
    value: unknown,
  ): Promise<string | null> {
    if (value === undefined || value === null || value === '') return requester.worktreeId
    if (typeof value !== 'string') throw new Refusal('Le paramètre `worktree` doit être une chaîne.')
    const name = value.trim()
    if (name === '@root') return null

    const existing = this.ctx.db
      .select({ id: worktrees.id })
      .from(worktrees)
      .where(and(eq(worktrees.projectId, project.id), eq(worktrees.name, name), isNull(worktrees.removedAt)))
      .get()
    if (existing) return existing.id

    assertWorktreeName(name)
    const row = await createWorktree(this.ctx, project, requester.userId, name, 'HEAD')
    this.worktreeStatus?.forget(project.id)
    return row.id
  }

  // --- create_worktree, list_worktrees ---------------------------------------------

  /**
   * Crée un worktree pour la session qui le demande, au même endroit et de la même façon
   * que l'interface, puis l'y rattache.
   *
   * Le rattachement passe par `conversation_paths`, comme une écriture dans l'arbre, et
   * jamais par `conversations.worktree_id` : ce dernier décide du cwd à la reprise, et
   * Claude range ses transcripts par dossier de travail, si bien qu'une session dont on
   * changerait le cwd après coup ne se retrouverait plus. Le cwd reste donc où il est,
   * et l'agent travaille dans l'arbre par chemins absolus.
   *
   * Une branche neuve part de la branche par défaut du projet et non de HEAD : la
   * session qui demande est souvent dans l'arbre principal, resté sur une autre branche
   * que celle qu'on croit.
   */
  private async createWorktreeFor(requester: ConversationRow, project: ProjectRow, payload: Record<string, unknown>): Promise<string> {
    const branch = typeof payload.branch === 'string' ? payload.branch.trim() : ''
    if (!branch) throw new Refusal('Le paramètre `branch` est requis : le nom de la branche, par exemple `fix/titre-tronque`.')
    assertWorktreeName(branch)

    const existing = this.ctx.db
      .select()
      .from(worktrees)
      .where(and(eq(worktrees.projectId, project.id), eq(worktrees.name, branch), isNull(worktrees.removedAt)))
      .get()

    let row = existing
    let origin: string
    if (row) {
      origin = 'Il existait déjà : Solera te le rend tel quel.'
    } else {
      const requested = typeof payload.base === 'string' ? payload.base.trim() : ''
      // Passée telle quelle à `git worktree add` : un tiret en tête serait lu comme une option.
      if (requested && (!/^[A-Za-z0-9._/@{}^~-]+$/.test(requested) || requested.startsWith('-'))) {
        throw new Refusal(`Base invalide « ${requested} » : un nom de branche, de tag ou de commit.`)
      }
      const base = requested || (await defaultBase(project.workspacePath)) || 'HEAD'
      row = await createWorktree(this.ctx, project, requester.userId, branch, base)
      origin = row.baseRef === branch
        ? `La branche « ${branch} » existait : elle est reprise telle quelle.`
        : `Branche neuve, partie de ${base}.`
    }

    const now = Date.now()
    this.ctx.db
      .insert(conversationPaths)
      .values({ conversationId: requester.id, path: row.path, lastTs: now })
      .onConflictDoUpdate({
        target: [conversationPaths.conversationId, conversationPaths.path],
        set: { lastTs: sql`max(${conversationPaths.lastTs}, ${now})` },
      })
      .run()
    this.worktreeStatus?.forget(project.id)

    return [
      `Worktree « ${branch} » prêt dans ${row.path}. ${origin}`,
      "Ta session y est rattachée : l'utilisateur retrouve l'arbre et ta session dans la vue Chantiers du projet, d'où il le nettoiera une fois fusionné.",
      `Ton répertoire de travail ne change pas. Travaille dans l'arbre par chemins absolus : édite les fichiers sous ${row.path}, et lance tes commandes avec \`cd ${row.path} && …\` ou \`git -C ${row.path} …\`.`,
      `Pour qu'une autre session y travaille directement, start_session avec \`worktree: "${branch}"\`.`,
    ].join('\n')
  }

  /**
   * Les arbres du projet et leur avancement, tels que la vue Chantiers les montre.
   *
   * Attend un calcul à jour plutôt que de rendre la liste périmée que l'interface
   * accepte : un agent qui demande s'il peut reprendre un arbre décide sur la réponse.
   */
  private async listWorktrees(requester: ConversationRow, project: ProjectRow): Promise<string> {
    if (!this.worktreeStatus) throw new Refusal("L'avancement des worktrees n'est pas disponible ici.")
    const list = await this.worktreeStatus.current(project)
    if (list.worktrees.length === 0) {
      return list.base === null
        ? "Ce projet n'est pas un dépôt git : il n'a pas de worktree."
        : "Aucun worktree en dehors de l'arbre principal. create_worktree en crée un."
    }

    const ids = [...new Set(list.worktrees.flatMap((tree) => tree.conversations.map((entry) => entry.id)))]
    const titles = new Map(
      ids.length
        ? this.ctx.db
            .select({ id: conversations.id, title: conversations.title, archivedAt: conversations.archivedAt })
            .from(conversations)
            .where(inArray(conversations.id, ids))
            .all()
            .map((row) => [row.id, row.archivedAt ? `${row.title} (archivée)` : row.title])
        : [],
    )

    const lines = list.worktrees.map((tree) => {
      const facts = [
        tree.modified > 0 ? `${tree.modified} fichier(s) modifié(s)` : null,
        tree.untracked > 0 ? `${tree.untracked} non suivi(s)` : null,
        tree.ahead > 0 ? `${tree.ahead} commit(s) en avance` : null,
        tree.behind > 0 ? `${tree.behind} en retard` : null,
        tree.conflicts ? 'conflit prévisible' : null,
      ].filter(Boolean)
      const sessions = tree.conversations.map((entry) => {
        const who = entry.id === requester.id ? 'toi' : `« ${titles.get(entry.id) ?? entry.id} »`
        return `${who} ${entry.link === 'worktree' ? 'y travaille' : 'y a travaillé'}`
      })
      return [
        `- \`${tree.name}\` : ${WORKTREE_STATE_WORDS[tree.state]}${facts.length ? ` (${facts.join(', ')})` : ''}`,
        `  ${tree.path}${tree.external ? ' · créé hors de Solera' : ''}`,
        sessions.length ? `  Sessions : ${sessions.join(' ; ')}` : '  Aucune session rattachée.',
      ].join('\n')
    })

    return [`Worktrees du projet, comparés à ${list.base ?? 'HEAD'} :`, ...lines].join('\n')
  }

  private launchCard(projectId: string, value: unknown): { id: string; number: number; title: string } | null {
    if (value === undefined || value === null || value === '') return null
    const number = typeof value === 'number' ? value : Number(String(value).replace(/^#/, ''))
    if (!Number.isInteger(number)) throw new Refusal('Le paramètre `card` est le numéro de la carte, par exemple 12.')
    const card = this.ctx.db
      .select({ id: cards.id, number: cards.number, title: cards.title })
      .from(cards)
      .where(and(eq(cards.projectId, projectId), eq(cards.number, number)))
      .get()
    if (!card) throw new Refusal(`Aucune carte #${number} dans ce projet. list_cards les montre.`)
    return card
  }

  // --- schedule_task -------------------------------------------------------------

  /**
   * Crée une tâche planifiée, comme le ferait le formulaire de l'interface.
   *
   * Même latitude qu'un lancement : le modèle et l'effort se choisissent, les
   * permissions restent celles des défauts du projet. Elles comptent davantage ici,
   * personne n'étant là pendant les tirs, et la réponse les rappelle pour que l'agent
   * le dise à l'utilisateur.
   */
  private async scheduleTask(
    requester: ConversationRow,
    project: ProjectRow,
    payload: Record<string, unknown>,
  ): Promise<string> {
    if (requester.scheduleId) {
      throw new Refusal(
        "Refusé : cette session est elle-même un tir planifié. Une tâche qui en crée d'autres se multiplierait sans personne pour l'arrêter ; ouvre une carte avec create_card.",
      )
    }

    const name = typeof payload.name === 'string' ? payload.name.trim() : ''
    if (!name) throw new Refusal('Le paramètre `name` est requis : le nom court de la tâche.')
    if (name.length > MAX_SCHEDULE_NAME_CHARS) {
      throw new Refusal(`Nom trop long (${MAX_SCHEDULE_NAME_CHARS} caractères au plus).`)
    }
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : ''
    if (!prompt) throw new Refusal('Le paramètre `prompt` est requis : la consigne rejouée à chaque tir.')
    if (prompt.length > MAX_SCHEDULE_PROMPT_CHARS) {
      throw new Refusal(
        `Consigne trop longue (${prompt.length} caractères, ${MAX_SCHEDULE_PROMPT_CHARS} au plus). Mets le détail dans un fichier et cite-le.`,
      )
    }

    const [existing] = this.ctx.db
      .select({ total: count() })
      .from(scheduledTasks)
      .where(eq(scheduledTasks.projectId, project.id))
      .all()
    if ((existing?.total ?? 0) >= MAX_AGENT_SCHEDULES_PER_PROJECT) {
      throw new Refusal(
        `Refusé : ce projet porte déjà ${MAX_AGENT_SCHEDULES_PER_PROJECT} tâches planifiées. L'utilisateur peut en supprimer dans la vue Planification.`,
      )
    }

    const cadence = parseAgentCadence(payload)
    const maxDurationMinutes = payload.max_duration_minutes ?? DEFAULT_SCHEDULE_DURATION_MINUTES
    if (
      typeof maxDurationMinutes !== 'number' ||
      !Number.isInteger(maxDurationMinutes) ||
      maxDurationMinutes < MIN_SCHEDULE_DURATION_MINUTES ||
      maxDurationMinutes > MAX_SCHEDULE_DURATION_MINUTES
    ) {
      throw new Refusal(
        `\`max_duration_minutes\` est un entier entre ${MIN_SCHEDULE_DURATION_MINUTES} et ${MAX_SCHEDULE_DURATION_MINUTES}.`,
      )
    }
    const overlap = payload.overlap ?? 'skip'
    if (overlap !== 'skip' && overlap !== 'wait') {
      throw new Refusal('`overlap` vaut `skip` (sauter le tir) ou `wait` (attendre la fin du précédent).')
    }
    const checkScript = checkScriptSchema.safeParse(payload.check_script ?? null)
    if (!checkScript.success) {
      throw new Refusal(`\`check_script\` est le texte du script, ${MAX_CHECK_SCRIPT_CHARS} caractères au plus.`)
    }
    const checkTimeout = checkTimeoutSchema.safeParse(payload.check_timeout_seconds ?? DEFAULT_CHECK_TIMEOUT_SECONDS)
    if (!checkTimeout.success) {
      throw new Refusal(
        `\`check_timeout_seconds\` est un entier entre ${MIN_CHECK_TIMEOUT_SECONDS} et ${MAX_CHECK_TIMEOUT_SECONDS}.`,
      )
    }

    const agent = this.parseAgent(payload.agent, requester.agent)
    const config = await this.launchConfig(agent, project, requester.userId, payload)
    const task = createScheduledTask(
      this.ctx.db,
      { projectId: project.id, userId: requester.userId, conversationId: requester.id },
      {
        name,
        agent,
        config,
        prompt,
        cadence,
        overlapPolicy: overlap,
        maxDurationMinutes,
        enabled: true,
        checkScript: checkScript.data,
        checkTimeoutSeconds: checkTimeout.data,
      },
    )

    const lines = [
      `Tâche planifiée « ${task.name} » créée, id ${task.id}.`,
      `Cadence : ${describeCadence(cadence)}. Prochain tir : ${task.nextRunAt ? new Date(task.nextRunAt).toLocaleString('fr-FR') : 'aucun'} (heure du serveur).`,
      `Chaque tir ouvre une session neuve : CLI ${agent}, modèle ${describeModel(config)}, effort ${describeEffort(config)}, ${task.maxDurationMinutes} min au plus, à la racine du projet.`,
      describePermissions(config)
        ? "Attention : avec les permissions par défaut du projet, un tir s'arrêtera pour demander un accord que personne ne donnera, jusqu'à sa durée maximale. Dis-le à l'utilisateur : il règle les permissions de la tâche dans la vue Planification."
        : null,
      task.checkScript
        ? "Le script de vérification attend la validation de l'utilisateur : tant qu'il n'est pas validé, les tirs sont écartés, sans script ni session. Dis-le-lui : il peut le relire, l'essayer et le valider directement sous cet appel dans la conversation, ou depuis la vue Planification du projet."
        : null,
      "L'utilisateur la retrouve dans la vue Planification du projet, où il peut la modifier, la mettre en pause, la lancer tout de suite ou la supprimer. Ses tirs n'apparaissent pas dans la liste des sessions mais sous la tâche.",
    ]
    return lines.filter(Boolean).join('\n')
  }

  // --- create_card ---------------------------------------------------------------

  /**
   * Toujours en « à faire » : une carte ouverte par un agent est une proposition, pas
   * un travail engagé. Elle avance quand une session la prend, comme toute autre.
   */
  private createCard(requester: ConversationRow, payload: Record<string, unknown>): string {
    const title = typeof payload.title === 'string' ? payload.title.trim() : ''
    const description = typeof payload.description === 'string' ? payload.description.trim() : ''
    if (!title) throw new Refusal('Le paramètre `title` est requis.')
    if (title.length > 200) throw new Refusal('Titre trop long (200 caractères au plus).')
    if (description.length > 20000) throw new Refusal('Description trop longue (20 000 caractères au plus).')

    // Le board appartient à un projet : un fil libre n'en a pas, et il n'y a donc nulle
    // part où poser la carte tant qu'il n'est pas rangé.
    if (requester.projectId === null) {
      throw new Refusal("Cette conversation n'appartient à aucun projet : il n'y a pas de board où créer une carte.")
    }
    const card = createCard(this.ctx.db, requester.projectId, requester.userId, {
      title,
      description,
      column: 'todo',
    })
    // La provenance se lit dans le fil de la carte, avec un lien vers la session : la
    // description reste celle que l'agent a rédigée, et la personne qui la reprendra
    // sait d'où elle vient.
    this.ctx.db
      .insert(cardNotes)
      .values({
        id: randomUUID(),
        cardId: card.id,
        conversationId: requester.id,
        userId: null,
        body: 'Carte ouverte depuis cette session.',
        createdAt: Date.now(),
      })
      .run()

    return `Carte #${card.number} « ${card.title} » créée dans « à faire ». Pour la faire traiter tout de suite : start_session avec card=${card.number}.`
  }

  // --- create_project ------------------------------------------------------------

  /**
   * Déclare un projet sur un dossier que l'agent a créé lui-même.
   *
   * Acte direct, sans accord préalable : c'est une ligne en base, et un archivage la
   * défait. Solera ne crée ni ne supprime jamais le dossier — l'agent a déjà un shell,
   * et le jour où Solera crée, elle devient responsable du nettoyage, qui est la question
   * qu'on refuse d'ouvrir (`DELETE /api/projects/:id` ne touche pas au `workspacePath`).
   */
  private async createProject(
    request: AgentRequestRow,
    requester: ConversationRow,
    payload: Record<string, unknown>,
  ): Promise<string> {
    this.assertFilingAllowed(requester)

    const given = typeof payload.path === 'string' ? payload.path.trim() : ''
    if (!given) {
      throw new Refusal(
        'Le paramètre `path` est requis : le chemin absolu du dossier du projet, que tu dois avoir créé avant.',
      )
    }

    const [recent] = this.ctx.db
      .select({ total: count() })
      .from(agentRequests)
      .where(
        and(
          eq(agentRequests.conversationId, requester.id),
          eq(agentRequests.kind, 'create_project'),
          eq(agentRequests.isError, false),
          ne(agentRequests.id, request.id),
          gt(agentRequests.createdAt, Date.now() - HOUR_MS),
        ),
      )
      .all()
    if ((recent?.total ?? 0) >= PROJECTS_PER_HOUR) {
      throw new Refusal(
        `Refusé : cette session a déjà déclaré ${PROJECTS_PER_HOUR} projet dans l'heure. Dis à l'utilisateur ce que tu voulais ranger, il créera le projet lui-même.`,
      )
    }

    // Le dossier où cette personne range ses projets. Nul tant qu'elle n'en a créé aucun :
    // le premier projet est le sien à faire, et on n'a alors aucune racine à vérifier.
    const projectsDir = readUserSettings(this.ctx.db, requester.userId).projectsDir
    if (!projectsDir) {
      throw new Refusal(
        "Refusé : cette instance n'a pas encore de dossier où elle range ses projets. Demande à l'utilisateur de créer ce premier projet lui-même, depuis Solera.",
      )
    }

    const workspacePath = await assertUsableWorkspace(given).catch(() => {
      throw new Refusal(
        `Refusé : « ${given} » n'existe pas, ou n'est pas un dossier. Crée-le d'abord avec tes propres outils : Solera ne crée pas de dossier.`,
      )
    })

    // La garde de séparateur, et c'est tout son intérêt : sans elle `~/projets-a-moi`
    // passerait pour un enfant de `~/projets`.
    const resolved = resolve(projectsDir)
    const root = resolved.endsWith(sep) ? resolved.slice(0, -sep.length) : resolved
    if (workspacePath !== root && !workspacePath.startsWith(root + sep)) {
      throw new Refusal(
        `Refusé : « ${workspacePath} » est hors de ${root}, où cette instance range ses projets. Crée le dossier là-bas, puis rappelle create_project.`,
      )
    }

    const taken = this.ctx.db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.workspacePath, workspacePath))
      .get()
    if (taken) {
      throw new Refusal(`Refusé : ce dossier est déjà le projet « ${taken.name} ».`)
    }

    const name = typeof payload.name === 'string' && payload.name.trim()
      ? payload.name.trim().slice(0, 200)
      : (workspacePath.split(sep).filter(Boolean).at(-1) ?? workspacePath)

    const row = await insertProject(this.ctx, requester.userId, {
      name,
      workspacePath,
      // Privé, comme tout projet créé depuis l'interface : partager est un geste que son
      // propriétaire fait, pas un défaut qu'un agent choisit.
      visibility: 'private',
      color: null,
      // Déduit du contenu du dossier, comme dans la route : un AGENTS.md que l'agent y
      // aurait posé donne `repo`, ce qui est juste.
      instructionsMode: undefined,
    })

    return [
      `Projet « ${row.name} » créé, id ${row.id}, sur ${row.workspacePath}.`,
      `Consignes en mode ${row.instructionsMode}.`,
      `Il est privé et vide : aucune conversation n'y est rangée. Pour y ranger celle-ci ou une autre : move_conversation avec project="${row.id}", que l'utilisateur accorde d'un clic.`,
    ].join('\n')
  }

  // --- move_conversation ---------------------------------------------------------

  /**
   * Dépose une demande de rangement, et ne déplace rien.
   *
   * L'outil ne peut pas se contenter de déclarer que l'utilisateur l'a demandé : c'est
   * invérifiable, et pour un rangement le pire cas ne se voit pas arriver, là où une
   * session lancée de trop se voit. C'est donc le clic qui déplace — et c'est lui, en
   * retour, qui autorise d'aller d'un projet vers un autre sans restriction.
   */
  private async requestFiling(
    request: AgentRequestRow,
    requester: ConversationRow,
    payload: Record<string, unknown>,
  ): Promise<string> {
    this.assertFilingAllowed(requester)

    const targetId =
      typeof payload.conversation === 'string' && payload.conversation.trim()
        ? payload.conversation.trim()
        : requester.id
    // Jointure externe : une jointure interne écarterait les fils libres, qui sont
    // justement ce qu'on range le plus souvent.
    const found = this.ctx.db
      .select({ conversation: conversations })
      .from(conversations)
      .leftJoin(projects, eq(projects.id, conversations.projectId))
      .where(and(eq(conversations.id, targetId), conversationVisibleTo(requester.userId)))
      .get()
    if (!found) {
      throw new Refusal(
        `Aucune conversation « ${targetId} » que cette session puisse voir. list_sessions et search_history donnent les identifiants.`,
      )
    }
    const target = found.conversation

    if (target.scheduleId) {
      throw new Refusal("Refusé : cette conversation est un tir planifié, et reste où sa tâche l'a mis.")
    }

    const destinationId =
      typeof payload.project === 'string' && payload.project.trim()
        ? payload.project.trim()
        : requester.projectId
    if (!destinationId) {
      throw new Refusal(
        "Le paramètre `project` est requis : cette session n'appartient elle-même à aucun projet, il n'y a donc pas de destination à sous-entendre. create_project en déclare un.",
      )
    }
    const destination = this.ctx.db
      .select()
      .from(projects)
      .where(eq(projects.id, destinationId))
      .get()
    // Visible pour qui accordera, c'est-à-dire le propriétaire du fil déplacé : lui
    // demander de ranger dans un projet qu'il ne voit pas n'aurait aucun sens.
    if (
      !destination ||
      (destination.ownerId !== target.userId && destination.visibility !== 'shared')
    ) {
      throw new Refusal(`Aucun projet « ${destinationId} » où ranger cette conversation.`)
    }
    if (target.projectId === destination.id) {
      throw new Refusal(`Cette conversation est déjà rangée dans « ${destination.name} ».`)
    }

    // Une seule demande en attente à la fois, et c'est un invariant plutôt qu'un chiffre
    // horaire : rien ne se désynchronise, et tant que l'utilisateur n'a pas répondu
    // l'agent n'a rien à ajouter. Les demandes en attente se comptent sur les doigts,
    // par construction : la charge se relit en mémoire plutôt qu'en SQL.
    const waiting = this.ctx.db
      .select()
      .from(agentRequests)
      .where(
        and(
          eq(agentRequests.kind, 'move_conversation'),
          isNull(agentRequests.resolvedAt),
          ne(agentRequests.id, request.id),
        ),
      )
      .all()
    for (const other of waiting) {
      if (other.conversationId === requester.id) {
        throw new Refusal(
          "Refusé : cette session a déjà une demande de rangement en attente. Attends que l'utilisateur y réponde.",
        )
      }
      if (filingTargetId(other) === target.id) {
        throw new Refusal(
          "Refusé : un rangement de cette conversation attend déjà une réponse de l'utilisateur.",
        )
      }
    }

    const price = await this.filingPrice(target)
    this.log.append(target.id, {
      type: 'filing.requested',
      requestId: request.id,
      conversationId: target.id,
      conversationTitle: target.title,
      projectId: destination.id,
      projectName: destination.name,
      ...price,
    })
    this.notifyLists(target.id)
    this.notifyAwaiting([target.userId])

    const lines = [
      target.id === requester.id
        ? `Demande déposée : ranger cette conversation dans « ${destination.name} ».`
        : `Demande déposée : ranger « ${target.title} » dans « ${destination.name} ».`,
      "Elle attend un clic dans Solera, et rien n'est déplacé avant. Son propriétaire y voit le prix du déplacement : worktree et carte détachés, reprise du CLI perdue.",
      target.id === requester.id
        ? 'Accordée, le déplacement a lieu dès que ce tour est fini : la session redémarre dans le nouveau projet, avec ses outils, et sans la session native du CLI.'
        : 'Accordée, le déplacement a lieu dès que cette conversation ne travaille plus.',
      "N'en redépose pas : une seule demande de rangement peut attendre à la fois.",
    ]
    return lines.join('\n')
  }

  /**
   * Ce que le déplacement coûte, tel que la demande l'affichera.
   *
   * On autorise et on annonce, mot pour mot la doctrine du `force` d'un worktree sale :
   * le travail non commité ne bouge pas, il reste dans le projet de départ. Refuser dès
   * qu'il y a un worktree aurait rendu indéplaçable toute session ayant travaillé dans un
   * arbre, le détachement n'existant pas.
   */
  private async filingPrice(target: ConversationRow): Promise<{
    worktree: { name: string; dirtyFiles: number } | null
    card: { number: number; title: string } | null
    resumable: boolean
  }> {
    const tree = target.worktreeId
      ? (this.ctx.db
          .select({ name: worktrees.name, path: worktrees.path })
          .from(worktrees)
          .where(eq(worktrees.id, target.worktreeId))
          .get() ?? null)
      : null
    const status = tree ? await readGitStatus(tree.path).catch(() => null) : null
    const card = target.cardId
      ? (this.ctx.db
          .select({ number: cards.number, title: cards.title })
          .from(cards)
          .where(eq(cards.id, target.cardId))
          .get() ?? null)
      : null

    return {
      worktree: tree ? { name: tree.name, dirtyFiles: status?.changedFiles ?? 0 } : null,
      card,
      resumable: target.agentSessionId !== null,
    }
  }

  /**
   * Applique les rangements accordés, dès que la conversation visée se tait.
   *
   * Le balayage tente, et le refus de `releaseRunner` est la condition de réessai : rien
   * à ajouter à `settleIdle`, aucun état en mémoire. L'acceptation est revérifiée ici et
   * non au dépôt — entre les deux, le projet de destination a pu disparaître.
   */
  private async applyFilings(): Promise<void> {
    const accepted = this.ctx.db
      .select()
      .from(agentRequests)
      .where(
        and(
          eq(agentRequests.kind, 'move_conversation'),
          isNotNull(agentRequests.acceptedAt),
          isNull(agentRequests.resolvedAt),
        ),
      )
      .orderBy(asc(agentRequests.acceptedAt))
      .all()

    for (const request of accepted) {
      const targetId = filingTargetId(request)
      const target = this.ctx.db
        .select()
        .from(conversations)
        .where(eq(conversations.id, targetId))
        .get()
      const filing = this.log.openFiling(targetId, request.id)
      // Le fil ou sa demande ont disparu : il n'y a plus de journal où écrire la suite.
      if (!target || !filing) {
        this.closeFiling(request.id)
        continue
      }

      const destination = this.ctx.db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, filing.projectId))
        .get()
      if (!destination) {
        this.resolveFiling(request, target, 'impossible', 'project_not_found')
        continue
      }

      const result = await moveConversation(this.ctx, this.sessions, target, destination.id)
      if (!result.ok) {
        // `busy` : un tour tourne, on retentera au prochain balayage. C'est tout le
        // mécanisme d'attente, et il n'y en a pas d'autre.
        if (result.refusal === 'busy') continue
        this.resolveFiling(request, target, 'impossible', 'conversation_scheduled')
        continue
      }
      this.resolveFiling(request, target, 'accepted', null)
      this.logger?.info(
        { conversation: target.id, project: destination.id, request: request.id },
        'rangement accorde applique',
      )
    }
  }

  /**
   * Écrit la résolution dans le fil déplacé, et ferme la demande.
   *
   * `reason` est un code et non une phrase : il part dans le journal, que l'interface
   * relit dans la langue de son lecteur, là où tout le reste de ce module est du texte
   * rédigé pour un modèle.
   */
  private resolveFiling(
    request: AgentRequestRow,
    target: ConversationRow,
    decision: 'accepted' | 'impossible',
    reason: 'project_not_found' | 'conversation_scheduled' | null,
  ): void {
    this.log.append(target.id, {
      type: 'filing.resolved',
      requestId: request.id,
      decision,
      // Seul le propriétaire du fil déplacé peut accorder : c'est donc lui, et la route
      // n'a pas à nous le redire.
      decidedBy: decision === 'accepted' ? target.userId : null,
      reason,
    })
    this.closeFiling(request.id)
    this.notifyLists(target.id)
  }

  /** La demande n'attend plus rien : ni l'agent, ni l'utilisateur, ni ce balayage. */
  private closeFiling(id: string): void {
    this.ctx.db
      .update(agentRequests)
      .set({ resolvedAt: Date.now() })
      .where(eq(agentRequests.id, id))
      .run()
  }

  /**
   * Les deux outils de rangement sont une portée accordée, pas une capacité par défaut.
   *
   * Vérifié ici et pas seulement à la liste des outils du serveur MCP : c'est la base qui
   * tranche, et le serveur, lui, n'est qu'un process lancé par le CLI.
   */
  private assertFilingAllowed(requester: ConversationRow): void {
    if (!this.ctx.config.mcp.projectFiling) {
      throw new Refusal(
        "Refusé : cette instance de Solera n'ouvre pas le rangement aux agents (`[mcp] project_filing` dans config.toml).",
      )
    }
    if (!parseAgentConfig(requester.config).projectFiling) {
      throw new Refusal(
        "Refusé : le rangement de projet n'est pas accordé à cette conversation. L'utilisateur peut le cocher dans les réglages de la session, et la relancer.",
      )
    }
  }

  // --- request_card_move ---------------------------------------------------------

  /**
   * Dépose une proposition de déplacement de cartes, et ne déplace rien.
   *
   * Même motif que `move_conversation`, avec les écarts que #54 arbitre : plusieurs
   * cartes par demande, une raison obligatoire par carte, toutes les colonnes permises, et
   * c'est le **propriétaire du projet** qui accorde. L'invariant « une en attente à la
   * fois » porte, lui, sur la conversation demandeuse, comme pour une conversation : tant
   * que l'utilisateur n'a pas répondu, l'agent n'a rien à ajouter.
   *
   * Pas de borne horaire par-dessus l'invariant : rien ne s'applique sans clic, donc une
   * boucle d'erreur ne produit qu'une demande, celle qui attend déjà.
   */
  private requestCardMove(
    request: AgentRequestRow,
    requester: ConversationRow,
    project: ProjectRow,
    payload: Record<string, unknown>,
  ): string {
    this.assertCardFilingAllowed(requester)

    const moves = Array.isArray(payload.moves) ? payload.moves : null
    if (!moves || moves.length === 0) {
      throw new Refusal('Le paramètre `moves` est requis : au moins un {card, column, reason}.')
    }
    if (moves.length > MAX_CARD_MOVES) {
      throw new Refusal(
        `Trop de cartes dans une demande (${moves.length}, ${MAX_CARD_MOVES} au plus). Garde ce qui se décide ensemble.`,
      )
    }

    // Une seule demande de rangement de carte en attente par conversation demandeuse.
    // Compté à part de `move_conversation` : les deux ne se disputent pas la place, ce
    // sont deux conversations différentes qui les lisent et deux objets différents.
    const waiting = this.ctx.db
      .select({ id: agentRequests.id })
      .from(agentRequests)
      .where(
        and(
          eq(agentRequests.kind, 'request_card_move'),
          eq(agentRequests.conversationId, requester.id),
          isNull(agentRequests.resolvedAt),
          ne(agentRequests.id, request.id),
        ),
      )
      .get()
    if (waiting) {
      throw new Refusal(
        "Refusé : cette session a déjà une proposition de rangement de carte en attente. Attends que l'utilisateur y réponde.",
      )
    }

    const seen = new Set<number>()
    const proposed: {
      cardId: string
      number: number
      title: string
      fromColumn: CardColumn
      toColumn: CardColumn
      reason: string
    }[] = []

    for (const raw of moves) {
      const move = raw as { card?: unknown; column?: unknown; reason?: unknown }
      if (!Number.isInteger(move.card)) {
        throw new Refusal('Chaque déplacement veut un `card` entier : le numéro de la carte, sans le `#`.')
      }
      const number = move.card as number
      // Deux lignes sur la même carte feraient deux mouvements contradictoires dans la
      // même transaction, et l'utilisateur ne saurait pas lequel il accorde.
      if (seen.has(number)) throw new Refusal(`La carte #${number} apparaît deux fois dans la même demande.`)
      seen.add(number)

      const column = cardColumnSchema.safeParse(move.column)
      if (!column.success) {
        throw new Refusal(
          `Colonne inconnue pour #${number} : ${cardColumnSchema.options.join(', ')}.`,
        )
      }
      // Obligatoire, et c'est le seul écart de forme avec `move_conversation` : son prix
      // à lui se calcule tout seul, là où une carte ne se range que sur un constat.
      const reason = typeof move.reason === 'string' ? move.reason.trim() : ''
      if (!reason) {
        throw new Refusal(
          `Le champ \`reason\` est requis pour #${number} : dis ce que tu as constaté, en une phrase. Une demande sans raison n'est pas une proposition.`,
        )
      }

      const card = this.ctx.db
        .select({ id: cards.id, title: cards.title, column: cards.column })
        .from(cards)
        .where(and(eq(cards.projectId, project.id), eq(cards.number, number)))
        .get()
      if (!card) throw new Refusal(`Aucune carte #${number} dans ce projet. list_cards donne les numéros.`)
      if (card.column === column.data) {
        throw new Refusal(
          `La carte #${number} est déjà en « ${COLUMN_WORDS[column.data]} ». Retire-la de la demande.`,
        )
      }

      proposed.push({
        cardId: card.id,
        number,
        title: card.title,
        fromColumn: card.column,
        toColumn: column.data,
        reason: reason.slice(0, MAX_CARD_MOVE_REASON_CHARS),
      })
    }

    // Dans le journal de la conversation qui demande, et non dans un fil par carte : une
    // carte n'a pas de fil à elle. C'est pourtant le propriétaire du projet qui accordera.
    this.log.append(requester.id, {
      type: 'card_filing.requested',
      requestId: request.id,
      cards: proposed,
    })
    this.notifyLists(requester.id)
    this.notifyAwaiting([project.ownerId])

    const lines = [
      proposed.length === 1
        ? `Demande déposée : déplacer #${proposed[0]!.number} vers « ${COLUMN_WORDS[proposed[0]!.toColumn]} ».`
        : `Demande déposée : déplacer ${proposed.length} cartes (${proposed.map((move) => `#${move.number} → ${COLUMN_WORDS[move.toColumn]}`).join(', ')}).`,
      "Elle attend un clic dans cette conversation, et rien n'est déplacé avant. C'est le propriétaire du projet qui tranche, et le mouvement sera inscrit à son nom.",
      proposed.length === 1
        ? 'Accordée ou refusée, tu le liras dans ce fil.'
        : 'Un seul clic accorde la liste entière, ou la refuse entière.',
      "N'en redépose pas : une seule proposition de rangement de carte peut attendre à la fois.",
    ]
    return lines.join('\n')
  }

  /**
   * `request_card_move` est une portée accordée, pas une capacité par défaut.
   *
   * Vérifié ici et pas seulement à la liste des outils du serveur MCP : c'est la base qui
   * tranche, et le serveur, lui, n'est qu'un process lancé par le CLI.
   */
  private assertCardFilingAllowed(requester: ConversationRow): void {
    if (!this.ctx.config.mcp.cardFiling) {
      throw new Refusal(
        "Refusé : cette instance de Solera n'ouvre pas le rangement de carte aux agents (`[mcp] card_filing` dans config.toml).",
      )
    }
    if (!parseAgentConfig(requester.config).cardFiling) {
      throw new Refusal(
        "Refusé : le rangement de carte n'est pas accordé à cette conversation. L'utilisateur peut le cocher dans les réglages de la session, et la relancer.",
      )
    }
  }

  // --- request_decision ----------------------------------------------------------

  /**
   * Dépose une demande de décision, sans bloquer l'agent : voir `decisions/decisions.ts`.
   *
   * Placée avant `requireProject` pour qu'un fil libre lise pourquoi on la lui refuse,
   * plutôt que le refus générique : la réponse revient par `session_messages`, dont le
   * projet est obligatoire, et c'est la seule raison de cette exigence.
   */
  private requestDecision(
    request: AgentRequestRow,
    requester: ConversationRow,
    payload: Record<string, unknown>,
  ): DecisionDeposit {
    if (!this.ctx.config.mcp.decisions) {
      throw new Refusal(
        "Refusé : cette instance de Solera n'ouvre pas les demandes de décision aux agents (`[mcp] decisions` dans config.toml). Décide selon tes instructions, ou pose ta question dans ta réponse.",
      )
    }
    if (!parseAgentConfig(requester.config).decisions) {
      throw new Refusal(
        "Refusé : les demandes de décision ne sont pas accordées à cette conversation. Décide selon tes instructions, ou pose ta question dans ta réponse. L'utilisateur peut cocher « Décisions » dans les réglages de la session, et la relancer.",
      )
    }
    if (!requester.projectId) {
      throw new Refusal(
        "Refusé : une demande de décision exige un projet, et cette conversation n'en a pas — sa réponse revient par la messagerie entre sessions, qui vit dans un projet. Ici, quelqu'un lit le fil : pose ta question dans ta réponse.",
      )
    }
    const project = this.requireProject(requester.projectId)
    if (!this.decisions) throw new Refusal('Les décisions ne sont pas disponibles sur ce serveur.')
    try {
      return this.decisions.request(request, requester, project, payload)
    } catch (err) {
      if (err instanceof DecisionRefusal) throw new Refusal(err.message)
      throw err
    }
  }

  // --- list_models ---------------------------------------------------------------

  private async listModels(
    requester: ConversationRow,
    project: ProjectRow,
    payload: Record<string, unknown>,
  ): Promise<string> {
    const agents: AgentKind[] =
      payload.agent === undefined || payload.agent === null || payload.agent === ''
        ? [...agentKindSchema.options]
        : [this.parseAgent(payload.agent, requester.agent)]

    const sections: string[] = []
    for (const agent of agents) {
      const defaults = await this.launchConfig(agent, project, requester.userId, {}).catch(() => null)
      const models = await this.registry
        .adapter(agent)
        .models()
        .then((listing) => listing.models)
        .catch(() => null)
      const head = defaults
        ? `## ${agent} — par défaut : modèle ${describeModel(defaults)}, effort ${describeEffort(defaults)}`
        : `## ${agent}`
      if (!models) {
        sections.push(`${head}\nCatalogue injoignable : le CLI n'est peut-être pas installé.`)
        continue
      }
      const lines = models.map((model) => {
        const efforts = model.efforts.map((entry) => entry.value)
        return `- \`${model.value}\` (${model.displayName})${model.isDefault ? ' [défaut du CLI]' : ''}${efforts.length > 0 ? ` — efforts : ${efforts.join(', ')}` : ''}`
      })
      sections.push([head, ...lines].join('\n'))
    }
    return `${sections.join('\n\n')}\n\nDans start_session, \`model\` accepte la valeur ou le nom affiché, et \`effort: "max"\` prend le plus haut niveau quand le modèle n'en a pas de ce nom.`
  }
}

/**
 * La cadence telle qu'un agent la donne : exactement un de `every_minutes`, `cron`, `at`.
 *
 * Trois paramètres à plat plutôt qu'un objet discriminé : c'est la forme qu'un modèle
 * remplit sans se tromper, et celle de `CronCreate` qu'il connaît déjà.
 */
function parseAgentCadence(payload: Record<string, unknown>): ScheduleCadence {
  const given = ['every_minutes', 'cron', 'at'].filter(
    (key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '',
  )
  if (given.length !== 1) {
    throw new Refusal(
      'Donne exactement une cadence : `every_minutes` (intervalle), `cron` (motif à cinq champs) ou `at` (date et heure uniques, ISO 8601).',
    )
  }

  let candidate: unknown
  if (given[0] === 'every_minutes') {
    candidate = { kind: 'interval', minutes: payload.every_minutes }
  } else if (given[0] === 'cron') {
    candidate = { kind: 'cron', expression: typeof payload.cron === 'string' ? payload.cron.trim() : payload.cron }
  } else {
    const at = typeof payload.at === 'string' ? Date.parse(payload.at) : Number.NaN
    if (Number.isNaN(at)) throw new Refusal('`at` doit être une date ISO 8601, par exemple 2026-10-12T09:00:00+02:00.')
    if (at <= Date.now()) throw new Refusal('`at` est dans le passé.')
    candidate = { kind: 'once', at }
  }

  const parsed = scheduleCadenceSchema.safeParse(candidate)
  if (!parsed.success) {
    throw new Refusal(
      given[0] === 'cron'
        ? `Motif cron invalide « ${String(payload.cron)} » : cinq champs (minute heure jour mois jour-de-semaine), lus à l'heure du serveur.`
        : '`every_minutes` doit être un entier positif.',
    )
  }

  const cadence = parsed.data
  if (cadence.kind === 'interval' && cadence.minutes < MIN_AGENT_SCHEDULE_MINUTES) {
    throw new Refusal(`Intervalle trop court : ${MIN_AGENT_SCHEDULE_MINUTES} minutes au moins.`)
  }
  if (cadence.kind === 'cron') {
    const [first, second] = new Cron(cadence.expression, { paused: true }).nextRuns(2)
    if (first && second && second.getTime() - first.getTime() < MIN_AGENT_SCHEDULE_MINUTES * 60_000) {
      throw new Refusal(`Motif trop serré : ${MIN_AGENT_SCHEDULE_MINUTES} minutes au moins entre deux tirs.`)
    }
  }
  return cadence
}

function describeCadence(cadence: ScheduleCadence): string {
  if (cadence.kind === 'interval') return `toutes les ${cadence.minutes} minutes`
  if (cadence.kind === 'cron') return `motif cron \`${cadence.expression}\``
  return `une seule fois, le ${new Date(cadence.at).toLocaleString('fr-FR')}`
}

function nameModel(model: AgentModelDto): string {
  return model.displayName && model.displayName !== model.value ? `${model.value} (${model.displayName})` : model.value
}

/**
 * Trouve le modèle que l'agent désigne, souvent du nom qu'a dit l'utilisateur
 * (« Astra », « opus ») plutôt que de son identifiant exact.
 */
export function matchModel(catalog: AgentModelDto[], wanted: string): AgentModelDto | null {
  const needle = wanted.toLowerCase()
  const exact = catalog.find((model) => model.value.toLowerCase() === needle)
  if (exact) return exact
  const named = catalog.find((model) => model.displayName.toLowerCase() === needle)
  if (named) return named
  const partial = catalog.filter(
    (model) => model.value.toLowerCase().includes(needle) || model.displayName.toLowerCase().includes(needle),
  )
  // Un seul candidat, ou rien : deviner entre deux modèles serait choisir à la place
  // de l'utilisateur.
  return partial.length === 1 ? (partial[0] ?? null) : null
}

/**
 * `max` vaut le niveau de ce nom s'il existe (Codex en propose un, sous `ultra`), et
 * sinon le plus haut du modèle : l'utilisateur dit « effort max » sans savoir qu'un
 * modèle donné s'arrête à `xhigh`. Les catalogues listent les niveaux du plus bas au
 * plus haut.
 */
export function matchEffort(efforts: string[], wanted: string): string | null {
  if (efforts.includes(wanted)) return wanted
  if (wanted === 'max' || wanted === 'maximum') return efforts.at(-1) ?? null
  if (wanted === 'min' || wanted === 'minimum') return efforts[0] ?? null
  return null
}

function withEffort(config: AgentConfig, effort: string): AgentConfig {
  // Le schéma refuse plus bas un niveau que Claude ne connaît pas : le transtypage ne
  // sert qu'à passer la chaîne jusque-là.
  if (config.agent === 'claude') return { ...config, effort: effort as typeof config.effort }
  if (config.agent === 'codex' || config.agent === 'grok') return { ...config, reasoningEffort: effort }
  return { ...config, variant: effort }
}

/** L'effort sous le nom que chaque CLI lui donne : la variante, chez opencode. */
function effortOf(config: AgentConfig): string {
  if (config.agent === 'claude') return config.effort
  if (config.agent === 'opencode') return config.variant
  return config.reasoningEffort
}

function describeModel(config: AgentConfig): string {
  return config.model || 'celui du CLI'
}

function describeEffort(config: AgentConfig): string {
  return effortOf(config) || 'celui du CLI'
}

function describePermissions(config: AgentConfig): string | null {
  if (config.agent === 'claude' && config.permissionMode === 'manual') {
    return "Ses permissions sont en mode manuel, comme les défauts du projet : elle s'arrêtera pour demander à l'utilisateur avant d'agir."
  }
  if (config.agent === 'codex' && config.askForApproval !== 'never' && config.askForApproval !== '') {
    return "Elle demandera l'approbation de l'utilisateur pour ce qui sort de son bac à sable, comme le veulent les défauts du projet."
  }
  if (config.agent === 'opencode' && (config.permissions.edit === 'ask' || config.permissions.bash === 'ask')) {
    return "Elle demandera la permission de l'utilisateur avant d'écrire ou d'exécuter, comme le veulent les défauts du projet."
  }
  if (config.agent === 'grok' && (config.permissionMode === 'default' || config.permissionMode === 'plan')) {
    return "Elle demandera la permission de l'utilisateur avant d'écrire ou d'exécuter, comme le veulent les défauts du projet."
  }
  return null
}
