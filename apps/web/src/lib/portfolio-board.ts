import type { CardDto, ProjectDto } from '@solera/protocol'
import {
  DEFAULT_DISPLAY,
  DEFAULT_LIST_SORT,
  DONE_SHOWN,
  TINT_COUNT,
  boardModel,
  columnSlice,
  matches,
  sortList,
  type BoardCard,
  type BoardMilestone,
} from './board-model'
import { cardDestination, destinationHref } from './card-destination'
import { withPortfolioSheet } from './card-sheet'
import { isOpen, loadedStatus, type StatusOf } from './card-state'

/*
 * Le Tableau du portefeuille (#239, `coque.md` PF-22 à PF-27) : les tuiles du Tableau
 * d'un projet (`boardModel`), pour tous les projets à la fois, chacune avec le sien.
 * Pur, sans React ni réseau.
 */

export type PortfolioMilestone = BoardMilestone & { project: ProjectDto }
export type PortfolioEntry = Omit<BoardCard, 'milestone'> & { project: ProjectDto; milestone: PortfolioMilestone | null }

export interface PortfolioBoardModel {
  entries: PortfolioEntry[]
  milestones: PortfolioMilestone[]
}

/**
 * Les feuilles de tous les projets et leurs jalons, dans l'ordre des projets. Les teintes
 * de jalon tournent sur tout le portefeuille : deux projets ne se partagent pas une
 * teinte tant que la palette en a. L'abandon est un classement, pas une étape : une
 * carte abandonnée n'est pas une tuile ici.
 */
export function portfolioBoardModel(
  cards: readonly (CardDto & { project: ProjectDto })[],
  projects: readonly ProjectDto[],
  options: { now?: number; statusOf?: StatusOf } = {},
): PortfolioBoardModel {
  const entries: PortfolioEntry[] = []
  const milestones: PortfolioMilestone[] = []
  for (const project of projects) {
    const own = cards.filter((card) => card.project.id === project.id)
    if (own.length === 0) continue
    const model = boardModel(own, options)
    const tinted = new Map<string, PortfolioMilestone>()
    for (const milestone of model.milestones) {
      const entry = { ...milestone, project, tint: milestones.length % TINT_COUNT }
      tinted.set(milestone.card.id, entry)
      milestones.push(entry)
    }
    for (const entry of model.cards) {
      if (entry.card.column === 'abandoned') continue
      entries.push({ ...entry, project, milestone: entry.milestone ? (tinted.get(entry.milestone.card.id) ?? null) : null })
    }
  }
  return { entries, milestones }
}

/** Le compte d'un projet dans « Filtrer ▾ » : ses feuilles non livrées. */
export function projectCounts(entries: readonly PortfolioEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) if (isOpen(entry.card)) counts.set(entry.project.id, (counts.get(entry.project.id) ?? 0) + 1)
  return counts
}

/* ------------------------------------------------------------------ recherche et filtres */

/** La recherche du Tableau d'un projet, et le nom du projet en plus. */
export function portfolioMatches(entry: PortfolioEntry, query: string): boolean {
  const search = query.trim().toLocaleLowerCase()
  if (!search || search.startsWith('#')) return matches(entry, search)
  return matches(entry, search) || entry.project.name.toLocaleLowerCase().includes(search)
}

/** Les filtres de « Filtrer ▾ », état de la page. */
export interface PortfolioFilters {
  /** Ids de projet. Vide : tous. */
  projects: string[]
  waiting: boolean
  late: boolean
}

export const NO_PORTFOLIO_FILTERS: PortfolioFilters = { projects: [], waiting: false, late: false }

/** Les projets cochés en « ou » ; T'attend et En retard se cumulent. */
export function portfolioPasses(entry: PortfolioEntry, filters: PortfolioFilters): boolean {
  if (filters.projects.length > 0 && !filters.projects.includes(entry.project.id)) return false
  if (filters.waiting && !entry.waiting) return false
  if (filters.late && !entry.late) return false
  return true
}

/** Le nombre de filtres posés, un par puce. */
export function portfolioActive(filters: PortfolioFilters): number {
  return filters.projects.length + Number(filters.waiting) + Number(filters.late)
}

