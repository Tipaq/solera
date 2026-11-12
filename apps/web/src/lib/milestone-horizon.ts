import { DAY } from '../components/gantt/scale'
import { lateDays, liveSessions, loadedStatus, type StatusOf } from './card-state'
import { MATURITIES, type Maturity, type MilestoneEntry } from './milestone-model'

/*
 * L'onglet Jalons (#190, spec jalons BAR, HOR) en fonctions pures : ce que la barre garde,
 * où chaque jalon se range dans l'horizon, et la barre d'un jalon sur l'axe daté. Testé
 * seul (`apps/server/test/milestone-horizon.test.ts`).
 */

/** Ce que « Filtrer ▾ » restreint (BAR-3). */
export interface MilestoneFilters {
  maturities: Maturity[]
  late: boolean
}

export const NO_MILESTONE_FILTERS: MilestoneFilters = { maturities: [], late: false }

export function milestoneFilterCount(filters: MilestoneFilters): number {
  return filters.maturities.length + Number(filters.late)
}

/** BAR-2 : « {numéro} {titre} » en minuscules ; `#901` et `901` trouvent le même jalon. */
export function milestoneMatches(entry: MilestoneEntry, query: string): boolean {
  const search = query.trim().toLocaleLowerCase().replace(/^#/, '')
  return !search || `${entry.card.number} ${entry.card.title}`.toLocaleLowerCase().includes(search)
}

/**
 * Échéance passée et pas livré. Au calendrier, comme sur le board : posée le 4, elle n'est
 * en retard qu'à partir du 5. La colonne de la carte-jalon ne dit rien, sa maturité si.
 */
export function isMilestoneLate(entry: MilestoneEntry, now = Date.now()): boolean {
  return dueLateDays(entry, now) > 0
}

function dueLateDays(entry: MilestoneEntry, now: number): number {
  if (entry.maturity === 'delivered') return 0
  return lateDays({ column: 'todo', dueAt: entry.card.dueAt }, now)
}

export function keepMilestone(entry: MilestoneEntry, query: string, filters: MilestoneFilters, now = Date.now()): boolean {
  if (!milestoneMatches(entry, query)) return false
  if (filters.maturities.length > 0 && !filters.maturities.includes(entry.maturity)) return false
  return !filters.late || isMilestoneLate(entry, now)
}

/** HOR-1 : combien de jalons à chaque étape. */
export function maturityCounts(entries: readonly MilestoneEntry[]): Record<Maturity, number> {
  const counts = Object.fromEntries(MATURITIES.map((maturity) => [maturity, 0])) as Record<Maturity, number>
  for (const entry of entries) counts[entry.maturity] += 1
  return counts
}

/** Ce qui a un passé : lancé, livré, ou une carte déjà en cours ou à relire. */
function isMoving(entry: MilestoneEntry): boolean {
  return (
    entry.maturity === 'launched' ||
    entry.maturity === 'delivered' ||
    entry.children.some((card) => card.column === 'in_progress' || card.column === 'review')
  )
}

const byBoard = (a: MilestoneEntry, b: MilestoneEntry) => a.card.position - b.card.position

/**
 * Les trois temps de l'horizon. **Maintenant** (HOR-2) sur l'axe daté, les non livrés
 * d'abord puis par création ; **Ensuite** (HOR-9) et **Plus tard** (HOR-10) sans dates,
 * dans l'ordre du tableau : un jalon pas encore parti n'a ni durée ni début, on n'en
 * invente pas.
 */
export function horizonSections(entries: readonly MilestoneEntry[]): {
  now: MilestoneEntry[]
  next: MilestoneEntry[]
  later: MilestoneEntry[]
} {
  const delivered = (entry: MilestoneEntry) => (entry.maturity === 'delivered' ? 1 : 0)
  const now = entries.filter(isMoving).sort((a, b) => delivered(a) - delivered(b) || a.card.createdAt - b.card.createdAt)
  const future = entries.filter((entry) => !isMoving(entry))
  return {
    now,
    next: future.filter((entry) => entry.maturity === 'split' || entry.maturity === 'ready').sort(byBoard),
    later: future.filter((entry) => entry.maturity === 'idea' || entry.maturity === 'refine').sort(byBoard),
  }
}

/** La barre d'un jalon sur l'axe daté (HOR-5, HOR-7). */
export interface MilestoneBarGeometry {
  start: number
  end: number
  /** Sans échéance : elle court jusqu'à aujourd'hui, en pointillé. */
  loose: boolean
  done: number
  /** Les cartes non abandonnées. */
  total: number
  /** La part faite, de 0 à 1. */
  share: number
  /** Jours de retard au calendrier ; 0 à l'heure ou livré. */
  lateDays: number
}

/** De la plus ancienne création (jalon ou carte) à l'échéance, ou à aujourd'hui sans elle. */
export function milestoneBar(entry: MilestoneEntry, now = Date.now()): MilestoneBarGeometry {
  const start = Math.min(entry.card.createdAt, ...entry.children.map((card) => card.createdAt))
  const due = entry.card.dueAt
  const total = entry.children.filter((card) => card.column !== 'abandoned').length
  return {
    start,
    end: due ?? Math.max(now, start + DAY),
    loose: due === null,
    done: entry.done,
    total,
    share: total ? entry.done / total : 0,
    lateDays: dueLateDays(entry, now),
  }
}

/** Les sessions vivantes de ses cartes, qui tournent ou attendent. */
export function livesOf(entry: MilestoneEntry, statusOf: StatusOf = loadedStatus): number {
  return entry.children.reduce((sum, card) => sum + liveSessions(card, statusOf).length, 0)
}
