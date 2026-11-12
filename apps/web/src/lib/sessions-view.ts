import type { AgentKind, CardColumn, ConversationDto, ConversationStatus, ProjectDto } from '@solera/protocol'

/*
 * La page `/sessions` (#232) : toutes les conversations, de tous les projets et sans
 * projet, cherchées, filtrées, rangées. Tout ce qui se calcule ici est pur — la page ne
 * fait que lire l'adresse, appeler ces fonctions et rendre.
 *
 * **L'adresse est la source** des filtres, de la recherche, de la portée et du tri :
 * la sidebar et la palette ouvrent la page sur un projet ou une recherche par un simple
 * lien, et cliquer ce lien quand on y est déjà change bien la page.
 */

/** L'état qu'on lit d'un coup d'œil, dans l'ordre où il réclame Tim. */
export type SessionState = 'awaiting' | 'error' | 'review' | 'running' | 'done'

export const SESSION_STATES: readonly SessionState[] = ['awaiting', 'error', 'review', 'running', 'done']

const STATE_RANK: Record<SessionState, number> = { awaiting: 0, error: 1, review: 2, running: 3, done: 4 }

/**
 * L'état d'une session : ce que dit son statut vivant, puis sa carte.
 *
 * Une interruption compte comme une erreur, comme pour `threadState` : l'agent a été
 * coupé sans qu'on le lui demande. Une session qui travaille travaille, même si sa
 * carte est déjà passée « à vérifier » : on relira quand elle aura fini.
 */
export function sessionState(input: { status: ConversationStatus; busy: boolean; cardColumn: CardColumn | null }): SessionState {
  if (input.status === 'awaiting_input') return 'awaiting'
  if (input.status === 'error' || input.status === 'interrupted') return 'error'
  if (input.status === 'running' || input.busy) return 'running'
  return input.cardColumn === 'review' ? 'review' : 'done'
}

/** Une ligne de la page. */
export interface SessionRow {
  id: string
  title: string
  agent: AgentKind
  project: ProjectDto | null
  state: SessionState
  /** La branche de son arbre, ou celle de la racine du projet ; `null` quand on ne la sait pas. */
  branch: string | null
  cardNumber: number | null
  pinned: boolean
  archived: boolean
  at: number
  /** Le chemin de son fil. */
  path: string
}

/**
 * Les lignes, une par conversation, **sauf** celles qu'un tir de tâche planifiée a
 * ouvertes : elles ont leur page, et noieraient les autres.
 *
 * `live` porte le statut poussé par le socket, qui prime sur celui de la liste ;
 * `branches` la branche de chaque arbre connu, par identifiant d'arbre.
 */
export function sessionRows(input: {
  conversations: readonly ConversationDto[]
  live: ReadonlyMap<string, { status: ConversationStatus; busy: boolean }>
  projects: ReadonlyMap<string, ProjectDto>
  branches: ReadonlyMap<string, string>
}): SessionRow[] {
  return input.conversations
    .filter((entry) => !entry.scheduleId)
    .map((entry) => {
      const project = entry.projectId ? (input.projects.get(entry.projectId) ?? null) : null
      const live = input.live.get(entry.id)
      return {
        id: entry.id,
        title: entry.title,
        agent: entry.agent,
        project,
        state: sessionState({ status: live?.status ?? entry.status, busy: live?.busy ?? false, cardColumn: entry.card?.column ?? null }),
        branch: entry.worktreeId ? (input.branches.get(entry.worktreeId) ?? null) : (project?.git?.branch ?? null),
        cardNumber: entry.card?.number ?? null,
        pinned: entry.pinned,
        archived: entry.archivedAt !== null,
        at: entry.updatedAt,
        path: entry.projectId ? `/p/${entry.projectId}/c/${entry.id}` : `/c/${entry.id}`,
      }
    })
}

/* ------------------------------------------------------------------ l'adresse */

export type SessionScope = 'actives' | 'archivees'
export type SessionSort = 'recent' | 'attente' | 'nom'
export type SessionPeriod = 'all' | 'day' | 'week' | 'month'

/** `projects` contient des identifiants de projet, et `none` pour les fils sans projet. */
export interface SessionFilters {
  projects: ReadonlySet<string>
  states: ReadonlySet<SessionState>
  agents: ReadonlySet<AgentKind>
  period: SessionPeriod
  pinned: boolean
}

