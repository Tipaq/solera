import { randomUUID } from 'node:crypto'
import type { EventEmitter } from 'node:events'
import { and, desc, eq, inArray, isNotNull, isNull, ne, or } from 'drizzle-orm'
import type { FastifyBaseLogger } from 'fastify'
import {
  agentRequests,
  cardNotes,
  cards,
  conversations,
  projects,
  sessionMessages,
  users,
  type AgentRequestRow,
  type ConversationRow,
  type ProjectRow,
} from '@solera/db'
import {
  MAX_DECISION_CONTEXT_CHARS,
  MAX_DECISION_OPTION_CHARS,
  MAX_DECISION_OPTIONS,
  MAX_DECISION_QUESTION_CHARS,
  MIN_DECISION_HOURS,
  decisionAnswerSchema,
  parseAgentConfig,
  type AnswerDecisionBody,
  type AwaitingRequestDto,
  type AwaitingRequestEntryDto,
  type DecisionAnswer,
  type DecisionDto,
  type DecisionPayload,
  type DecisionWorktreeDto,
} from '@solera/protocol'
import type { EventLog } from '../events/event-log.js'
import type { AppContext } from '../http/context.js'
import { HttpError } from '../http/errors.js'
import type { Notifications } from '../notifications/dispatcher.js'
import { tellOutcome } from '../sessions/request-lifecycle.js'

/**
 * Les décisions qu'une session demande à une personne (`request_decision`).
 *
 * **Pas de table à elles** : une décision est une ligne `agent_requests`, sur le modèle
 * des deux rangements. L'agent dépose et a sa réponse tout de suite (« déposée, ne
 * l'attends pas ») ; une personne tranche plus tard, et la ligne se clôt
 * (`resolved_at`). La réponse repart à la session par `session_messages`, genre
 * `decision` : c'est le relais qui la remet et relance la session, et c'est ce qui
 * survit à un redémarrage, là où une demande native du CLI meurt avec son process.
 *
 * Ce module porte ce qui est propre aux décisions et que deux appelants partagent : le
 * dépôt et le balayage des échéances, appelés par `AgentRequests`, et la réponse,
 * appelée par la route. Les textes rendus à l'agent sont rédigés pour le modèle, en
 * français comme le reste des outils.
 */

const HOUR_MS = 3_600_000

/** Refus adressé à l'agent : le texte lui est rendu tel quel. */
export class DecisionRefusal extends Error {}

/**
 * Une décision déposée : le texte rendu à l'agent, et l'annonce à qui doit trancher.
 *
 * L'annonce est à part parce qu'elle doit venir **après** la clôture côté daemon
 * (`settled_at`) : la section « À décider » ne liste que les demandes closes, et l'onglet
 * qui la relit sur `awaiting-changed` repartirait sans la décision — et effacerait son
 * toast. Elle n'attend pas le push : un service de push lent ne doit retenir ni la
 * réponse de l'agent, ni le balayage des autres demandes.
 */
export interface DecisionDeposit {
  text: string
  announce(): void
}

/** Ce que ce module attend de l'aiguillage des notifications, et rien de plus. */
export type DecisionNotifier = Pick<Notifications, 'dispatch'>

function stamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** La charge réécrite au dépôt ; une ligne d'avant la normalisation se relit vide. */
export function readDecisionPayload(raw: string): DecisionPayload {
  const value = JSON.parse(raw) as Partial<DecisionPayload>
  return {
    question: typeof value.question === 'string' ? value.question : '',
    context: typeof value.context === 'string' ? value.context : '',
    options: Array.isArray(value.options)
      ? value.options.filter((entry): entry is string => typeof entry === 'string')
      : [],
    defaultOption: typeof value.defaultOption === 'string' ? value.defaultOption : null,
  }
}

/**
 * L'arbre visé par une ancienne proposition de nettoyage, qui reste lisible dans
 * l'historique ; null pour une demande d'agent.
 */
function readWorktree(row: AgentRequestRow): DecisionWorktreeDto | null {
  if (!row.worktreePath) return null
  const value = (JSON.parse(row.payload) as { worktree?: Partial<DecisionWorktreeDto> }).worktree ?? {}
  return {
    path: row.worktreePath,
    branch: typeof value.branch === 'string' ? value.branch : '',
    base: typeof value.base === 'string' ? value.base : '',
    sessions: typeof value.sessions === 'number' ? value.sessions : 0,
  }
}