/* ------------------------------------------------------------------ couloirs */

export const LANE_MODES = ['none', 'project', 'milestone'] as const
export type LaneMode = (typeof LANE_MODES)[number]

/** Les couloirs retenus ; une valeur qui n'a plus cours reprend « Par projet », le défaut. */
export function readLanes(raw: string | null): LaneMode {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    return LANE_MODES.includes(value as LaneMode) ? (value as LaneMode) : 'project'
  } catch {
    return 'project'
  }
}

export interface PortfolioLane {
  key: string
  /** Le projet du couloir : le sien en couloirs par projet, celui du jalon par jalon. */
  project: ProjectDto | null
  milestone: PortfolioMilestone | null
  entries: PortfolioEntry[]
}

/**
 * Les couloirs (PF-24) : aucun, un par projet ou un par jalon puis « Sans jalon » à la
 * fin. Au repos, un couloir ne se montre que s'il a du travail ouvert : un projet qui
 * n'a plus que du fait n'occupe pas une bande pour ça. Une recherche ou un filtre posé
 * (`narrowed`) montre tout ce qu'il trouve, fait compris.
 */
export function lanesOf(
  entries: readonly PortfolioEntry[],
  {
    mode,
    projects,
    milestones,
    narrowed = false,
  }: { mode: LaneMode; projects: readonly ProjectDto[]; milestones: readonly PortfolioMilestone[]; narrowed?: boolean },
): PortfolioLane[] {
  if (mode === 'none') return [{ key: 'all', project: null, milestone: null, entries: [...entries] }]
  const lanes: PortfolioLane[] =
    mode === 'project'
      ? projects.map((project) => ({
          key: project.id,
          project,
          milestone: null,
          entries: entries.filter((entry) => entry.project.id === project.id),
        }))
      : [
          ...milestones.map((milestone) => ({
            key: milestone.card.id,
            project: milestone.project,
            milestone,
            entries: entries.filter((entry) => entry.milestone?.card.id === milestone.card.id),
          })),
          { key: 'none', project: null, milestone: null, entries: entries.filter((entry) => entry.milestone === null) },
        ]
  return lanes.filter((lane) => (narrowed ? lane.entries.length > 0 : lane.entries.some((entry) => isOpen(entry.card))))
}

/* ------------------------------------------------------------------ Fait, Liste */

/** Les faites d'un couloir, les plus récentes d'abord : cinq, ou toutes une fois dépliées. */
export function doneCut(entries: readonly PortfolioEntry[], all: boolean): { shown: PortfolioEntry[]; total: number } {
  return columnSlice(entries, 'done', DEFAULT_DISPLAY, all ? Infinity : DONE_SHOWN)
}

/** Une colonne ouverte du Kanban, triée comme au Tableau d'un projet : ce qui t'attend d'abord. */
export function openColumn(entries: readonly PortfolioEntry[], column: CardDto['column']): { shown: PortfolioEntry[]; total: number } {
  return columnSlice(entries, column, DEFAULT_DISPLAY)
}

/** Les lignes de la Liste (PF-25) : sans les faites, dans l'ordre « État » de la Liste d'un projet. */
export function listRows(entries: readonly PortfolioEntry[]): PortfolioEntry[] {
  return sortList(entries.filter((entry) => isOpen(entry.card)), DEFAULT_LIST_SORT)
}

/* ------------------------------------------------------------------ clic */

/**
 * Où mène un clic sur une tuile (PF-26) : la fiche du portefeuille pour une carte qui
 * t'attend, sinon sa session, sinon un brouillon rattaché (`cardDestination`).
 */
export function portfolioHref(
  entry: PortfolioEntry,
  { search, statusOf = loadedStatus }: { search: URLSearchParams; statusOf?: StatusOf },
): string {
  const destination = cardDestination(entry.card, statusOf)
  if (destination.kind === 'sheet') {
    return `?${withPortfolioSheet(search, { projectId: entry.project.id, number: destination.number }).toString()}`
  }
  return destinationHref(entry.project.id, destination)
}
