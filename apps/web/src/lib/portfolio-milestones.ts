import type { CardDto, MilestoneRunDto, ProjectDto } from '@solera/protocol'
import type { Anchor, Scale } from '../components/gantt/scale'
import { loadedStatus, type StatusOf } from './card-state'
import { isMilestoneLate, milestoneBar, milestoneMatches } from './milestone-horizon'
import { horizonOf, type Maturity, type MilestoneEntry } from './milestone-model'
import type { SessionRequest } from './session-request-summary'

/*
 * Les Jalons du portefeuille (#240, `coque.md` PF-28 à PF-31) en fonctions pures : les
 * jalons de chaque projet sur le modèle de maturité, ce que la barre garde, les bandes
 * de l'horizon et les flèches du Gantt commun. Testé seul (`apps/server/test/portfolio.test.ts`).
 */

/** Un jalon du portefeuille, qui sait de quel projet il vient. */
export interface PortfolioMilestone {
  project: ProjectDto
  entry: MilestoneEntry
}

/**
 * Les jalons et idées de chaque projet, analysés comme sur sa page (`horizonOf`), dans
 * l'ordre des projets. Les cartes d'un projet absent de la liste sont ignorées.
 */
export function portfolioMilestones({
  projects,
  cards,
  runs,
  requests = new Map(),
  statusOf = loadedStatus,
}: {
  projects: readonly ProjectDto[]
  cards: readonly CardDto[]
  /** Les pilotages actifs, par projet (`usePortfolioActiveMilestones`). */
  runs: ReadonlyMap<string, readonly MilestoneRunDto[]>
  requests?: ReadonlyMap<string, SessionRequest>
  statusOf?: StatusOf
}): PortfolioMilestone[] {
  const byProject = new Map<string, CardDto[]>()
  for (const card of cards) {
    const bucket = byProject.get(card.projectId)
    if (bucket) bucket.push(card)
    else byProject.set(card.projectId, [card])
  }
  return projects.flatMap((project) =>
    horizonOf({ cards: byProject.get(project.id) ?? [], runs: runs.get(project.id) ?? [], requests, statusOf }).map((entry) => ({
      project,
      entry,
    })),
  )
}

/** Ce que « Filtrer ▾ » et « Affichage ▾ » restreignent (PF-28). */
export interface PortfolioMilestoneFilters {
  /** Les projets cochés en tête de « Filtrer ▾ » ; aucun : tous. */
  projects: ReadonlySet<string>
  maturities: ReadonlySet<Maturity>
  late: boolean
  /** « Montrer : Jalons livrés » : masqués par défaut. */
  delivered: boolean
}

export const NO_PORTFOLIO_MILESTONE_FILTERS: PortfolioMilestoneFilters = { projects: new Set(), maturities: new Set(), late: false, delivered: false }

/**
 * Les filtres propres à la page posés, pour le compte de « Filtrer ▾ » : la barre du
 * portefeuille compte les projets elle-même, et les livrés relèvent de l'affichage.
 */
export function milestoneExtraFilterCount(filters: PortfolioMilestoneFilters): number {
  return filters.maturities.size + Number(filters.late)
}

/**
 * Un jalon livré ne se montre que si on le demande : par « Montrer », ou en cochant sa
 * maturité. La recherche porte aussi sur le nom du projet.
 */
export function keepPortfolioMilestone(
  { project, entry }: PortfolioMilestone,
  query: string,
  filters: PortfolioMilestoneFilters,
  now = Date.now(),
): boolean {
  if (filters.projects.size > 0 && !filters.projects.has(project.id)) return false
  if (filters.maturities.size > 0 && !filters.maturities.has(entry.maturity)) return false
  if (entry.maturity === 'delivered' && !filters.delivered && !filters.maturities.has('delivered')) return false
  if (filters.late && !isMilestoneLate(entry, now)) return false
  return milestoneMatches(entry, query) || project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}

/** Les jalons pas encore livrés, par projet : la méta et les comptes du filtre Projet. */
export function openMilestoneCounts(rows: readonly PortfolioMilestone[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const { project, entry } of rows) {
    if (entry.maturity !== 'delivered') counts.set(project.id, (counts.get(project.id) ?? 0) + 1)
  }
  return counts
}

/** Du plus avancé au moins avancé, le livré à la fin : ce qui bouge se lit d'abord (PF-29). */
const RANK: Record<Maturity, number> = { launched: 0, ready: 1, split: 2, refine: 3, idea: 4, delivered: 5 }

/**
 * Les bandes de l'horizon et du Gantt : une par projet qui a des jalons montrés, dans
 * l'ordre des projets ; dans une bande, par maturité, puis par échéance, puis par numéro.
 */
export function milestoneGroups(
  rows: readonly PortfolioMilestone[],
  projects: readonly ProjectDto[],
): { project: ProjectDto; rows: PortfolioMilestone[] }[] {
  return projects.flatMap((project) => {
    const mine = rows
      .filter((row) => row.project.id === project.id)
      .sort(
        (a, b) =>
          RANK[a.entry.maturity] - RANK[b.entry.maturity] ||
          (a.entry.card.dueAt ?? Infinity) - (b.entry.card.dueAt ?? Infinity) ||
          a.entry.card.number - b.entry.card.number,
      )
    return mine.length ? [{ project, rows: mine }] : []
  })
}

/**
 * Les flèches « bloque » entre jalons montrés (`blockedBy` de leur carte), d'un projet à
 * l'autre aussi : de la fin de la barre qui bloque au début de celle qui attend. Les
 * barres d'un jalon ne sont pas celles d'une carte (`milestoneBar`), d'où ce calcul
 * plutôt qu'`anchorsOf`.
 */
export function milestoneAnchors(
  entries: readonly MilestoneEntry[],
  centerY: ReadonlyMap<string, number>,
  scale: Pick<Scale, 'x'>,
  now = Date.now(),
): Anchor[] {
  const byId = new Map(entries.map((entry) => [entry.card.id, entry]))
  return entries.flatMap((entry) => {
    const y2 = centerY.get(entry.card.id)
    if (y2 === undefined) return []
    return entry.card.blockedBy.flatMap((blocker) => {
      const source = byId.get(blocker.id)
      const y1 = centerY.get(blocker.id)
      if (!source || y1 === undefined) return []
      return [
        {
          x1: scale.x(milestoneBar(source, now).end),
          y1,
          x2: scale.x(milestoneBar(entry, now).start),
          y2,
          from: source.card.id,
          to: entry.card.id,
        },
      ]
    })
  })
}