function readAnswer(raw: string | null): DecisionAnswer | null {
  if (!raw) return null
  const parsed = decisionAnswerSchema.safeParse(JSON.parse(raw))
  return parsed.success ? parsed.data : null
}

export class Decisions {
  private logger: FastifyBaseLogger | null = null

  constructor(
    private readonly ctx: AppContext,
    private readonly log: EventLog,
    /** Le bus du gestionnaire de sessions, que le hub WebSocket écoute. */
    private readonly bus: EventEmitter,
    /** Absent dans les tests qui n'en parlent pas : rien ne part alors. */
    private readonly notifications?: DecisionNotifier,
  ) {}

  setLogger(logger: FastifyBaseLogger): void {
    this.logger = logger
  }

  /**
   * Les demandes qui attendent ces comptes ont changé : la section « À décider » de leurs
   * onglets se relit, et la pastille de l'icône avec elle.
   */
  awaitingChanged(userIds: Iterable<string>): void {
    const unique = [...new Set(userIds)]
    if (unique.length > 0) this.bus.emit('awaiting', { userIds: unique })
  }

  // --- Le dépôt, par le daemon ------------------------------------------------------

  /**
   * Valide et dépose une décision. La ligne est déjà là, écrite par le serveur MCP : on
   * la complète (charge normalisée, échéance), et l'appelant prévient qui doit trancher
   * par `announce`, une fois la demande close de son côté.
   *
   * Le droit (`decisions` dans la configuration de la session) et le projet sont
   * vérifiés par l'appelant, avec les autres genres.
   */
  request(
    request: AgentRequestRow,
    requester: ConversationRow,
    project: ProjectRow,
    payload: Record<string, unknown>,
    /**
     * Le réglage « Automatique » (#120) : personne n'est sollicité, l'option par défaut
     * de l'agent est retenue dès le dépôt, et le fil le dit en une ligne.
     */
    automatic = false,
  ): DecisionDeposit {
    const question = typeof payload.question === 'string' ? payload.question.trim() : ''
    if (!question) throw new DecisionRefusal('Le paramètre `question` est requis.')
    if (question.length > MAX_DECISION_QUESTION_CHARS) {
      throw new DecisionRefusal(
        `Question trop longue (${question.length} caractères, ${MAX_DECISION_QUESTION_CHARS} au plus) : mets le détail dans \`context\`.`,
      )
    }
    const context = typeof payload.context === 'string' ? payload.context.trim() : ''
    if (context.length > MAX_DECISION_CONTEXT_CHARS) {
      throw new DecisionRefusal(`Contexte trop long (${MAX_DECISION_CONTEXT_CHARS} caractères au plus).`)
    }
    const options = Array.isArray(payload.options)
      ? [
          ...new Set(
            payload.options
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.trim())
              .filter(Boolean),
          ),
        ]
      : []
    if (options.length > MAX_DECISION_OPTIONS) {
      throw new DecisionRefusal(`${MAX_DECISION_OPTIONS} choix au plus.`)
    }
    if (options.some((option) => option.length > MAX_DECISION_OPTION_CHARS)) {
      throw new DecisionRefusal(`Un choix tient en ${MAX_DECISION_OPTION_CHARS} caractères au plus.`)
    }
    const fallback =
      typeof payload.default === 'string' && payload.default.trim() ? payload.default.trim() : null
    if (fallback && !options.includes(fallback)) {
      throw new DecisionRefusal('`default` doit reprendre exactement l’un des `options`.')
    }

    // Pas d'échéance imposée (#119) : certaines décisions ne doivent pas avoir de fin.
    // L'agent en pose une s'il la veut, bornée au maximum réglé pour la session ; un
    // choix par défaut en demande une, sans quoi il ne s'appliquerait jamais.
    const maxHours = parseAgentConfig(requester.config).decisionMaxHours
    const asked =
      typeof payload.expires_in_hours === 'number' && Number.isFinite(payload.expires_in_hours)
        ? payload.expires_in_hours
        : fallback
          ? maxHours
          : null
    const hours = asked === null ? null : Math.min(Math.max(asked, MIN_DECISION_HOURS), maxHours)

