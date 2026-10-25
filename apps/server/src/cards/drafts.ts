import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { cardNotes, cards, writeTransaction, type CardRow, type Db } from '@solera/db'
import {
  CARD_CLOSED_COLUMNS,
  DRAFT_DESCRIPTION_MAX,
  DRAFT_LINKS_MAX,
  DRAFT_SUBTASK_MAX,
  DRAFT_SUBTASKS_MAX,
  DRAFT_TITLE_MAX,
  MAX_DRAFT_CARDS,
  appendSubtasks,
  cardDraftProblems,
  type CardDraft,
  type CardDraftCard,
  type CardDraftCreated,
  type CardDraftParent,
  type CardDraftProblem,
  type CardDraftRef,
} from '@solera/protocol'
import { badRequest } from '../http/errors.js'
import { Refusal } from '../sessions/refusal.js'
import { addCardBlock } from './blocks.js'
import { createCard } from './create.js'
import { addCardRelation } from './relations.js'

/**
 * Le découpage en cartes (#70) : un agent dépose un brouillon, une personne le corrige et
 * le valide, et c'est alors seulement que les cartes naissent.
 *
 * Deux moitiés, deux publics. `readAgentDraft` lit ce que l'agent envoie et lui répond en
 * refus français qu'il peut corriger ; `createDraftCards` écrit ce que la personne a
 * validé, et répond en erreurs HTTP que l'interface traduit.
 */

const ref = (card: Pick<CardRow, 'id' | 'number' | 'title'>): CardDraftRef => ({
  cardId: card.id,
  number: card.number,
  title: card.title,
})

function cardIn(db: Db, projectId: string, number: number): CardRow {
  const card = db.select().from(cards).where(and(eq(cards.projectId, projectId), eq(cards.number, number))).get()
  if (!card) throw new Refusal(`Aucune carte #${number} dans ce projet. list_cards donne les numéros.`)
  return card
}

function text(value: unknown, field: string, max: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Refusal(`Le champ \`${field}\` est un texte.`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new Refusal(`Le champ \`${field}\` est trop long (${max} caractères au plus).`)
  return trimmed
}

function list<T>(value: unknown, field: string, check: (item: unknown) => item is T, what: string): T[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || !value.every(check)) throw new Refusal(`Le champ \`${field}\` est une liste ${what}.`)
  if (value.length > DRAFT_LINKS_MAX && field !== 'subtasks') {
    throw new Refusal(`Trop d'éléments dans \`${field}\` (${DRAFT_LINKS_MAX} au plus).`)
  }
  return [...new Set(value)]
}

const isString = (item: unknown): item is string => typeof item === 'string'
const isInteger = (item: unknown): item is number => Number.isInteger(item)

/** Un problème de structure, dit à l'agent dans les mots de son brouillon. */
function describeProblem(problem: CardDraftProblem): string {
  switch (problem.code) {
    case 'duplicate_key':
      return `Deux cartes portent la clé « ${problem.key} » : chaque clé est unique dans le brouillon.`
    case 'unknown_key':
      return `La carte « ${problem.key} » attend « ${problem.missing} », qui n'est pas une clé du brouillon. Pour une carte qui existe déjà, utilise \`blocked_by\` avec son numéro.`
    case 'self':
      return `La carte « ${problem.key} » s'attend elle-même dans \`after\`.`
    case 'cycle':
      return `Les cartes ${problem.keys.map((key) => `« ${key} »`).join(' → ')} s'attendent en boucle : aucune ne pourrait commencer.`
  }
}

/**
 * Lit le brouillon que l'agent dépose avec `propose_cards`.
 *
 * Les cartes existantes sont résolues ici, par leur numéro, et gardées avec leur titre :
 * le bloc les affiche sans relire la base, et la validation les relit par leur id. Sans
 * parente donnée, celle d'où le découpage est parti (`splitCardId`) est proposée : c'est
 * ce que la personne a demandé en lançant le découpage depuis une carte.
 */
