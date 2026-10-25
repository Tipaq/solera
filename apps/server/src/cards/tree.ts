import { and, eq } from 'drizzle-orm'
import { cards, writeTransaction, type CardRow, type Db, type Tx } from '@solera/db'
import { CARD_CLOSED_COLUMNS, deriveParentColumn } from '@solera/protocol'
import { badRequest, conflict, notFound } from '../http/errors.js'
import { recordCardMove } from './moves.js'

/**
 * L'arbre des cartes : rattacher une carte à une parente, et tenir la colonne des
 * parentes à jour d'après leurs enfants.
 *
 * Partagé par la route du board et les demandes des agents : la règle du cycle et celle
 * de la colonne déduite ne doivent avoir qu'une copie.
 */

/** Garde-fou contre un arbre corrompu à la main : aucune vraie branche n'est si profonde. */
const MAX_DEPTH = 64

/**
 * Recalcule la colonne d'une parente, puis remonte : un enfant qui démarre fait démarrer
 * sa parente, et la parente de celle-ci.
 *
 * Écrite et non calculée à la lecture : le Journal, la chronologie, `list_cards` et les
 * filtres lisent tous `cards.column`, et une colonne affichée qui ne serait pas celle de
 * la table les ferait diverger. Le mouvement passe par `recordCardMove`, comme tous les
 * autres, avec la personne ou la session dont le geste l'a provoqué.
 *
 * Une parente fermée n'est plus touchée : c'est une personne qui l'a fermée, et un
 * enfant rouvert ne défait pas ce verdict.
 */
export function syncParentColumn(
  db: Db | Tx,
  parentId: string | null,
  by: { userId: string | null; conversationId?: string; at?: number },
  depth = 0,
): void {
  if (!parentId || depth > MAX_DEPTH) return
  const parent = db.select({ id: cards.id, column: cards.column }).from(cards).where(eq(cards.id, parentId)).get()
  if (!parent || CARD_CLOSED_COLUMNS.includes(parent.column)) return
  const children = db.select({ column: cards.column }).from(cards).where(eq(cards.parentId, parentId)).all()
  // Une carte qui n'a plus d'enfant redevient une feuille : sa colonne lui appartient.
  if (children.length === 0) return
  const derived = deriveParentColumn(children.map((child) => child.column))
  if (derived === parent.column) return
  const at = by.at ?? Date.now()
  const moved = db
    .update(cards)
    .set({ column: derived, updatedAt: at })
    .where(and(eq(cards.id, parent.id), eq(cards.column, parent.column)))
    .run()
  // `recordCardMove` remonte d'un cran à son tour : la récursion passe par lui.
  if (moved.changes > 0) recordCardMove(db, { cardId: parent.id, from: parent.column, to: derived, ...by, at, depth: depth + 1 })
}

/**
 * Vérifie qu'une carte peut devenir la parente d'une autre : même projet, ni elle-même
 * ni l'une de ses descendantes, sans quoi l'arbre ferait une boucle qu'aucune lecture ne
 * saurait arrêter.
 */
export function resolveParent(db: Db | Tx, card: Pick<CardRow, 'id' | 'projectId'>, parentId: string): string {
  if (parentId === card.id) throw badRequest('card_parent_self', 'A card cannot be its own parent.')
  const parent = db
    .select({ id: cards.id, parentId: cards.parentId })
    .from(cards)
    .where(and(eq(cards.id, parentId), eq(cards.projectId, card.projectId)))
    .get()
  if (!parent) throw notFound('card_not_found', 'Card not found.')
  // On remonte depuis la future parente : si l'on croise la carte, elle en descend.
  let cursor: string | null = parent.parentId
  for (let depth = 0; cursor && depth <= MAX_DEPTH; depth += 1) {
    if (cursor === card.id) throw conflict('card_parent_cycle', 'This card is an ancestor of the chosen parent.')
    cursor = db.select({ parentId: cards.parentId }).from(cards).where(eq(cards.id, cursor)).get()?.parentId ?? null
  }
  return parent.id
}

/**
 * Rattache une carte à une parente, ou l'en détache avec `null`, et recalcule la colonne
 * des deux parentes concernées : l'ancienne perd un enfant, la nouvelle en gagne un.
 */
export function setCardParent(
  db: Db,
  card: Pick<CardRow, 'id' | 'projectId' | 'parentId'>,
  parentId: string | null,
  by: { userId: string | null; conversationId?: string },
): void {
  const next = parentId === null ? null : resolveParent(db, card, parentId)
  if (next === card.parentId) return
  writeTransaction(db, (tx) => writeCardParent(tx, card, next, by))
}

/**
 * L'écriture de `setCardParent`, dans la transaction de l'appelant : une demande
 * `request_card_change` accordée applique toute sa liste d'un tenant. `next` doit avoir
 * été vérifiée par `resolveParent`.
 */
export function writeCardParent(
  tx: Db | Tx,
  card: Pick<CardRow, 'id' | 'parentId'>,
  next: string | null,
  by: { userId: string | null; conversationId?: string },
): void {
  const at = Date.now()
  tx.update(cards).set({ parentId: next, updatedAt: at }).where(eq(cards.id, card.id)).run()
  syncParentColumn(tx, card.parentId, { ...by, at })
  syncParentColumn(tx, next, { ...by, at })
}

/**
 * Pose ou lève l'état « à préciser ».
 *
 * Le poser ramène la carte dans « à faire » : c'est un état de cette colonne, et une
 * session qui attend des réponses n'est pas en train d'avancer. Le lever ne la déplace
 * pas ; c'est la session qui reprend qui la repasse en « en cours ». Une carte fermée
 * n'a plus rien à préciser.
 */
export function setToClarify(
  db: Db,
  cardId: string,
  on: boolean,
  by: { userId: string | null; conversationId?: string },
): void {
  const card = db.select().from(cards).where(eq(cards.id, cardId)).get()
  if (!card) throw notFound('card_not_found', 'Card not found.')
  if (!on) {
    if (card.toClarifySince !== null) {
      db.update(cards).set({ toClarifySince: null, updatedAt: Date.now() }).where(eq(cards.id, cardId)).run()
    }
    return
  }
  if (CARD_CLOSED_COLUMNS.includes(card.column)) {
    throw conflict('card_closed', 'A closed card has nothing left to clarify.')
  }
  const at = Date.now()
  writeTransaction(db, (tx) => {
    // Le mouvement d'abord : quitter une colonne pour « à faire » n'efface rien, mais
    // l'ordre inverse laisserait croire qu'on l'efface pour le reposer.
    if (card.column !== 'todo') {
      tx.update(cards).set({ column: 'todo', updatedAt: at }).where(eq(cards.id, cardId)).run()
      recordCardMove(tx, { cardId, from: card.column, to: 'todo', ...by, at })
    }
    if (card.toClarifySince === null) {
      tx.update(cards).set({ toClarifySince: at, updatedAt: at }).where(eq(cards.id, cardId)).run()
    }
  })
}