    // Une seule décision en attente à la fois par conversation, comme pour les
    // rangements : tant que personne n'a répondu, l'agent n'a rien à ajouter.
    const waiting = this.ctx.db
      .select({ payload: agentRequests.payload })
      .from(agentRequests)
      .where(
        and(
          eq(agentRequests.kind, 'request_decision'),
          eq(agentRequests.conversationId, requester.id),
          isNull(agentRequests.resolvedAt),
          deposited(),
          ne(agentRequests.id, request.id),
        ),
      )
      .get()
    if (waiting) {
      throw new DecisionRefusal(
        `Refusé : une demande de décision attend déjà sa réponse (« ${readDecisionPayload(waiting.payload).question} »). Une seule à la fois : termine ton tour, la réponse t'arrivera en message.`,
      )
    }

    const normalized: DecisionPayload = { question, context, options, defaultOption: fallback }
    if (automatic) return this.decideAutomatically(request, requester, normalized)
    const expiresAt = hours === null ? null : Date.now() + hours * HOUR_MS
    this.ctx.db
      .update(agentRequests)
      .set({ payload: JSON.stringify(normalized), expiresAt })
      .where(eq(agentRequests.id, request.id))
      .run()

    this.log.append(requester.id, {
      type: 'decision.requested',
      requestId: request.id,
      question,
      context,
      options,
      defaultOption: fallback,
      expiresAt,
    })
    this.noteOnCard(requester, `Décision demandée : ${question}`, null)

