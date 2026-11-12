import type { ProjectDto } from '@solera/protocol'
import {
  DUES,
  actionState,
  ago,
  byNextRun,
  dueOf,
  healthOf,
  inShort,
  reviewReason,
  verdictRuns,
  type Automation,
  type Due,
  type StateTone,
  type Translate,
  type UnifiedRun,
  type What,
} from './automations'
import type { ScheduleTarget } from './schedules'

/**
 * La page globale des **Planifiées** (`actions.md` §1.J, AC-20) : ce qu'elle montre, ses
 * filtres, ses groupes, ce que dit une tuile et une ligne de la Liste. Pur :
 * `SchedulesPage` le rend, les tests le lisent seul. L'état d'une action vient de
 * `lib/automations.ts` ; ici, ce qu'y ajoute la **portée** : le projet, le Savoir,
 * l'instance ou rien.
 */

/** Ce qu'une pastille de projet lit de lui. */
export type ScopeProject = Pick<ProjectDto, 'id' | 'name' | 'image' | 'color'>

/**
 * Où une tâche travaille : un projet (null quand on ne le voit plus), le vault (le
 * Savoir), le dossier de données de l'instance, ou un dossier vide à chaque passage.
 */
export type PlannedScope =
  | { kind: 'project'; projectId: string; project: ScopeProject | null }
  | { kind: 'vault' }
  | { kind: 'instance' }
  | { kind: 'none' }

export type PlannedItem = Automation & { scope: PlannedScope }

function scopeOf(item: Automation, projects: ReadonlyMap<string, ScopeProject>): PlannedScope {
  if (item.projectId) return { kind: 'project', projectId: item.projectId, project: projects.get(item.projectId) ?? null }
  // Seule une tâche d'agent vit hors projet : une commande appartient toujours au sien.
  const scope = item.source.kind === 'task' ? item.source.task.scope : 'none'
  return scope === 'vault' || scope === 'instance' ? { kind: scope } : { kind: 'none' }
}

/**
 * Ce que la page montre : tout ce qui a une cadence, et toute tâche hors projet, qui
 * n'a pas d'autre page. Une commande à la demande d'un projet reste dans son onglet
 * Actions.
 */
export function plannedOf(items: readonly Automation[], projects: readonly ScopeProject[]): PlannedItem[] {
  const byId = new Map(projects.map((project) => [project.id, project]))
  return items
    .filter((item) => item.schedule !== null || item.projectId === null)
    .map((item) => ({ ...item, scope: scopeOf(item, byId) }))
}

export const scopeKey = (scope: PlannedScope): string => (scope.kind === 'project' ? scope.projectId : scope.kind)

export function scopeLabel(scope: PlannedScope, t: Translate): string {
  switch (scope.kind) {
    case 'project':
      return scope.project?.name ?? t('planned.scope.unknown')
    case 'vault':
      return t('planned.scope.vault')
    case 'instance':
      return t('planned.scope.instance')
    case 'none':
      return t('planned.scope.none')
  }
}

export interface ScopeOption {
  key: string
  scope: PlannedScope
  count: number
}

const SCOPE_RANK: Record<PlannedScope['kind'], number> = { project: 0, vault: 1, instance: 2, none: 3 }

/** Les portées présentes, avec leur compte : les projets par nom, puis Savoir, Instance, Sans projet. */
export function scopeOptions(items: readonly PlannedItem[], t: Translate): ScopeOption[] {
  const options = new Map<string, ScopeOption>()
  for (const item of items) {
    const key = scopeKey(item.scope)
    const option = options.get(key) ?? { key, scope: item.scope, count: 0 }
    option.count += 1
    options.set(key, option)
  }
  return [...options.values()].sort(
    (a, b) => SCOPE_RANK[a.scope.kind] - SCOPE_RANK[b.scope.kind] || scopeLabel(a.scope, t).localeCompare(scopeLabel(b.scope, t)),
  )
}

/** Où part un lancement à la main (PLF-9). */
export function launchWhere(scope: PlannedScope, t: Translate): string {
  if (scope.kind === 'project') return t('planned.where.project', { name: scopeLabel(scope, t) })
  return t(`planned.where.${scope.kind}`)
}

