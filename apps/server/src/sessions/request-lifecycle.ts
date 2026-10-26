import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import {
  agentRequests,
  conversations,
  sessionMessages,
  type AgentRequestRow,
  type ConversationRow,
  type Db,
} from '@solera/db'
import { allowsRequest, parseAgentConfig, type PendingRequestCounts } from '@solera/protocol'
import type { Config } from '../config.js'

/**
 * Le cycle de vie des demandes qui attendent le clic d'une personne (#119) :
 * `move_conversation`, `request_card_change`, `propose_cards` et `request_decision`.
 *
 * Trois règles, tranchées avec Tim :
 *
 * - **revérifier au clic** : entre le dépôt et l'accord, le fil a pu être archivé,
 *   rangé ailleurs, perdre l'option qui permettait la demande, ou lancer un travail de
 *   fond qu'un déplacement couperait. La demande devient alors « plus applicable » au
 *   lieu de s'exécuter ;
 * - **prévenir sans relancer** : l'agent apprend toujours l'issue, par un message
 *   `outcome` que le relais ne remet que pendant un tour. Seuls un brouillon de cartes
 *   créé et la réponse à une décision gardent le réveil : ils débloquent la suite ;
 * - **retirer avec le fil** : archiver ou supprimer un fil retire ses demandes, et
 *   l'archivage automatique ne range pas un fil qui en a.
 *
 * Ce module ne touche pas au déplacement lui-même (`conversations/move.ts`) : il dit
 * seulement s'il peut encore avoir lieu.
 */

export const AWAITING_KINDS = [
  'move_conversation',
  'request_card_change',
  'propose_cards',
  'request_decision',
] as const satisfies readonly AgentRequestRow['kind'][]

/**
 * Pourquoi une demande ne s'applique plus. Un code et non une phrase : il part dans le
 * journal, que l'interface relit dans la langue de son lecteur.
 */
export type StaleReason =
  | 'conversation_archived'
  | 'conversation_deleted'
  | 'project_changed'
  | 'option_disabled'
  | 'background_running'

/** Les mêmes, rédigés pour le modèle. */
export const STALE_WORDS: Record<StaleReason, string> = {
  conversation_archived: 'le fil a été archivé',
  conversation_deleted: "le fil n'existe plus",
  project_changed: 'le fil a changé de projet depuis la demande',
  option_disabled: "l'option qui permettait cette demande a été coupée entre-temps",
  background_running: 'un travail de fond tourne dans le fil, et le déplacement le couperait',
}

/** Le fil qu'un `move_conversation` déplace : celui que l'agent a nommé, ou le sien. */
export function filingTargetId(request: Pick<AgentRequestRow, 'payload' | 'conversationId'>): string {
  const payload = JSON.parse(request.payload) as { conversation?: unknown }
  return typeof payload.conversation === 'string' && payload.conversation.trim()
    ? payload.conversation.trim()
    : request.conversationId
}

function conversation(db: Db, id: string): ConversationRow | undefined {
  return db.select().from(conversations).where(eq(conversations.id, id)).get()
}

/** Une configuration illisible ne prouve pas que l'option est restée ouverte. */
function granted(raw: string, flag: 'projectFiling' | 'cardFiling' | 'proposeCards'): boolean {
  try {
    return allowsRequest(parseAgentConfig(raw)[flag])
  } catch {
    return false
  }
}

/**
 * Ce qui empêche une demande d'être accordée maintenant, ou null si rien.
 *
 * `fromProjectId` est le projet du fil déplacé au dépôt, tel que le journal le porte ;
 * `undefined` pour une demande d'avant #119, dont ce point ne se revérifie pas.
 *
 * Le travail de fond ne compte que pour un déplacement : c'est le seul geste qui relâche
 * le runner, donc le seul qui le couperait.
 */
export function recheck(
  db: Db,
  config: Config,
  request: AgentRequestRow,
  fromProjectId?: string | null,
): StaleReason | null {
  const requester = conversation(db, request.conversationId)
  if (!requester) return 'conversation_deleted'
  if (requester.archivedAt !== null) return 'conversation_archived'

  if (request.kind === 'move_conversation') {
    const target = requester.id === filingTargetId(request) ? requester : conversation(db, filingTargetId(request))
    if (!target) return 'conversation_deleted'
    if (target.archivedAt !== null) return 'conversation_archived'
    if (fromProjectId !== undefined && target.projectId !== fromProjectId) return 'project_changed'
    if (!config.mcp.projectFiling || !granted(requester.config, 'projectFiling')) return 'option_disabled'
    if (target.backgroundCount > 0 || target.loopCount > 0) return 'background_running'
    return null
  }

  // Une carte et un brouillon parlent du board du projet où la demande a été déposée :
  // un fil rangé ailleurs depuis ferait chercher les cartes dans le mauvais.
  if (requester.projectId !== request.projectId) return 'project_changed'
  if (request.kind === 'request_card_change') {
    if (!config.mcp.cardFiling || !granted(requester.config, 'cardFiling')) return 'option_disabled'
  }
  if (request.kind === 'propose_cards' && requester.purpose !== 'split') {
    if (!granted(requester.config, 'proposeCards')) return 'option_disabled'
  }
  return null
}