    const text = [
      "Demande déposée : l'utilisateur la voit dans « À décider » et en est notifié.",
      expiresAt === null
        ? "Ne l'attends pas : termine ton tour, ou continue ce qui n'en dépend pas. Elle n'a pas d'échéance : la réponse t'arrivera en message quand l'utilisateur aura tranché, et te relancera."
        : `Ne l'attends pas : termine ton tour, ou continue ce qui n'en dépend pas. La réponse t'arrivera en message, au plus tard le ${stamp(expiresAt)} ; ${
            fallback
              ? `sans réponse d'ici là, Solera répondra « ${fallback} » à sa place`
              : "sans réponse d'ici là, Solera te dira que personne n'a répondu"
          }.`,
      "N'en redépose pas : une seule demande de décision peut attendre à la fois.",
    ].join('\n')
    return {
      text,
      announce: () => {
        this.awaitingChanged([requester.userId])
        void this.notify(request.id, requester, project, question)
      },
    }
  }

  /**
   * Une décision tranchée d'office (#120) : la demande est close au dépôt, sans
   * notification ni message à l'agent — le retour de son outil lui dit ce qui est retenu,
   * et un message le relancerait pour rien. Elle ne passe donc pas par « À décider ».
   *
   * Sans option par défaut, rien n'est choisi à sa place : il l'apprend de la même façon,
   * et décide selon ses instructions.
   */
  private decideAutomatically(
    request: AgentRequestRow,
    requester: ConversationRow,
    normalized: DecisionPayload,
  ): DecisionDeposit {
    const now = Date.now()
    const option = normalized.defaultOption
    const answer: DecisionAnswer = option ? { by: 'default', option } : { by: 'expired' }
    this.ctx.db
      .update(agentRequests)
      .set({
        payload: JSON.stringify(normalized),
        expiresAt: null,
        resolvedAt: now,
        answer: JSON.stringify(answer),
        ...(option ? { acceptedAt: now } : {}),
      })
      .where(eq(agentRequests.id, request.id))
      .run()
    this.log.append(requester.id, {
      type: 'decision.requested',
      requestId: request.id,
      question: normalized.question,
      context: normalized.context,
      options: normalized.options,
      defaultOption: option,
      expiresAt: null,
    })
    this.log.append(requester.id, {
      type: 'decision.resolved',
      requestId: request.id,
      by: answer.by,
      option: option ?? null,
      text: null,
      decidedBy: null,
      automatic: true,
    })
    this.noteOnCard(requester, `Décision prise d'office : ${normalized.question}`, option)
    return {
      text: option
        ? `Les décisions de cette session sont réglées sur « Automatique » : personne n'est sollicité, et ton option par défaut, « ${option} », est retenue. Continue avec elle.`
        : "Les décisions de cette session sont réglées sur « Automatique » : personne n'est sollicité, et tu n'as pas donné d'option par défaut. Décide selon tes instructions, et dis dans ta réponse ce que tu as choisi.",
      announce: () => {},
    }
  }

  /**
   * Échéances et retraits, greffés sur le balayage des demandes d'agent.
   *
   * Une décision échue reçoit le choix par défaut, ou la nouvelle que personne n'a
   * répondu. Celle d'une conversation archivée ou supprimée est retirée : archiver une
   * session, c'est la ranger, et sa demande n'attend plus personne. Balayé plutôt
   * qu'appelé au moment de l'archivage, qui se fait en trois endroits (la route,
   * l'archivage automatique, la rétention des tirs planifiés).
   */
  sweep(now = Date.now()): void {
    const open = this.ctx.db
      .select()
      .from(agentRequests)
      .where(
        and(
          eq(agentRequests.kind, 'request_decision'),
          isNull(agentRequests.resolvedAt),
          deposited(),
        ),
      )
      .all()
    if (open.length === 0) return

    const owners = new Map(
      this.ctx.db
        .select({ id: conversations.id, archivedAt: conversations.archivedAt })
        .from(conversations)
        .where(inArray(conversations.id, [...new Set(open.map((row) => row.conversationId))]))
        .all()
        .map((row) => [row.id, row.archivedAt]),
    )
    for (const row of open) {
      try {
        // Une ancienne proposition de nettoyage, que `retireWorktreeProposals` aurait
        // dû retirer au démarrage.
        if (row.worktreePath) {
          this.close(row, { by: 'withdrawn' })
          continue
        }
        const archivedAt = owners.get(row.conversationId)
        if (archivedAt === undefined || archivedAt !== null) {
          this.close(row, { by: 'withdrawn' })
        } else if (row.expiresAt !== null && row.expiresAt <= now) {
          const fallback = readDecisionPayload(row.payload).defaultOption
          this.close(row, fallback ? { by: 'default', option: fallback } : { by: 'expired' })
        }
      } catch (err) {
        this.logger?.warn({ err, request: row.id }, 'échéance de décision en échec')
      }
    }
  }

  // --- Les anciennes propositions de nettoyage -----------------------------------

  /**
   * Retire les propositions « nettoyer ? » encore en attente, au démarrage.
   *
   * Solera en posait une dès qu'un worktree était fusionné ; il n'en pose plus :
   * « À décider » est réservé à ce qu'un agent demande à une personne, et le nettoyage
   * se fait à la main, depuis la vue Chantiers. Les arbres ne sont pas touchés, et
   * aucune session n'est relancée. Les propositions closes restent dans l'historique.
   */
  retireWorktreeProposals(): number {
    const pending = this.ctx.db
      .select()
      .from(agentRequests)
      .where(
        and(
          eq(agentRequests.kind, 'request_decision'),
          isNotNull(agentRequests.worktreePath),
          isNull(agentRequests.resolvedAt),
        ),
      )
      .all()
    for (const row of pending) this.close(row, { by: 'withdrawn' })
    return pending.length
  }

  // --- Les gestes de l'utilisateur ------------------------------------------------

  /**
   * La réponse d'une personne. Seul le propriétaire de la conversation tranche. Une
   * ancienne proposition de nettoyage ne se tranche plus : elle se retire, et rien n'est
   * nettoyé.
   */
  async answer(userId: string, id: string, body: AnswerDecisionBody): Promise<DecisionDto> {
    const row = this.row(userId, id)
    if (row.worktreePath && row.resolvedAt === null) this.close(row, { by: 'withdrawn' })
    if (row.worktreePath || row.resolvedAt !== null) {
      throw new HttpError(409, 'decision_closed', 'This decision is no longer pending.')
    }
    if (body.option !== null && !readDecisionPayload(row.payload).options.includes(body.option)) {
      throw new HttpError(400, 'decision_unknown_option', 'This option was not offered.')
    }
    this.close(row, {
      by: 'user',
      userId,
      ...(body.option !== null ? { option: body.option } : {}),
      ...(body.text ? { text: body.text } : {}),
    })
    return this.get(userId, id)
  }

  list(userId: string, scope: 'pending' | 'all', limit = 200): DecisionDto[] {
    const rows = this.ctx.db
      .select({ request: agentRequests })
      .from(agentRequests)
      .leftJoin(conversations, eq(conversations.id, agentRequests.conversationId))
      .leftJoin(projects, eq(projects.id, agentRequests.projectId))
      .where(
        and(
          eq(agentRequests.kind, 'request_decision'),
          ownedBy(userId),
          deposited(),
          scope === 'pending' ? isNull(agentRequests.resolvedAt) : undefined,
        ),
      )
      .orderBy(desc(agentRequests.createdAt))
      .limit(limit)
      .all()
      .map((entry) => entry.request)
    return this.toDtos(rows)
  }

  get(userId: string, id: string): DecisionDto {
    return this.toDtos([this.row(userId, id)])[0]!
  }

  pendingCount(userId: string): number {
    return this.ctx.db
      .select({ id: agentRequests.id })
      .from(agentRequests)
      .leftJoin(conversations, eq(conversations.id, agentRequests.conversationId))
      .leftJoin(projects, eq(projects.id, agentRequests.projectId))
      .where(
        and(
          eq(agentRequests.kind, 'request_decision'),
          ownedBy(userId),
          isNull(agentRequests.resolvedAt),
          deposited(),
        ),
      )
      .all().length
  }

  /**
   * Tout ce qui attend ce compte, pour la section « À décider » : les décisions des
   * conversations qu'il possède, les rangements de cartes des projets qu'il possède (c'est
   * le propriétaire du projet qui range son board), et les rangements de ses
   * conversations. Un rangement de conversation déjà accordé n'attend plus que le
   * balayage, pas une personne.
   */
  awaiting(userId: string): AwaitingRequestDto[] {
    const rows = this.ctx.db
      .select()
      .from(agentRequests)
      .where(
        and(
          inArray(agentRequests.kind, ['request_decision', 'request_card_change', 'propose_cards', 'move_conversation']),
          isNull(agentRequests.resolvedAt),
          isNull(agentRequests.acceptedAt),
          isNotNull(agentRequests.settledAt),
          eq(agentRequests.isError, false),
        ),
      )
      .orderBy(desc(agentRequests.createdAt))
      .all()
    if (rows.length === 0) return []

    const conversationIds = new Set<string>()
    for (const row of rows) {
      conversationIds.add(row.conversationId)
      if (row.kind === 'move_conversation') conversationIds.add(filingTarget(row))
    }
    const threads = new Map(
      this.ctx.db
        .select({
          id: conversations.id,
          title: conversations.title,
          userId: conversations.userId,
          projectId: conversations.projectId,
        })
        .from(conversations)
        .where(inArray(conversations.id, [...conversationIds]))
        .all()
        .map((row) => [row.id, row]),
    )
    const projectIds = [...new Set(rows.flatMap((row) => (row.projectId ? [row.projectId] : [])))]
    const owners = new Map(
      projectIds.length === 0
        ? []
        : this.ctx.db
            .select({ id: projects.id, ownerId: projects.ownerId })
            .from(projects)
            .where(inArray(projects.id, projectIds))
            .all()
            .map((row) => [row.id, row.ownerId]),
    )

    const items: AwaitingRequestDto[] = []
    for (const row of rows) {
      const requester = threads.get(row.conversationId)
      if (row.kind === 'request_decision' && row.worktreePath) {
        if (!row.projectId || owners.get(row.projectId) !== userId) continue
        items.push({
          kind: 'decision',
          id: row.id,
          conversationId: row.conversationId,
          projectId: row.projectId,
          conversationTitle: '',
          question: readDecisionPayload(row.payload).question,
          worktreeBranch: readWorktree(row)?.branch ?? null,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
        })
      } else if (row.kind === 'request_decision') {
        if (!requester || requester.userId !== userId || !requester.projectId) continue
        items.push({
          kind: 'decision',
          id: row.id,
          conversationId: row.conversationId,
          projectId: requester.projectId,
          conversationTitle: requester.title,
          question: readDecisionPayload(row.payload).question,
          worktreeBranch: null,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
        })
      } else if (row.kind === 'propose_cards') {
        // Le brouillon de cartes (#70) : c'est aussi le propriétaire du projet qui crée.
        if (!requester || !row.projectId || owners.get(row.projectId) !== userId) continue
        const payload = JSON.parse(row.payload) as { cards?: unknown }
        items.push({
          kind: 'propose_cards',
          id: row.id,
          conversationId: row.conversationId,
          projectId: row.projectId,
          conversationTitle: requester.title,
          count: Array.isArray(payload.cards) ? payload.cards.length : 0,
          createdAt: row.createdAt,
        })
      } else if (row.kind === 'request_card_change') {
        if (!requester || !row.projectId || owners.get(row.projectId) !== userId) continue
        // `moves` avant #66, qui l'a élargi en `changes` : une demande déposée avant la
        // migration attend peut-être encore son clic.
        const payload = JSON.parse(row.payload) as { changes?: unknown; moves?: unknown }
        const changes = payload.changes ?? payload.moves
        items.push({
          kind: 'request_card_change',
          id: row.id,
          conversationId: row.conversationId,
          projectId: row.projectId,
          conversationTitle: requester.title,
          count: Array.isArray(changes) ? changes.length : 0,
          createdAt: row.createdAt,
        })
      } else {
        const target = threads.get(filingTarget(row))
        if (!target || target.userId !== userId) continue
        items.push({
          kind: 'move_conversation',
          id: row.id,
          conversationId: target.id,
          projectId: target.projectId,
          conversationTitle: target.title,
          createdAt: row.createdAt,
        })
      }
    }
    return items
  }

  /**
   * L'événement qui a ouvert un accord en attente, pour que la modale d'Activité (#121)
   * en montre le bloc. Le droit est celui de la section : un accord qu'elle ne liste pas
   * pour ce compte n'existe pas pour lui.
   */
  requestEntry(userId: string, id: string): AwaitingRequestEntryDto {
    const request = this.awaiting(userId).find((entry) => entry.id === id)
    if (!request || request.kind === 'decision') {
      throw new HttpError(404, 'request_not_found', 'Request not found.')
    }
    const type = request.kind === 'move_conversation'
      ? 'filing.requested'
      : request.kind === 'request_card_change' ? 'card_filing.requested' : 'card_draft.proposed'
    const entry = this.log.requestEntry(request.conversationId, type, id)
    if (!entry) throw new HttpError(404, 'request_not_found', 'Request not found.')
    return { conversationId: request.conversationId, ...entry }
  }

  // --- La clôture -----------------------------------------------------------------

  /**
   * Clôt une décision, quelle que soit l'issue, et rend la réponse à la session.
   *
   * La réponse part en `session_messages` et non directement au runner : le relais la
   * remet par les gestes ordinaires (inflexion, file ou relance), et un redémarrage
   * entre la clôture et la remise ne la perd pas. Un retrait part en `outcome`, qui ne
   * relance pas : la session apprend à son prochain tour que la question a été retirée
   * avec son fil, et qu'aucun défaut n'a été appliqué à sa place (#119).
   */
  private close(row: AgentRequestRow, answer: DecisionAnswer): void {
    const now = Date.now()
    // Conditionnel : une réponse et une échéance qui se croisent ne doivent clore qu'une
    // fois, et c'est la première écriture qui gagne.
    const closed = this.ctx.db
      .update(agentRequests)
      .set({
        resolvedAt: now,
        answer: JSON.stringify(answer),
        ...(answer.by === 'user' || answer.by === 'default' ? { acceptedAt: now } : {}),
      })
      .where(and(eq(agentRequests.id, row.id), isNull(agentRequests.resolvedAt)))
      .run()
    if (closed.changes === 0) {
      throw new HttpError(409, 'decision_closed', 'This decision is no longer pending.')
    }

    // Une proposition de nettoyage n'a pas de session à qui répondre : seule la section
    // « À décider » du propriétaire est à relire.
    if (row.worktreePath) {
      const owner = row.projectId
        ? this.ctx.db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, row.projectId)).get()
        : undefined
      this.awaitingChanged(owner ? [owner.ownerId] : [])
      return
    }

    const payload = readDecisionPayload(row.payload)
    const requester = this.ctx.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, row.conversationId))
      .get()

    if (requester) {
      this.log.append(requester.id, {
        type: 'decision.resolved',
        requestId: row.id,
        by: answer.by,
        option: answer.option ?? null,
        text: answer.text ?? null,
        decidedBy: answer.userId ?? null,
      })
    }

    if (requester && answer.by === 'withdrawn') {
      tellOutcome(
        this.ctx.db,
        row,
        [
          'Ta demande de décision a été retirée : son fil a été archivé, ou la session qui la posait a disparu.',
          `Question : « ${payload.question} »`,
          "Personne n'y a répondu, et aucun choix par défaut n'a été appliqué à ta place. Ne la redépose pas sans que l'utilisateur le demande.",
        ].join('\n'),
      )
    } else if (requester && requester.projectId) {
      this.ctx.db
        .insert(sessionMessages)
        .values({
          id: randomUUID(),
          projectId: requester.projectId,
          fromConversationId: requester.id,
          toConversationId: requester.id,
          kind: 'decision',
          body: this.message(payload, answer),
          replyTo: row.id,
          createdAt: now,
        })
        .run()
      this.noteOnCard(requester, `Décision : ${payload.question}\n→ ${describeOutcome(payload, answer)}`, answer.userId ?? null)
    }

    this.awaitingChanged(requester ? [requester.userId] : [])
  }

  /** Le texte remis à la session, dans l'enveloppe `decision` de `formatSessionMessage`. */
  private message(payload: DecisionPayload, answer: DecisionAnswer): string {
    const question = `Question : « ${payload.question} »`
    if (answer.by === 'default') {
      return [
        'Ta demande de décision a expiré sans réponse.',
        question,
        `Réponse appliquée par défaut, comme tu l'avais prévu : « ${answer.option} ».`,
      ].join('\n')
    }
    if (answer.by === 'expired') {
      return [
        'Ta demande de décision a expiré sans réponse.',
        question,
        "Personne n'a répondu dans le délai, et tu n'avais pas donné de choix par défaut : décide selon tes instructions, ou laisse le point ouvert dans ton compte rendu.",
      ].join('\n')
    }
    const name = answer.userId
      ? this.ctx.db.select({ name: users.displayName }).from(users).where(eq(users.id, answer.userId)).get()?.name
      : null
    return [
      'Réponse à ta demande de décision.',
      question,
      answer.option ? `Réponse : « ${answer.option} »` : null,
      answer.text ? `${answer.option ? 'Précision' : 'Réponse'} : ${answer.text}` : null,
      name ? `Répondu par ${name}.` : null,
    ]
      .filter((line) => line !== null)
      .join('\n')
  }

  /** Une session rattachée à une carte y inscrit sa question, puis la réponse. */
  private noteOnCard(requester: ConversationRow, body: string, userId: string | null): void {
    if (!requester.cardId) return
    const card = this.ctx.db.select({ id: cards.id }).from(cards).where(eq(cards.id, requester.cardId)).get()
    if (!card) return
    this.ctx.db
      .insert(cardNotes)
      .values({
        id: randomUUID(),
        cardId: card.id,
        conversationId: requester.id,
        userId,
        body,
        createdAt: Date.now(),
      })
      .run()
  }

  /** Notification et toast : une décision attend, c'est tout l'intérêt de la prévenir. */
  private async notify(
    id: string,
    requester: ConversationRow,
    project: ProjectRow,
    question: string,
  ): Promise<void> {
    if (!this.notifications) return
    await this.notifications
      .dispatch(requester.userId, {
        kind: 'decision',
        push: {
          title: 'Décision à prendre',
          body: `${requester.title} — ${question}`,
          url: `/decisions?open=${id}`,
          tag: `decision-${id}`,
          kind: 'decision',
          badge: this.pendingCount(requester.userId),
        },
        toast: {
          kind: 'decision',
          decisionId: id,
          question,
          conversationId: requester.id,
          conversationTitle: requester.title,
          projectName: project.name,
        },
      })
      .catch((err: unknown) => this.logger?.warn({ err, request: id }, 'notification de décision non émise'))
  }

  private row(userId: string, id: string): AgentRequestRow {
    const found = this.ctx.db
      .select({ request: agentRequests, ownerId: conversations.userId, projectOwnerId: projects.ownerId })
      .from(agentRequests)
      .leftJoin(conversations, eq(conversations.id, agentRequests.conversationId))
      .leftJoin(projects, eq(projects.id, agentRequests.projectId))
      .where(
        and(
          eq(agentRequests.id, id),
          eq(agentRequests.kind, 'request_decision'),
          deposited(),
        ),
      )
      .get()
    if (!found || (found.request.worktreePath ? found.projectOwnerId : found.ownerId) !== userId) {
      throw new HttpError(404, 'decision_not_found', 'Decision not found.')
    }
    return found.request
  }

  private toDtos(rows: AgentRequestRow[]): DecisionDto[] {
    if (rows.length === 0) return []
    const threads = new Map(
      this.ctx.db
        .select({
          id: conversations.id,
          title: conversations.title,
          projectId: conversations.projectId,
          cardId: conversations.cardId,
        })
        .from(conversations)
        .where(inArray(conversations.id, [...new Set(rows.map((row) => row.conversationId))]))
        .all()
        .map((row) => [row.id, row]),
    )
    const projectIds = [...new Set(rows.flatMap((row) => (row.projectId ? [row.projectId] : [])))]
    const projectNames = new Map(
      projectIds.length === 0
        ? []
        : this.ctx.db
            .select({ id: projects.id, name: projects.name })
            .from(projects)
            .where(inArray(projects.id, projectIds))
            .all()
            .map((row) => [row.id, row.name]),
    )
    const cardIds = [...threads.values()].flatMap((row) => (row.cardId ? [row.cardId] : []))
    const cardRows = new Map(
      cardIds.length === 0
        ? []
        : this.ctx.db
            .select({ id: cards.id, number: cards.number, title: cards.title })
            .from(cards)
            .where(inArray(cards.id, cardIds))
            .all()
            .map((row) => [row.id, { number: row.number, title: row.title }]),
    )
    const answers = new Map(rows.map((row) => [row.id, readAnswer(row.answer)]))
    const answerers = [
      ...new Set([...answers.values()].flatMap((answer) => (answer?.userId ? [answer.userId] : []))),
    ]
    const names = new Map(
      answerers.length === 0
        ? []
        : this.ctx.db
            .select({ id: users.id, name: users.displayName })
            .from(users)
            .where(inArray(users.id, answerers))
            .all()
            .map((row) => [row.id, row.name]),
    )

    return rows.map((row) => {
      const payload = readDecisionPayload(row.payload)
      const thread = threads.get(row.conversationId)
      const answer = answers.get(row.id) ?? null
      return {
        id: row.id,
        projectId: row.projectId ?? '',
        projectName: row.projectId ? (projectNames.get(row.projectId) ?? '') : '',
        conversationId: row.conversationId,
        conversationTitle: thread?.title ?? '',
        card: thread?.cardId ? (cardRows.get(thread.cardId) ?? null) : null,
        worktree: readWorktree(row),
        question: payload.question,
        context: payload.context,
        options: payload.options,
        defaultOption: payload.defaultOption,
        expiresAt: row.expiresAt,
        status: answer?.by ?? 'pending',
        answer: answer
          ? {
              option: answer.option ?? null,
              text: answer.text ?? null,
              byName: answer.userId ? (names.get(answer.userId) ?? null) : null,
              at: row.resolvedAt ?? row.createdAt,
            }
          : null,
        createdAt: row.createdAt,
      }
    })
  }
}

