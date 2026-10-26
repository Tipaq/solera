import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  agentRequests,
  cards,
  conversationHandoffs,
  conversationReads,
  conversations,
  projects,
  worktrees,
  type ConversationRow,
} from '@solera/db'
import {
  cardDraftDecisionBodySchema,
  createConversationBodySchema,
  createFreeConversationBodySchema,
  moveConversationBodySchema,
  editDiffQuerySchema,
  eventBodyRefSchema,
  elicitationAnswerBodySchema,
  filingDecisionBodySchema,
  forkConversationBodySchema,
  handoffConversationBodySchema,
  markReadBodySchema,
  permissionDecisionBodySchema,
  planDecisionBodySchema,
  questionAnswerBodySchema,
  parseAgentConfig,
  sendMessageBodySchema,
  steerBodySchema,
  updateConversationBodySchema,
  type CardLinkDto,
  type ConversationDto,
  type ConversationPromptDto,
  type EditDiffDto,
  type HandoffDto,
  type JournalPageDto,
  type PendingRequestsDto,
  type ToolOutputDto,
} from '@solera/protocol'
import { ForkError, type AgentRegistry } from '../../agents/registry.js'
import type { OutgoingAttachment } from '../../agents/types.js'
import { isInlineImage, type AttachmentStore } from '../../attachments/store.js'
import type { CardClosure } from '../../cards/close.js'
import { advanceCardOnLaunch } from '../../cards/create.js'
import { createConversation } from '../../conversations/create.js'
import { overridesFor, patchOverrides, readOverrides } from '../../conversations/config-inheritance.js'
import { moveConversation } from '../../conversations/move.js'
import { conversationVisibleTo } from '../../conversations/scope.js'
import {
  buildHandoff,
  clampHandoffTokens,
  HandoffError,
  readHandoffItems,
} from '../../conversations/handoff.js'
import { conversationMetrics } from '../../conversations/metrics.js'
import { pendingPromptOf } from '../v1/task-view.js'
import type { WebhookService } from '../../webhooks/service.js'
import {
  checkWorktree,
  isWorkingDirectoryMissing,
  workingDirectoryMissing,
} from '../../worktrees/gone.js'
import { assertWorktreeBelongs } from '../v1/access.js'
import { assertCardAccepted, assertCardInProject, readCardLink } from './cards.js'
import { coalesceDeltas } from '../../events/coalesce.js'
import type { EventLog } from '../../events/event-log.js'
import { dropConversation } from '../../search/search-index.js'
import {
  describeCardFilingOutcome,
  describeDraftOutcome,
  describeFilingOutcome,
  pendingRequests,
  tellOutcome,
} from '../../sessions/request-lifecycle.js'
import type { SessionManager } from '../../sessions/session-manager.js'
import { acceptCardFiling, acceptDraft, acceptFiling, type AcceptDeps } from '../../sessions/request-accept.js'
import type { AppContext } from '../context.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * Bornes d'une page de relecture (`EventLog.readForReplay`).
 *
 * Une page coûte un aller-retour, et le client les enchaîne l'une après l'autre : à 500
 * événements, la conversation la plus lourde en demandait 147. La borne en octets porte
 * sur les payloads lus en base, et c'est elle qui tient la mémoire du daemon ; celle en
 * lignes borne le listage qui la précède.
 *
 * 16 Mo et pas davantage : rejouées dans un tas contraint, les conversations les plus
 * lourdes de la base passent sous 96 Mo avec cette borne, quand les anciennes pages de 500
 * événements en demandaient plus de 128. Une page plus grande gagnerait quelques
 * allers-retours sur cette marge, et le daemon porte aussi les sessions en cours.
 */
const PAGE_ROWS = 5000
const PAGE_BYTES = 16_000_000

/**
 * `lastReadSeq`, `card` et `worktreeGone` sont passés plutôt que relus ici : les routes
 * de liste les ramènent en une jointure, et une lecture par ligne rendrait la sidebar
 * quadratique.
 */
export function conversationToDto(
  row: ConversationRow,
  userId: string,
  lastReadSeq: number,
  card: CardLinkDto | null,
  worktreeGone: boolean,
): ConversationDto {
  return {
    id: row.id,
    projectId: row.projectId,
    worktreeId: row.worktreeId,
    worktreeGone,
    card,
    userId: row.userId,
    title: row.title,
    titleSetByUser: row.titleSetByUser,
    agent: row.agent,
    forkedFromId: row.forkedFromId,
    handoffFromId: row.handoffFromId,
    config: parseAgentConfig(row.config),
    configOverrides: readOverrides(row),
    status: row.status,
    lastSeq: row.lastSeq,
    lastNotableSeq: row.lastNotableSeq,
    lastReadSeq,
    costUsd: row.costUsd,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    metrics: conversationMetrics(row),
    pinned: row.pinned,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isOwner: row.userId === userId,
    origin: row.originLabel
      ? { tokenId: row.createdByTokenId, label: row.originLabel }
      : null,
    scheduleId: row.scheduleId,
  }
}

