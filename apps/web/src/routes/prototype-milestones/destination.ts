/* PROTOTYPE — jetable */
import type { CardConversationDto, CardDto } from '@solera/protocol'

/** Ce qui demande une personne d'abord, puis ce qui travaille. */
const PRIORITY: Record<string, number> = {
  awaiting_input: 0,
  error: 1,
  running: 2,
}

/**
 * La session d'une carte, celle qu'on veut ouvrir en cliquant dessus : une vivante qui
 * t'attend, sinon une qui travaille, sinon la plus récente. Les archivées n'en sont pas.
 */
export function sessionOf(card: Pick<CardDto, 'conversations'>): CardConversationDto | null {
  const sessions = card.conversations.filter((conversation) => conversation.archivedAt === null)
  if (sessions.length === 0) return null
  return [...sessions].sort(
    (a, b) => (PRIORITY[a.status] ?? 9) - (PRIORITY[b.status] ?? 9) || b.createdAt - a.createdAt,
  )[0]!
}

/**
 * Où mène un clic sur une carte : sa session, et non le board. Sans session, un
 * brouillon de conversation déjà rattaché à la carte, pour la lancer.
 */
export function cardDestination(projectId: string, card: Pick<CardDto, 'id' | 'number' | 'conversations'>): string {
  // Une carte de démo n'a pas de vraie session : le clic ouvre sa fiche sur place.
  // `useProtoHref` change ce `?fiche=` en adresse complète, la page courante gardée.
  if (card.id.startsWith('demo-')) return `?fiche=${card.number}`
  // Une carte qui t'attend ouvre sa fiche, où l'on répond sur place (décidé le
  // 2026-11-11) ; le lien « Ouvrir la session » de la fiche mène au fil.
  if (card.conversations.some((session) => !session.archivedAt && session.status === 'awaiting_input')) return `?fiche=${card.number}`
  const session = sessionOf(card)
  return session ? `/p/${projectId}/c/${session.id}` : `/p/${projectId}/c/new?card=${card.id}`
}
