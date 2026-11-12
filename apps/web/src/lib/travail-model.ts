import { agentKindSchema, type AgentKind, type CardDto, type JournalEntryDto } from '@solera/protocol'
import type { ActivityFilter, ActivityGroup } from './activity-groups'
import {
  entryInTree,
  inboxInTree,
  isCleanable,
  rowInTree,
  statesOfBranch,
  statesOfRow,
  statesOfTree,
  type BranchInfo,
  type StateKey,
  type TreeRow,
  type TreeScope,
} from './code-model'

/**
 * L'onglet **Travail** d'un projet (`projet.md` T-1 à T-5) : ce que disent ses filtres,
 * sa cible (un arbre ou une branche choisis), et ce que le fil en garde.
 *
 * Pur, comme `code-model.ts` qu'il prolonge : les tests le lisent seul, et la page ne
 * fait qu'y passer ses requêtes. Les vues de Travail (Par arbre, Par moment, Tableau,
 * Graphe, Par état, Frise) lisent toutes les mêmes filtres.
 */

/* ------------------------------------------------------------------ les vues */

/** Les six vues, dans l'ordre de leurs tuiles ; `?vue=` les nomme ainsi. */
export const TRAVAIL_VIEWS = ['couloirs', 'fil', 'tableau', 'graphe', 'etat', 'frise'] as const
export type TravailView = (typeof TRAVAIL_VIEWS)[number]

/* ------------------------------------------------------------------ les filtres */

export const WHAT_KEYS = ['trees', 'branches', 'sessions', 'events'] as const
export type What = (typeof WHAT_KEYS)[number]

export const STATE_KEYS: StateKey[] = ['waiting', 'working', 'review', 'prReady', 'ciRed', 'stale', 'cleanup', 'merged']

/** La période de l'historique ; sans elle, tout ce que le journal a lu. */
export const PERIODS = ['today', '7', '30'] as const
export type Period = (typeof PERIODS)[number]

export interface TravailFilters {
  what: What[]
  states: StateKey[]
  milestones: number[]
  agents: AgentKind[]
  period: Period | null
}

export const NO_FILTERS: TravailFilters = { what: [], states: [], milestones: [], agents: [], period: null }

export type Grouping = 'none' | 'milestone' | 'state'
export type Sorting = 'waiting' | 'recent' | 'size'

/** Les réglages d'« Affichage », hors la vue. */
export interface TravailDisplay {
  index: boolean
  group: Grouping
  sort: Sorting
  showMerged: boolean
  showCleanup: boolean
  showProject: boolean
}

/** Les défauts de T-1.9 : l'index, aucun regroupement, tout montré, ce qui t'attend d'abord. */
export const DEFAULT_DISPLAY: TravailDisplay = { index: true, group: 'none', sort: 'waiting', showMerged: true, showCleanup: true, showProject: true }