export function readAgentDraft(
  db: Db,
  projectId: string,
  splitCardId: string | null,
  payload: Record<string, unknown>,
): CardDraft {
  const rawCards = Array.isArray(payload.cards) ? payload.cards : null
  if (!rawCards || rawCards.length === 0) {
    throw new Refusal('Le paramètre `cards` est requis : au moins une carte, avec son `title`.')
  }
  if (rawCards.length > MAX_DRAFT_CARDS) {
    throw new Refusal(
      `Trop de cartes dans un brouillon (${rawCards.length}, ${MAX_DRAFT_CARDS} au plus). Découpe en plusieurs parentes, ou regroupe les petits pas en sous-tâches.`,
    )
  }

  if (payload.parent !== undefined && payload.milestone !== undefined) {
    throw new Refusal('Donne `parent` (une carte existante) ou `milestone` (une parente neuve), pas les deux.')
  }
  let parent: CardDraftParent | null = null
  if (payload.milestone !== undefined && payload.milestone !== null) {
    const milestone = (payload.milestone ?? {}) as Record<string, unknown>
    const title = text(milestone.title, 'milestone.title', DRAFT_TITLE_MAX)
    if (!title) throw new Refusal('Le champ `milestone.title` est requis : le nom du jalon.')
    parent = {
      kind: 'new',
      title,
      description: text(milestone.description, 'milestone.description', DRAFT_DESCRIPTION_MAX),
      dueAt: milestone.due === undefined || milestone.due === null || milestone.due === '' ? null : parseDay(milestone.due),
    }
  } else if (payload.parent !== undefined && payload.parent !== null && payload.parent !== 0) {
    if (!Number.isInteger(payload.parent)) throw new Refusal('Le paramètre `parent` est le numéro de la carte parente, sans le `#`.')
    parent = { kind: 'existing', card: ref(openParent(db, projectId, payload.parent as number)) }
  } else if (payload.parent === undefined && splitCardId) {
    const start = db.select().from(cards).where(and(eq(cards.id, splitCardId), eq(cards.projectId, projectId))).get()
    if (start && !CARD_CLOSED_COLUMNS.includes(start.column)) parent = { kind: 'existing', card: ref(start) }
  }

  const draftCards: CardDraftCard[] = rawCards.map((raw, index) => {
    const card = (raw ?? {}) as Record<string, unknown>
    const position = `la carte ${index + 1}`
    const title = text(card.title, `cards[${index}].title`, DRAFT_TITLE_MAX)
    if (!title) throw new Refusal(`Le champ \`title\` est requis pour ${position}.`)
    const key = card.key === undefined ? String(index + 1) : text(card.key, `cards[${index}].key`, 40)
    if (!key) throw new Refusal(`La clé de ${position} est vide.`)

    const subtasks = list(card.subtasks, 'subtasks', isString, 'de libellés')
      .map((label) => label.replace(/\s+/g, ' ').trim())
      .filter((label) => label !== '')
    if (subtasks.length > DRAFT_SUBTASKS_MAX) throw new Refusal(`Trop de sous-tâches pour ${position} (${DRAFT_SUBTASKS_MAX} au plus).`)
    if (subtasks.some((label) => label.length > DRAFT_SUBTASK_MAX)) {
      throw new Refusal(`Une sous-tâche tient en une ligne (${DRAFT_SUBTASK_MAX} caractères au plus).`)
    }

    const existing = (field: string) =>
      list(card[field], field, isInteger, 'de numéros de carte, sans le `#`').map((number) => ref(cardIn(db, projectId, number)))

    return {
      key,
      title,
      description: text(card.description, `cards[${index}].description`, DRAFT_DESCRIPTION_MAX),
      subtasks,
      after: list(card.after, 'after', isString, 'de clés du brouillon'),
      blockedBy: existing('blocked_by'),
      related: existing('related'),
    }
  })

  const draft: CardDraft = { parent, cards: draftCards }
  const problems = cardDraftProblems(draft)
  if (problems.length > 0) throw new Refusal(problems.map(describeProblem).join('\n'))
  return draft
}

function openParent(db: Db, projectId: string, number: number): CardRow {
  const card = cardIn(db, projectId, number)
  // Des enfants sous une carte close ne la rouvriraient pas : c'est une personne qui rouvre.
  if (CARD_CLOSED_COLUMNS.includes(card.column)) {
    throw new Refusal(`Refusé : la carte #${card.number} est close. Choisis une parente ouverte, ou propose un jalon neuf avec \`milestone\`.`)
  }
  return card
}

