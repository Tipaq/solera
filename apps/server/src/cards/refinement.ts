import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { agentRequests, conversations, type Db } from '@solera/db'
import type { CardRefinementDetailDto, CardRefinementDto, PendingRefinementRequestDto } from '@solera/protocol'
import type { EventLog } from '../events/event-log.js'
import { presentOf } from '../http/v1/task-view.js'

/**
 * La session d'affinage de chaque carte (#184) : la conversation `split` non archivée la
 * plus récente qui la découpe, avec le brouillon et le changement de cartes qui attendent
 * son clic.
 *
 * Deux requêtes pour tout le board, pas une par carte : `buildDtos` la lit pour chaque
 * liste de cartes.
 */
export function readRefinements(db: Db, cardIds: string[]): Map<string, CardRefinementDto> {
  const refinements = new Map<string, CardRefinementDto>()
  if (cardIds.length === 0) return refinements

  // Du plus récent au plus ancien : la première rencontrée pour une carte est la sienne.
  const sessions = db
    .select({
      splitCardId: conversations.splitCardId,
      id: conversations.id,
      title: conversations.title,
      status: conversations.status,
      splitMode: conversations.splitMode,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(
      and(
        inArray(conversations.splitCardId, cardIds),
        eq(conversations.purpose, 'split'),
        isNull(conversations.archivedAt),
      ),
    )
    .orderBy(desc(conversations.createdAt))
    .all()
  const chosen = new Map<string, (typeof sessions)[number]>()
  for (const session of sessions) {
    if (session.splitCardId && !chosen.has(session.splitCardId)) chosen.set(session.splitCardId, session)
  }
  if (chosen.size === 0) return refinements

  const pending = pendingRequests(db, [...chosen.values()].map((session) => session.id))
  for (const [cardId, session] of chosen) {
    refinements.set(cardId, {
      conversationId: session.id,
      title: session.title,
      status: session.status,
      // La migration a rempli le mode des découpages d'avant lui ; la colonne reste nulle
      // hors découpage, d'où le repli pour le type.
      mode: session.splitMode ?? 'questions',
      createdAt: session.createdAt,
      draft: pending.get(`${session.id}:propose_cards`) ?? null,
      change: pending.get(`${session.id}:request_card_change`) ?? null,
    })
  }
  return refinements
}

/**
 * Les demandes des sessions qui attendent un clic, par `conversation:genre`. Les mêmes
 * que la section « À décider » : traitées par le daemon, ni tranchées ni en échec.
 */
function pendingRequests(db: Db, conversationIds: string[]): Map<string, PendingRefinementRequestDto> {
  const rows = db
    .select({
      id: agentRequests.id,
      conversationId: agentRequests.conversationId,
      kind: agentRequests.kind,
      payload: agentRequests.payload,
    })
    .from(agentRequests)
    .where(
      and(
        inArray(agentRequests.conversationId, conversationIds),
        inArray(agentRequests.kind, ['propose_cards', 'request_card_change']),
        isNull(agentRequests.resolvedAt),
        isNotNull(agentRequests.settledAt),
        eq(agentRequests.isError, false),
      ),
    )
    .orderBy(desc(agentRequests.createdAt))
    .all()

  const pending = new Map<string, PendingRefinementRequestDto>()
  for (const row of rows) {
    const key = `${row.conversationId}:${row.kind}`
    if (pending.has(key)) continue
    pending.set(key, { requestId: row.id, count: countOf(row.kind, row.payload) })
  }
  return pending
}

/** Le nombre de cartes de la demande, lu comme la section « À décider » le lit. */
function countOf(kind: string, payload: string): number {
  const parsed = JSON.parse(payload) as { cards?: unknown; changes?: unknown; moves?: unknown }
  // `moves` avant #66, qui l'a élargi en `changes`.
  const list = kind === 'propose_cards' ? parsed.cards : (parsed.changes ?? parsed.moves)
  return Array.isArray(list) ? list.length : 0
}

/**
 * L'affinage d'une carte lu hors du fil : la session, son outil en cours, la demande du
 * CLI qui tient son tour, et les charges du brouillon et du changement en attente telles
 * que le journal les porte.
 *
 * La demande du CLI ne compte que si elle tient vraiment : la session attend une
 * réponse, ou c'est une question asynchrone restée ouverte. Un journal coupé par un
 * redémarrage peut garder une demande jamais résolue, que plus personne n'écoute.
 */
export function readRefinementDetail(db: Db, log: EventLog, cardId: string): CardRefinementDetailDto {
  const session = readRefinements(db, [cardId]).get(cardId) ?? null
  if (!session) return { session: null, activity: null, prompt: null, draft: null, change: null }

  const { activity, pending } = presentOf(log, session.conversationId)
  const asyncQuestion = pending?.event.type === 'question.requested' && pending.event.blocking === false
  const prompt = pending && (session.status === 'awaiting_input' || asyncQuestion) ? pending : null

  const draftEvent = session.draft
    ? log.requestEntry(session.conversationId, 'card_draft.proposed', session.draft.requestId)?.event
    : undefined
  const changeEvent = session.change
    ? log.requestEntry(session.conversationId, 'card_filing.requested', session.change.requestId)?.event
    : undefined

  // Ses arguments, dont la page tire sa ligne : le dernier `tool.input_updated` l'emporte
  // sur le `tool.started`, comme dans le fil.
  const running = session.status === 'running' ? activity : null
  const tool = running ? log.toolInputs(session.conversationId, [running.toolCallId]).get(running.toolCallId) : undefined

  return {
    session,
    activity: running ? { ...running, toolName: tool?.name ?? running.toolName, input: tool?.input ?? null } : null,
    prompt,
    draft:
      draftEvent?.type === 'card_draft.proposed'
        ? { requestId: draftEvent.requestId, conversationId: session.conversationId, draft: draftEvent.draft }
        : null,
    change:
      changeEvent?.type === 'card_filing.requested'
        ? { requestId: changeEvent.requestId, conversationId: session.conversationId, changes: changeEvent.cards }
        : null,
  }
}
