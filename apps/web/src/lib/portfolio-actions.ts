import { newActionParam, type ActionPanel, type NewActionKind } from './action-panel'
import { ACTION_PARAM } from './actions-tab'
import { matchesQuery, matchesWhen, type Automation, type What, type WhenFilter } from './automations'
import { NEW_PARAM } from './place'
import type { SessionWork } from './session-works'

/**
 * L'onglet Actions du portefeuille (`coque.md` PF-32 à PF-37) : les actions de tous les
 * projets, filtrées par projet, par nature et par cadence ; ce qui tourne sur l'instance ;
 * et l'adresse, dans l'onglet Actions de son projet, de ce qu'on y ouvre. Une action vit
 * dans son projet : son détail et son éditeur aussi. Pur : `PortfolioActionsPage` le
 * rend, les tests le lisent seul.
 */

export interface PortfolioActionFilters {
  projects: string[]
  what: What[]
  when: WhenFilter[]
}

export const NO_PORTFOLIO_ACTION_FILTERS: PortfolioActionFilters = { projects: [], what: [], when: [] }

/** « Chercher une action » : celle d'un projet, plus le nom du projet. */
export function portfolioActionMatches(item: Automation, query: string, projectName: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return matchesQuery(item, needle) || projectName.toLocaleLowerCase().includes(needle)
}

/** Projet, Quoi, Quand : un groupe sans case cochée laisse tout passer. */
export function portfolioActionPasses(item: Automation, filters: PortfolioActionFilters): boolean {
  return (
    (filters.projects.length === 0 || (item.projectId !== null && filters.projects.includes(item.projectId))) &&
    (filters.what.length === 0 || filters.what.includes(item.what)) &&
    (filters.when.length === 0 || filters.when.some((when) => matchesWhen(item, when)))
  )
}

/** Les filtres propres à la page, que la barre ajoute au compte des projets cochés. */
export function portfolioActionsActive(filters: PortfolioActionFilters): number {
  return filters.what.length + filters.when.length
}

/** Combien d'actions chaque projet porte, en regard de sa case de Filtrer ▾. */
export function projectActionCounts(items: readonly Automation[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) if (item.projectId !== null) counts.set(item.projectId, (counts.get(item.projectId) ?? 0) + 1)
  return counts
}

/** Le Lanceur (PF-34) : un groupe par projet qui a des actions à montrer, dans l'ordre des projets. */
export function byProject<P extends { id: string }>(projects: readonly P[], items: readonly Automation[]): { project: P; items: Automation[] }[] {
  return projects
    .map((project) => ({ project, items: items.filter((item) => item.projectId === project.id) }))
    .filter((group) => group.items.length > 0)
}

/** Une pastille de « Tourne maintenant » : une action en marche, ou ce qu'une session a laissé tourner. */
export type RunningEntry =
  | { kind: 'action'; key: string; projectId: string; item: Automation }
  | { kind: 'work'; key: string; projectId: string; work: SessionWork }

/**
 * Tourne maintenant, tous projets (PF-33) : projet par projet, ses actions en marche puis
 * les processus de ses sessions. Une action à relire ne tourne pas : elle attend. Les
 * projets qu'on ne montre pas (archivés, disparus) n'y sont pas.
 */
export function runningNow(
  items: readonly Automation[],
  works: ReadonlyMap<string, readonly SessionWork[]>,
  projectIds: readonly string[],
): RunningEntry[] {
  return projectIds.flatMap((projectId) => [
    ...items
      .filter((item) => item.projectId === projectId && item.live !== null && item.review === null)
      .map((item): RunningEntry => ({ kind: 'action', key: `${projectId}:${item.id}`, projectId, item })),
    ...(works.get(projectId) ?? []).map((work): RunningEntry => ({ kind: 'work', key: `${projectId}:${work.id}`, projectId, work })),
  ])
}

/** L'état d'une ligne de la Liste (PF-35), dans cet ordre de priorité. */
export type ListState = 'review' | 'live' | 'scheduled' | 'paused' | 'demand'

export function listStateOf(item: Automation): ListState {
  if (item.review) return 'review'
  if (item.live) return 'live'
  if (item.schedule) return item.schedule.enabled ? 'scheduled' : 'paused'
  return 'demand'
}

/** L'onglet Actions d'un projet, où vivent le détail et l'éditeur de ses actions. */
export const projectActionsHref = (projectId: string): string => `/p/${projectId}/actions`

const actionsOf = (projectId: string, param: string, value: string) =>
  `${projectActionsHref(projectId)}?${new URLSearchParams({ [param]: value }).toString()}`

/** Le détail d'une action, dans l'onglet Actions de son projet. */
export function actionHref(projectId: string, actionId: string): string {
  return actionsOf(projectId, ACTION_PARAM, actionId)
}

/** Une création dans l'onglet Actions d'un projet : l'éditeur pré-réglé, ou le choix à planifier. */
export function newActionHref(projectId: string, kind: NewActionKind): string {
  return actionsOf(projectId, NEW_PARAM, newActionParam(kind))
}

/**
 * Le tiroir qu'une tuile du Lanceur demande, en adresse de l'onglet Actions du projet
 * (PF-34) : le portefeuille n'a pas de tiroir d'action. Ce qui touche une action qui
 * existe (son détail, son passage, la modifier ou la planifier) ouvre son détail ; une
 * tuile d'ajout ouvre l'éditeur pré-réglé de sa nature.
 */
export function panelHref(projectId: string, panel: ActionPanel): string {
  switch (panel.mode) {
    case 'detail':
      return actionsOf(projectId, ACTION_PARAM, panel.id)
    case 'run':
      return actionsOf(projectId, ACTION_PARAM, panel.back)
    case 'pick':
      return newActionHref(projectId, 'schedule')
    case 'edit': {
      const { from, preset } = panel.seed
      if (from) return actionsOf(projectId, ACTION_PARAM, from.id)
      if (!preset) return newActionHref(projectId, 'any')
      return newActionHref(projectId, preset.what === 'agent' ? 'agent' : preset.kind === 'service' ? 'service' : 'command')
    }
  }
}
