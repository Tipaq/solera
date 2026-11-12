import type { CardDto } from '@solera/protocol'
import { awaitsMe, loadedStatus, type StatusOf } from './card-state'
import { leadSession, sheetSessions, withSheet } from './card-sheet'

/*
 * Où mène un clic sur une carte hors du board (#188, spec jalons FCH-10) : l'Aperçu,
 * Travail, les jalons, le portefeuille, `/sessions`. Une carte se pilote par sa session,
 * pas par sa fiche du board.
 */

export type CardDestination =
  /** Une session attend : la fiche sur place, où l'on répond sans quitter la page. */
  | { kind: 'sheet'; number: number }
  | { kind: 'session'; conversationId: string }
  /** Aucune session : un brouillon de conversation déjà rattaché à la carte, pour la lancer. */
  | { kind: 'draft'; cardId: string }

/**
 * La carte qui t'attend ouvre sa fiche ; sinon sa session la plus active (en erreur, puis
 * qui tourne), sinon la plus récente, archivées exclues ; sans session de travail, un
 * jalon ouvre sa session d'affinage, et une carte un brouillon rattaché.
 */
export function cardDestination(
  card: Pick<CardDto, 'id' | 'number' | 'conversations' | 'refinement'>,
  statusOf: StatusOf = loadedStatus,
): CardDestination {
  if (awaitsMe(card, statusOf)) return { kind: 'sheet', number: card.number }
  const session = leadSession(sheetSessions(card), statusOf)
  if (session) return { kind: 'session', conversationId: session.id }
  if (card.refinement) return { kind: 'session', conversationId: card.refinement.conversationId }
  return { kind: 'draft', cardId: card.id }
}

/**
 * L'adresse d'une destination. La fiche s'ouvre sur la page courante (`?fiche=N`), ses
 * autres paramètres gardés : `search` est celui de la page.
 */
export function destinationHref(projectId: string, destination: CardDestination, search?: URLSearchParams): string {
  switch (destination.kind) {
    case 'sheet':
      return `?${withSheet(search ?? new URLSearchParams(), destination.number).toString()}`
    case 'session':
      return `/p/${projectId}/c/${destination.conversationId}`
    case 'draft':
      return `/p/${projectId}/c/new?card=${destination.cardId}`
  }
}

/** Les deux d'un coup, pour un lien. */
export function cardHref(
  projectId: string,
  card: Pick<CardDto, 'id' | 'number' | 'conversations' | 'refinement'>,
  { statusOf, search }: { statusOf?: StatusOf; search?: URLSearchParams } = {},
): string {
  return destinationHref(projectId, cardDestination(card, statusOf), search)
}
