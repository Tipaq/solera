import { randomUUID } from 'node:crypto'
import { and, eq, inArray, max } from 'drizzle-orm'
import { cardRefs, cards, writeTransaction, type CardRow, type Db } from '@solera/db'
import { parseCardReferences, type CardColumn } from '@solera/protocol'
import type { AppContext } from '../http/context.js'
import { recordCardMove } from './moves.js'
import { resolveParent, syncParentColumn } from './tree.js'

/**
 * Passe une carte de `todo` à `in_progress` au lancement de sa première session.
 *
 * Déclenchée par l'envoi du premier message, jamais par la détection d'une session
 * active : la colonne est une position choisie, et seul un geste la change. Une carte
 * déjà plus loin dans le workflow ne recule pas — relancer une session sur une carte
 * en relecture n'annule pas la relecture.
 */
export function advanceCardOnLaunch(ctx: AppContext, cardId: string, userId: string): void {
  const moved = ctx.db
    .update(cards)
    .set({ column: 'in_progress', updatedAt: Date.now() })
    .where(and(eq(cards.id, cardId), eq(cards.column, 'todo')))
    .run()

  // L'un des trois chemins qui changent une colonne, et le plus facile à oublier
  // puisque personne ne l'a demandé explicitement. Conditionné au nombre de lignes
  // touchées : une carte déjà plus loin n'a pas bougé, et le journal ne doit pas
  // raconter un mouvement qui n'a pas eu lieu.
  if (moved.changes > 0) {
    recordCardMove(ctx.db, { cardId, from: 'todo', to: 'in_progress', userId })
  }
}

/**
 * Crée une carte en fin de colonne, avec ses backlinks.
 *
 * Partagée entre la route du board et les demandes des agents (`create_card`) : le
 * numéro et la position se calculent de la même façon, et deux copies auraient divergé.
 * Ici plutôt que dans la route, pour que le daemon n'ait pas à dépendre de la couche
 * HTTP afin de créer une carte.
 */
export function createCard(
  db: Db,
  projectId: string,
  userId: string,
  body: { title: string; description: string; column: CardColumn },
  options: CreateCardOptions = {},
): CardRow {
  const parentId = options.parentId ? resolveParent(db, { id: '', projectId }, options.parentId) : null
  const row = insertCard(db, projectId, userId, body, { ...options, parentId })
  syncCardReferences(db, row, row.description)
  // Un enfant né ailleurs qu'en « à faire » fait peut-être démarrer sa parente.
  syncParentColumn(db, parentId, { userId, conversationId: options.conversationId })
  return row
}

export interface CreateCardOptions {
  /** La parente, du même projet. Vérifiée comme un rattachement fait à la main. */
  parentId?: string | null
  /**
   * Vrai par défaut : une carte créée dans Solera, par une personne ou une session, est
   * acceptée en naissant. Faux pour une entrée venue de l'extérieur (une issue absorbée),
   * qui attend en tête de « à faire » qu'on l'accepte, la rattache ou la refuse.
   */
  accepted?: boolean
  /** La session qui crée, quand c'en est une, pour le mouvement éventuel de la parente. */
  conversationId?: string
  /** L'échéance, en minuit local du jour, quand celle qui crée en donne une. */
  dueAt?: number | null
}

function insertCard(
  db: Db,
  projectId: string,
  userId: string,
  body: { title: string; description: string; column: CardColumn },
  options: CreateCardOptions & { parentId: string | null },
): CardRow {
  const now = Date.now()
  // Numéro et position se calculent dans la transaction qui insère : deux créations
  // simultanées y liraient sinon le même maximum et se disputeraient l'unicité.
  return writeTransaction(db, (tx) => {
    const [highest] = tx
      .select({ number: max(cards.number) })
      .from(cards)
      .where(eq(cards.projectId, projectId))
      .all()
    const [last] = tx
      .select({ position: max(cards.position) })
      .from(cards)
      .where(and(eq(cards.projectId, projectId), eq(cards.column, body.column)))
      .all()

    const created = {
      id: randomUUID(),
      projectId,
      number: (highest?.number ?? 0) + 1,
      title: body.title,
      description: body.description,
      column: body.column,
      // En fin de colonne : une idée neuve n'est pas prioritaire par le seul fait
      // d'être neuve, et s'insérer en tête déclasserait ce qui a déjà été trié.
      position: (last?.position ?? 0) + 1,
      // Pas d'échéance par défaut : une carte ouverte pour noter ce qu'on a croisé n'a
      // pas de date à proposer. Un agent qui découpe un chantier daté en donne une.
      dueAt: options.dueAt ?? null,
      parentId: options.parentId,
      acceptedAt: options.accepted === false ? null : now,
      toClarifySince: null,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    }
    tx.insert(cards).values(created).run()
    return created
  })
}

/**
 * Réécrit les backlinks d'une carte d'après sa description.
 *
 * Un `#12` qui ne désigne aucune carte du projet n'est pas une erreur : il reste dans
 * le texte et ne produit simplement pas de lien. Refuser l'enregistrement pour une
 * référence morte ferait d'une faute de frappe un blocage, alors que la description
 * est de la prose avant d'être une structure.
 */
export function syncCardReferences(db: Db, card: CardRow, description: string): void {
  const numbers = parseCardReferences(description)
  const targets =
    numbers.length === 0
      ? []
      : db
          .select({ id: cards.id })
          .from(cards)
          .where(and(eq(cards.projectId, card.projectId), inArray(cards.number, numbers)))
          .all()
          .map((row) => row.id)
          // Une carte qui se cite elle-même n'apprend rien à personne.
          .filter((id) => id !== card.id)

  writeTransaction(db, (tx) => {
    tx.delete(cardRefs).where(eq(cardRefs.sourceId, card.id)).run()
    if (targets.length > 0) {
      tx.insert(cardRefs)
        .values(targets.map((targetId) => ({ sourceId: card.id, targetId })))
        .run()
    }
  })
}
