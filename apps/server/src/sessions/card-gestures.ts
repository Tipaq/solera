import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { cardNotes, cards, conversations, writeTransaction, type CardRow, type ConversationRow, type Db, type Tx } from '@solera/db'
import {
  CARD_CLOSED_COLUMNS,
  appendCardPrecision,
  appendSubtasks,
  parseSubtasks,
  toggleSubtask,
} from '@solera/protocol'
import { addCardBlock } from '../cards/blocks.js'
import { createCard, syncCardReferences } from '../cards/create.js'
import { recordCardMove } from '../cards/moves.js'
import { Refusal } from './refusal.js'

/**
 * Ce qu'un agent fait seul avec les cartes, au-delà de `move_card` (#66).
 *
 * Tout ici s'ajoute ou se reprend d'un geste, et c'est le critère qui le met dans le
 * socle plutôt que derrière un clic : créer une carte complète, compléter la description
 * de **sa** carte sans réécrire ce qui précède, y cocher ou ajouter des sous-tâches, et
 * rattacher à une carte la conversation lancée sans elle. Ce qui défait le choix d'une
 * personne — un verdict, l'échéance ou la parente d'une carte existante — se propose,
 * par `request_card_change`.
 *
 * Chaque écriture laisse une note sur la carte, signée de la session : c'est le fil que
 * l'utilisateur lit, et pour la description, son historique.
 */

/** Bornes d'accord avec `packages/protocol/src/cards.ts` et la route du board. */
const TITLE_MAX = 200
const DESCRIPTION_MAX = 20_000
/** Un ajout est un paragraphe, pas un rapport : au-delà, une note ou un fichier. */
export const MAX_PRECISION_CHARS = 4000
/** Une sous-tâche est un petit pas ; au-delà de quelques dizaines, c'est des cartes. */
export const MAX_SUBTASKS = 30
const SUBTASK_LABEL_MAX = 300
/** Liens « bloque » qu'une création peut poser d'un coup. */
export const MAX_CARD_LINKS = 20

type Requester = Pick<ConversationRow, 'id' | 'projectId' | 'userId' | 'title'>

/** Le jour d'un `YYYY-MM-DD`, en minuit local comme le champ de date du board. */
export function parseDueDay(value: unknown, field: string): number | null {
  if (value === null) return null
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()) : null
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
  if (!date || Number.isNaN(date.getTime()) || date.getDate() !== Number(match![3])) {
    throw new Refusal(`Le paramètre \`${field}\` est une date au format AAAA-MM-JJ, par exemple 2026-11-15.`)
  }
  return date.getTime()
}

/** Le jour local, tel que les précisions le signent. */
function today(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Une liste de numéros de carte, sans doublon, bornée. */
export function cardNumbers(value: unknown, field: string): number[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => Number.isInteger(item))) {
    throw new Refusal(`Le paramètre \`${field}\` est une liste de numéros de carte, sans le \`#\`.`)
  }
  if (value.length > MAX_CARD_LINKS) throw new Refusal(`Trop de cartes dans \`${field}\` (${MAX_CARD_LINKS} au plus).`)
  return [...new Set(value as number[])]
}

/** La carte du projet qui porte ce numéro, ou un refus qui dit où trouver les numéros. */
export function cardByNumber(db: Db | Tx, projectId: string, number: number): CardRow {
  const card = db.select().from(cards).where(and(eq(cards.projectId, projectId), eq(cards.number, number))).get()
  if (!card) throw new Refusal(`Aucune carte #${number} dans ce projet. list_cards donne les numéros.`)
  return card
}

/** Une note sur la carte, signée de la session. */
function noteFrom(db: Db | Tx, cardId: string, conversationId: string, body: string, at = Date.now()): void {
  db.insert(cardNotes).values({ id: randomUUID(), cardId, conversationId, userId: null, body, createdAt: at }).run()
}

function labelList(value: unknown, field: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Refusal(`Le paramètre \`${field}\` est une liste de libellés.`)
  }
  const labels = (value as string[]).map((label) => label.replace(/\s+/g, ' ').trim()).filter((label) => label !== '')
  if (labels.length > MAX_SUBTASKS) throw new Refusal(`Trop de sous-tâches dans \`${field}\` (${MAX_SUBTASKS} au plus).`)
  if (labels.some((label) => label.length > SUBTASK_LABEL_MAX)) {
    throw new Refusal(`Une sous-tâche tient en une ligne (${SUBTASK_LABEL_MAX} caractères au plus).`)
  }
  return labels
}

