import { and, eq } from 'drizzle-orm'
import { cards, type CardRow, type Db } from '@solera/db'
import { CARD_CLOSED_COLUMNS, parseSubtasks, promoteSubtaskLine } from '@solera/protocol'
import { badRequest, conflict } from '../http/errors.js'
import { addCardBlock } from './blocks.js'
import { createCard, syncCardReferences } from './create.js'

/** Le titre d'une carte tient en 200 caractères, comme à la création par le board. */
const TITLE_MAX = 200

/**
 * Promeut une sous-tâche en carte, quand elle mérite sa propre session (#71).
 *
 * La nouvelle carte est une **sœur** de l'origine, sous la même parente, ou sans parente
 * si l'origine n'en a pas : une carte est un coéquipier, et l'équipe en gagne un. En
 * faire une enfant de l'origine changerait la nature de celle-ci — sa colonne deviendrait
 * déduite, et sa branche celle d'une parente — alors qu'une session y travaille peut-être.
 *
 * La ligne devient `- [ ] #N libellé`, et sa case suit #N (`recordCardMove`). Partagé
 * par la route de la fiche et `promote_subtask`, que l'agent appelle seul sur sa carte.
 */
export function promoteSubtask(
  db: Db,
  origin: CardRow,
  input: { index: number; label: string; title?: string; blocks: boolean },
  by: { userId: string; conversationId?: string },
): CardRow {
  const subtask = parseSubtasks(origin.description)[input.index]
  if (!subtask || subtask.label !== input.label.trim()) {
    throw conflict('card_subtask_moved', 'The description changed since this list was shown.')
  }
  if (subtask.card !== null) {
    throw conflict('card_subtask_promoted', 'This subtask is already card #{number}.', { number: subtask.card })
  }
  if (!subtask.label && !input.title?.trim()) throw badRequest('card_subtask_empty', 'This subtask has no label to make a title.')
  if (subtask.checked) throw conflict('card_subtask_done', 'A finished subtask has nothing left to carry.')
  if (CARD_CLOSED_COLUMNS.includes(origin.column)) throw conflict('card_closed', 'This card is closed.')
  const parent = origin.parentId ? db.select().from(cards).where(eq(cards.id, origin.parentId)).get() : undefined
  // Une sœur sous une parente close resterait orpheline d'un travail déclaré fini.
  if (parent && CARD_CLOSED_COLUMNS.includes(parent.column)) {
    throw conflict('card_parent_closed', 'The parent card #{number} is closed.', { number: parent.number })
  }

  const created = createCard(
    db,
    origin.projectId,
    by.userId,
    {
      title: input.title?.trim() || titleOf(subtask.label),
      description: `Promue depuis une sous-tâche de #${origin.number}.`,
      column: 'todo',
    },
    { parentId: parent?.id ?? null, ...(by.conversationId ? { conversationId: by.conversationId } : {}) },
  )
  if (input.blocks) {
    addCardBlock(db, { projectId: origin.projectId, sourceId: created.id, targetId: origin.id, userId: by.userId })
  }

  const description = promoteSubtaskLine(origin.description, input.index, created.number)
  // Écrite seulement si personne n'a touché la description depuis la lecture : sinon la
  // carte neuve n'aurait pas de ligne qui la cite, et mieux vaut la retirer que de la
  // laisser sans raison d'être.
  const written =
    description === null
      ? { changes: 0 }
      : db
          .update(cards)
          .set({ description, updatedAt: Date.now() })
          .where(and(eq(cards.id, origin.id), eq(cards.description, origin.description)))
          .run()
  if (description === null || written.changes === 0) {
    db.delete(cards).where(eq(cards.id, created.id)).run()
    throw conflict('card_subtask_moved', 'The description changed since this list was shown.')
  }
  // La référence `#N` de la ligne fait le backlink, et c'est par lui que la case suit #N.
  syncCardReferences(db, origin, description)
  return created
}

/** Un libellé de sous-tâche fait un titre, au besoin raccourci. */
function titleOf(label: string): string {
  const flat = label.replace(/\s+/g, ' ').trim()
  return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…`
}