export interface SessionQuery {
  search: string
  scope: SessionScope
  sort: SessionSort
  filters: SessionFilters
}

/** La valeur de `?projet=` pour les fils sans projet. */
export const NO_PROJECT = 'none'

const SORTS: readonly SessionSort[] = ['recent', 'attente', 'nom']
const AGENTS: readonly AgentKind[] = ['claude', 'codex', 'opencode', 'grok']

/** Les mots de l'adresse, en français comme ses clés : `?etat=attend,erreur`. */
const STATE_SLUG: Record<SessionState, string> = { awaiting: 'attend', error: 'erreur', review: 'relire', running: 'travaille', done: 'terminee' }
const PERIOD_SLUG: Record<Exclude<SessionPeriod, 'all'>, string> = { day: 'jour', week: 'semaine', month: 'mois' }

const KEYS = { search: 'q', projects: 'projet', states: 'etat', agents: 'agent', period: 'periode', pinned: 'epinglees', scope: 'portee', sort: 'tri' } as const

function list(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? '').split(',').map((value) => value.trim()).filter(Boolean)
}

function slugged<T extends string>(slugs: Record<T, string>, slug: string | null): T | undefined {
  return (Object.keys(slugs) as T[]).find((key) => slugs[key] === slug)
}

/** Ce que l'adresse demande ; une valeur inconnue est ignorée plutôt que de tout vider. */
export function readSessionQuery(params: URLSearchParams): SessionQuery {
  const states = list(params, KEYS.states).flatMap((slug) => slugged(STATE_SLUG, slug) ?? [])
  const agents = list(params, KEYS.agents).filter((value): value is AgentKind => (AGENTS as readonly string[]).includes(value))
  const sort = params.get(KEYS.sort)
  return {
    search: params.get(KEYS.search) ?? '',
    scope: params.get(KEYS.scope) === 'archivees' ? 'archivees' : 'actives',
    sort: (SORTS as readonly (string | null)[]).includes(sort) ? (sort as SessionSort) : 'recent',
    filters: {
      projects: new Set(list(params, KEYS.projects)),
      states: new Set(states),
      agents: new Set(agents),
      period: slugged(PERIOD_SLUG, params.get(KEYS.period)) ?? 'all',
      pinned: params.get(KEYS.pinned) === '1',
    },
  }
}

/**
 * L'adresse qui dit `query`, à partir de `params` dont les autres clés (`?vue=`) restent.
 * Les valeurs par défaut se taisent : l'adresse nue reste l'adresse de la page.
 */
export function writeSessionQuery(params: URLSearchParams, query: SessionQuery): URLSearchParams {
  const next = new URLSearchParams(params)
  const put = (key: string, value: string | null) => (value ? next.set(key, value) : next.delete(key))
  const { filters } = query
  put(KEYS.search, query.search || null)
  put(KEYS.projects, [...filters.projects].join(','))
  put(KEYS.states, [...filters.states].map((state) => STATE_SLUG[state]).join(','))
  put(KEYS.agents, [...filters.agents].join(','))
  put(KEYS.period, filters.period === 'all' ? null : PERIOD_SLUG[filters.period])
  put(KEYS.pinned, filters.pinned ? '1' : null)
  put(KEYS.scope, query.scope === 'archivees' ? 'archivees' : null)
  put(KEYS.sort, query.sort === 'recent' ? null : query.sort)
  return next
}

/** Le nombre de filtres posés, un par puce. */
export function activeFilterCount(filters: SessionFilters): number {
  return filters.projects.size + filters.states.size + filters.agents.size + (filters.period === 'all' ? 0 : 1) + (filters.pinned ? 1 : 0)
}

export const NO_FILTERS: SessionFilters = { projects: new Set(), states: new Set(), agents: new Set(), period: 'all', pinned: false }

/* ------------------------------------------------------------------ filtrer, trier */

const DAY = 86_400_000

/** Le minuit local du jour de `now`, décalé de `days` jours (heure d'été comprise). */
function midnight(now: number, days = 0): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - days)
  return date.getTime()
}

/** Le début d'une période : aujourd'hui depuis minuit, 7 et 30 jours glissants. */
function periodStart(period: Exclude<SessionPeriod, 'all'>, now: number): number {
  if (period === 'day') return midnight(now)
  return now - (period === 'week' ? 7 : 30) * DAY
}