// --- create_card -----------------------------------------------------------------

/**
 * Crée une carte complète : parente, échéance, sous-tâches et liens « bloque » d'un coup.
 *
 * Toujours en « à faire » : une carte ouverte par un agent est une proposition, pas un
 * travail engagé. Elle avance quand une session la prend, comme toute autre. Tout est
 * validé avant d'écrire, pour ne pas laisser une carte à moitié reliée derrière un refus.
 */
export function createCardFor(db: Db, requester: Requester, payload: Record<string, unknown>): string {
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  if (!title) throw new Refusal('Le paramètre `title` est requis.')
  if (title.length > TITLE_MAX) throw new Refusal(`Titre trop long (${TITLE_MAX} caractères au plus).`)
  // Le board appartient à un projet : un fil libre n'en a pas, et il n'y a donc nulle
  // part où poser la carte tant qu'il n'est pas rangé.
  if (requester.projectId === null) {
    throw new Refusal("Cette conversation n'appartient à aucun projet : il n'y a pas de board où créer une carte.")
  }
  const projectId = requester.projectId

  const subtasks = labelList(payload.subtasks, 'subtasks')
  const base = typeof payload.description === 'string' ? payload.description.trim() : ''
  const description = appendSubtasks(base, subtasks)
  if (description.length > DESCRIPTION_MAX) throw new Refusal('Description trop longue (20 000 caractères au plus).')

  let parent: CardRow | null = null
  if (payload.parent !== undefined && payload.parent !== null) {
    if (!Number.isInteger(payload.parent)) throw new Refusal('Le paramètre `parent` est le numéro de la carte parente, sans le `#`.')
    parent = cardByNumber(db, projectId, payload.parent as number)
    // Un enfant sous une carte close ne la rouvrirait pas, et resterait orphelin d'un
    // travail déclaré fini : c'est une personne qui rouvre.
    if (CARD_CLOSED_COLUMNS.includes(parent.column)) {
      throw new Refusal(`Refusé : la carte #${parent.number} est close. Choisis une parente ouverte, ou propose de la rouvrir avec request_card_change.`)
    }
  }
  const dueAt = payload.due === undefined ? null : parseDueDay(payload.due, 'due')
  const blocks = cardNumbers(payload.blocks, 'blocks').map((number) => cardByNumber(db, projectId, number))
  const blockedBy = cardNumbers(payload.blocked_by, 'blocked_by').map((number) => cardByNumber(db, projectId, number))
  const both = blocks.find((card) => blockedBy.some((other) => other.id === card.id))
  if (both) throw new Refusal(`La carte #${both.number} ne peut pas à la fois bloquer la nouvelle et être bloquée par elle.`)

  const card = createCard(
    db,
    projectId,
    requester.userId,
    { title, description, column: 'todo' },
    { parentId: parent?.id ?? null, dueAt, ...(requester.id ? { conversationId: requester.id } : {}) },
  )
  for (const target of blocks) addCardBlock(db, { projectId, sourceId: card.id, targetId: target.id, userId: requester.userId })
  for (const source of blockedBy) addCardBlock(db, { projectId, sourceId: source.id, targetId: card.id, userId: requester.userId })

  // La provenance se lit dans le fil de la carte, avec un lien vers la session : la
  // description reste celle que l'agent a rédigée, et la personne qui la reprendra
  // sait d'où elle vient. Une carte ouverte au nom d'un compte porte déjà son auteur.
  if (requester.id) noteFrom(db, card.id, requester.id, 'Carte ouverte depuis cette session.')

  const details = [
    parent ? `enfant de #${parent.number}` : null,
    dueAt !== null ? `échéance le ${payload.due as string}` : null,
    subtasks.length > 0 ? `${subtasks.length} sous-tâche(s)` : null,
    blocks.length > 0 ? `bloque ${blocks.map((other) => `#${other.number}`).join(', ')}` : null,
    blockedBy.length > 0 ? `bloquée par ${blockedBy.map((other) => `#${other.number}`).join(', ')}` : null,
  ].filter((part) => part !== null)
  return `Carte #${card.number} « ${card.title} » créée dans « à faire »${details.length > 0 ? ` (${details.join(', ')})` : ''}. Pour la faire traiter tout de suite : start_session avec card=${card.number}.`
}

