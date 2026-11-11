import { z } from 'zod'
// Des types seulement : `api.ts` importe d'ici le schéma du mode, et un import à
// l'exécution dans l'autre sens refermerait un cycle au chargement.
import type { ConversationStatus } from './api.js'
import type { CardDraft } from './card-draft.js'
import type { SoleraEvent } from './events.js'
import type { TaskActivityDto, TaskPendingDto } from './v1.js'

/**
 * Comment la session d'affinage d'un jalon s'y prend (#184) : `questions`, poser ce qui
 * manque avant de découper ; `direct`, découper sur le brief et ne questionner que sur
 * un point vraiment ouvert. Le premier message le dit au skill (`--decouper`), la
 * conversation le garde pour le briefing et pour la page du jalon.
 */
export const splitModeSchema = z.enum(['questions', 'direct'])
export type SplitMode = z.infer<typeof splitModeSchema>

/** Une demande de l'agent qui attend le clic, comptée comme la section « À décider ». */
export interface PendingRefinementRequestDto {
  requestId: string
  count: number
}

/**
 * La session d'affinage d'une carte, telle que le board la porte : la conversation
 * `split` non archivée la plus récente dont la carte est le point de départ.
 *
 * `status` est l'état au chargement, comme pour `CardConversationDto` : le flux de
 * statuts du WebSocket a le dernier mot côté client (`refinementState` le prend).
 */
export interface CardRefinementDto {
  conversationId: string
  title: string
  status: ConversationStatus
  mode: SplitMode
  createdAt: number
  /** Le brouillon `propose_cards` de la session qui attend son clic. */
  draft: PendingRefinementRequestDto | null
  /** Le changement de cartes (`request_card_change`) de la session qui attend son clic. */
  change: PendingRefinementRequestDto | null
}

/** Un changement de carte proposé, tel que le bloc du fil le montre. */
export type CardFilingChangeDto = Extract<SoleraEvent, { type: 'card_filing.requested' }>['cards'][number]

/**
 * L'affinage d'une carte lu hors du fil (`GET /api/cards/:id/refinement`) : ce que la
 * page du jalon résume sans ouvrir la session. Brouillon et changement sont les charges
 * du journal, celles que les blocs du fil affichent et que leurs routes de décision
 * reprennent.
 */
export interface CardRefinementDetailDto {
  session: CardRefinementDto | null
  /** L'outil en cours de la session, quand elle travaille. */
  activity: TaskActivityDto | null
  /** La demande du CLI qui tient le tour : ses questions, d'ordinaire. */
  prompt: TaskPendingDto | null
  draft: { requestId: string; conversationId: string; draft: CardDraft } | null
  change: { requestId: string; conversationId: string; changes: CardFilingChangeDto[] } | null
}

/**
 * Où en est l'affinage : `none` pas encore lancé, `waiting` il t'attend (une question,
 * un brouillon ou un changement en attente, ou un tour fini sans rien proposer),
 * `working` il travaille, `done` terminé (rien en attente et le jalon a des cartes).
 *
 * `liveStatus` est le statut vivant du WebSocket, quand le client l'a : il l'emporte sur
 * celui du chargement.
 */
export type RefinementState = 'none' | 'waiting' | 'working' | 'done'

export function refinementState(
  refinement: CardRefinementDto | null,
  hasChildren: boolean,
  liveStatus?: ConversationStatus,
): RefinementState {
  if (!refinement) return 'none'
  const status = liveStatus ?? refinement.status
  if (status === 'awaiting_input' || refinement.draft || refinement.change) return 'waiting'
  if (status === 'running') return 'working'
  return hasChildren ? 'done' : 'waiting'
}
