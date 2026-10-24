import { and, eq } from 'drizzle-orm'
import { cardBlocks, cards, type Db, type Tx } from '@solera/db'
import { badRequest, conflict, notFound } from '../http/errors.js'

/**
 * Pose un lien « bloque » : `sourceId` empêche `targetId` d'avancer.
 *
 * Partagée par la route du board et les gestes des agents (`create_card`, une demande
 * `request_card_change` accordée) : le refus d'un lien réciproque ne doit avoir qu'une
 * copie. Idempotente, et volontairement : reposer un lien déjà là n'est pas une erreur à
 * expliquer, c'est un double clic.
 */
export function addCardBlock(
  db: Db | Tx,
  link: { projectId: string; sourceId: string; targetId: string; userId: string | null },
): void {
  if (link.sourceId === link.targetId) {
    throw badRequest('card_block_self', 'A card cannot block itself.')
  }
  const target = db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.id, link.targetId), eq(cards.projectId, link.projectId)))
    .get()
  if (!target) throw notFound('card_not_found', 'Card not found.')
  // Un blocage réciproque est une impasse qu'aucune des deux cartes ne peut lever :
  // la refuser ici évite de l'afficher comme un état normal.
  const reverse = db
    .select({ sourceId: cardBlocks.sourceId })
    .from(cardBlocks)
    .where(and(eq(cardBlocks.sourceId, target.id), eq(cardBlocks.targetId, link.sourceId)))
    .get()
  if (reverse) throw conflict('card_block_cycle', 'These two cards would block each other.')

  db.insert(cardBlocks)
    .values({ sourceId: link.sourceId, targetId: target.id, createdBy: link.userId, createdAt: Date.now() })
    .onConflictDoNothing()
    .run()
}

/** Retire un lien « bloque », s'il existe. */
export function removeCardBlock(db: Db | Tx, link: { sourceId: string; targetId: string }): void {
  db.delete(cardBlocks)
    .where(and(eq(cardBlocks.sourceId, link.sourceId), eq(cardBlocks.targetId, link.targetId)))
    .run()
}