/** La portée, les filtres et la recherche (titre, projet, branche, `#carte`). */
export function filterSessions(rows: readonly SessionRow[], query: SessionQuery, now: number): SessionRow[] {
  const { filters } = query
  const needle = query.search.trim().toLocaleLowerCase()
  const since = filters.period === 'all' ? null : periodStart(filters.period, now)
  return rows.filter((row) => {
    if (row.archived !== (query.scope === 'archivees')) return false
    if (filters.projects.size > 0 && !filters.projects.has(row.project?.id ?? NO_PROJECT)) return false
    if (filters.states.size > 0 && !filters.states.has(row.state)) return false
    if (filters.agents.size > 0 && !filters.agents.has(row.agent)) return false
    if (since !== null && row.at < since) return false
    if (filters.pinned && !row.pinned) return false
    if (!needle) return true
    return [row.title, row.project?.name ?? '', row.branch ?? '', row.cardNumber === null ? '' : `#${row.cardNumber}`].some((text) =>
      text.toLocaleLowerCase().includes(needle),
    )
  })
}

/**
 * Récentes : les épinglées d'abord, puis la plus récente. Ce qui t'attend : le rang de
 * l'état, puis la date. Nom : l'ordre alphabétique de la langue.
 */
export function sortSessions(rows: readonly SessionRow[], sort: SessionSort): SessionRow[] {
  return [...rows].sort((a, b) =>
    sort === 'nom'
      ? a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      : sort === 'attente'
        ? STATE_RANK[a.state] - STATE_RANK[b.state] || b.at - a.at
        : Number(b.pinned) - Number(a.pinned) || b.at - a.at,
  )
}

/* ------------------------------------------------------------------ regrouper */

export type DayBucket = 'today' | 'yesterday' | 'week' | 'older'

/** La tranche d'un horodatage, aux minuits locaux : la réponse à « que faisais-je ? ». */
export function bucketOf(at: number, now: number): DayBucket {
  if (at >= midnight(now)) return 'today'
  if (at >= midnight(now, 1)) return 'yesterday'
  if (at >= midnight(now, 7)) return 'week'
  return 'older'
}

/**
 * La Liste : triée par Récentes, les épinglées puis une tranche par jour ; sous un autre
 * tri, les tranches datées n'ont plus de sens et la liste est d'un seul tenant.
 * `rows` arrive déjà trié.
 */
export function byDay(rows: readonly SessionRow[], sort: SessionSort, now: number): { key: 'pinned' | DayBucket | 'all'; rows: SessionRow[] }[] {
  if (sort !== 'recent') return [{ key: 'all', rows: [...rows] }]
  const groups: { key: 'pinned' | DayBucket; rows: SessionRow[] }[] = []
  for (const row of rows) {
    const key = row.pinned ? 'pinned' : bucketOf(row.at, now)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.rows.push(row)
    else groups.push({ key, rows: [row] })
  }
  return groups
}

/** Par projet : un groupe par projet, dans l'ordre où ils viennent, les fils libres au bout. */
export function byProject(rows: readonly SessionRow[]): { key: string; project: ProjectDto | null; rows: SessionRow[] }[] {
  const groups = new Map<string, { key: string; project: ProjectDto | null; rows: SessionRow[] }>()
  const loose: SessionRow[] = []
  for (const row of rows) {
    if (!row.project) {
      loose.push(row)
      continue
    }
    const group = groups.get(row.project.id)
    if (group) group.rows.push(row)
    else groups.set(row.project.id, { key: row.project.id, project: row.project, rows: [row] })
  }
  return [...groups.values(), ...(loose.length ? [{ key: NO_PROJECT, project: null, rows: loose }] : [])]
}

export type StateColumn = 'waiting' | 'running' | 'review' | 'done'

const COLUMN_OF: Record<SessionState, StateColumn> = { awaiting: 'waiting', error: 'waiting', running: 'running', review: 'review', done: 'done' }

/** Par état : les quatre colonnes de Travail ; une session en erreur t'attend aussi. */
export function byState(rows: readonly SessionRow[]): { key: StateColumn; rows: SessionRow[] }[] {
  const columns: { key: StateColumn; rows: SessionRow[] }[] = (['waiting', 'running', 'review', 'done'] as const).map((key) => ({ key, rows: [] }))
  for (const row of rows) columns.find((column) => column.key === COLUMN_OF[row.state])!.rows.push(row)
  return columns
}
