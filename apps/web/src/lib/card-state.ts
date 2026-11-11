import { CARD_CLOSED_COLUMNS, type CardConversationDto, type CardDto } from '@solera/protocol'

/**
 * L'état qu'une barre ou une pastille montre d'une carte : sa colonne, plus « bloquée »
 * déduit de ses liens. Distinct des colonnes du board, qui ne connaissent pas le blocage.
 */
export type CardState = 'todo' | 'blocked' | 'running' | 'review' | 'done' | 'abandoned'

export function isOpen(card: Pick<CardDto, 'column'>): boolean {
  return !CARD_CLOSED_COLUMNS.includes(card.column)
}

/** Bloquée tant qu'une carte qui la bloque reste ouverte ; à relire, son travail est fait. */
export function cardState(card: Pick<CardDto, 'column' | 'blockedBy'>): CardState {
  if (card.column === 'done') return 'done'
  if (card.column === 'abandoned') return 'abandoned'
  if (card.column === 'review') return 'review'
  if (card.blockedBy.some(isOpen)) return 'blocked'
  if (card.column === 'in_progress') return 'running'
  return 'todo'
}

function midnight(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/**
 * Les jours de retard d'une carte ouverte, au calendrier : une échéance est un jour, pas
 * un instant (`lib/dates`), donc posée le 4 elle n'est en retard qu'à partir du 5, comme
 * sur le board. 0 quand elle ne l'est pas.
 */
export function lateDays(card: Pick<CardDto, 'column' | 'dueAt'>, now = Date.now()): number {
  if (!isOpen(card) || card.dueAt === null) return 0
  // Arrondi : un jour de changement d'heure dure 23 h ou 25 h.
  return Math.max(0, Math.round((midnight(now) - midnight(card.dueAt)) / 86_400_000))
}

export function isLate(card: Pick<CardDto, 'column' | 'dueAt'>, now = Date.now()): boolean {
  return lateDays(card, now) > 0
}

/** Les sessions vivantes d'une carte : qui tourne, qui attend quelqu'un. */
export function liveSessions(card: Pick<CardDto, 'conversations'>): CardConversationDto[] {
  return card.conversations.filter(
    (session) => !session.archivedAt && (session.status === 'running' || session.status === 'awaiting_input'),
  )
}

/**
 * Une session de la carte attend une réponse (question, permission) : le repère ambre
 * des vues de jalon. La demande elle-même vit dans « Ce qui t'attend » ; ici on ne fait
 * que la montrer du doigt.
 */
export function awaitsMe(card: Pick<CardDto, 'conversations'>): boolean {
  return card.conversations.some((session) => !session.archivedAt && session.status === 'awaiting_input')
}