/**
 * À qui revient une décision : au propriétaire de la conversation qui l'a demandée, ou à
 * celui du projet pour une proposition de nettoyage. Suppose les jointures à gauche sur
 * `conversations` et `projects`.
 */
function ownedBy(userId: string) {
  return or(
    and(isNull(agentRequests.worktreePath), eq(conversations.userId, userId)),
    and(isNotNull(agentRequests.worktreePath), eq(projects.ownerId, userId)),
  )
}

/**
 * Une décision bien déposée : traitée par le daemon et acceptée. Elle disait avant
 * « avec une échéance », que le dépôt posait toujours ; une décision peut désormais n'en
 * pas avoir (#119).
 */
function deposited() {
  return and(isNotNull(agentRequests.settledAt), eq(agentRequests.isError, false))
}

/** Le fil qu'un `move_conversation` déplace : celui que l'agent a nommé, ou le sien. */
function filingTarget(row: AgentRequestRow): string {
  const payload = JSON.parse(row.payload) as { conversation?: unknown }
  return typeof payload.conversation === 'string' && payload.conversation.trim()
    ? payload.conversation.trim()
    : row.conversationId
}

/** L'issue en une ligne, pour la note de carte. */
function describeOutcome(payload: DecisionPayload, answer: DecisionAnswer): string {
  if (answer.by === 'default') return `sans réponse à l'échéance, « ${answer.option} » appliqué par défaut`
  if (answer.by === 'expired') return "expirée sans réponse"
  return [answer.option ? `« ${answer.option} »` : null, answer.text ?? null].filter(Boolean).join(' — ') ||
    payload.question
}
