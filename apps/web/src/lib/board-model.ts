import { parseSubtasks, type AgentKind, type CardColumn, type CardConversationDto, type CardDto } from '@solera/protocol'
import { awaitsMe, isLate, isOpen, liveSessions, loadedStatus, type StatusOf } from './card-state'
import { isIdea } from './milestone-model'

/*
 * Le modèle du Tableau (#180, spec page projet v2 B-1, B-2, B-4) : quelles cartes sont
 * des tuiles, à quel jalon chacune appartient, ce qu'elle demande, et comment la barre
 * les filtre, les trie et les range. Pur, sans React ni réseau : `useBoardData` lui
 * passe les cartes et le statut vivant des sessions.
 */

/** Les colonnes montrées d'office ; Fait et Abandonné se règlent dans « Affichage ». */
const OPEN_COLUMNS: readonly CardColumn[] = ['todo', 'in_progress', 'review']
const ALL_COLUMNS: readonly CardColumn[] = [...OPEN_COLUMNS, 'done', 'abandoned']

/** Le nombre de teintes de jalon, qui tournent au-delà (`MilestoneTint`). */
export const TINT_COUNT = 6

/** Les fermées montrées dans Fait en « Les 5 récentes ». */
const DONE_SHOWN = 5
/** Les fermées montrées dans la cellule Fait d'un couloir, avant « N de plus ». */
export const LANE_DONE_SHOWN = 2

export interface BoardMilestone {
  card: CardDto
  /** Son rang dans la palette, de 0 à `TINT_COUNT - 1`. */
  tint: number
  /** Ses feuilles, à toute profondeur, toutes colonnes. */
  leaves: CardDto[]
  /** Les feuilles closes : faites ou abandonnées. */
  done: number
}

export interface BoardCard {
  card: CardDto
  milestone: BoardMilestone | null
  subtasks: { done: number; total: number }
  /** Une session non archivée attend une réponse. */
  waiting: boolean
  /** Les sessions qui tournent ou attendent, à leur statut vivant. */
  live: CardConversationDto[]
  late: boolean
}

export interface BoardModel {
  cards: BoardCard[]
  milestones: BoardMilestone[]
}

/**
 * Les tuiles du Tableau et ses jalons (B-2). Seules les feuilles sont des tuiles : une
 * carte qui a des enfants les regroupe, et devient un filtre et un couloir. Une idée de
 * jalon, sans enfant, n'est pas une tâche du tableau.
 */
export function boardModel(
  cards: readonly CardDto[],
  { now = Date.now(), statusOf = loadedStatus }: { now?: number; statusOf?: StatusOf } = {},
): BoardModel {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const leavesOf = (card: CardDto): CardDto[] =>
    card.children.length === 0
      ? [card]
      : card.children.flatMap((child) => {
          const found = byId.get(child.id)
          return found ? leavesOf(found) : []
        })

  const milestones = cards
    .filter((card) => card.parent === null && card.children.length > 0)
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.number - b.number)
    .map((card, index): BoardMilestone => {
      const leaves = leavesOf(card)
      return { card, tint: index % TINT_COUNT, leaves, done: leaves.filter((leaf) => !isOpen(leaf)).length }
    })
  const milestoneOf = new Map<string, BoardMilestone>()
  for (const milestone of milestones) for (const leaf of milestone.leaves) milestoneOf.set(leaf.id, milestone)

  return {
    milestones,
    cards: cards
      .filter((card) => card.children.length === 0 && !isIdea(card))
      .map((card): BoardCard => {
        const subtasks = parseSubtasks(card.description)
        return {
          card,
          milestone: milestoneOf.get(card.id) ?? null,
          subtasks: { done: subtasks.filter((task) => task.checked).length, total: subtasks.length },
          waiting: awaitsMe(card, statusOf),
          live: liveSessions(card, statusOf).map((session) => ({ ...session, status: statusOf(session) })),
          late: isLate(card, now),
        }
      }),
  }
}

/* ------------------------------------------------------------------ recherche et filtres */

/** La recherche de la barre : `#12` vise un numéro par préfixe, le reste le numéro, le titre et celui du jalon. */
export function matches(entry: BoardCard, query: string): boolean {
  const search = query.trim().toLocaleLowerCase()
  if (!search) return true
  if (search.startsWith('#')) return String(entry.card.number).startsWith(search.slice(1))
  return `${entry.card.number} ${entry.card.title} ${entry.milestone?.card.title ?? ''}`.toLocaleLowerCase().includes(search)
}

/** Les filtres de « Filtrer ▾ », état de la page : ils ne sont pas retenus. */
export interface BoardFilters {
  /** Ids de jalon, `none` pour « Sans jalon ». Vide : tous. */
  milestones: string[]
  waiting: boolean
  clarify: boolean
  accept: boolean
  due: 'late' | 'week' | null
  agents: AgentKind[]
  /** Une seule colonne, posée par « Tout voir » de Fait. */
  column: CardColumn | null
}

export const NO_FILTERS: BoardFilters = { milestones: [], waiting: false, clarify: false, accept: false, due: null, agents: [], column: null }

const WEEK = 7 * 86_400_000

/**
 * Les familles de filtres se cumulent en « et » ; dans une famille, en « ou » — « t'attend
 * ou à préciser » est la question qu'on se pose.
 */