export function registerConversationRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  log: EventLog,
  sessions: SessionManager,
  registry: AgentRegistry,
  attachments: AttachmentStore,
  webhooks: WebhookService,
  /** La clôture des cartes (#69) ; sans elle, une demande `close` ne s'accorde pas. */
  closure?: CardClosure,
): void {
  /** Ce que le chemin d'accord partagé avec le réglage « Automatique » demande (#120). */
  const acceptDeps = (request: FastifyRequest): AcceptDeps => ({
    db: ctx.db,
    config: ctx.config,
    log,
    closure,
    warn: (err, card) => request.log.warn({ err, card }, 'clôture de carte en échec'),
  })

  /**
   * Résout les pièces jointes à envoyer, dans l'ordre choisi par le client.
   *
   * Un identifiant inconnu, appartenant à quelqu'un d'autre ou déjà envoyé fait
   * échouer l'ensemble : envoyer un message amputé d'un de ses fichiers serait pire
   * qu'un refus, l'utilisateur croirait l'agent en possession de tout.
   */
  const resolveAttachments = (userId: string, ids: string[]): OutgoingAttachment[] => {
    if (ids.length === 0) return []

    const byId = new Map(attachments.listClaimable(userId, ids).map((row) => [row.id, row]))
    return ids.map((id) => {
      const row = byId.get(id)
      if (!row) {
        throw badRequest(
          'attachment_unavailable',
          'Attachment {id} is unavailable or has already been sent.',
          { id },
        )
      }
      return {
        id: row.id,
        filename: row.filename,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        path: row.storagePath,
        inlineImage: isInlineImage(row.mimeType),
      }
    })
  }
  /** Curseur de lecture d'un compte. 0 quand il n'a jamais ouvert le fil. */
  const readCursor = (conversationId: string, userId: string): number => {
    const row = ctx.db
      .select({ lastReadSeq: conversationReads.lastReadSeq })
      .from(conversationReads)
      .where(
        and(
          eq(conversationReads.conversationId, conversationId),
          eq(conversationReads.userId, userId),
        ),
      )
      .get()
    return row?.lastReadSeq ?? 0
  }

  /** Lecture : propriétaire du projet ou projet partagé. Écriture : propriétaire du fil. */
  const loadReadable = async (conversationId: string, userId: string) => {
    const row = ctx.db
      .select({ conversation: conversations })
      .from(conversations)
      .leftJoin(projects, eq(projects.id, conversations.projectId))
      .where(and(eq(conversations.id, conversationId), conversationVisibleTo(userId)))
      .get()

    if (!row) throw notFound('conversation_not_found', 'Conversation not found.')
    return row.conversation
  }

  const loadWritable = async (conversationId: string, userId: string) => {
    const conversation = await loadReadable(conversationId, userId)
    if (conversation.userId !== userId) {
      throw forbidden('conversation_write_forbidden', 'Only the conversation owner can write to it.')
    }
    return conversation
  }

  /**
   * Toutes les conversations visibles, tous projets confondus. La sidebar les affiche
   * groupées sous leur projet : une requête plutôt qu'une par projet.
   */
  app.get('/api/conversations', async (request) => {
    const user = requireUser(request)

    const rows = ctx.db
      .select({
        conversation: conversations,
        lastReadSeq: conversationReads.lastReadSeq,
        card: {
          id: cards.id,
          number: cards.number,
          title: cards.title,
          column: cards.column,
        },
        worktreeRemovedAt: worktrees.removedAt,
      })
      .from(conversations)
      .leftJoin(cards, eq(cards.id, conversations.cardId))
      .leftJoin(worktrees, eq(worktrees.id, conversations.worktreeId))
      .leftJoin(projects, eq(projects.id, conversations.projectId))
      .leftJoin(
        conversationReads,
        and(
          eq(conversationReads.conversationId, conversations.id),
          eq(conversationReads.userId, user.id),
        ),
      )
      // Les archivées comprises, la sidebar les rangeant elle-même dans sa section
      // repliée. Deux requêtes séparées coûteraient un aller-retour à chaque dépliage,
      // et un désarchivage ne pourrait plus se voir sans recharger les deux.
      .where(conversationVisibleTo(user.id))
      .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
      .all()

    return rows.map((row) =>
      conversationToDto(
        row.conversation,
        user.id,
        row.lastReadSeq ?? 0,
        row.card,
        // Sans constat sur le disque : la liste ne fait pas un `stat` par fil. L'ouverture
        // du fil, l'envoi et la réconciliation des worktrees posent `removedAt`.
        row.worktreeRemovedAt !== null,
      ),
    )
  })

  app.get('/api/projects/:id/conversations', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const includeArchived = (request.query as { archived?: string }).archived === '1'

    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get()
    if (!project) throw notFound('project_not_found', 'Project not found.')
    if (project.ownerId !== user.id && project.visibility !== 'shared') {
      throw notFound('project_not_found', 'Project not found.')
    }

    const rows = ctx.db
      .select({
        conversation: conversations,
        lastReadSeq: conversationReads.lastReadSeq,
        card: {
          id: cards.id,
          number: cards.number,
          title: cards.title,
          column: cards.column,
        },
        worktreeRemovedAt: worktrees.removedAt,
      })
      .from(conversations)
      .leftJoin(cards, eq(cards.id, conversations.cardId))
      .leftJoin(worktrees, eq(worktrees.id, conversations.worktreeId))
      .leftJoin(
        conversationReads,
        and(
          eq(conversationReads.conversationId, conversations.id),
          eq(conversationReads.userId, user.id),
        ),
      )
      .where(
        includeArchived
          ? eq(conversations.projectId, id)
          : and(eq(conversations.projectId, id), isNull(conversations.archivedAt)),
      )
      .orderBy(desc(conversations.pinned), desc(conversations.updatedAt))
      .all()

    return rows.map((row) =>
      conversationToDto(
        row.conversation,
        user.id,
        row.lastReadSeq ?? 0,
        row.card,
        // Sans constat sur le disque : la liste ne fait pas un `stat` par fil. L'ouverture
        // du fil, l'envoi et la réconciliation des worktrees posent `removedAt`.
        row.worktreeRemovedAt !== null,
      ),
    )
  })

  /**
   * Les demandes que les sessions d'un projet attendent, pour l'onglet Activité (#112) :
   * la question ou la permission se lit et se tranche sous la ligne, sans ouvrir le fil.
   *
   * Ne replie que les fils qui attendent — `awaiting_input`, ou une question asynchrone
   * restée ouverte sur un fil au repos —, et chacun sur ses dernières entrées seulement :
   * la liste ne paie pas l'historique de tout le projet. Les archivées en sont, comme
   * dans l'Activité : une session rangée qui réclame réclame encore.
   */
  app.get('/api/projects/:id/prompts', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }

    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get()
    if (!project) throw notFound('project_not_found', 'Project not found.')
    if (project.ownerId !== user.id && project.visibility !== 'shared') {
      throw notFound('project_not_found', 'Project not found.')
    }

    const asking = new Set(log.openAsyncQuestionConversationIds())
    const rows = ctx.db
      .select({ id: conversations.id, status: conversations.status })
      .from(conversations)
      .where(eq(conversations.projectId, id))
      .all()

    const prompts: ConversationPromptDto[] = []
    for (const row of rows) {
      if (row.status !== 'awaiting_input' && !asking.has(row.id)) continue
      const pending = pendingPromptOf(log, row.id)
      if (pending) prompts.push({ conversationId: row.id, ...pending })
    }
    return { prompts }
  })

  app.post('/api/projects/:id/conversations', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = createConversationBodySchema.parse(request.body)

    if (body.config.agent !== body.agent) {
      throw badRequest('config_agent_mismatch', 'The configuration does not match the selected CLI.')
    }

    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get()
    if (!project) throw notFound('project_not_found', 'Project not found.')
    if (project.ownerId !== user.id && project.visibility !== 'shared') {
      throw notFound('project_not_found', 'Project not found.')
    }

    if (body.worktreeId) assertWorktreeBelongs(ctx, id, body.worktreeId)
    if (body.cardId) {
      assertCardInProject(ctx, body.cardId, id)
      assertCardAccepted(ctx, body.cardId)
    }
    // Un découpage se lit à la racine du projet, sans arbre ni carte rattachée : la
    // session propose des cartes, elle n'écrit pas de code (#70).
    if (body.purpose === 'split' && (body.worktreeId || body.cardId)) {
      throw badRequest('split_without_worktree', 'A card split runs at the project root, without a worktree or a linked card.')
    }
    if (body.splitCardId) {
      if (body.purpose !== 'split') throw badRequest('split_card_without_purpose', 'splitCardId only goes with purpose "split".')
      assertCardInProject(ctx, body.splitCardId, id)
    }

    // Les `CLI_DEFAULT` sont remplacés par ce que le CLI annonce, avant d'écrire en
    // base : la conversation garde ensuite une configuration explicite et stable.
    const config = await registry.adapter(body.agent).resolveDefaults(body.config)

    const firstMessage = body.firstMessage
    const row = await createConversation(ctx.db, sessions, {
      projectId: id,
      userId: user.id,
      agent: body.agent,
      config,
      worktreeId: body.worktreeId,
      cardId: body.cardId,
      purpose: body.purpose,
      splitCardId: body.splitCardId,
      title: body.title,
      origin: null,
      firstMessage: firstMessage && {
        clientMessageId: firstMessage.clientMessageId,
        text: firstMessage.text,
        attachments: resolveAttachments(user.id, firstMessage.attachmentIds),
        mentions: firstMessage.mentions,
        skills: firstMessage.skills,
      },
    })

    // Rattachées seulement après un envoi réussi : si le CLI refuse, la conversation
    // a été supprimée et les fichiers restent réutilisables pour une nouvelle tentative.
    if (firstMessage) attachments.claim(firstMessage.attachmentIds, row.id)

    // La seule transition automatique du board, et elle tient à ce qu'elle suit un
    // geste : c'est l'envoi qui vient de réussir, pas la découverte d'une session en
    // train de tourner. Une carte plus avancée que `todo` ne recule pas.
    if (body.cardId) advanceCardOnLaunch(ctx, body.cardId, user.id)

    // Curseur à zéro : le client marque la conversation lue en s'y installant, comme
    // pour n'importe quelle autre. La devancer ici mentirait sur ce qui est en base.
    return reply
      .status(201)
      .send(
        conversationToDto(
          row,
          user.id,
          0,
          readCardLink(ctx, body.cardId),
          checkWorktree(ctx.db, row.worktreeId).gone,
        ),
      )
  })

  /**
   * Ouvrir un fil libre, qui n'appartient à aucun projet.
   *
   * Route à part et non un `projectId` optionnel sur celle du projet : le chemin dit
   * déjà ce qui est visé, et la route du projet porte des contrôles — le worktree, la
   * carte, l'avancement du board — qui n'ont ici aucun objet.
   */
  app.post('/api/conversations', async (request, reply) => {
    const user = requireUser(request)
    const body = createFreeConversationBodySchema.parse(request.body)

    if (body.config.agent !== body.agent) {
      throw badRequest('config_agent_mismatch', 'The configuration does not match the selected CLI.')
    }

    const config = await registry.adapter(body.agent).resolveDefaults(body.config)

    const firstMessage = body.firstMessage
    const row = await createConversation(ctx.db, sessions, {
      projectId: null,
      userId: user.id,
      agent: body.agent,
      config,
      worktreeId: null,
      cardId: null,
      title: body.title,
      origin: null,
      firstMessage: firstMessage && {
        clientMessageId: firstMessage.clientMessageId,
        text: firstMessage.text,
        attachments: resolveAttachments(user.id, firstMessage.attachmentIds),
        mentions: firstMessage.mentions,
        skills: firstMessage.skills,
      },
    })

    if (firstMessage) attachments.claim(firstMessage.attachmentIds, row.id)

    return reply.status(201).send(conversationToDto(row, user.id, 0, null, false))
  })


  /**
   * Branche une conversation à un point du fil.
   *
   * Lecture suffisante sur la source : brancher une conversation partagée est une
   * lecture, et la branche appartient à celui qui la crée. L'ordre des opérations
   * compte : la session est forkée d'abord, parce que c'est la seule étape qui peut
   * échouer pour une raison extérieure, et rien ne doit rester en base si elle échoue.
   */
  app.post('/api/conversations/:id/fork', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = forkConversationBodySchema.parse(request.body)
    const source = await loadReadable(id, user.id)

    if (body.throughSeq > source.lastSeq) {
      throw badRequest('fork_point_unknown', 'This cut point is beyond the end of the thread.')
    }
    // Une branche hérite du worktree, et le CLI forke sa session dans ce dossier : d'un
    // worktree disparu, il n'y a rien à brancher. Le refus est celui du bandeau, qui
    // propose de continuer à la racine avant de brancher.
    const sourceWorktree = checkWorktree(ctx.db, source.worktreeId)
    if (sourceWorktree.marked) sessions.statusBus.emit('lists', { conversationId: id })
    if (sourceWorktree.gone) throw workingDirectoryMissing(sourceWorktree.path ?? '')

    let agentSessionId: string
    try {
      agentSessionId = await sessions.forkSession(id, body.throughSeq)
    } catch (err) {
      if (err instanceof ForkError) throw badRequest('fork_failed', err.message)
      throw err
    }

    const now = Date.now()
    const row: ConversationRow = {
      ...source,
      id: randomUUID(),
      userId: user.id,
      title: body.title ?? `${source.title} (branche)`,
      titleSetByUser: body.title !== undefined,
      titleSetByAgent: false,
      agentSessionId,
      forkedFromId: source.id,
      // La branche est ouverte depuis l'interface, par une personne : hériter du
      // marqueur d'origine de la source lui attribuerait un jeton qui n'y est pour rien.
      createdByTokenId: null,
      originLabel: null,
      scheduleId: null,
      status: 'idle',
      // Le journal est recopié juste après, qui posera le vrai compteur.
      lastSeq: 0,
      pinned: false,
      position: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    ctx.db.insert(conversations).values(row).run()

    // Sans cette copie, la branche s'afficherait vide alors que l'agent, lui, se
    // souvient de tout l'historique conservé (invariant I2).
    const copied = log.copyThrough(id, row.id, body.throughSeq)
    // Les repères de tour recopiés doivent mener aux mêmes captures.
    await sessions.inheritCheckpoints(id, row.id)

    // Une branche d'une suite reste une suite : le contexte transmis arrive par le
    // prompt système à chaque démarrage, et la branche le perdrait sans sa propre ligne.
    const handoff = ctx.db
      .select()
      .from(conversationHandoffs)
      .where(eq(conversationHandoffs.conversationId, id))
      .get()
    if (handoff) {
      ctx.db.insert(conversationHandoffs).values({ ...handoff, conversationId: row.id }).run()
    }

    // Le fork hérite du rattachement : c'est le même travail exploré autrement.
    return reply
      .status(201)
      .send(
        conversationToDto(
          { ...row, lastSeq: copied },
          user.id,
          0,
          readCardLink(ctx, row.cardId),
          false,
        ),
      )
  })

  /**
   * Continue une conversation dans un autre CLI.
   *
   * Même droit de lecture que le fork : continuer un fil partagé est une lecture, et la
   * suite appartient à qui l'ouvre. Rien n'est envoyé au CLI ici : la sélection est
   * écrite avec la conversation, et c'est le premier message, la nouvelle demande, qui
   * lancera la session avec ce contexte dans son prompt système.
   */
  app.post('/api/conversations/:id/handoff', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = handoffConversationBodySchema.parse(request.body)
    const source = await loadReadable(id, user.id)

    if (body.config.agent !== body.agent) {
      throw badRequest('config_agent_mismatch', 'The configuration does not match the selected CLI.')
    }

    const budgetTokens = clampHandoffTokens(body.budgetTokens)
    let handoff
    try {
      handoff = buildHandoff(
        readHandoffItems(log, id),
        { id: source.id, title: source.title, agent: source.agent, rereadable: source.projectId !== null },
        body.agent,
        budgetTokens,
      )
    } catch (err) {
      if (err instanceof HandoffError) throw badRequest(err.code, err.message)
      throw err
    }

    const config = await registry.adapter(body.agent).resolveDefaults(body.config)
    const row = await createConversation(ctx.db, sessions, {
      projectId: source.projectId,
      userId: user.id,
      agent: body.agent,
      config,
      // Même arbre et même chantier : c'est le même travail, poursuivi avec un autre
      // outil.
      // Un worktree disparu ne se transmet pas : la suite partirait condamnée au même
      // bandeau. Elle reprend à la racine du projet.
      worktreeId: checkWorktree(ctx.db, source.worktreeId).gone ? null : source.worktreeId,
      cardId: source.cardId,
      purpose: source.purpose,
      splitCardId: source.splitCardId,
      title: body.title ?? source.title,
      origin: null,
      handoff: {
        fromConversationId: source.id,
        throughSeq: source.lastSeq,
        budgetTokens,
        text: handoff.text,
      },
    })

    return reply
      .status(201)
      .send(
        conversationToDto(
          row,
          user.id,
          0,
          readCardLink(ctx, row.cardId),
          checkWorktree(ctx.db, row.worktreeId).gone,
        ),
      )
  })

  /** Ce qu'une suite a reçu de sa source, pour que l'utilisateur voie ce que l'agent sait. */
  app.get('/api/conversations/:id/handoff', async (request): Promise<HandoffDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    await loadReadable(id, user.id)
    const row = ctx.db
      .select()
      .from(conversationHandoffs)
      .where(eq(conversationHandoffs.conversationId, id))
      .get()
    if (!row) throw notFound('handoff_not_found', 'This conversation does not continue another one.')
    return {
      fromConversationId: row.fromConversationId,
      throughSeq: row.throughSeq,
      budgetTokens: row.budgetTokens,
      bytes: Buffer.byteLength(row.text),
      text: row.text,
      createdAt: row.createdAt,
    }
  })

  app.get('/api/conversations/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const conversation = await loadReadable(id, user.id)
    // Constaté ici et non seulement à l'envoi : un worktree emporté par un merge doit
    // montrer son bandeau à l'ouverture du fil, pas au premier message refusé.
    const worktree = checkWorktree(ctx.db, conversation.worktreeId)
    if (worktree.marked) sessions.statusBus.emit('lists', { conversationId: id })
    return conversationToDto(
      conversation,
      user.id,
      readCursor(id, user.id),
      readCardLink(ctx, conversation.cardId),
      worktree.gone,
    )
  })

  /**
   * Avance le curseur de lecture. Ouvert à tout lecteur, y compris sur un fil qu'il ne
   * peut pas écrire : savoir ce qu'on a lu n'est pas une modification de la conversation.
   */
  app.post('/api/conversations/:id/read', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = markReadBodySchema.parse(request.body)
    const conversation = await loadReadable(id, user.id)

    // Borné au journal de cette conversation-là : un client qui suit plusieurs fils
    // envoie forcément un jour le `seq` du précédent, et un curseur au-delà de ce qui
    // existe déclarerait lu d'avance tout ce que la conversation produira ensuite.
    const seq = Math.min(body.seq, conversation.lastSeq)
    const now = Date.now()
    ctx.db
      .insert(conversationReads)
      .values({ conversationId: id, userId: user.id, lastReadSeq: seq, updatedAt: now })
      .onConflictDoUpdate({
        target: [conversationReads.conversationId, conversationReads.userId],
        // Le `max` est porté par la base et non par une lecture préalable : deux onglets
        // qui marquent en même temps ne peuvent alors pas se faire reculer l'un l'autre,
        // quel que soit l'ordre d'arrivée.
        set: {
          lastReadSeq: sql`max(excluded.last_read_seq, ${conversationReads.lastReadSeq})`,
          updatedAt: now,
        },
      })
      .run()

    return { lastReadSeq: readCursor(id, user.id) }
  })

  /**
   * Une page du fil projeté (`thread-projection.ts`) : les tours récents, ou ceux
   * d'avant `before`. `building` tant que la projection rattrape le journal ; le
   * client réessaie.
   */
  app.get('/api/conversations/:id/thread', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    await loadReadable(id, user.id)
    const query = request.query as { before?: string; after?: string }
    const before = query.before === undefined ? undefined : Number(query.before)
    const after = query.after === undefined ? undefined : Number(query.after)
    if ([before, after].some((value) => value !== undefined && (!Number.isSafeInteger(value) || value < 0))) {
      throw badRequest('invalid_thread_cursor', 'Invalid thread cursor.')
    }
    reply.header('cache-control', 'no-store')
    return log.thread.page(id, before, after)
  })

  app.get('/api/conversations/:id/events', async (request): Promise<JournalPageDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const asked = Number((request.query as { after?: string }).after ?? 0)
    const after = Number.isFinite(asked) ? asked : 0
    const conversation = await loadReadable(id, user.id)

    const bodies = (request.query as { bodies?: string }).bodies === '1'
    const page = log.readForReplay(id, after, { rows: PAGE_ROWS, bytes: PAGE_BYTES, bodies })
    return {
      entries: coalesceDeltas(page.entries).map((entry) => ({
        seq: entry.seq,
        ts: entry.ts,
        event: entry.event,
      })),
      nextAfter: page.nextAfter,
      lastSeq: conversation.lastSeq,
    }
  })

  /**
   * Un corps laissé au serveur par la relecture (`bodies=1`). Suit la visibilité de la
   * conversation, projets partagés compris. Rien du `raw` natif n'est exposé, et
   * aucun chemin JSON fourni par l'appelant n'est évalué.
   */
  app.get('/api/conversations/:id/events/:seq/body/:field', async (request, reply) => {
    const user = requireUser(request)
    const { id, seq, field } = request.params as { id: string; seq: string; field: string }
    await loadReadable(id, user.id)
    const block = (request.query as { block?: string }).block
    const ref = eventBodyRefSchema.parse({
      seq: Number(seq),
      field,
      ...(block === undefined ? {} : { block: Number(block) }),
    })
    const found = log.eventBody(id, ref.seq, ref.field, ref.block)
    if (!found) throw notFound('event_body_not_found', 'Content not found in this conversation.')
    return reply.header('cache-control', 'private, no-store').send(found)
  })

  app.get('/api/conversations/:id/events/:seq/images/:block', async (request, reply) => {
    const user = requireUser(request)
    const { id, seq, block } = request.params as { id: string; seq: string; block: string }
    await loadReadable(id, user.id)
    const ref = eventBodyRefSchema.parse({ seq: Number(seq), field: 'output', block: Number(block) })
    const url = log.eventImage(id, ref.seq, ref.block!)
    // Images matricielles seulement : un contenu actif (HTML, SVG) ne doit jamais
    // s'exécuter sur notre origine.
    const match = url ? /^data:(image\/(?:png|jpeg|gif|webp|avif));base64,/.exec(url) : null
    if (!url || !match) throw notFound('event_body_not_found', 'Content not found in this conversation.')
    return reply
      .type(match[1]!)
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'private, no-store')
      .send(Buffer.from(url.slice(match[0].length), 'base64'))
  })

  /**
   * Sortie complète d'un appel d'outil.
   *
   * La relecture d'historique ne rend qu'un aperçu des sorties volumineuses, pour ne pas
   * transférer des mégaoctets que personne n'ouvre. La carte de l'appel demande ici le
   * corps entier, et seulement quand on la déplie.
   */
  app.get('/api/conversations/:id/tools/:toolCallId/output', async (request): Promise<ToolOutputDto> => {
    const user = requireUser(request)
    const { id, toolCallId } = request.params as { id: string; toolCallId: string }
    await loadReadable(id, user.id)

    const found = log.toolOutput(id, toolCallId)
    if (!found) throw notFound('tool_call_not_found', 'No such tool call in this conversation.')
    return { toolCallId, output: found.output }
  })

  /**
   * Ce qu'un appel d'outil a fait d'un fichier, pour l'historique du panneau.
   *
   * Reconstitué depuis le payload natif conservé dans le journal (invariant I3 : la
   * lecture est faite par l'adaptateur du CLI concerné). Un tour passé n'a pas de
   * diff git à interroger, le disque ayant continué d'évoluer depuis.
   */
  app.get('/api/conversations/:id/edits/:toolCallId', async (request): Promise<EditDiffDto> => {
    const user = requireUser(request)
    const { id, toolCallId } = request.params as { id: string; toolCallId: string }
    const { path } = editDiffQuerySchema.parse(request.query)

    const conversation = await loadReadable(id, user.id)
    // Le diff se lit dans le journal ; le dossier ne sert qu'à rendre les chemins
    // relatifs. Un worktree disparu garde donc ses diffs lisibles, sous son ancien chemin.
    let cwd: string
    try {
      cwd = sessions.workingDirectory(id)
    } catch (err) {
      if (!isWorkingDirectoryMissing(err) || !err.params) throw err
      cwd = String(err.params.path)
    }
    return registry.adapter(conversation.agent).describeEdit({
      log,
      conversationId: id,
      toolCallId,
      cwd,
      path,
    })
  })

  /**
   * Les demandes en attente des fils qu'on s'apprête à archiver (#119), pour la fenêtre
   * qui prévient : archiver les retire. Seuls les fils de l'appelant comptent, et seuls
   * ceux qui en ont sont rendus — une liste vide veut dire « archiver sans demander ».
   */
  app.get('/api/conversations/pending-requests', async (request): Promise<PendingRequestsDto> => {
    const user = requireUser(request)
    const raw = (request.query as { ids?: string }).ids ?? ''
    const ids = [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))].slice(0, 200)
    if (ids.length === 0) return { conversations: [] }
    const owned = ctx.db
      .select({ id: conversations.id, projectId: conversations.projectId })
      .from(conversations)
      .where(and(inArray(conversations.id, ids), eq(conversations.userId, user.id)))
      .all()
    const counts = pendingRequests(ctx.db, owned.map((row) => row.id))
    // Dans l'ordre demandé : le premier fil est celui que « Voir les demandes » ouvre.
    return {
      conversations: ids.flatMap((id) => {
        const row = owned.find((entry) => entry.id === id)
        const entry = counts.get(id)
        return row && entry ? [{ id, projectId: row.projectId, ...entry }] : []
      }),
    }
  })

  app.patch('/api/conversations/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = updateConversationBodySchema.parse(request.body)
    const conversation = await loadWritable(id, user.id)

    const patch: Partial<ConversationRow> = {}
    if (body.title !== undefined) {
      patch.title = body.title.trim()
      patch.titleSetByUser = true
      patch.titleSetByAgent = false
    }
    if (body.pinned !== undefined) patch.pinned = body.pinned
    if (body.archived !== undefined) patch.archivedAt = body.archived ? Date.now() : null
    // Un fil rangé n'a plus de tour à défaire : ses captures quittent le dépôt.
    if (body.archived === true && conversation.archivedAt === null) void sessions.dropCheckpoints(id)

    if (body.cardId !== undefined) {
      // Une carte appartient à un projet, donc un fil libre n'en traite aucune : la
      // rattacher demanderait d'abord de le ranger.
      if (body.cardId) {
        if (conversation.projectId === null) {
          throw badRequest(
            'conversation_without_project',
            'A conversation without a project cannot handle a card.',
          )
        }
        assertCardInProject(ctx, body.cardId, conversation.projectId)
      }
      patch.cardId = body.cardId
      // Rattacher après coup ne fait pas avancer la carte : le geste dit « cette
      // session traitait déjà ce travail », il ne lance rien.
    }

    // La conversation ne retient que ce qu'elle change à son héritage (#120). Une
    // configuration entière, le chemin des clients d'avant, se ramène à ses écarts.
    if (body.config !== undefined) {
      if (body.config.agent !== conversation.agent) {
        throw badRequest('config_agent_immutable', 'The CLI of a conversation cannot change.')
      }
      const overrides = await overridesFor(
        ctx.db,
        (config) => sessions.resolveDefaults(config),
        conversation,
        body.config,
      )
      patch.configOverrides = JSON.stringify(overrides)
    } else if (body.overrides !== undefined) {
      patch.configOverrides = JSON.stringify(patchOverrides(ctx.db, conversation, body.overrides))
    }
    const configChanged = patch.configOverrides !== undefined

    if (Object.keys(patch).length > 0) {
      ctx.db.update(conversations).set(patch).where(eq(conversations.id, id)).run()
    }

    // Le SDK applique modèle, effort et mode de permission à chaud : la session garde
    // son contexte. Le repli par redémarrage est géré, et signalé, par le gestionnaire.
    if (configChanged) {
      await sessions.refreshConfig(id)
      await sessions.reloadConfig(id)
    }

    return { ok: true }
  })

  /**
   * *Ranger…* — la destination d'une conversation, choisie après coup.
   *
   * Le déplacement lui-même vit dans `conversations/move.ts`, partagé avec le daemon
   * qui applique les rangements qu'un agent a demandés. Ne reste ici que ce qui est
   * propre à un clic : quel projet cet utilisateur a le droit de voir.
   */
  app.post('/api/conversations/:id/project', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = moveConversationBodySchema.parse(request.body)
    const conversation = await loadWritable(id, user.id)

    if (body.projectId !== null) {
      const project = ctx.db.select().from(projects).where(eq(projects.id, body.projectId)).get()
      if (!project) throw notFound('project_not_found', 'Project not found.')
      if (project.ownerId !== user.id && project.visibility !== 'shared') {
        throw notFound('project_not_found', 'Project not found.')
      }
    }

    const result = await moveConversation(ctx, sessions, log, conversation, body.projectId)
    if (!result.ok) {
      throw result.refusal === 'scheduled'
        ? badRequest('conversation_scheduled', 'A scheduled run stays where its task put it.')
        : badRequest('conversation_busy', 'A conversation cannot be moved while a turn is running.')
    }
    return conversationToDto(
      result.row,
      user.id,
      readCursor(id, user.id),
      result.moved ? null : readCardLink(ctx, conversation.cardId),
      checkWorktree(ctx.db, result.row.worktreeId).gone,
    )
  })

  /**
   * *Continuer à la racine* — la conversation dont le worktree a disparu reprend dans
   * le workspace du projet. Le geste vit dans le gestionnaire de sessions, qui tient le
   * runner et la file.
   */
  app.post('/api/conversations/:id/project-root', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    await loadWritable(id, user.id)
    const row = await sessions.continueAtProjectRoot(id)
    return conversationToDto(
      row,
      user.id,
      readCursor(id, user.id),
      readCardLink(ctx, row.cardId),
      false,
    )
  })

  app.delete('/api/conversations/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    await loadWritable(id, user.id)
    // Les captures git d'abord, tant que la ligne dit encore où est le dépôt.
    await sessions.dropCheckpoints(id)
    // Les fichiers d'abord : la cascade de la base n'efface que les lignes.
    await attachments.removeForConversations([id])
    // L'index de recherche est une table virtuelle : aucune cascade ne l'atteint.
    dropConversation(ctx.db, id)
    ctx.db.delete(conversations).where(eq(conversations.id, id)).run()
    return reply.status(204).send()
  })

  app.post('/api/conversations/:id/messages', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = sendMessageBodySchema.parse(request.body)
    const conversation = await loadWritable(id, user.id)

    // Écrire dans un fil rangé le ressort de l'archive : sinon il repart au travail
    // tout en restant invisible, et son activité ne se signale nulle part.
    if (conversation.archivedAt !== null) {
      ctx.db.update(conversations).set({ archivedAt: null }).where(eq(conversations.id, id)).run()
    }

    const files = resolveAttachments(user.id, body.attachmentIds)
    await sessions.sendMessage(id, body.clientMessageId, body.text, files, body.mentions, body.skills)
    attachments.claim(body.attachmentIds, id)

    return reply.status(202).send({ accepted: true })
  })

  /**
   * Infléchit le tour en cours.
   *
   * Distinct de `/messages`, qui met en file pendant un tour : les deux gestes ne
   * produisent pas le même résultat, et lequel s'applique doit rester le choix de
   * l'utilisateur. Un refus est donc rendu tel quel plutôt que replié sur la file.
   */
  app.post('/api/conversations/:id/steer', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = steerBodySchema.parse(request.body)
    await loadWritable(id, user.id)

    const files = resolveAttachments(user.id, body.attachmentIds)
    const steered = await sessions.steer(
      id,
      body.clientMessageId,
      body.text,
      files,
      body.mentions,
      body.skills,
    )
    if (!steered) {
      throw badRequest(
        'steer_unavailable',
        'No turn in progress to steer, or this CLI does not support it.',
      )
    }
    attachments.claim(body.attachmentIds, id)

    return reply.status(202).send({ accepted: true })
  })

  /** Demande à l'agent de résumer la conversation pour libérer du contexte. */
  app.post('/api/conversations/:id/compact', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    await loadWritable(id, user.id)

    if (!(await sessions.compact(id))) {
      throw badRequest('compact_unsupported', 'This CLI does not support compaction.')
    }
    return reply.status(202).send({ accepted: true })
  })

  /**
   * Arrête un travail de fond (commande, workflow, surveillance) sans toucher au tour.
   * La clôture n'est pas dans la réponse : elle revient par le journal, dans le
   * `background.updated` suivant.
   */
  app.post('/api/conversations/:id/background/:taskId/stop', async (request, reply) => {
    const user = requireUser(request)
    const { id, taskId } = request.params as { id: string; taskId: string }
    await loadWritable(id, user.id)

    if (!(await sessions.stopBackgroundTask(id, taskId))) {
      throw badRequest(
        'background_stop_unavailable',
        'No running session holds this task, or this CLI cannot stop background work.',
      )
    }
    return reply.status(202).send({ accepted: true })
  })

  app.post('/api/conversations/:id/interrupt', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    await loadWritable(id, user.id)
    await sessions.interrupt(id)
    // Une tâche lancée par un jeton et arrêtée ici laisserait son appelant suspendu à
    // une complétion qui ne viendra jamais : le webhook `task.stopped` le lui dit.
    webhooks.taskStopped(id, { kind: 'user', id: user.id, label: user.displayName })
    return reply.status(204).send()
  })

  app.post('/api/conversations/:id/permissions/:requestId', async (request) => {
    const user = requireUser(request)
    const { id, requestId } = request.params as { id: string; requestId: string }
    const body = permissionDecisionBodySchema.parse(request.body)
    await loadWritable(id, user.id)

    if (!sessions.hasPendingPermission(id, requestId)) {
      throw notFound('permission_request_not_found', 'Permission request not found.')
    }

    const resolved = sessions.resolvePermission(id, requestId, {
      decision: body.decision,
      scope: body.scope,
      decidedBy: user.id,
    })
    if (!resolved) {
      // La session a pu s'arrêter entre l'affichage et le clic : le dire explicitement
      // plutôt que de laisser l'UI attendre une réponse qui ne viendra pas.
      throw badRequest('permission_expired', 'This request has expired, the session has ended.')
    }
    return { ok: true }
  })

  /**
   * Accorde ou refuse un rangement qu'un agent a demandé.
   *
   * `:id` est la conversation **déplacée**, et `loadWritable` dit le reste : seul son
   * propriétaire décide, et c'est dans son fil que la demande est apparue.
   *
   * Accordée, la route ne déplace rien : elle pose la promesse dans la ligne, et le
   * balayage du daemon l'applique dès que la conversation se tait. Une session ne peut
   * pas se ranger elle-même pendant son tour, et relâcher son runner ici tuerait le
   * process CLI qui héberge l'appel en cours.
   */
  app.post('/api/conversations/:id/filings/:requestId', async (request) => {
    const user = requireUser(request)
    const { id, requestId } = request.params as { id: string; requestId: string }
    const body = filingDecisionBodySchema.parse(request.body)
    await loadWritable(id, user.id)

    const row = ctx.db
      .select()
      .from(agentRequests)
      .where(and(eq(agentRequests.id, requestId), eq(agentRequests.kind, 'move_conversation')))
      .get()
    const filing = log.openFiling(id, requestId)
    if (!row || !filing) throw notFound('filing_request_not_found', 'Filing request not found.')
    if (row.resolvedAt !== null || row.acceptedAt !== null) {
      throw badRequest('filing_already_decided', 'This filing request has already been decided.')
    }

    if (body.decision === 'refused') {
      const target = ctx.db.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, id)).get()
      ctx.db.update(agentRequests).set({ resolvedAt: Date.now() }).where(eq(agentRequests.id, requestId)).run()
      log.append(id, { type: 'filing.resolved', requestId, decision: 'refused', decidedBy: user.id, reason: null })
      tellOutcome(ctx.db, row, describeFilingOutcome(target?.title ?? filing.conversationTitle, filing.projectName, 'refused', null))
      return { ok: true }
    }

    // Revérifié au clic (#119), dans le chemin que partage le réglage « Automatique »
    // (#120) : la demande devient « plus applicable » au lieu de s'exécuter, et la réponse
    // dit seulement que le clic a été entendu, le journal porte le reste.
    const accepted = acceptFiling(acceptDeps(request), { conversationId: id, row, filing, userId: user.id, automatic: false })
    if (!accepted.ok) {
      if (accepted.reason === 'project_not_found') throw notFound('project_not_found', 'Project not found.')
      return { ok: true, applied: false, reason: accepted.reason }
    }
    return { ok: true }
  })

  /**
   * Accorde ou refuse un déplacement de cartes qu'un agent a proposé.
   *
   * `:id` est la conversation **qui a demandé**, dans le journal de laquelle la demande
   * est apparue : une carte n'a pas de fil à elle. Mais c'est le **propriétaire du
   * projet** qui décide, et non celui de la conversation — c'est le board qu'on range.
   * D'où `loadReadable` et un contrôle de projet à la main, là où le rangement de
   * conversation se contente de `loadWritable`.
   *
   * Accordée, la route applique elle-même, dans une transaction : il n'y a ni runner à
   * relâcher ni tour à attendre, donc rien à confier au balayage du daemon. Les lignes
   * `card_moves` portent l'`userId` de qui a cliqué — **le mouvement est attribué à la
   * personne**, et c'est le fond de la décision de la carte #54.
   */
  app.post('/api/conversations/:id/card-filings/:requestId', async (request) => {
    const user = requireUser(request)
    const { id, requestId } = request.params as { id: string; requestId: string }
    const body = filingDecisionBodySchema.parse(request.body)
    const conversation = await loadReadable(id, user.id)

    // Le droit avant l'existence : le board appartient au projet, et c'est son
    // propriétaire qui le range. Une conversation lisible dans un projet partagé ne
    // donne donc pas le droit de cliquer — et contrôler d'abord évite qu'un membre non
    // propriétaire distingue un `requestId` qui existe d'un qui n'existe pas.
    const project = conversation.projectId
      ? ctx.db
          .select({ ownerId: projects.ownerId })
          .from(projects)
          .where(eq(projects.id, conversation.projectId))
          .get()
      : null
    if (!project || project.ownerId !== user.id) {
      throw forbidden('card_filing_forbidden', 'Only the project owner can file cards.')
    }

    const row = ctx.db
      .select()
      .from(agentRequests)
      .where(and(eq(agentRequests.id, requestId), eq(agentRequests.kind, 'request_card_change')))
      .get()
    const filing = log.openCardFiling(id, requestId)
    if (!row || !filing) throw notFound('filing_request_not_found', 'Filing request not found.')
    if (row.resolvedAt !== null) {
      throw badRequest('filing_already_decided', 'This filing request has already been decided.')
    }

    if (body.decision === 'refused') {
      ctx.db
        .update(agentRequests)
        .set({ resolvedAt: Date.now() })
        .where(and(eq(agentRequests.id, requestId), isNull(agentRequests.resolvedAt)))
        .run()
      log.append(id, { type: 'card_filing.resolved', requestId, decision: 'refused', decidedBy: user.id, reason: null, moved: [] })
      tellOutcome(ctx.db, row, describeCardFilingOutcome('refused', null, [], filing.cards.length))
      return { ok: true }
    }

    // Chaque geste est attribué à qui a cliqué, et non à la session qui a proposé : c'est
    // le geste d'une personne, tout l'objet de la demande d'accord.
    const accepted = await acceptCardFiling(acceptDeps(request), {
      conversationId: id,
      row,
      cards: filing.cards,
      userId: user.id,
      automatic: false,
    })
    if (!accepted.ok) {
      // La demande *est* résolue alors que la route répond une erreur, et c'est
      // délibéré : elle n'attend plus rien, et l'appelant apprend qu'aucune carte n'a pu
      // changer.
      if (accepted.reason === 'cards_gone') throw badRequest('card_filing_stale', 'None of these cards can still be changed.')
      return { ok: true, applied: false, reason: accepted.reason }
    }
    sessions.statusBus.emit('lists', { conversationId: id })
    return { ok: true }
  })

  /**
   * Crée ou refuse le brouillon de cartes qu'un agent a proposé (#70).
   *
   * Même contrôle que les rangements de cartes : `:id` est la conversation qui propose,
   * et c'est le **propriétaire du projet** qui tranche, puisque c'est son board qui se
   * remplit. Le corps porte le brouillon tel que la personne l'a corrigé dans le bloc ;
   * le journal garde celui de l'agent, et la clôture dit ce qui a été créé.
   *
   * Créé, le brouillon revient à la session en message (`cards`) : elle apprend les
   * numéros sans relire le board, et peut le dire. Refusé, rien ne part : la personne dit
   * dans le fil ce qui ne va pas, et c'est ce message-là qui relance l'agent.
   */
  app.post('/api/conversations/:id/card-drafts/:requestId', async (request) => {
    const user = requireUser(request)
    const { id, requestId } = request.params as { id: string; requestId: string }
    const body = cardDraftDecisionBodySchema.parse(request.body)
    const conversation = await loadReadable(id, user.id)

    const project = conversation.projectId
      ? ctx.db.select({ ownerId: projects.ownerId }).from(projects).where(eq(projects.id, conversation.projectId)).get()
      : null
    if (!project || project.ownerId !== user.id) {
      throw forbidden('card_draft_forbidden', 'Only the project owner can create cards from a draft.')
    }

    const row = ctx.db
      .select()
      .from(agentRequests)
      .where(and(eq(agentRequests.id, requestId), eq(agentRequests.kind, 'propose_cards'), eq(agentRequests.conversationId, id)))
      .get()
    if (!row) throw notFound('card_draft_not_found', 'Card draft not found.')
    if (row.resolvedAt !== null) throw badRequest('card_draft_already_decided', 'This draft has already been decided.')

    if (body.decision === 'refused') {
      const closed = ctx.db
        .update(agentRequests)
        .set({ resolvedAt: Date.now() })
        .where(and(eq(agentRequests.id, requestId), isNull(agentRequests.resolvedAt)))
        .run()
      if (closed.changes === 0) throw badRequest('card_draft_already_decided', 'This draft has already been decided.')
      log.append(id, { type: 'card_draft.resolved', requestId, decision: 'refused', decidedBy: user.id, parent: null, created: [] })
      tellOutcome(ctx.db, row, describeDraftOutcome('refused', null))
      return { ok: true }
    }

    const accepted = acceptDraft(acceptDeps(request), {
      conversationId: id,
      row,
      projectId: conversation.projectId!,
      draft: body.draft,
      userId: user.id,
      automatic: false,
    })
    if (!accepted.ok) {
      if (accepted.reason === 'already_decided') throw badRequest('card_draft_already_decided', 'This draft has already been decided.')
      return { ok: true, applied: false, reason: accepted.reason }
    }
    const { ok: _ok, ...outcome } = accepted
    return { ok: true, ...outcome }
  })

  /**
   * Réponse à une question de l'agent. Contrairement aux permissions, l'état ne vit
   * que dans le runner : c'est le journal qui garde la trace, et une demande qui n'y
   * est plus en attente n'a plus personne pour l'écouter.
   */
  app.post('/api/conversations/:id/questions/:requestId', async (request) => {
    const user = requireUser(request)
    const { id, requestId } = request.params as { id: string; requestId: string }
    const body = questionAnswerBodySchema.parse(request.body)
    await loadWritable(id, user.id)

    const answered = await sessions.answerQuestion(id, requestId, {
      status: body.status,
      answers: body.answers,
      decidedBy: user.id,
    })
    if (!answered) {
      throw badRequest('question_expired', 'This question is no longer awaiting an answer.')
    }
    return { ok: true }
  })

  /** Retire de la file un message qui n'est pas encore parti au CLI. */
  app.delete('/api/conversations/:id/queue/:queueId', async (request, reply) => {
    const user = requireUser(request)
    const { id, queueId } = request.params as { id: string; queueId: string }
    await loadWritable(id, user.id)

    if (!sessions.cancelQueued(id, queueId)) {
      throw badRequest('queue_entry_gone', 'This message has already been sent.')
    }
    return reply.status(204).send()
  })

  /**
   * Fait passer un message en attente dans le tour en cours.
   *
   * Le pendant de `DELETE` sur la même entrée : le message est déjà écrit et déjà en
   * file, ce geste ne fait que choisir quand l'agent le lit.
   */
  app.post('/api/conversations/:id/queue/:queueId/steer', async (request, reply) => {
    const user = requireUser(request)
    const { id, queueId } = request.params as { id: string; queueId: string }
    await loadWritable(id, user.id)

    const outcome = await sessions.steerQueued(id, queueId)
    if (outcome === 'gone') {
      throw badRequest('queue_entry_gone', 'This message has already been sent.')
    }
    if (outcome === 'unavailable') {
      throw badRequest(
        'steer_unavailable',
        'No turn in progress to steer, or this CLI does not support it.',
      )
    }

    return reply.status(202).send({ accepted: true })
  })

  app.post('/api/conversations/:id/elicitations/:requestId', async (request) => {
    const user = requireUser(request)
    const { id, requestId } = request.params as { id: string; requestId: string }
    const body = elicitationAnswerBodySchema.parse(request.body)
    await loadWritable(id, user.id)

    const resolved = sessions.resolveElicitation(id, requestId, {
      action: body.action,
      content: body.content,
      decidedBy: user.id,
    })
    if (!resolved) {
      throw badRequest('elicitation_expired', 'This request is no longer awaiting an answer.')
    }
    return { ok: true }
  })

  app.post('/api/conversations/:id/plans/:requestId', async (request) => {
    const user = requireUser(request)
    const { id, requestId } = request.params as { id: string; requestId: string }
    const body = planDecisionBodySchema.parse(request.body)
    await loadWritable(id, user.id)

    const reviewed = sessions.reviewPlan(id, requestId, {
      decision: body.decision,
      followUpMode: body.followUpMode,
      decidedBy: user.id,
    })
    if (!reviewed) {
      throw badRequest('plan_expired', 'This plan is no longer awaiting a decision.')
    }
    return { ok: true }
  })
}