// --- la carte de la conversation ---------------------------------------------------

/** La carte de la conversation, ou un refus qui dit comment s'en donner une. */
function ownCard(db: Db, requester: Pick<ConversationRow, 'cardId'>, projectId: string): CardRow {
  const card = requester.cardId
    ? db.select().from(cards).where(and(eq(cards.id, requester.cardId), eq(cards.projectId, projectId))).get()
    : undefined
  if (!card) {
    throw new Refusal(
      "Cette conversation n'est rattachée à aucune carte. Si une carte décrit bien ton travail, rattache-la avec link_card ; ces gestes ne valent que pour la carte de la conversation.",
    )
  }
  return card
}

/**
 * Réécrit la description si personne ne l'a changée depuis la lecture.
 *
 * Une personne qui édite la carte au même moment gagne : son texte est plus récent que
 * celui que l'agent a lu, et l'écraser défairait sa consigne, ce que ces gestes
 * promettent de ne jamais faire.
 */
function rewriteDescription(db: Db, card: CardRow, description: string, note: string | null, conversationId: string): void {
  writeTransaction(db, (tx) => {
    const at = Date.now()
    const written = tx
      .update(cards)
      .set({ description, updatedAt: at })
      .where(and(eq(cards.id, card.id), eq(cards.description, card.description)))
      .run()
    if (written.changes === 0) {
      throw new Refusal(`La description de #${card.number} vient de changer. Relis-la avec read_card, puis recommence.`)
    }
    if (note) noteFrom(tx, card.id, conversationId, note, at)
  })
}

/**
 * Ajoute une précision à la description de sa carte, en fin, dans la section
 * « Précisions », datée et signée. Ce qui précède n'est pas touché.
 */
export function appendOwnDescription(
  db: Db,
  requester: ConversationRow,
  projectId: string,
  payload: Record<string, unknown>,
): string {
  const body = typeof payload.text === 'string' ? payload.text.trim() : ''
  if (!body) throw new Refusal('Le paramètre `text` est requis.')
  if (body.length > MAX_PRECISION_CHARS) {
    throw new Refusal(`Ajout trop long (${body.length} caractères, ${MAX_PRECISION_CHARS} au plus). Le détail va dans une note, ou dans un fichier du dépôt.`)
  }
  const card = ownCard(db, requester, projectId)
  const author = requester.title.trim() ? `session « ${requester.title.trim()} »` : 'une session'
  const description = appendCardPrecision(card.description, { day: today(), author, body })
  if (description.length > DESCRIPTION_MAX) {
    throw new Refusal('La description dépasserait 20 000 caractères. Mets la suite dans une note avec add_card_note.')
  }
  const excerpt = body.length > 200 ? `${body.slice(0, 200).trimEnd()}…` : body
  rewriteDescription(db, card, description, `Description complétée, section « Précisions » :\n\n> ${excerpt.replace(/\n/g, '\n> ')}`, requester.id)
  syncCardReferences(db, card, description)
  return `Précision ajoutée en fin de description de #${card.number} « ${card.title} », section « Précisions ». Une note sur la carte le dit.`
}

/**
 * Coche, décoche ou ajoute des sous-tâches à sa carte.
 *
 * Désignées par leur libellé et non par leur rang : l'agent les lit dans `read_card`,
 * où elles sont écrites, et un rang compté de tête serait faux à la première case
 * qu'une personne insère. Deux cases au même libellé se cochent dans l'ordre du texte.
 */