export function passes(entry: BoardCard, filters: BoardFilters, now = Date.now()): boolean {
  const { card } = entry
  if (filters.milestones.length > 0 && !filters.milestones.includes(entry.milestone?.card.id ?? 'none')) return false
  if (filters.waiting || filters.clarify || filters.accept) {
    const any =
      (filters.waiting && entry.waiting) ||
      (filters.clarify && card.toClarifySince !== null) ||
      (filters.accept && card.acceptedAt === null)
    if (!any) return false
  }
  if (filters.due === 'late' && !entry.late) return false
  if (filters.due === 'week' && (card.dueAt === null || card.dueAt - now > WEEK)) return false
  if (
    filters.agents.length > 0 &&
    !card.conversations.some((session) => session.archivedAt === null && filters.agents.includes(session.agent))
  )
    return false
  if (filters.column !== null && card.column !== filters.column) return false
  return true
}

/** Le nombre de filtres posés, un par puce. */
export function activeFilters(filters: BoardFilters): number {
  return (
    filters.milestones.length +
    Number(filters.waiting) +
    Number(filters.clarify) +
    Number(filters.accept) +
    Number(filters.due !== null) +
    filters.agents.length +
    Number(filters.column !== null)
  )
}

/* ------------------------------------------------------------------ affichage */

export const BOARD_SORTS = ['waiting', 'recent', 'due', 'number'] as const
export type BoardSort = (typeof BOARD_SORTS)[number]
const DONE_MODES = ['recent', 'all', 'hidden'] as const
export type DoneMode = (typeof DONE_MODES)[number]

/** Les réglages de présentation, tenus par « Affichage ▾ » et retenus par projet. */
export interface BoardDisplay {
  /** Couloirs par jalon. */
  lanes: boolean
  done: DoneMode
  abandoned: boolean
  sort: BoardSort
}

export const DEFAULT_DISPLAY: BoardDisplay = { lanes: false, done: 'recent', abandoned: false, sort: 'waiting' }

/** L'affichage retenu, relu champ par champ : une valeur qui n'a plus cours reprend son défaut. */
export function readDisplay(raw: string | null): BoardDisplay {
  let stored: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    stored = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    stored = {}
  }
  const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback)
  return {
    lanes: pick(stored.lanes, [true, false], DEFAULT_DISPLAY.lanes),
    done: pick(stored.done, DONE_MODES, DEFAULT_DISPLAY.done),
    abandoned: pick(stored.abandoned, [true, false], DEFAULT_DISPLAY.abandoned),
    sort: pick(stored.sort, BOARD_SORTS, DEFAULT_DISPLAY.sort),
  }
}

export function shownColumns(display: BoardDisplay): CardColumn[] {
  return ALL_COLUMNS.filter(
    (column) => OPEN_COLUMNS.includes(column) || (column === 'done' && display.done !== 'hidden') || (column === 'abandoned' && display.abandoned),
  )
}

const COMPARE: Record<BoardSort, (a: BoardCard, b: BoardCard) => number> = {
  // Ce qui t'attend, puis ce qui attend un tri, puis le retard, puis les entrées récentes.
  waiting: (a, b) =>
    Number(b.waiting) - Number(a.waiting) ||
    Number(a.card.acceptedAt !== null) - Number(b.card.acceptedAt !== null) ||
    Number(b.late) - Number(a.late) ||
    b.card.columnSince - a.card.columnSince,
  recent: (a, b) => b.card.updatedAt - a.card.updatedAt,
  due: (a, b) => (a.card.dueAt ?? Infinity) - (b.card.dueAt ?? Infinity) || b.card.columnSince - a.card.columnSince,
  number: (a, b) => b.card.number - a.card.number,
}

export function sortEntries(entries: readonly BoardCard[], sort: BoardSort): BoardCard[] {
  // Le tri est stable : des ex aequo gardent l'ordre du serveur.
  return [...entries].sort(COMPARE[sort])
}

/** Fait se lit toujours par récence d'arrivée : ce qui vient de se finir d'abord. */
const byArrival = (a: BoardCard, b: BoardCard) => b.card.columnSince - a.card.columnSince || b.card.number - a.card.number

/**
 * Les tuiles d'une colonne, triées, et combien elle en a en tout. Fait est limitée en
 * « Les 5 récentes », ou à `cap` quand on en donne un (une cellule de couloir).
 */
export function columnSlice(
  entries: readonly BoardCard[],
  column: CardColumn,
  display: BoardDisplay,
  cap?: number,
): { shown: BoardCard[]; total: number } {
  const own = entries.filter((entry) => entry.card.column === column)
  const sorted = column === 'done' ? [...own].sort(byArrival) : sortEntries(own, display.sort)
  const limit = column !== 'done' ? Infinity : (cap ?? (display.done === 'recent' ? DONE_SHOWN : Infinity))
  return { shown: sorted.slice(0, limit), total: sorted.length }
}

export interface LaneGroup {
  key: string
  milestone: BoardMilestone | null
  entries: BoardCard[]
}

/** Les couloirs (B-4.7) : un par jalon qui a des feuilles ouvertes, puis « Sans jalon ». */
export function laneGroups(entries: readonly BoardCard[], milestones: readonly BoardMilestone[]): LaneGroup[] {
  return [
    ...milestones.map((milestone) => ({
      key: milestone.card.id,
      milestone,
      entries: entries.filter((entry) => entry.milestone?.card.id === milestone.card.id),
    })),
    { key: 'none', milestone: null, entries: entries.filter((entry) => entry.milestone === null) },
  ].filter((group) => group.entries.some((entry) => isOpen(entry.card)))
}

/**
 * Le titre court d'un jalon : sans le préfixe « Jalon — » que l'usage met en tête de ses
 * titres (une convention de nommage des cartes, pas de l'interface), coupé au premier
 * séparateur.
 */
export function shortTitle(title: string, max = 26): string {
  const bare = title.replace(/^jalon\s*[—:–-]\s*/i, '')
  const head = bare.split(/\s[:—–]\s/)[0]!.trim()
  return head.length > max ? `${head.slice(0, max - 1).trimEnd()}…` : head
}