function parsed(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const listOf = <T>(value: unknown, keep: (item: unknown) => item is T): T[] => (Array.isArray(value) ? value.filter(keep) : [])
const oneOf = <T extends string>(values: readonly T[]) => (item: unknown): item is T => values.includes(item as T)

/**
 * Les filtres retenus pour un projet, relus du navigateur. Ce qui n'a plus cours (un
 * état retiré, un agent inconnu) est écarté plutôt que de filtrer sur du vide.
 */
export function readFilters(raw: string | null): TravailFilters {
  const value = parsed(raw)
  return {
    what: listOf(value.what, oneOf(WHAT_KEYS)),
    states: listOf(value.states, oneOf(STATE_KEYS)),
    milestones: listOf(value.milestones, (item): item is number => Number.isInteger(item)),
    agents: listOf(value.agents, oneOf(agentKindSchema.options)),
    period: oneOf(PERIODS)(value.period) ? value.period : null,
  }
}

export function readDisplay(raw: string | null): TravailDisplay {
  const value = parsed(raw)
  const flag = (key: keyof TravailDisplay) => (typeof value[key] === 'boolean' ? (value[key] as boolean) : (DEFAULT_DISPLAY[key] as boolean))
  return {
    index: flag('index'),
    group: oneOf<Grouping>(['none', 'milestone', 'state'])(value.group) ? value.group : DEFAULT_DISPLAY.group,
    sort: oneOf<Sorting>(['waiting', 'recent', 'size'])(value.sort) ? value.sort : DEFAULT_DISPLAY.sort,
    showMerged: flag('showMerged'),
    showCleanup: flag('showCleanup'),
    showProject: flag('showProject'),
  }
}

const DAY = 86_400_000

/** Le début de la période : minuit local pour « Aujourd'hui », N jours avant sinon. */
export function periodStart(period: Period | null, now: number): number | null {
  if (period === null) return null
  if (period === 'today') {
    const midnight = new Date(now)
    midnight.setHours(0, 0, 0, 0)
    return midnight.getTime()
  }
  return now - Number(period) * DAY
}

/** Le compte de « Filtrer » : une puce par valeur posée, l'arbre ou la branche choisis compris. */
export function filterCount(filters: TravailFilters, targeted: boolean): number {
  return (
    Number(targeted) +
    filters.what.length +
    filters.states.length +
    filters.milestones.length +
    filters.agents.length +
    Number(filters.period !== null)
  )
}

/* ------------------------------------------------------------------ la cible */

/** L'arbre ou la branche choisis (`?arbre=<clé>`), et ce qui rattache le fil à l'arbre. */
export type TravailTarget = { kind: 'tree'; tree: TreeRow; scope: TreeScope } | { kind: 'branch'; branch: BranchInfo } | null

export function targetOf(key: string | null, trees: TreeRow[], branches: BranchInfo[], scopes: Map<string, TreeScope>): TravailTarget {
  if (!key) return null
  const tree = trees.find((entry) => entry.key === key)
  const scope = tree ? scopes.get(tree.key) : undefined
  if (tree && scope) return { kind: 'tree', tree, scope }
  const branch = branches.find((entry) => entry.key === key)
  return branch ? { kind: 'branch', branch } : null
}

/* ------------------------------------------------------------------ ce que chaque filtre garde */

/** Aucun choix ne garde tout ; sinon il suffit d'un des choix (« ou »). */
const anyIn = <T>(wanted: T[], have: Iterable<T>) => {
  if (wanted.length === 0) return true
  const set = new Set(have)
  return wanted.some((entry) => set.has(entry))
}
const wants = (filters: TravailFilters, what: What) => filters.what.length === 0 || filters.what.includes(what)
const inMilestones = (filters: TravailFilters, number: number | null | undefined) =>
  filters.milestones.length === 0 || (number != null && filters.milestones.includes(number))

export function treePasses(tree: TreeRow, filters: TravailFilters, target: TravailTarget): boolean {
  // La cible l'emporte sur tout : un arbre choisi se montre, quoi que disent les filtres.
  if (target) return target.kind === 'tree' && target.tree.key === tree.key
  if (!wants(filters, 'trees')) return false
  if (!anyIn(filters.states, statesOfTree(tree))) return false
  if (!inMilestones(filters, tree.card?.milestone?.number)) return false
  if (filters.agents.length > 0 && !tree.sessions.some((session) => filters.agents.includes(session.agent))) return false
  return true
}

export function branchPasses(branch: BranchInfo, filters: TravailFilters, target: TravailTarget, now: number): boolean {
  if (target) return target.kind === 'branch' && target.branch.key === branch.key
  if (!wants(filters, 'branches')) return false
  if (!anyIn(filters.states, statesOfBranch(branch, now))) return false
  if (!inMilestones(filters, branch.card?.milestone?.number)) return false
  // Une branche sans arbre n'a pas de session : un filtre d'agent l'écarte.
  return filters.agents.length === 0
}

/** Une session vivante du fil, telle que les filtres la lisent. */
export interface LiveFacts {
  entry: { conversation: { id: string; agent: AgentKind } }
  group: ActivityGroup
  place: { root: boolean; branch: string | null; path: string | null }
}

export function rowPasses(row: LiveFacts, filters: TravailFilters, target: TravailTarget, milestone: number | null): boolean {
  if (target?.kind === 'branch') return false
  if (target?.kind === 'tree' && !rowInTree(row, target.tree, target.scope)) return false
  if (!wants(filters, 'sessions')) return false
  if (!anyIn(filters.states, statesOfRow(row))) return false
  if (!inMilestones(filters, milestone)) return false
  return filters.agents.length === 0 || filters.agents.includes(row.entry.conversation.agent)
}

/** Une demande de « Ce qui t'attend », telle que les filtres la lisent. */
export type InboxFacts =
  | { kind: 'session'; conversationId: string; cardNumber: number | null; agent: AgentKind; milestone: { number: number } | null }
  | { kind: 'refine' | 'draft' | 'merge'; milestone: { number: number } }
  | { kind: 'light' }

/**
 * Une demande est une session qui t'attend : « Sessions » et l'état « T'attend » la
 * gardent. Celles d'un jalon (affinage, découpage, PR finale) ne vivent dans aucun
 * arbre ni chez aucun agent.
 */
export function inboxPasses(item: InboxFacts, filters: TravailFilters, target: TravailTarget): boolean {
  if (!wants(filters, 'sessions')) return false
  if (filters.states.length > 0 && !filters.states.includes('waiting')) return false
  if (target?.kind === 'branch') return false
  const session = item.kind === 'session' ? item : null
  if (target?.kind === 'tree') {
    if (!session || !inboxInTree({ sessionId: session.conversationId, cardNumber: session.cardNumber }, target.scope)) return false
  }
  const milestone = item.kind === 'light' ? null : (item.milestone?.number ?? null)
  if (!inMilestones(filters, milestone)) return false
  return filters.agents.length === 0 || (session !== null && filters.agents.includes(session.agent))
}

/** Ce qu'il faut savoir d'une ligne d'historique pour la filtrer, que la page lit à côté. */
export interface EntryFacts {
  milestone: number | null
  agent: AgentKind | null
  /** L'arbre qui la porte. */
  tree: TreeRow | null
  /** Le début de la période, ou null. */
  from: number | null
}

export function entryPasses(entry: JournalEntryDto, filters: TravailFilters, target: TravailTarget, facts: EntryFacts): boolean {
  if (target?.kind === 'branch' && !entry.title.includes(target.branch.name)) return false
  if (target?.kind === 'tree' && !entryInTree(entry, target.tree, target.scope)) return false
  if (!wants(filters, 'events')) return false
  if (facts.from !== null && entry.at < facts.from) return false
  if (!inMilestones(filters, facts.milestone)) return false
  if (filters.agents.length > 0 && (!facts.agent || !filters.agents.includes(facts.agent))) return false
  // Un événement suit l'état de l'arbre qui le porte ; sans arbre, aucun état ne le garde.
  if (filters.states.length > 0 && (!facts.tree || !anyIn(filters.states, statesOfTree(facts.tree)))) return false
  return true
}

/** La recherche de la barre sur une ligne d'historique : tous les mots, et `#n`. */
export function entryMatches(filter: ActivityFilter, entry: JournalEntryDto): boolean {
  if (filter.cards.length > 0 && !filter.cards.includes(entry.cardNumber ?? -1)) return false
  if (filter.words.length === 0) return true
  const haystack = `${entry.title} ${entry.source ?? ''} ${entry.cardNumber !== null ? `#${entry.cardNumber}` : ''}`.toLocaleLowerCase()
  return filter.words.every((word) => haystack.includes(word))
}

/* ------------------------------------------------------------------ jalons et agents */

export interface MilestoneRef {
  number: number
  title: string
}

/**
 * Le jalon d'une carte, par son numéro : sa parente. Un jalon est une carte de premier
 * niveau qui a des enfants ; une idée de jalon, sans enfant, n'en est pas encore un.
 */
export function cardMilestones(cards: CardDto[]) {
  const byNumber = new Map(cards.map((card) => [card.number, card]))
  return {
    ofCard: (number: number | null): MilestoneRef | null => {
      const parent = number === null ? null : byNumber.get(number)?.parent
      return parent ? { number: parent.number, title: parent.title } : null
    },
    isMilestone: (number: number | null): boolean => {
      const card = number === null ? undefined : byNumber.get(number)
      return Boolean(card && card.parent === null && card.children.length > 0)
    },
  }
}

export interface MilestoneOption extends MilestoneRef {
  /** L'avancement de ses enfants, quand la carte est connue. */
  progress: { done: number; total: number } | null
}

/**
 * Les jalons qu'offre « Filtrer » : ceux des arbres et des branches, puis les jalons
 * ouverts du projet, par ordre d'arrivée.
 */
export function milestoneOptions(trees: TreeRow[], branches: BranchInfo[], cards: CardDto[]): MilestoneOption[] {
  const seen = new Map<number, string>()
  for (const tree of trees) if (tree.card?.milestone) seen.set(tree.card.milestone.number, tree.card.milestone.title)
  for (const branch of branches) if (branch.card?.milestone) seen.set(branch.card.milestone.number, branch.card.milestone.title)
  const open = (card: CardDto) => card.column !== 'done' && card.column !== 'abandoned'
  for (const card of cards) if (card.parent === null && card.children.length > 0 && open(card) && !seen.has(card.number)) seen.set(card.number, card.title)
  const byNumber = new Map(cards.map((card) => [card.number, card]))
  const columnOf = new Map(cards.map((card) => [card.id, card.column]))
  return [...seen].map(([number, title]) => {
    const card = byNumber.get(number)
    const progress = card
      ? { done: card.children.filter((child) => columnOf.get(child.id) === 'done').length, total: card.children.length }
      : null
    return { number, title, progress }
  })
}

/** Les agents qu'offre « Filtrer » : ceux qui travaillent dans un arbre ou dans le fil. */
export function agentOptions(trees: TreeRow[], rows: LiveFacts[]): AgentKind[] {
  const seen = new Set<AgentKind>()
  for (const tree of trees) for (const session of tree.sessions) seen.add(session.agent)
  for (const row of rows) seen.add(row.entry.conversation.agent)
  return [...seen]
}

/* ------------------------------------------------------------------ T-5.5 le regroupement */

/** Trois heures : au-delà, deux lignes d'une même carte racontent deux moments. */
export const CLUSTER_GAP_MS = 3 * 3_600_000

export interface Cluster {
  key: string
  /** Ce qui les réunit : une carte, ou une session (nommée par sa source). */
  subject: { kind: 'card'; number: number } | { kind: 'session'; source: string | null } | null
  entries: JournalEntryDto[]
}

/**
 * Les événements consécutifs d'une même session ou d'une même carte, à moins de trois
 * heures l'un de l'autre, se replient ensemble. On ne regroupe que des voisins : l'ordre
 * du fil ne bouge pas.
 */
export function clustersOf(entries: JournalEntryDto[], gap = CLUSTER_GAP_MS): Cluster[] {
  const out: Cluster[] = []
  let lastSubject: string | null = null
  for (const entry of entries) {
    const subject = entry.conversationId ? `s:${entry.conversationId}` : entry.cardNumber !== null ? `c:${entry.cardNumber}` : null
    const last = out[out.length - 1]
    const tail = last?.entries[last.entries.length - 1]
    if (subject && last && subject === lastSubject && tail && Math.abs(tail.at - entry.at) <= gap) {
      last.entries.push(entry)
      continue
    }
    lastSubject = subject
    out.push({
      key: `${subject ?? 'x'}|${entry.id}`,
      subject: entry.cardNumber !== null ? { kind: 'card', number: entry.cardNumber } : subject ? { kind: 'session', source: entry.source } : null,
      entries: [entry],
    })
  }
  return out
}

/* ------------------------------------------------------------------ T-3 l'index */

/**
 * Les arbres de l'index : les actifs, ce qui t'attend d'abord, puis le plus récent — un
 * arbre où une session vit l'est maintenant ; ceux à nettoyer (ou introuvables) à la
 * suite, seulement quand un filtre les réclame. À égalité, l'ordre reçu (`sortTrees`).
 */
export function indexTrees(trees: TreeRow[], withCleanup: boolean): TreeRow[] {
  const done = (tree: TreeRow) => isCleanable(tree) || tree.verdict === 'missing'
  const waiting = (tree: TreeRow) => Number(tree.verdict === 'waiting')
  const recency = (tree: TreeRow) => (tree.sessions.length > 0 ? Number.POSITIVE_INFINITY : (tree.lastUsedAt ?? 0))
  const active = trees
    .filter((tree) => !done(tree))
    .sort((a, b) => waiting(b) - waiting(a) || (recency(b) === recency(a) ? 0 : recency(b) > recency(a) ? 1 : -1))
  return withCleanup ? [...active, ...trees.filter(done)] : active
}

/* ------------------------------------------------------------------ T-1.4 le bilan */

/**
 * « N arbres · X Go » : les worktrees, sans la racine, et la place de tout le projet. La
 * taille ne se dit qu'une fois tout mesuré : une somme partielle mentirait.
 */
export function treeSummary(trees: TreeRow[]): { count: number; bytes: number | null } {
  const count = trees.filter((tree) => !tree.root).length
  if (trees.length === 0 || trees.some((tree) => tree.sizeBytes === null)) return { count, bytes: null }
  return { count, bytes: trees.reduce((sum, tree) => sum + (tree.sizeBytes ?? 0), 0) }
}

/* ------------------------------------------------------------------ les anciennes adresses */

/**
 * La requête de Travail pour une ancienne adresse : l'Activité groupée par worktree
 * devient « Par arbre », le Journal « Par moment ». Le reste de la requête suit.
 */
export function legacyTravailQuery(from: 'activity' | 'journal', search: string): string {
  const params = new URLSearchParams(search)
  if (from === 'activity') {
    const byTree = params.get('groupe') === 'worktree'
    params.delete('groupe')
    if (byTree) params.set('vue', 'couloirs')
  } else {
    params.set('vue', 'fil')
  }
  return params.toString()
}

/* ------------------------------------------------------------------ l'arrivée filtrée */

/** Le paramètre d'une arrivée filtrée sur un état : `?etat=cleanup`. */
export const STATE_PARAM = 'etat'

/**
 * L'adresse de Travail, Par arbre, filtré sur un état : ce que l'Aperçu ouvre pour « + N
 * arbres fusionnés à nettoyer » (A-4.6).
 */
export function travailStateHref(projectId: string, state: StateKey): string {
  return `/p/${projectId}/travail?vue=couloirs&${STATE_PARAM}=${state}`
}

/**
 * Les filtres qu'impose une arrivée par `?etat=` : cet état seul. Les filtres retenus
 * sont levés, sans quoi un jalon ou un agent choisi la veille cacherait ce qu'on vient
 * voir. Null si l'adresse n'en demande pas, ou un état qui n'existe pas.
 */
export function arrivalFilters(state: string | null): TravailFilters | null {
  if (!state || !oneOf(STATE_KEYS)(state)) return null
  return { ...NO_FILTERS, states: [state] }
}