/** Le jour d'un `AAAA-MM-JJ`, en minuit local comme le champ de date du board. */
function parseDay(value: unknown): number {
  const match = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim()) : null
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
  if (!date || Number.isNaN(date.getTime()) || date.getDate() !== Number(match![3])) {
    throw new Refusal('Le champ `milestone.due` est une date au format AAAA-MM-JJ, par exemple 2026-11-15.')
  }
  return date.getTime()
}

/** Ce que la validation a créé : la parente des cartes, et les cartes elles-mêmes. */
export interface DraftCreation {
  parent: CardDraftRef | null
  created: CardDraftCreated[]
}

/**
 * Crée le brouillon tel que la personne l'a validé, en une transaction : la parente
 * neuve s'il y en a une, les cartes sous elle, leurs sous-tâches, leurs liens « bloque »
 * et leurs liens « liée à ». Un brouillon à moitié écrit laisserait sur le board des
 * cartes sans leurs dépendances, qu'on lancerait dans le mauvais ordre.
 *
 * Tout est relu ici : le brouillon vient du client, et des cartes existantes ont pu
 * disparaître ou se clore depuis le dépôt. Une parente existante close refuse la
 * validation, puisqu'elle changerait le sens du découpage ; un lien vers une carte
 * disparue tombe seul, puisqu'il n'en change que le détail.
 */
export function createDraftCards(
  db: Db,
  input: { projectId: string; userId: string; conversationId: string; draft: CardDraft },
): DraftCreation {
  const { projectId, userId, conversationId, draft } = input
  if (cardDraftProblems(draft).length > 0) throw badRequest('card_draft_invalid', 'This draft has a dependency problem.')

  const live = (target: CardDraftRef) =>
    db.select().from(cards).where(and(eq(cards.id, target.cardId), eq(cards.projectId, projectId))).get()

  let existingParent: CardRow | null = null
  if (draft.parent?.kind === 'existing') {
    existingParent = live(draft.parent.card) ?? null
    if (!existingParent || CARD_CLOSED_COLUMNS.includes(existingParent.column)) {
      throw badRequest('card_draft_parent_closed', 'The parent card is gone or closed.')
    }
  }
  for (const card of draft.cards) {
    if (appendSubtasks(card.description.trim(), card.subtasks).length > DRAFT_DESCRIPTION_MAX) {
      throw badRequest('card_draft_too_long', 'A card description is too long.')
    }
  }

  const note = (cardId: string, body: string) =>
    db.insert(cardNotes).values({ id: randomUUID(), cardId, conversationId, userId: null, body, createdAt: Date.now() }).run()

  return writeTransaction(db, () => {
    const by = { userId, conversationId }
    let parent: CardRow | null = existingParent
    if (draft.parent?.kind === 'new') {
      parent = createCard(
        db,
        projectId,
        userId,
        { title: draft.parent.title.trim(), description: draft.parent.description.trim(), column: 'todo' },
        { dueAt: draft.parent.dueAt, conversationId },
      )
      note(parent.id, 'Jalon ouvert par le découpage de cette session, validé dans le fil.')
    }

    const byKey = new Map<string, CardRow>()
    const created: CardDraftCreated[] = []
    for (const card of draft.cards) {
      const row = createCard(
        db,
        projectId,
        userId,
        { title: card.title.trim(), description: appendSubtasks(card.description.trim(), card.subtasks), column: 'todo' },
        { parentId: parent?.id ?? null, conversationId },
      )
      byKey.set(card.key, row)
      created.push({ key: card.key, cardId: row.id, number: row.number, title: row.title })
      note(row.id, 'Carte ouverte par le découpage de cette session, validé dans le fil.')
    }

    for (const card of draft.cards) {
      const row = byKey.get(card.key)!
      for (const before of card.after) {
        addCardBlock(db, { projectId, sourceId: byKey.get(before)!.id, targetId: row.id, userId })
      }
      for (const blocker of card.blockedBy) {
        if (live(blocker)) addCardBlock(db, { projectId, sourceId: blocker.cardId, targetId: row.id, userId })
      }
      for (const other of card.related) {
        if (live(other)) addCardRelation(db, { projectId, sourceId: row.id, targetId: other.cardId, kind: 'related', replace: false, ...by })
      }
    }

    return { parent: parent ? ref(parent) : null, created }
  })
}