/* ------------------------------------------------------------------ filtres (PLF-2) */

export type PlannedState = 'active' | 'paused' | 'failing' | 'review'
export const PLANNED_STATES: readonly PlannedState[] = ['active', 'paused', 'failing', 'review']

export type NextFilter = 'today' | 'week'
export const NEXT_FILTERS: readonly NextFilter[] = ['today', 'week']

/** « Filtrer ▾ » : OU dans un groupe, ET entre les groupes ; « Prochain passage » est exclusif. */
export interface PlannedFilters {
  scopes: string[]
  what: What[]
  state: PlannedState[]
  next: NextFilter | null
}

export const NO_PLANNED_FILTERS: PlannedFilters = { scopes: [], what: [], state: [], next: null }

/** Une tâche hors projet sans cadence n'est ni active ni en pause : elle attend un clic. */
export function matchesPlannedState(item: Automation, state: PlannedState): boolean {
  switch (state) {
    case 'active':
      return item.schedule?.enabled === true
    case 'paused':
      return item.schedule?.enabled === false
    case 'failing':
      return item.failStreak > 0
    case 'review':
      return item.review !== null
  }
}

function matchesNext(item: Automation, next: NextFilter, now: number): boolean {
  const due = dueOf(item, now)
  return next === 'today' ? due === 'today' : due === 'today' || due === 'week'
}

export function matchesPlanned(item: PlannedItem, filters: PlannedFilters, now: number): boolean {
  if (filters.scopes.length && !filters.scopes.includes(scopeKey(item.scope))) return false
  if (filters.what.length && !filters.what.includes(item.what)) return false
  if (filters.state.length && !filters.state.some((state) => matchesPlannedState(item, state))) return false
  return filters.next === null || matchesNext(item, filters.next, now)
}

export function plannedFilterCount(filters: PlannedFilters): number {
  return filters.scopes.length + filters.what.length + filters.state.length + (filters.next ? 1 : 0)
}

type ListGroup = 'scopes' | 'what' | 'state'

/** Coche ou décoche une entrée d'un groupe à cases ; les autres ne bougent pas. */
export function togglePlanned<G extends ListGroup>(filters: PlannedFilters, group: G, value: PlannedFilters[G][number]): PlannedFilters {
  const list = filters[group] as PlannedFilters[G][number][]
  const next = list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
  return { ...filters, [group]: next }
}

/** « Chercher une tâche » : libellé, prompt, commande, description et nom de la portée. */
export function matchesPlannedQuery(item: PlannedItem, query: string, t: Translate): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return [item.label, item.prompt, item.command, item.description, scopeLabel(item.scope, t)].some((text) =>
    text?.toLocaleLowerCase().includes(needle),
  )
}

/** Le compte de chaque entrée de « Filtrer ▾ », sur toutes les tâches et non les filtrées. */
export function plannedTally(items: readonly PlannedItem[]): { what: Record<What, number>; state: Record<PlannedState, number> } {
  const count = (test: (item: PlannedItem) => boolean) => items.filter(test).length
  return {
    what: { agent: count((item) => item.what === 'agent'), command: count((item) => item.what === 'command') },
    state: Object.fromEntries(PLANNED_STATES.map((state) => [state, count((item) => matchesPlannedState(item, state))])) as Record<PlannedState, number>,
  }
}

/* ------------------------------------------------------------------ le Lanceur (PLF-4) */

/** Les groupes « Par échéance » : ceux de `dueOf`, et à part ce qui n'a pas de cadence. */
export type DueGroup = Due | 'demand'
export const DUE_GROUPS: readonly DueGroup[] = [...DUES, 'demand']

export function groupByDue(items: readonly PlannedItem[], now: number): Record<DueGroup, PlannedItem[]> {
  const groups = Object.fromEntries(DUE_GROUPS.map((key) => [key, [] as PlannedItem[]])) as Record<DueGroup, PlannedItem[]>
  for (const item of items) groups[item.schedule ? dueOf(item, now) : 'demand'].push(item)
  for (const key of DUE_GROUPS) groups[key].sort(byNextRun)
  return groups
}

