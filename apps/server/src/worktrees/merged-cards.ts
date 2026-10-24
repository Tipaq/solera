import { randomUUID } from 'node:crypto'
import { and, eq, gte, inArray, max } from 'drizzle-orm'
import { cardMoves, cardNotes, cards, conversations, writeTransaction, type Db, type ProjectRow } from '@solera/db'
import type { CardColumn, WorktreeStatusListDto } from '@solera/protocol'
import { recordCardMove } from '../cards/moves.js'
import type { WorktreeStatusService } from './status-service.js'

/** Les colonnes d'où une fusion fait passer une carte en « Terminé ». */
const OPEN_COLUMNS: CardColumn[] = ['in_progress', 'review']

/**
 * Passe en « Terminé » les cartes dont le worktree vient d'être fusionné (#86, porté de
 * Sillage).
 *
 * Branché sur les calculs d'avancement : une fusion se fait par l'onglet Git, par un agent au shell ou sur
 * la forge puis un pull, et seul l'état de l'arbre les voit toutes. C'est le seul passage
 * en « Terminé » qu'aucune personne ne clique, et il tient parce que la fusion en est
 * déjà un : quelqu'un a jugé le travail bon à livrer.
 *
 * Une carte encore à faire n'est pas touchée (rien n'y a été lancé, ou quelqu'un l'y a
 * remise), ni une carte déjà terminée ou abandonnée.
 */
export function watchMergedCards(db: Db, status: WorktreeStatusService): void {
  status.onComputed((project, list) => {
    closeMergedCards(db, project, list)
  })
}

/** Exporté pour les tests : un passage, sur une liste d'avancement donnée. */
export function closeMergedCards(db: Db, project: ProjectRow, list: WorktreeStatusListDto): number {
  if (!list.base) return 0
  let closed = 0
  for (const tree of list.worktrees) {
    // `merged` et non `empty` : un arbre neuf, sans commit à lui, n'a rien livré. L'arbre
    // qui porte la branche par défaut n'est pas un chantier qu'on fusionne.
    if (tree.state !== 'merged' || tree.branch === list.base) continue
    const ids = tree.conversations.map((entry) => entry.id)
    if (ids.length === 0) continue

    const linked = db
      .select({ id: conversations.id, status: conversations.status, cardId: conversations.cardId, archivedAt: conversations.archivedAt })
      .from(conversations)
      .where(inArray(conversations.id, ids))
      .all()
    // Une session qui travaille encore dans l'arbre n'a peut-être pas fini.
    if (linked.some((row) => row.archivedAt === null && (row.status === 'running' || row.status === 'awaiting_input'))) {
      continue
    }

    // Les cartes des sessions qui vivent dans l'arbre, et non de celles qui n'y ont
    // qu'écrit un fichier : celles-là travaillent ailleurs, sur une autre carte.
    const residents = new Set(tree.conversations.filter((entry) => entry.link === 'worktree').map((entry) => entry.id))
    const cardIds = [
      ...new Set(linked.filter((row) => residents.has(row.id)).map((row) => row.cardId).filter((id): id is string => id !== null)),
    ]
    if (cardIds.length === 0) continue

    const targets = db
      .select({ id: cards.id, column: cards.column })
      .from(cards)
      .where(and(eq(cards.projectId, project.id), inArray(cards.id, cardIds), inArray(cards.column, OPEN_COLUMNS)))
      .all()
      // Une fois par livraison : une carte déjà passée en « Terminé » depuis le dernier
      // commit de l'arbre, puis ramenée à la main, y reste. Lu dans `card_moves` plutôt
      // que retenu dans une colonne de plus ; un nouveau commit fusionné rouvre la
      // question, et c'est juste, puisque c'est une nouvelle livraison.
      .filter((card) => !closedSince(db, card.id, tree.lastCommitAt ?? 0))

    for (const card of targets) {
      const now = Date.now()
      writeTransaction(db, (tx) => {
        const last = tx
          .select({ last: max(cards.position) })
          .from(cards)
          .where(and(eq(cards.projectId, project.id), eq(cards.column, 'done')))
          .get()
        tx.update(cards)
          .set({ column: 'done', position: (last?.last ?? 0) + 1, updatedAt: now })
          .where(eq(cards.id, card.id))
          .run()
        // Ni personne ni session : la fusion n'a pas d'auteur que Solera connaisse.
        recordCardMove(tx, { cardId: card.id, from: card.column, to: 'done', userId: null, at: now })
        // Une ligne dans le fil : sans elle, une carte qui change de colonne seule
        // ressemble à une erreur.
        tx.insert(cardNotes)
          .values({
            id: randomUUID(),
            cardId: card.id,
            conversationId: null,
            userId: null,
            body: `Passée en « Terminé » : la branche \`${tree.branch ?? tree.name}\` est fusionnée dans \`${list.base}\`.`,
            createdAt: now,
          })
          .run()
      })
      closed += 1
    }
  }
  return closed
}

/** La carte est-elle déjà arrivée en « Terminé » depuis cet instant ? */
function closedSince(db: Db, cardId: string, since: number): boolean {
  return (
    db
      .select({ id: cardMoves.id })
      .from(cardMoves)
      .where(and(eq(cardMoves.cardId, cardId), eq(cardMoves.toColumn, 'done'), gte(cardMoves.movedAt, since)))
      .get() !== undefined
  )
}
