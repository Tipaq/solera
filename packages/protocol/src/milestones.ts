import { z } from 'zod'
import { agentConfigSchema } from './agent-config.js'
import type { ConversationStatus } from './api.js'
import type { AgentKind } from './events.js'

/**
 * Lancer un jalon (#72) : les enfants d'une carte parente partent en sessions
 * parallèles, dans l'ordre que dictent leurs liens « bloque ». C'est le serveur qui
 * pilote, pas une session : l'ordre est du code, il ne coûte aucun jeton.
 */

/** Sessions d'un jalon qui travaillent en même temps, par défaut. */
export const DEFAULT_MILESTONE_CONCURRENCY = 3

/**
 * Plafond de la concurrence. Les limites de `start_session` (6 lancements par heure,
 * deux niveaux) ne s'appliquent pas au serveur : c'est cette borne qui les remplace.
 */
export const MAX_MILESTONE_CONCURRENCY = 6

/** Au-delà, l'aperçu avertit que le quota fond d'autant plus vite. */
export const MILESTONE_QUOTA_WARNING = 3

/**
 * `running` : le serveur lance ce qui est prêt ; `paused` : plus aucun lancement, les
 * sessions en cours continuent ; `stopped` : arrêté par une personne, la file est
 * abandonnée ; `finished` : toutes les cartes sont closes.
 */
export const milestoneRunStateSchema = z.enum(['running', 'paused', 'stopped', 'finished'])
export type MilestoneRunState = z.infer<typeof milestoneRunStateSchema>

/** Un pilotage qui tourne encore, en marche ou en pause : un seul par parente. */
export const MILESTONE_RUN_ACTIVE_STATES: readonly MilestoneRunState[] = ['running', 'paused']

/**
 * Où en est une carte d'un jalon lancé, telle que le serveur la déduit à chaque tour.
 *
 * - `waiting` : un de ses bloqueurs n'est pas terminé ;
 * - `queued` : prête, elle attend une place (ou la reprise d'un jalon en pause) ;
 * - `launching` : sa session est en cours de création ;
 * - `working` : sa session travaille ;
 * - `reviewing` : sa PR est dans la boucle de revue ;
 * - `merging` : au vert, Solera la fusionne dans la branche du jalon ;
 * - `blocked` : elle attend une personne (voir `MilestoneBlockReason`) ; seules les
 *   cartes qui en dépendent l'attendent, et elle libère sa place ;
 * - `done`, `abandoned` : close ;
 * - `failed` : sa session n'a pas pu être lancée.
 */
export const milestoneCardStatusSchema = z.enum([
  'waiting',
  'queued',
  'launching',
  'working',
  'reviewing',
  'merging',
  'blocked',
  'done',
  'abandoned',
  'failed',
])
export type MilestoneCardStatus = z.infer<typeof milestoneCardStatusSchema>

/** Ce qui occupe une place du jalon. */
export const MILESTONE_BUSY_STATUSES: readonly MilestoneCardStatus[] = ['launching', 'working', 'reviewing', 'merging']

/**
 * Pourquoi une carte attend une personne.
 *
 * `to_clarify` : « à préciser », la session attend des réponses ; `awaiting_input` : une
 * permission ou une question du CLI ; `error`, `interrupted` : la session s'est arrêtée ;
 * `idle` : au repos sans PR signalée ; `escalated` : la revue a atteint son plafond ;
 * `merge_failed` : la fusion dans la branche du jalon a échoué ; `review_closed` : la
 * revue est close sans fusion.
 */
export const milestoneBlockReasonSchema = z.enum([
  'to_clarify',
  'awaiting_input',
  'error',
  'interrupted',
  'idle',
  'escalated',
  'merge_failed',
  'review_closed',
])
export type MilestoneBlockReason = z.infer<typeof milestoneBlockReasonSchema>

/**
 * Ce que l'aperçu dit d'une enfant avant le lancement.
 *
 * `ready` part tout de suite (dans la limite de la concurrence) ; `waiting` attend ses
 * bloqueurs ; `running` a déjà une session au travail, suivie sans être relancée ;
 * `excluded` ne partira pas (`excludedReason`).
 */
export const milestonePlanStatusSchema = z.enum(['ready', 'waiting', 'running', 'excluded'])
export type MilestonePlanStatus = z.infer<typeof milestonePlanStatusSchema>

/**
 * `not_accepted` : une carte venue de l'extérieur que personne n'a acceptée ;
 * `closed` : déjà terminée ou abandonnée ; `has_children` : elle a ses propres enfants,
 * et se lance comme un jalon à part.
 */
export const milestoneExcludedReasonSchema = z.enum(['not_accepted', 'closed', 'has_children'])
export type MilestoneExcludedReason = z.infer<typeof milestoneExcludedReasonSchema>

export interface MilestoneBlockerDto {
  number: number
  title: string
  /** Hors du jalon : elle bloque quand même, et il faudra qu'elle se termine ailleurs. */
  outside: boolean
  abandoned: boolean
}

export interface MilestonePlanCardDto {
  cardId: string
  number: number
  title: string
  /** L'étage du graphe : 0 sans bloqueur dans le jalon, puis un de plus que le plus haut. */
  layer: number
  status: MilestonePlanStatus
  excludedReason: MilestoneExcludedReason | null
  /** Les bloqueurs pas encore terminés. */
  blockedBy: MilestoneBlockerDto[]
}

export interface MilestonePlanDto {
  cardId: string
  cards: MilestonePlanCardDto[]
  /** Les cartes prises dans un cycle de blocages : le lancement est refusé tant qu'il y en a. */
  cycle: number[]
  /** La branche où les cartes se fusionnent, créée au premier lancement. */
  branch: string
}

export interface MilestoneRunCardDto {
  cardId: string
  number: number
  title: string
  layer: number
  status: MilestoneCardStatus
  blockReason: MilestoneBlockReason | null
  blockedBy: MilestoneBlockerDto[]
  conversationId: string | null
  conversationTitle: string | null
  conversationStatus: ConversationStatus | null
  worktreeName: string | null
  /** Le CLI et la configuration propres à cette carte, ou null pour ceux du jalon. */
  agent: AgentKind | null
  model: string | null
  error: string | null
}

export interface MilestoneRunDto {
  id: string
  cardId: string
  /** Le numéro et le titre de la parente : le bandeau et la frise la nomment (#116). */
  cardNumber: number
  cardTitle: string
  state: MilestoneRunState
  concurrency: number
  agent: AgentKind
  model: string
  branch: string
  /** Les places occupées en ce moment. */
  busy: number
  cards: MilestoneRunCardDto[]
  createdAt: number
  endedAt: number | null
}

export const startMilestoneBodySchema = z.object({
  concurrency: z.number().int().min(1).max(MAX_MILESTONE_CONCURRENCY).default(DEFAULT_MILESTONE_CONCURRENCY),
  /**
   * La configuration du jalon, CLI compris (`config.agent`) ; absente, celle qu'une
   * session neuve aurait dans ce projet.
   */
  config: agentConfigSchema.optional(),
  /** Les configurations propres à certaines cartes, par identifiant. */
  cards: z.record(z.string().uuid(), agentConfigSchema).default({}),
})
export type StartMilestoneBody = z.infer<typeof startMilestoneBodySchema>

export const updateMilestoneRunBodySchema = z.object({
  state: z.enum(['running', 'paused', 'stopped']).optional(),
  concurrency: z.number().int().min(1).max(MAX_MILESTONE_CONCURRENCY).optional(),
})
export type UpdateMilestoneRunBody = z.infer<typeof updateMilestoneRunBodySchema>