/** « Par portée » : dans l'ordre des portées, chacune par prochain passage. */
export function groupByScope(items: readonly PlannedItem[], options: readonly ScopeOption[]): (ScopeOption & { items: PlannedItem[] })[] {
  return options.map((option) => ({
    ...option,
    items: items.filter((item) => scopeKey(item.scope) === option.key).sort(byNextRun),
  }))
}

/* ------------------------------------------------------------------ la tuile (PLF-5) */

/** « dernier ✓ il y a 6 h » : le dernier passage jugé, un sauté ne dit rien. */
function lastWords(item: Automation, now: number, t: Translate): { text: string; failed: boolean } {
  const last = verdictRuns(item.runs)[0]
  if (!last) return { text: t('planned.tile.never'), failed: false }
  const failed = last.status !== 'succeeded'
  return { text: t(failed ? 'planned.tile.lastFail' : 'planned.tile.lastOk', { ago: ago(last.startedAt, now, t) }), failed }
}

/** L'état d'une tâche planifiée en une phrase : ce qui vient, puis ce qui s'est passé. */
export function plannedState(item: PlannedItem, now: number, t: Translate): { tone: StateTone; text: string } {
  // À relire et en cours : la phrase de l'onglet Actions, la même partout.
  if (item.review || item.live) return actionState(item, now, t)
  const last = lastWords(item, now, t)
  if (item.failStreak >= 2) return { tone: 'fail', text: t('planned.tile.failStreak', { count: item.failStreak, last: last.text }) }
  if (!item.schedule) return { tone: 'idle', text: t('planned.tile.demand', { last: last.text }) }
  if (!item.schedule.enabled) return { tone: 'idle', text: t('planned.tile.paused', { last: last.text }) }
  const { nextRunAt } = item.schedule
  const next = nextRunAt === null ? t('planned.tile.noNext') : t('planned.tile.next', { when: inShort(nextRunAt, now, t) })
  return { tone: last.failed ? 'fail' : 'idle', text: t('planned.tile.upcoming', { next, last: last.text }) }
}

export type PlannedGesture = 'review' | 'session' | 'resume' | 'launch'

/** Le seul geste d'une tuile : relire, rejoindre le passage en cours, reprendre, sinon lancer. */
export function plannedGestureOf(item: Automation): PlannedGesture {
  if (item.review) return 'review'
  if (item.live?.kind === 'run' && item.live.conversationId) return 'session'
  if (item.schedule?.enabled === false) return 'resume'
  return 'launch'
}

/* ------------------------------------------------------------------ la Liste (PLF-7) */

export type HealthSection = 'watch' | 'healthy' | 'paused'
export const HEALTH_SECTIONS: readonly HealthSection[] = ['watch', 'healthy', 'paused']

/** À regarder (échecs ou relecture), en pause, sinon en bonne santé. */
export function healthSectionOf(item: Automation): HealthSection {
  if (item.failStreak > 0 || item.review) return 'watch'
  return item.schedule?.enabled === false ? 'paused' : 'healthy'
}

export interface HealthSummary {
  /** Réussis sur jugés, toutes tâches confondues, sur 30 jours ; null sans aucun jugé. */
  rate: number | null
  failing: number
  cost: number
  next: number | null
}

/** Les quatre chiffres de la Liste. */
export function healthSummary(items: readonly Automation[], costOf: (run: UnifiedRun) => number | null, now: number): HealthSummary {
  let judged = 0
  let succeeded = 0
  let cost = 0
  let next: number | null = null
  for (const item of items) {
    const health = healthOf(item, costOf, now)
    judged += health.judged
    succeeded += (health.rate ?? 0) * health.judged
    cost += health.cost30 ?? 0
    const at = item.schedule?.enabled ? item.schedule.nextRunAt : null
    if (at !== null && (next === null || at < next)) next = at
  }
  return {
    rate: judged ? Math.round(succeeded) / judged : null,
    failing: items.filter((item) => item.failStreak > 0).length,
    cost,
    next,
  }
}