/**
 * Dit à la session qui a demandé ce qu'il est advenu de sa demande, sans la relancer :
 * le relais remet un `outcome` pendant un tour, jamais en ouvrant un.
 *
 * Rien ne part vers un fil libre : `session_messages` est rangée par projet, comme les
 * réponses aux décisions.
 */
export function tellOutcome(db: Db, request: Pick<AgentRequestRow, 'id' | 'conversationId'>, body: string): void {
  const requester = db
    .select({ id: conversations.id, projectId: conversations.projectId })
    .from(conversations)
    .where(eq(conversations.id, request.conversationId))
    .get()
  if (!requester?.projectId) return
  db.insert(sessionMessages)
    .values({
      id: randomUUID(),
      projectId: requester.projectId,
      fromConversationId: requester.id,
      toConversationId: requester.id,
      kind: 'outcome',
      body,
      replyTo: request.id,
      createdAt: Date.now(),
    })
    .run()
}

/**
 * Les demandes en attente, rangées par fil : celles qu'il a déposées, et pour un
 * déplacement celui qu'il vise. Un déplacement accordé qui attend la fin d'un tour y
 * compte aussi : archiver le fil le retire comme les autres.
 */
export function pendingRequests(db: Db, conversationIds: string[]): Map<string, PendingRequestCounts> {
  const wanted = new Set(conversationIds)
  const counts = new Map<string, PendingRequestCounts>()
  if (wanted.size === 0) return counts

  const rows = db
    .select()
    .from(agentRequests)
    .where(
      and(
        inArray(agentRequests.kind, [...AWAITING_KINDS]),
        isNull(agentRequests.resolvedAt),
        isNotNull(agentRequests.settledAt),
        eq(agentRequests.isError, false),
        isNull(agentRequests.worktreePath),
      ),
    )
    .all()

  for (const row of rows) {
    const owners = new Set([row.conversationId])
    if (row.kind === 'move_conversation') owners.add(filingTargetId(row))
    for (const owner of owners) {
      if (!wanted.has(owner)) continue
      const entry = counts.get(owner) ?? { decision: 0, cardChange: 0, cardDraft: 0, move: 0 }
      if (row.kind === 'request_decision') entry.decision += 1
      else if (row.kind === 'request_card_change') entry.cardChange += 1
      else if (row.kind === 'propose_cards') entry.cardDraft += 1
      else entry.move += 1
      counts.set(owner, entry)
    }
  }
  return counts
}

/** Les motifs d'avant #119, à côté de ceux de la revérification. */
const REASON_WORDS: Record<string, string> = {
  ...STALE_WORDS,
  project_not_found: "le projet de destination n'existe plus",
  conversation_scheduled: "c'est un tir planifié, qui reste où sa tâche l'a mis",
  cards_gone: "aucune de ces cartes ne pouvait plus changer : elles ont disparu, ou quelqu'un les a modifiées depuis",
}

function because(reason: string | null): string {
  return reason ? (REASON_WORDS[reason] ?? 'elle est devenue impossible') : 'elle est devenue impossible'
}

/** L'issue d'un `move_conversation`, telle que la session qui l'a demandé la lira. */
export function describeFilingOutcome(
  title: string,
  projectName: string | null,
  decision: 'accepted' | 'refused' | 'impossible',
  reason: string | null,
): string {
  const where = projectName ? ` dans « ${projectName} »` : ''
  if (decision === 'accepted') return `Ta demande de rangement a été accordée : « ${title} » est maintenant rangée${where}.`
  if (decision === 'refused') {
    return `Ta demande de ranger « ${title} »${where} a été refusée par l'utilisateur. Rien n'a été déplacé ; ne la redépose pas sans qu'il le demande.`
  }
  return `Ta demande de ranger « ${title} »${where} n'est plus applicable : ${because(reason)}. Rien n'a été déplacé.`
}

/** L'issue d'un `request_card_change`. */
export function describeCardFilingOutcome(
  decision: 'accepted' | 'refused' | 'impossible',
  reason: string | null,
  applied: number[] = [],
  proposed = applied.length,
): string {
  if (decision === 'accepted') {
    return [
      `Ta proposition de changement de cartes a été accordée : ${applied.map((number) => `#${number}`).join(', ')} ${applied.length > 1 ? 'ont changé' : 'a changé'} comme proposé.`,
      proposed > applied.length
        ? "Les autres cartes ont été laissées telles quelles : elles avaient changé depuis ta proposition, ou n'existent plus."
        : null,
    ]
      .filter((line) => line !== null)
      .join(' ')
  }
  if (decision === 'refused') {
    return "Ta proposition de changement de cartes a été refusée par l'utilisateur. Rien n'a changé sur le board ; ne la redépose pas sans qu'il le demande."
  }
  return `Ta proposition de changement de cartes n'est plus applicable : ${because(reason)}. Rien n'a changé sur le board.`
}

/** L'issue d'un `propose_cards` qui n'a rien créé ; une création, elle, relance. */
export function describeDraftOutcome(decision: 'refused' | 'impossible', reason: string | null): string {
  if (decision === 'refused') {
    return "Ton brouillon de cartes a été refusé : rien n'a été créé. Si l'utilisateur dit pourquoi dans le fil, tu le liras."
  }
  return `Ton brouillon de cartes n'est plus applicable : ${because(reason)}. Rien n'a été créé.`
}