export function editOwnSubtasks(
  db: Db,
  requester: ConversationRow,
  projectId: string,
  payload: Record<string, unknown>,
): string {
  const check = labelList(payload.check, 'check')
  const uncheck = labelList(payload.uncheck, 'uncheck')
  const add = labelList(payload.add, 'add')
  if (check.length + uncheck.length + add.length === 0) {
    throw new Refusal('Donne au moins une sous-tâche dans `check`, `uncheck` ou `add`.')
  }
  const card = ownCard(db, requester, projectId)

  let description = card.description
  const changed: string[] = []
  for (const [labels, checked] of [[check, true], [uncheck, false]] as const) {
    for (const label of labels) {
      const subtasks = parseSubtasks(description)
      const named = subtasks.filter((subtask) => subtask.label === label)
      if (named.length === 0) {
        const known = subtasks.map((subtask) => `« ${subtask.label} »`).join(', ')
        throw new Refusal(
          `Aucune sous-tâche « ${label} » sur #${card.number}.${known ? ` Celles qui existent : ${known}.` : ' Elle n’en a aucune : ajoute-la avec `add`.'}`,
        )
      }
      const target = named.find((subtask) => subtask.checked !== checked)
      if (!target) continue
      description = toggleSubtask(description, target.index, checked) ?? description
      changed.push(`${checked ? 'cochée' : 'décochée'} « ${label} »`)
    }
  }
  description = appendSubtasks(description, add)
  if (description.length > DESCRIPTION_MAX) throw new Refusal('La description dépasserait 20 000 caractères.')
  if (description === card.description) return `Rien à changer : les sous-tâches de #${card.number} sont déjà dans cet état.`

  // Cocher se voit dans la barre d'avancement de la carte, et une note par case
  // noierait le fil ; ajouter change le travail décrit, et se dit.
  const note = add.length > 0 ? `Sous-tâches ajoutées : ${add.map((label) => `« ${label} »`).join(', ')}.` : null
  rewriteDescription(db, card, description, note, requester.id)
  syncCardReferences(db, card, description)
  const parts = [...changed, ...(add.length > 0 ? [`${add.length} ajoutée(s)`] : [])]
  return `Sous-tâches de #${card.number} mises à jour : ${parts.join(', ')}.`
}

/**
 * Rattache à une carte la conversation lancée sans elle.
 *
 * Seulement si elle n'en a pas : changer de carte détacherait le travail de celle qui le
 * décrit, et c'est un geste de l'interface. Une carte close ou pas encore acceptée ne
 * prend pas de session, comme au lancement.
 */
export function linkOwnConversation(db: Db, requester: ConversationRow, projectId: string, payload: Record<string, unknown>): string {
  const number = typeof payload.card === 'number' ? payload.card : Number(String(payload.card ?? '').replace(/^#/, ''))
  if (!Number.isInteger(number)) throw new Refusal('Le paramètre `card` est le numéro de la carte, par exemple 12.')
  const card = cardByNumber(db, projectId, number)

  if (requester.cardId === card.id) return `Cette conversation est déjà rattachée à #${card.number} « ${card.title} ».`
  if (requester.cardId) {
    const current = db.select({ number: cards.number }).from(cards).where(eq(cards.id, requester.cardId)).get()
    throw new Refusal(
      `Refusé : cette conversation est déjà rattachée à ${current ? `#${current.number}` : 'une carte'}. Changer de carte se fait dans l'interface ; dis-le dans ta réponse si c'est la mauvaise.`,
    )
  }
  if (card.acceptedAt === null) {
    throw new Refusal(`Refusé : la carte #${card.number} est arrivée de l'extérieur et personne ne l'a encore acceptée.`)
  }
  if (CARD_CLOSED_COLUMNS.includes(card.column)) {
    throw new Refusal(`Refusé : la carte #${card.number} est close. Si le travail la rouvre, propose-le avec request_card_change.`)
  }

  writeTransaction(db, (tx) => {
    const at = Date.now()
    const linked = tx
      .update(conversations)
      .set({ cardId: card.id, updatedAt: at })
      .where(and(eq(conversations.id, requester.id), isNull(conversations.cardId)))
      .run()
    if (linked.changes === 0) throw new Refusal("Cette conversation vient d'être rattachée à une carte depuis l'interface.")
    // Comme au lancement d'une session sur la carte : le travail a commencé.
    if (card.column === 'todo') {
      tx.update(cards).set({ column: 'in_progress', updatedAt: at }).where(and(eq(cards.id, card.id), eq(cards.column, 'todo'))).run()
      recordCardMove(tx, { cardId: card.id, from: 'todo', to: 'in_progress', userId: requester.userId, conversationId: requester.id, at })
    }
    noteFrom(tx, card.id, requester.id, 'Session rattachée à cette carte.', at)
  })
  return `Conversation rattachée à #${card.number} « ${card.title} »${card.column === 'todo' ? ', passée en « en cours »' : ''}. Lis-la avec read_card si ce n'est pas fait : sa description dit ce qui est attendu.`
}
