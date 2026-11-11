import type { CardColumn, CardConversationDto, CardDto } from '@solera/protocol'

/**
 * L'état qu'une barre ou une pastille montre d'une carte : sa colonne, plus « bloquée »
 * déduit de ses liens. Distinct des colonnes du board, qui ne connaissent pas le blocage.
 */
export type CardState = 'todo' | 'blocked' | 'running' | 'review' | 'done' | 'abandoned'

const CLOSED: readonly CardColumn[] = ['done', 'abandoned']

export function isOpen(card: Pick<CardDto, 'column'>): boolean {
  return !CLOSED.includes(card.column)
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

export function isLate(card: Pick<CardDto, 'column' | 'dueAt'>, now = Date.now()): boolean {
  return isOpen(card) && card.dueAt !== null && card.dueAt < now
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