/** Le motif sous le nom d'une ligne à regarder ; null pour une tâche en bonne santé. */
export function healthMotive(item: Automation, now: number, t: Translate): string | null {
  if (item.review) return item.review.kind === 'checkScript' ? t('planned.health.reviewScript') : t('automation.state.review', { reason: reviewReason(item.review, t) })
  if (item.failStreak === 0) return null
  const failure = healthOf(item, () => null, now).lastFailure
  const reason = failure?.error ?? (failure?.code != null ? t('planned.health.code', { code: failure.code }) : t('planned.health.seeLastRun'))
  return t(item.failStreak === 1 ? 'planned.health.failStreak.one' : 'planned.health.failStreak.other', { count: item.failStreak, reason })
}

/* ------------------------------------------------------------------ le champ Portée (PLF-10) */

/** La portée où créer une tâche, ou dupliquer celle-ci. */
export function targetOf(scope: PlannedScope): ScheduleTarget {
  return scope.kind === 'project' ? { scope: 'project', projectId: scope.projectId } : { scope: scope.kind }
}

/** La portée d'une action, sans la liste des projets : là où dupliquer une tâche. */
export function targetOfItem(item: Automation): ScheduleTarget {
  if (item.projectId) return { scope: 'project', projectId: item.projectId }
  const scope = item.source.kind === 'task' ? item.source.task.scope : 'none'
  return scope === 'vault' || scope === 'instance' ? { scope } : { scope: 'none' }
}

/** La valeur d'une option du champ Portée : `project:<id>`, `vault`, `instance`, `none`. */
export const targetValue = (target: ScheduleTarget): string => (target.scope === 'project' ? `project:${target.projectId}` : target.scope)

export function targetFromValue(value: string): ScheduleTarget | null {
  if (value.startsWith('project:')) return { scope: 'project', projectId: value.slice('project:'.length) }
  return value === 'vault' || value === 'instance' || value === 'none' ? { scope: value } : null
}

/** Pourquoi une portée est fermée : une commande vit dans un projet ; sans vault, pas de Savoir. */
export type ClosedTarget = 'commandOnly' | 'noVault'

export interface TargetOption {
  value: string
  target: ScheduleTarget
  closed: ClosedTarget | null
}

const byName = (a: ScopeProject, b: ScopeProject) => a.name.localeCompare(b.name)

/**
 * Les portées que propose l'éditeur : les projets par nom, Savoir, Instance
 * (administrateurs), Sans projet. `vault` : un dossier de vault est configuré.
 */
export function editorTargets(
  projects: readonly ScopeProject[],
  { admin, what, vault }: { admin: boolean; what: What; vault: boolean },
): TargetOption[] {
  const outside: ScheduleTarget[] = [{ scope: 'vault' }, ...(admin ? [{ scope: 'instance' } as const] : []), { scope: 'none' }]
  const closed = (target: ScheduleTarget): ClosedTarget | null => {
    if (target.scope === 'project') return null
    if (what === 'command') return 'commandOnly'
    return target.scope === 'vault' && !vault ? 'noVault' : null
  }
  return [
    ...[...projects].sort(byName).map((project) => ({ scope: 'project', projectId: project.id }) as const),
    ...outside,
  ].map((target) => ({ value: targetValue(target), target, closed: closed(target) }))
}

/** La portée proposée d'office : le premier projet, sinon le Savoir s'il existe, sinon sans projet. */
export function defaultTarget(projects: readonly ScopeProject[], { vault }: { vault: boolean }): ScheduleTarget {
  const [first] = [...projects].sort(byName)
  if (first) return { scope: 'project', projectId: first.id }
  return vault ? { scope: 'vault' } : { scope: 'none' }
}

/**
 * La portée qui convient à la nature choisie : une commande quitte le vault, l'instance
 * ou « Sans projet » pour le premier projet. Sans projet du tout, la portée reste, et
 * l'éditeur dit pourquoi il refuse d'enregistrer.
 */
export function fitTarget(target: ScheduleTarget, what: What, projects: readonly ScopeProject[]): ScheduleTarget {
  if (what !== 'command' || target.scope === 'project' || projects.length === 0) return target
  return defaultTarget(projects, { vault: false })
}

/** Le projet d'une portée ; null hors projet. */
export const projectOfTarget = (target: ScheduleTarget): string | null => (target.scope === 'project' ? target.projectId : null)
