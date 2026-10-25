import { and, eq } from 'drizzle-orm'
import { cardRelations, cards, type CardRow, type Db, type Tx } from '@solera/db'
import type { CardRelationKind } from '@solera/protocol'
import { badRequest, conflict, notFound } from '../http/errors.js'

/**
 * Les liens informatifs entre cartes (#109) : « liée à » et « doublon de ».
 *
 * Partagés par la route du board et `relate_cards`, que l'agent appelle seul : ils ne
 * changent ni l'ordre du travail ni la colonne, et se retirent d'un geste. Clore un
 * doublon, lui, reste un clic de la fiche.
 */

export interface RelationAuthor {
  userId: string | null
  conversationId?: string | null
}

/** Ce que l'ajout a changé, pour que l'appelant dise vrai : rien, posé, ou remplacé. */
export type RelationOutcome =
  | { kind: 'unchanged' }
  | { kind: 'added' }
  | { kind: 'replaced'; previous: Pick<CardRow, 'id' | 'number' | 'title'> }

/** « Liée à » ne s'écrit qu'une fois, la plus petite clé en source. */
function ordered(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

function targetIn(db: Db | Tx, projectId: string, targetId: string): CardRow {
  const target = db
    .select()
    .from(cards)
    .where(and(eq(cards.id, targetId), eq(cards.projectId, projectId)))
    .get()
  if (!target) throw notFound('card_not_found', 'Card not found.')
  return target
}

/**
 * Pose un lien depuis `sourceId`. Idempotent : reposer un lien déjà là n'est pas une
 * erreur, c'est un double clic.
 *
 * Pour `duplicate_of`, `replace` dit quoi faire d'une autre originale déjà posée : la
 * fiche la remplace, comme elle change une parente ; l'agent est refusé, pour ne pas
 * défaire en silence un lien qu'une personne a posé.
 */
export function addCardRelation(
  db: Db | Tx,
  link: { projectId: string; sourceId: string; targetId: string; kind: CardRelationKind; replace: boolean } & RelationAuthor,
): RelationOutcome {
  if (link.sourceId === link.targetId) {
    throw badRequest('card_relation_self', 'A card cannot be linked to itself.')
  }
  const target = targetIn(db, link.projectId, link.targetId)
  const at = Date.now()
  const author = { createdBy: link.userId, conversationId: link.conversationId ?? null, createdAt: at }

  if (link.kind === 'related') {
    const [sourceId, targetId] = ordered(link.sourceId, target.id)
    const written = db
      .insert(cardRelations)
      .values({ sourceId, targetId, kind: 'related', ...author })
      .onConflictDoNothing()
      .run()
    return written.changes === 0 ? { kind: 'unchanged' } : { kind: 'added' }
  }

  // Deux cartes doublons l'une de l'autre n'ont plus d'originale : laquelle garder ne
  // se lirait nulle part.
  const reverse = db
    .select({ sourceId: cardRelations.sourceId })
    .from(cardRelations)
    .where(
      and(
        eq(cardRelations.kind, 'duplicate_of'),
        eq(cardRelations.sourceId, target.id),
        eq(cardRelations.targetId, link.sourceId),
      ),
    )
    .get()
  if (reverse) throw conflict('card_relation_cycle', 'These two cards would be duplicates of each other.')

  const current = duplicateOf(db, link.sourceId)
  if (current?.id === target.id) return { kind: 'unchanged' }
  if (current && !link.replace) {
    throw conflict('card_relation_original', `This card is already a duplicate of #${current.number}.`)
  }
  if (current) {
    db.delete(cardRelations)
      .where(and(eq(cardRelations.kind, 'duplicate_of'), eq(cardRelations.sourceId, link.sourceId)))
      .run()
  }
  db.insert(cardRelations).values({ sourceId: link.sourceId, targetId: target.id, kind: 'duplicate_of', ...author }).run()
  return current ? { kind: 'replaced', previous: current } : { kind: 'added' }
}

/** Retire un lien, s'il existe. « Liée à » se retire depuis l'un ou l'autre bout. */
export function removeCardRelation(
  db: Db | Tx,
  link: { sourceId: string; targetId: string; kind: CardRelationKind },
): boolean {
  const pair =
    link.kind === 'related'
      ? (() => {
          const [sourceId, targetId] = ordered(link.sourceId, link.targetId)
          return and(eq(cardRelations.sourceId, sourceId), eq(cardRelations.targetId, targetId))
        })()
      : and(eq(cardRelations.sourceId, link.sourceId), eq(cardRelations.targetId, link.targetId))
  return db.delete(cardRelations).where(and(eq(cardRelations.kind, link.kind), pair)).run().changes > 0
}

/** L'originale de la carte, s'il y en a une. */
export function duplicateOf(db: Db | Tx, cardId: string): Pick<CardRow, 'id' | 'number' | 'title'> | null {
  return (
    db
      .select({ id: cards.id, number: cards.number, title: cards.title })
      .from(cardRelations)
      .innerJoin(cards, eq(cards.id, cardRelations.targetId))
      .where(and(eq(cardRelations.kind, 'duplicate_of'), eq(cardRelations.sourceId, cardId)))
      .get() ?? null
  )
}
