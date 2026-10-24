import { randomUUID } from 'node:crypto'
import { cardMoves, type Db, type Tx } from '@solera/db'
import type { CardColumn } from '@solera/protocol'

/**
 * Enregistre un changement de colonne, et rien d'autre.
 *
 * Seule source honnête de la date d'un mouvement : `cards.updated_at` est réécrit par
 * une correction de titre, donc il ne dit pas quand une carte a été terminée. Le
 * Journal lit cette table, et elle ne vaut que si les trois chemins qui changent une
 * colonne passent tous par ici — le glisser-déposer, le menu du panneau, le passage
 * automatique en « en cours » au lancement d'une session, la demande accordée d'un
 * clic, `move_card`, par lequel un agent déplace sa propre carte, et la fusion d'un
 * worktree, qui termine les cartes de ses sessions (`worktrees/merged-cards.ts`).
 *
 * En ajout seul : un mouvement est un fait daté, il ne se corrige pas. Un aller-retour
 * laisse deux lignes, ce qui est la vérité et pas du bruit.
 *
 * Accepte une transaction aussi bien que la base : le glisser-déposer écrit plusieurs
 * mouvements et leurs positions d'un seul tenant, et un lot à moitié écrit ferait un
 * journal qui raconte un déplacement qui n'a pas eu lieu.
 */
export function recordCardMove(
  db: Db | Tx,
  move: {
    cardId: string
    from: CardColumn
    to: CardColumn
    userId: string | null
    /** La session qui déplace d'elle-même, par `move_card` ; absente pour une personne. */
    conversationId?: string
    at?: number
  },
): void {
  if (move.from === move.to) return
  db.insert(cardMoves)
    .values({
      id: randomUUID(),
      cardId: move.cardId,
      fromColumn: move.from,
      toColumn: move.to,
      userId: move.userId,
      conversationId: move.conversationId ?? null,
      movedAt: move.at ?? Date.now(),
    })
    .run()
}
