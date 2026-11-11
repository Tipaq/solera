/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Travail `une-ligne` : le principe validé sur le Tableau (`OneLineBoard`) appliqué à
 * Travail. Une seule ligne d'outils — recherche, « Filtrer ▾ » (tout dans un popover, les
 * filtres actifs en puces sur la même ligne), le bilan des arbres, « Affichage ▾ » (la vue
 * en tuiles, l'index, le regroupement, ce qu'on montre, le tri), « + Session » au bout.
 * Plus de bascule en haut de page, plus de seconde rangée : choisir un arbre ou une
 * branche précise est un filtre comme un autre (« Arbre : feat/… ✕ »).
 *
 * Les trois vues réutilisent ce qui existe : les couloirs de `Couloirs`/`Hybride`, le fil
 * de l'Activité (`FilBody`, sans sa barre), le tableau des arbres de Code (`TreeLine`).
 */
import { Activity, ChartGantt, ChevronRight, Columns3, Filter, FolderGit2, GitBranch, GitFork, Layers, Plus, Rows3, Table2, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { AgentKind, JournalEntryDto, ProjectDto } from '@solera/protocol'
import { Button, Popover, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { AskInbox, inboxMilestoneNumber, type InboxItem } from '../../components/prototype/AskInbox'
import {
  FilterChip,
  MenuCheck,
  MenuHeading,
  MenuSegment,
  OneLineToolbar,
  ToolbarSearch,
  ViewTiles,
  toolbarButtonClass,
  useView,
  type ViewOption,
} from '../../components/prototype/ViewSwitch'
import type { ActivityRow } from '../../lib/activity-rows'
import { useCards } from '../../lib/cards'
import { elapsed } from '../../lib/dates'
import { FilBody } from '../prototype-activity/FilActivity'
import { GRID, SimTag, TreeLine, VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import { formatBytes, isCleanable, STALE_DAYS, type TreeRow } from '../prototype-code/data'
import { DemoToggle } from '../prototype-milestones/HorizonVariant'
import { DAY } from '../prototype-milestones/model'
import { Lane, ProjectLane, useLanes, type LaneData } from './Couloirs'
import { BRANCH_TONE, BaseCard, BranchLane, IndexBranch, MergedBranches, isInteresting, useBranchInfos, type BranchInfo } from './branches'
import { PR_LABEL } from '../prototype-code/ProjectCodePage'
import { ProjectGitGraph } from './GitGraph'
import { StateBoard, Timeline } from './UneLigneViews'
import { TravailActionsContext, TreeChip, entryInTree, inboxInTree, rowInTree, shortBranch, useModelWith, useTravail, useTravailActions, type Travail, type TravailActions } from './shared'
import { CleanAllDialog, TreeDrawer, type CleanRequest } from './TravailPanels'

/* ------------------------------------------------------------------ les réglages */

type View = 'couloirs' | 'fil' | 'tableau' | 'graphe' | 'etat' | 'frise'
const VIEWS: ViewOption<View>[] = [
  { key: 'couloirs', label: 'Par arbre', icon: <Rows3 size={16} /> },
  { key: 'fil', label: 'Par moment', icon: <Activity size={16} /> },
  { key: 'tableau', label: 'Tableau', icon: <Table2 size={16} /> },
  { key: 'graphe', label: 'Graphe', icon: <GitFork size={16} /> },
  { key: 'etat', label: 'Par état', icon: <Columns3 size={16} /> },
  { key: 'frise', label: 'Frise', icon: <ChartGantt size={16} /> },
]
/** Les vues où l'index d'arbres a un sens, et celles où regrouper et trier en ont un. */
const WITH_INDEX: View[] = ['couloirs', 'fil']
const WITH_GROUPS: View[] = ['couloirs', 'tableau']
const VIEW_KEYS = VIEWS.map((view) => view.key)

type What = 'trees' | 'branches' | 'sessions' | 'events'
const WHAT_WORD: Record<What, string> = { trees: 'Worktrees', branches: 'Branches sans arbre', sessions: 'Sessions', events: 'Événements du projet' }

type StateKey = 'waiting' | 'working' | 'review' | 'prReady' | 'ciRed' | 'stale' | 'cleanup' | 'merged'
const STATE_WORD: Record<StateKey, string> = {
  waiting: 'T’attend',
  working: 'Travaille',
  review: 'À relire',
  prReady: 'PR prête',
  ciRed: 'CI rouge ou conflit',
  stale: 'Abandonné ?',
  cleanup: 'À nettoyer',
  merged: 'Fusionné',
}
const STATE_KEYS = Object.keys(STATE_WORD) as StateKey[]

type Period = 'today' | '7' | '30'
const PERIOD_WORD: Record<Period, string> = { today: 'Aujourd’hui', '7': '7 jours', '30': '30 jours' }

interface Filters {
  what: What[]
  states: StateKey[]
  milestones: number[]
  agents: AgentKind[]
  period: Period | null
}
const NO_FILTERS: Filters = { what: [], states: [], milestones: [], agents: [], period: null }

type Group = 'none' | 'milestone' | 'state'
type Sort = 'waiting' | 'recent' | 'size'
interface Display {
  index: boolean
  group: Group
  showMerged: boolean
  showCleanup: boolean
  showProject: boolean
  sort: Sort
}
const DEFAULT_DISPLAY: Display = { index: true, group: 'none', showMerged: true, showCleanup: true, showProject: true, sort: 'waiting' }

const AGENT_WORD: Record<string, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok', opencode: 'OpenCode' }

/** Réglage retenu par projet, dans le navigateur. */
function useStored<T extends object>(key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return { ...fallback, ...(JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<T>) }
    } catch {
      return fallback
    }
  })
  return [
    value,
    (next) => {
      localStorage.setItem(key, JSON.stringify(next))
      setValue(next)
    },
  ]
}

/* ------------------------------------------------------------------ ce que dit chaque filtre */

function statesOfTree(tree: TreeRow): Set<StateKey> {
  const out = new Set<StateKey>()
  if (tree.verdict === 'waiting') out.add('waiting')
  if (tree.verdict === 'active') out.add('working')
  if (tree.verdict === 'review') out.add('review')
  if (tree.pr?.state === 'ready') out.add('prReady')
  if (tree.pr?.state === 'failing' || tree.conflicts) out.add('ciRed')
  if (tree.verdict === 'stale') out.add('stale')
  if (isCleanable(tree) || tree.verdict === 'missing') out.add('cleanup')
  if (tree.state === 'merged' || tree.pr?.state === 'merged' || tree.verdict === 'merged-dirty') out.add('merged')
  return out
}

function statesOfBranch(branch: BranchInfo, now: number): Set<StateKey> {
  const out = new Set<StateKey>()
  if (branch.pr?.state === 'ready') out.add('prReady')
  if (branch.pr?.state === 'failing') out.add('ciRed')
  if (branch.kind === 'unmerged' && now - branch.lastCommitAt > STALE_DAYS * DAY) out.add('stale')
  if (branch.kind === 'merged') {
    out.add('cleanup')
    out.add('merged')
  }
  return out
}

function statesOfRow(row: ActivityRow): Set<StateKey> {
  const out = new Set<StateKey>()
  if (row.group === 'asking') out.add('waiting')
  if (row.group === 'running') out.add('working')
  if (row.group === 'review') out.add('review')
  return out
}

const anyIn = <T,>(wanted: T[], have: Set<T>) => wanted.length === 0 || wanted.some((entry) => have.has(entry))
const wants = (filters: Filters, what: What) => filters.what.length === 0 || filters.what.includes(what)

/* ------------------------------------------------------------------ la page */

export function UneLigne({ projectId, project }: { projectId: string; project: ProjectDto }) {
  const travail = useTravail(projectId, project)
  const { model, code, overview, scopes, conversations } = travail
  const branchInfos = useBranchInfos(projectId, project, code)
  const { data: cards } = useCards(projectId)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [view, setView] = useView<View>('travail', projectId, VIEW_KEYS)
  const [display, setDisplay] = useStored<Display>(`proto-travail-affichage:${projectId}`, DEFAULT_DISPLAY)
  const [filters, setFiltersStored] = useStored<Filters>(`proto-travail-filtres:${projectId}`, NO_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [displayOpen, setDisplayOpen] = useState(false)
  const [sessionOpen, setSessionOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [cleanRequest, setCleanRequest] = useState<CleanRequest | null>(null)
  const [openTreeKey, setOpenTreeKey] = useState<string | null>(null)
  /** En démo, ce qu'on a « nettoyé » disparaît de la vue : clés d'arbres et noms de branches. */
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set())

  const set = (patch: Partial<Filters>) => setFiltersStored({ ...filters, ...patch })
  const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  const simulate = (text: string) => {
    setNotice(`Simulé : ${text}`)
    window.setTimeout(() => setNotice((current) => (current === `Simulé : ${text}` ? null : current)), 5_000)
  }
  const actions: TravailActions = {
    simulate,
    cleanTrees: (trees) => setCleanRequest({ trees, branches: [] }),
    cleanBranches: (names) => setCleanRequest({ trees: [], branches: names }),
    openTree: setOpenTreeKey,
  }

  /* La cible : un arbre ou une branche précise, portée par l'adresse. */
  const targetKey = params.get('arbre')
  const targetTree = code.trees.find((tree) => tree.key === targetKey) ?? null
  const targetBranch = branchInfos.find((branch) => branch.key === targetKey) ?? null
  const setTarget = (key: string | null) =>
    setParams((current) => {
      if (key) current.set('arbre', key)
      else current.delete('arbre')
      return current
    }, { replace: true })

  /* ---------------------------------------------------------------- le filtrage */

  const now = Date.now()
  const periodFrom = filters.period === 'today' ? new Date().setHours(0, 0, 0, 0) : filters.period ? now - Number(filters.period) * DAY : null

  const treePasses = (tree: TreeRow) => {
    if (removed.has(tree.key)) return false
    if (targetBranch) return false
    if (targetTree) return tree.key === targetTree.key
    if (!wants(filters, 'trees')) return false
    if (!anyIn(filters.states, statesOfTree(tree))) return false
    if (filters.milestones.length > 0 && !filters.milestones.includes(tree.card?.milestone?.number ?? -1)) return false
    if (filters.agents.length > 0 && !tree.sessions.some((session) => filters.agents.includes(session.agent))) return false
    return true
  }
  const branchPasses = (branch: BranchInfo) => {
    if (removed.has(branch.name)) return false
    if (targetTree) return false
    if (targetBranch) return branch.key === targetBranch.key
    if (!wants(filters, 'branches')) return false
    if (!anyIn(filters.states, statesOfBranch(branch, now))) return false
    if (filters.milestones.length > 0 && !filters.milestones.includes(branch.card?.milestone?.number ?? branch.card?.number ?? -1)) return false
    // Une branche sans arbre n'a pas de session : un filtre d'agent l'écarte.
    if (filters.agents.length > 0) return false
    return true
  }

  const shownTrees = useMemo(() => code.trees.filter(treePasses), [code.trees, filters, targetKey, targetBranch, targetTree, removed]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownBranches = useMemo(() => branchInfos.filter(branchPasses), [branchInfos, filters, targetKey, targetTree, targetBranch, removed]) // eslint-disable-line react-hooks/exhaustive-deps

  const targetScope = targetTree ? scopes.get(targetTree.key) ?? null : null

  const live = useMemo(
    () =>
      model.live.filter((row) => {
        if (targetBranch) return false
        if (targetTree && targetScope && !rowInTree(row, targetTree, targetScope)) return false
        if (!wants(filters, 'sessions')) return false
        if (!anyIn(filters.states, statesOfRow(row))) return false
        if (filters.milestones.length > 0 && !filters.milestones.includes(model.milestoneOfRow(row)?.number ?? -1)) return false
        if (filters.agents.length > 0 && !filters.agents.includes(row.entry.conversation.agent)) return false
        return true
      }),
    [model, filters, targetTree, targetScope, targetBranch],
  )

  const entries = useMemo(
    () =>
      model.entries.filter((entry) => {
        if (targetBranch && !entry.title.includes(targetBranch.name)) return false
        if (targetTree && targetScope && !entryInTree(entry, targetTree, targetScope)) return false
        if (!wants(filters, 'events')) return false
        if (periodFrom !== null && entry.at < periodFrom) return false
        if (filters.milestones.length > 0 && !filters.milestones.includes(model.milestoneOfEntry(entry)?.number ?? -1)) return false
        if (filters.agents.length > 0) {
          const agent = model.conversationOf(entry)?.agent ?? (entry.source as AgentKind | null)
          if (!agent || !filters.agents.includes(agent)) return false
        }
        if (filters.states.length > 0) {
          // Un événement suit l'état de l'arbre qui le porte ; sans arbre, il ne répond à aucun état.
          const tree = travail.treeOfEntry(entry)
          if (!tree || !anyIn(filters.states, statesOfTree(tree))) return false
        }
        return true
      }),
    [model, filters, targetTree, targetScope, targetBranch, periodFrom], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const filteredModel = useModelWith(model, live, entries, false, !targetTree && !targetBranch)
  const filteredTravail: Travail = useMemo(
    () => ({ ...travail, model: filteredModel, code: { ...code, trees: shownTrees } }),
    [travail, filteredModel, code, shownTrees],
  )
  const lanes = useLanes(filteredTravail)

  const inbox = useMemo<InboxItem[]>(() => {
    if (!wants(filters, 'sessions')) return []
    if (filters.states.length > 0 && !filters.states.includes('waiting')) return []
    if (targetBranch) return []
    return overview.inbox.filter((item) => {
      if (targetScope && !inboxInTree(item, targetScope)) return false
      if (filters.milestones.length > 0 && !filters.milestones.includes(inboxMilestoneNumber(item) ?? -1)) return false
      if (filters.agents.length > 0 && !(item.kind === 'session' && filters.agents.includes(item.agent))) return false
      return true
    })
  }, [overview.inbox, filters, targetScope, targetBranch])

  /* ---------------------------------------------------------------- tri et regroupement */

  const recency = (lane: LaneData) => Math.max(lane.tree.lastUsedAt ?? 0, lane.entries[0]?.at ?? 0, lane.live.length > 0 ? now : 0)
  const sortLanes = (list: LaneData[]) =>
    display.sort === 'size'
      ? [...list].sort((a, b) => b.tree.sizeBytes - a.tree.sizeBytes)
      : display.sort === 'recent'
        ? [...list].sort((a, b) => recency(b) - recency(a))
        : list // l'ordre de `useLanes` : ce qui t'attend d'abord, puis le plus récent
  const liveBranches = shownBranches.filter(isInteresting)
  const mergedBranches = shownBranches.filter((branch) => !isInteresting(branch))
  const sortedBranches = display.sort === 'waiting' ? liveBranches : [...liveBranches].sort((a, b) => b.lastCommitAt - a.lastCommitAt)
  const activeLanes = sortLanes(lanes.active)
  const cleanupLanes = sortLanes(lanes.cleanup)
  const forceCleanup = filters.states.includes('cleanup') || filters.states.includes('merged')
  const showCleanup = (display.showCleanup || forceCleanup) && cleanupLanes.length > 0
  const showMerged = (display.showMerged || forceCleanup) && mergedBranches.length > 0
  const showProject = display.showProject && !targetTree && !targetBranch && lanes.loose.length > 0

  type Item = { kind: 'tree'; lane: LaneData } | { kind: 'branch'; branch: BranchInfo }
  const groupOf = (item: Item): string => {
    const card = item.kind === 'tree' ? item.lane.tree.card : item.branch.card
    if (display.group === 'milestone') {
      const milestone = card?.milestone
      return milestone ? `Jalon #${milestone.number} · ${milestone.title}` : 'Sans jalon'
    }
    if (display.group === 'state') return item.kind === 'tree' ? VERDICT_TONE[item.lane.tree.verdict].label : `Branche · ${BRANCH_TONE[item.branch.kind].label}`
    return ''
  }
  const items: Item[] = [...activeLanes.map((lane) => ({ kind: 'tree' as const, lane })), ...sortedBranches.map((branch) => ({ kind: 'branch' as const, branch }))]
  const groups = useMemo(() => {
    if (display.group === 'none') return null
    const map = new Map<string, Item[]>()
    for (const item of items) {
      const key = groupOf(item)
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return [...map.entries()].sort(([a], [b]) => Number(a === 'Sans jalon') - Number(b === 'Sans jalon'))
  }, [items, display.group]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------------------------------------------------------- la barre */

  const milestoneList = useMemo(() => {
    const seen = new Map<number, string>()
    for (const tree of code.trees) if (tree.card?.milestone) seen.set(tree.card.milestone.number, tree.card.milestone.title)
    for (const branch of branchInfos) if (branch.card?.milestone) seen.set(branch.card.milestone.number, branch.card.milestone.title)
    for (const card of cards ?? []) if (card.parent === null && card.children.length > 0 && card.column !== 'done' && card.column !== 'abandoned') seen.set(card.number, card.title)
    return [...seen.entries()].map(([number, title]) => {
      const card = (cards ?? []).find((entry) => entry.number === number)
      const progress = card ? `${card.children.filter((child) => child.column === 'done').length}/${card.children.length}` : null
      return { number, title, progress }
    })
  }, [code.trees, branchInfos, cards])

  const agentList = useMemo(() => {
    const seen = new Set<AgentKind>()
    for (const tree of code.trees) for (const session of tree.sessions) seen.add(session.agent)
    for (const row of model.live) seen.add(row.entry.conversation.agent)
    return [...seen]
  }, [code.trees, model.live])

  const chips = [
    targetTree ? (
      <FilterChip key="t" title={targetTree.path} onClear={() => setTarget(null)}>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cx('size-1.5 rounded-full', VERDICT_TONE[targetTree.verdict].dot)} />
          Arbre : <span className="font-mono">{shortBranch(targetTree)}</span>
        </span>
      </FilterChip>
    ) : null,
    targetBranch ? (
      <FilterChip key="b" onClear={() => setTarget(null)}>
        Branche : <span className="font-mono">{targetBranch.name}</span>
      </FilterChip>
    ) : null,
    ...filters.what.map((what) => <FilterChip key={`w-${what}`} onClear={() => set({ what: filters.what.filter((item) => item !== what) })}>{WHAT_WORD[what]}</FilterChip>),
    ...filters.states.map((state) => <FilterChip key={`s-${state}`} onClear={() => set({ states: filters.states.filter((item) => item !== state) })}>{STATE_WORD[state]}</FilterChip>),
    ...filters.milestones.map((number) => (
      <FilterChip key={`m-${number}`} onClear={() => set({ milestones: filters.milestones.filter((item) => item !== number) })}>Jalon #{number}</FilterChip>
    )),
    ...filters.agents.map((agent) => <FilterChip key={`a-${agent}`} onClear={() => set({ agents: filters.agents.filter((item) => item !== agent) })}>{AGENT_WORD[agent] ?? agent}</FilterChip>),
    filters.period ? <FilterChip key="p" onClear={() => set({ period: null })}>{PERIOD_WORD[filters.period]}</FilterChip> : null,
  ].filter(Boolean)
  const activeCount = chips.length

  const filterMenu = (
    <Popover
      open={filterOpen}
      onOpenChange={setFilterOpen}
      label="Filtrer"
      side="bottom"
      align="start"
      className="w-80"
      trigger={
        <button type="button" className={toolbarButtonClass(activeCount > 0)}>
          <Filter size={13} /> Filtrer
          {activeCount > 0 ? <span className="rounded bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink">{activeCount}</span> : null}
        </button>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto pb-2">
        <MenuHeading>Quoi</MenuHeading>
        {(Object.keys(WHAT_WORD) as What[]).map((what) => (
          <MenuCheck key={what} checked={filters.what.includes(what)} onChange={() => set({ what: toggleIn(filters.what, what) })}>
            {WHAT_WORD[what]}
          </MenuCheck>
        ))}

        <MenuHeading>État</MenuHeading>
        {STATE_KEYS.map((state) => (
          <MenuCheck key={state} checked={filters.states.includes(state)} onChange={() => set({ states: toggleIn(filters.states, state) })}>
            {STATE_WORD[state]}
          </MenuCheck>
        ))}

        {milestoneList.length > 0 ? (
          <>
            <MenuHeading>Jalon</MenuHeading>
            {milestoneList.map((milestone) => (
              <MenuCheck
                key={milestone.number}
                checked={filters.milestones.includes(milestone.number)}
                onChange={() => set({ milestones: toggleIn(filters.milestones, milestone.number) })}
                aside={milestone.progress}
              >
                <span className="inline-flex min-w-0 items-center gap-1.5" title={milestone.title}>
                  <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{milestone.number}</span>
                  <span className="truncate">{milestone.title}</span>
                </span>
              </MenuCheck>
            ))}
          </>
        ) : null}

        {agentList.length > 0 ? (
          <>
            <MenuHeading>Agent</MenuHeading>
            {agentList.map((agent) => (
              <MenuCheck key={agent} checked={filters.agents.includes(agent)} onChange={() => set({ agents: toggleIn(filters.agents, agent) })}>
                <span className="inline-flex items-center gap-1.5"><AgentIcon agent={agent} size={13} /> {AGENT_WORD[agent] ?? agent}</span>
              </MenuCheck>
            ))}
          </>
        ) : null}

        <MenuHeading>Période de l’historique</MenuHeading>
        <MenuSegment<Period | 'all'>
          options={[{ key: 'all', label: 'Tout' }, { key: 'today', label: 'Aujourd’hui' }, { key: '7', label: '7 j' }, { key: '30', label: '30 j' }]}
          value={filters.period ?? 'all'}
          onChange={(next) => set({ period: next === 'all' ? null : next })}
        />

        {activeCount > 0 ? (
          <div className="mt-2 border-t border-line px-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setFiltersStored(NO_FILTERS)
                setTarget(null)
              }}
              className="text-xs text-ink-faint hover:text-ink"
            >
              Effacer tous les filtres
            </button>
          </div>
        ) : null}
      </div>
    </Popover>
  )

  const current = VIEWS.find((option) => option.key === view)!
  const displayMenu = (
    <Popover
      open={displayOpen}
      onOpenChange={setDisplayOpen}
      label="Affichage"
      side="bottom"
      align="end"
      className="w-80"
      trigger={
        <button type="button" className={toolbarButtonClass(false)} title={`Affichage : ${current.label}`}>
          {current.icon} <span className="hidden sm:inline">Affichage</span>
        </button>
      }
    >
      <div className="pb-3">
        {/* Six vues : deux rangées de trois tuiles, pour qu'elles restent lisibles. */}
        <ViewTiles options={VIEWS.slice(0, 3)} value={view} onChange={setView} />
        <div className="-mt-2">
          <ViewTiles options={VIEWS.slice(3)} value={view} onChange={setView} />
        </div>
        {WITH_INDEX.includes(view) ? (
          <MenuCheck checked={display.index} onChange={(next) => setDisplay({ ...display, index: next })}>
            Index des arbres à gauche <span className="text-xs text-ink-faint">{view === 'fil' ? '(filtre)' : '(défile)'}</span>
          </MenuCheck>
        ) : null}
        {WITH_GROUPS.includes(view) ? (
          <>
            <MenuHeading>Regrouper</MenuHeading>
            <MenuSegment<Group>
              options={[{ key: 'none', label: 'Aucun' }, { key: 'milestone', label: 'Par jalon' }, { key: 'state', label: 'Par état' }]}
              value={display.group}
              onChange={(next) => setDisplay({ ...display, group: next })}
            />
            <MenuHeading>Trier</MenuHeading>
            <MenuSegment<Sort>
              options={[{ key: 'waiting', label: 'Ce qui t’attend' }, { key: 'recent', label: 'Récent' }, { key: 'size', label: 'Taille' }]}
              value={display.sort}
              onChange={(next) => setDisplay({ ...display, sort: next })}
            />
          </>
        ) : null}
        <MenuHeading>Montrer</MenuHeading>
        <MenuCheck checked={display.showCleanup} onChange={(next) => setDisplay({ ...display, showCleanup: next })}>Arbres à nettoyer</MenuCheck>
        <MenuCheck checked={display.showMerged} onChange={(next) => setDisplay({ ...display, showMerged: next })}>Branches fusionnées</MenuCheck>
        {view === 'couloirs' ? (
          <MenuCheck checked={display.showProject} onChange={(next) => setDisplay({ ...display, showProject: next })}>Couloir « Projet »</MenuCheck>
        ) : null}
      </div>
    </Popover>
  )

  /* Le bilan : un texte méta neutre, qui ne se clique pas. */
  const liveTrees = code.trees.filter((tree) => !removed.has(tree.key))
  const worktreeCount = liveTrees.filter((tree) => !tree.root).length
  const totalSize = liveTrees.reduce((sum, tree) => sum + tree.sizeBytes, 0)
  const cleanable = liveTrees.filter(isCleanable)
  const mergedBranchNames = branchInfos.filter((branch) => branch.kind === 'merged' && !removed.has(branch.name)).map((branch) => branch.name)
  const summary = (
    <span className="hidden shrink-0 items-center gap-1.5 px-1 text-xs text-ink-faint tabular-nums xl:inline-flex">
      {worktreeCount} arbre{worktreeCount > 1 ? 's' : ''}
      <span aria-hidden>·</span>
      {formatBytes(totalSize)}
    </span>
  )

  /* Un seul geste de nettoyage : il ouvre le dialogue qui réunit les arbres fusionnés et
     les branches fusionnées. Neutre : il ne se signale que par son compte. */
  const cleanCount = cleanable.length || mergedBranchNames.length
  const cleanButton =
    cleanable.length > 0 || mergedBranchNames.length > 0 ? (
      <button
        type="button"
        onClick={() => setCleanRequest({ trees: cleanable, branches: mergedBranchNames })}
        className={toolbarButtonClass(false)}
        title="Voir ce qui part, puis confirmer"
      >
        <Trash2 size={13} /> Nettoyer · <span className="tabular-nums">{cleanCount}</span>
      </button>
    ) : null

  const sessionMenu = (
    <Popover
      open={sessionOpen}
      onOpenChange={setSessionOpen}
      label="Nouvelle session"
      side="bottom"
      align="end"
      className="w-72"
      trigger={
        <Button size="sm" icon={<Plus size={15} />}>
          Session
        </Button>
      }
    >
      <div className="py-2">
        <MenuHeading>Où travailler</MenuHeading>
        {code.trees
          .filter((tree) => tree.root || (tree.id !== null && !isCleanable(tree) && tree.verdict !== 'missing'))
          .map((tree) => (
            <button
              key={tree.key}
              type="button"
              onClick={() => {
                setSessionOpen(false)
                if (code.demo) return simulate(`une session s’ouvrirait dans ${tree.branch ?? tree.name}.`)
                navigate(tree.root || !tree.id ? `/p/${projectId}/c/new` : `/p/${projectId}/c/new?worktree=${tree.id}`)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-high"
            >
              {tree.root ? <FolderGit2 size={13} className="shrink-0 text-ink-faint" /> : <GitBranch size={13} className="shrink-0 text-ink-faint" />}
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{tree.root ? `${tree.branch ?? tree.name} (racine)` : shortBranch(tree)}</span>
              <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', VERDICT_TONE[tree.verdict].dot)} />
            </button>
          ))}
        <button
          type="button"
          onClick={() => {
            setSessionOpen(false)
            if (code.demo) return simulate('une session s’ouvrirait dans un nouveau worktree.')
            navigate(`/p/${projectId}/c/new`)
          }}
          className="mt-1 flex w-full items-center gap-2 border-t border-line px-3 pt-2 pb-1 text-left text-sm text-ink-soft hover:text-ink"
        >
          <Plus size={13} /> Nouveau worktree…
        </button>
      </div>
    </Popover>
  )

  /* ---------------------------------------------------------------- le rendu */

  if (model.isPending) return null
  const hasTrees = Boolean(project.git || code.demo)
  const nothing = items.length === 0 && !showProject && !showCleanup && !showMerged && inbox.length === 0
  const index = hasTrees && display.index && WITH_INDEX.includes(view)

  const choose = (key: string | null) => {
    if (view === 'fil') return setTarget(key)
    if (key === null) return document.getElementById('travail-haut')?.scrollIntoView({ behavior: 'smooth' })
    document.getElementById(anchorOf(key))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setFlash(key)
    window.setTimeout(() => setFlash((value) => (value === key ? null : value)), 1600)
  }

  const clearAll = () => {
    setFiltersStored(NO_FILTERS)
    setTarget(null)
  }

  return (
    <TravailActionsContext.Provider value={actions}>
    <div className="flex h-full min-h-0 flex-col">
      <OneLineToolbar
        search={<ToolbarSearch value={model.query} onChange={model.setQuery} placeholder="Chercher, #12, branche" />}
        filter={filterMenu}
        chips={chips}
        extra={
          <span className="flex items-center gap-1">
            {summary}
            {cleanButton}
            <span className="hidden lg:inline-flex">
              <DemoToggle demo={code.demo} />
            </span>
          </span>
        }
        display={displayMenu}
        action={sessionMenu}
      />
      <CleanAllDialog
        request={cleanRequest}
        base={code.base}
        onClose={() => setCleanRequest(null)}
        onConfirm={(trees, branches) => {
          setCleanRequest(null)
          const parts = [
            trees.length ? `${trees.length} arbre${trees.length > 1 ? 's' : ''}` : null,
            branches.length ? `${branches.length} branche${branches.length > 1 ? 's' : ''}` : null,
          ].filter(Boolean)
          const freed = trees.reduce((sum, tree) => sum + tree.sizeBytes, 0)
          simulate(`${parts.join(' et ')} supprimé${trees.length + branches.length > 1 ? 's' : ''}${freed ? `, ${formatBytes(freed)} libérés` : ''}.${code.demo ? '' : ' Rien n’a été supprimé.'}`)
          if (code.demo) setRemoved((current) => new Set([...current, ...trees.map((tree) => tree.key), ...branches]))
          if (trees.some((tree) => tree.key === openTreeKey)) setOpenTreeKey(null)
        }}
      />
      <TreeDrawer
        projectId={projectId}
        tree={code.trees.find((tree) => tree.key === openTreeKey && !removed.has(tree.key)) ?? null}
        model={model}
        conversations={conversations}
        demo={code.demo}
        onClose={() => setOpenTreeKey(null)}
      />
      {/* Le retour de tout geste simulé, au même endroit : sous la ligne d'outils, au-dessus
          du contenu comme du tiroir. */}
      {notice ? (
        <p role="status" className="pointer-events-none fixed top-28 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-fuchsia-600 px-3 py-2 text-xs text-white shadow-lg">
          {notice}
        </p>
      ) : null}

      <div className={cx('min-h-0 flex-1', index && 'lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]')}>
        {index ? (
          <aside className="hidden min-h-0 overflow-y-auto border-r border-line lg:block">
            <Index
              lanes={[...activeLanes, ...(forceCleanup ? cleanupLanes : [])]}
              branches={sortedBranches}
              showProject={showProject}
              current={view === 'fil' ? targetKey : flash}
              onChoose={choose}
              filtering={view === 'fil'}
            />
          </aside>
        ) : null}

        {view === 'fil' ? (
          <FilBody
            bare
            model={filteredModel}
            projectId={projectId}
            project={project}
            inbox={inbox}
            showInbox={inbox.length > 0}
            before={hasTrees && !targetTree && !targetBranch ? <BaseCard code={code} branches={branchInfos} compact /> : undefined}
            entryAside={(entry: JournalEntryDto) => {
              const tree = travail.treeOfEntry(entry)
              return tree ? <TreeChip tree={tree} active={tree.key === targetKey} onSelect={(key) => setTarget(key === targetKey ? null : key)} /> : null
            }}
            rowAside={(row: ActivityRow) => {
              const tree = travail.treeOfRow(row)
              return tree ? <TreeChip tree={tree} active={tree.key === targetKey} onSelect={(key) => setTarget(key === targetKey ? null : key)} /> : null
            }}
          />
        ) : (
          <div className="h-full min-h-0 overflow-y-auto">
            <div id="travail-haut" className="flex flex-col gap-5 px-4 pt-4 pb-28 md:px-6">
              {hasTrees && !targetTree && !targetBranch ? <BaseCard code={code} branches={branchInfos} compact /> : null}
              {inbox.length > 0 && view !== 'etat' ? <AskInbox items={inbox} /> : null}

              {nothing ? (
                <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line px-4 py-6 text-sm text-ink-faint">
                  Rien ne correspond à ces filtres.
                  <button type="button" onClick={clearAll} className="text-xs text-accent hover:underline">Effacer les filtres</button>
                </div>
              ) : view === 'graphe' ? (
                <ProjectGitGraph
                  projectId={projectId}
                  demo={code.demo}
                  trees={code.trees.filter((tree) => !removed.has(tree.key))}
                  branches={branchInfos.filter((branch) => !removed.has(branch.name))}
                  targetKey={targetKey}
                  from={periodFrom}
                  showMerged={forceCleanup}
                  onSelect={setTarget}
                  onOpenTree={setOpenTreeKey}
                  inbox={overview.inbox}
                />
              ) : view === 'etat' ? (
                <StateBoard travail={filteredTravail} trees={shownTrees} inbox={inbox} projectId={projectId} onSelectTree={(key) => setTarget(key)} />
              ) : view === 'frise' ? (
                <Timeline
                  lanes={[...activeLanes, ...(forceCleanup ? cleanupLanes : [])]}
                  branches={[...sortedBranches, ...(forceCleanup ? mergedBranches : [])]}
                  from={periodFrom ?? Date.now() - 7 * DAY}
                  conversations={conversations}
                  demo={code.demo}
                  targetKey={targetKey}
                  onSelect={setTarget}
                />
              ) : view === 'couloirs' ? (
                <CouloirsView
                  projectId={projectId}
                  travail={filteredTravail}
                  groups={groups}
                  items={items}
                  flash={flash}
                  demo={code.demo}
                />
              ) : (
                <TableView projectId={projectId} groups={groups} items={items} demo={code.demo} />
              )}

              {view === 'couloirs' && showProject ? (
                <ProjectLane entries={lanes.loose} model={filteredModel} anchorId={anchorOf('projet')} highlight={flash === 'projet'} />
              ) : null}

              {showCleanup && WITH_GROUPS.includes(view) ? (
                <CleanupSection
                  lanes={cleanupLanes}
                  view={view}
                  projectId={projectId}
                  travail={filteredTravail}
                  forceOpen={forceCleanup}
                  flash={flash}
                />
              ) : null}

              {showMerged && WITH_GROUPS.includes(view) ? <MergedBranches branches={mergedBranches} anchorId={anchorOf('branches-fusionnees')} forceOpen={forceCleanup} /> : null}
            </div>
          </div>
        )}
      </div>
    </div>
    </TravailActionsContext.Provider>
  )
}

const anchorOf = (key: string) => `travail-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`

/* ------------------------------------------------------------------ la vue Couloirs */

type GroupedItems = [string, ({ kind: 'tree'; lane: LaneData } | { kind: 'branch'; branch: BranchInfo })[]][] | null

function CouloirsView({
  projectId,
  travail,
  groups,
  items,
  flash,
  demo,
}: {
  projectId: string
  travail: Travail
  groups: GroupedItems
  items: ({ kind: 'tree'; lane: LaneData } | { kind: 'branch'; branch: BranchInfo })[]
  flash: string | null
  demo: boolean
}) {
  const render = (item: (typeof items)[number]) =>
    item.kind === 'tree' ? (
      <Lane
        key={item.lane.tree.key}
        tree={item.lane.tree}
        live={item.lane.live}
        entries={item.lane.entries}
        travail={travail}
        projectId={projectId}
        dense
        anchorId={anchorOf(item.lane.tree.key)}
        highlight={flash === item.lane.tree.key}
      />
    ) : (
      <BranchLane key={item.branch.key} projectId={projectId} branch={item.branch} demo={demo} anchorId={anchorOf(item.branch.key)} highlight={flash === item.branch.key} />
    )

  if (groups) {
    return (
      <div className="flex flex-col gap-6">
        {groups.map(([label, list]) => (
          <section key={label} className="flex flex-col gap-2.5">
            <GroupHeading label={label} count={list.length} />
            {list.map(render)}
          </section>
        ))}
      </div>
    )
  }
  const trees = items.filter((item) => item.kind === 'tree')
  const branches = items.filter((item) => item.kind === 'branch')
  return (
    <div className="flex flex-col gap-6">
      {trees.length > 0 ? <div className="flex flex-col gap-2.5">{trees.map(render)}</div> : null}
      {branches.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <GroupHeading label="Branches sans worktree" count={branches.length} icon={<GitBranch size={12} />} />
          {branches.map(render)}
        </section>
      ) : null}
    </div>
  )
}

function GroupHeading({ label, count, icon }: { label: string; count: number; icon?: ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 px-1 text-xs font-medium tracking-wide text-ink-faint uppercase">
      {icon}
      <span className="min-w-0 truncate normal-case tracking-normal text-sm font-semibold text-ink-soft">{label}</span>
      <span className="tabular-nums">{count}</span>
    </h3>
  )
}

/* ------------------------------------------------------------------ la vue Tableau */

function TableView({
  projectId,
  groups,
  items,
  demo,
}: {
  projectId: string
  groups: GroupedItems
  items: ({ kind: 'tree'; lane: LaneData } | { kind: 'branch'; branch: BranchInfo })[]
  demo: boolean
}) {
  const page = useTravailActions()!
  const row = (item: (typeof items)[number]) =>
    item.kind === 'tree' ? (
      <TreeLine
        key={item.lane.tree.key}
        projectId={projectId}
        tree={item.lane.tree}
        demo={demo}
        onSimulate={page.simulate}
        onClean={() => page.cleanTrees([item.lane.tree])}
        onOpen={() => page.openTree(item.lane.tree.key)}
      />
    ) : (
      <BranchRowLine key={item.branch.key} branch={item.branch} />
    )

  const header = (
    <div className={cx('hidden border-b border-line pb-2 text-meta font-medium tracking-wide text-ink-faint uppercase', GRID)}>
      <span>Branche · pourquoi elle est là</span>
      <span>Sessions</span>
      <span>PR</span>
      <span className="text-right">Base</span>
      <span className="text-right">Disque <SimTag /></span>
      <span className="text-right">Vu</span>
      <span />
    </div>
  )

  // Une largeur de lecture : sur un grand écran, la première colonne ne s'étire plus
  // jusqu'à repousser les suivantes à l'autre bout.
  return (
    <div className="flex flex-col gap-4">
      {header}
      {groups ? (
        groups.map(([label, list]) => (
          <section key={label} className="flex flex-col gap-1">
            <GroupHeading label={label} count={list.length} />
            <ul className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-line">{list.map(row)}</ul>
          </section>
        ))
      ) : (
        <ul className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-line">{items.map(row)}</ul>
      )}
    </div>
  )
}

/** Une branche sans arbre, sur la grille du tableau des arbres. */
function BranchRowLine({ branch }: { branch: BranchInfo }) {
  const tone = BRANCH_TONE[branch.kind]
  return (
    <li className={cx('rounded-xl border border-line px-3 py-3 md:rounded-none md:border-0 md:px-0 md:py-2.5', GRID)}>
      <span className="flex min-w-0 items-start gap-2.5">
        <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranch size={12} className="shrink-0 text-ink-faint" />
            <span className="min-w-0 truncate font-mono text-[13px]">{branch.remoteOnly ? `origin/${branch.name}` : branch.name}</span>
            <span className={cx('shrink-0 text-xs', tone.text)}>{tone.label}</span>
          </span>
          {branch.card ? (
            <span className="min-w-0 truncate text-xs text-ink-faint">
              #{branch.card.number} {branch.card.title}
              {branch.card.milestone ? <span className="ml-1.5 rounded bg-surface-high px-1.5 py-px">Jalon #{branch.card.milestone.number}</span> : null}
            </span>
          ) : null}
        </span>
      </span>
      <span className="hidden text-xs text-ink-faint md:block">sans arbre</span>
      <span className="hidden text-xs md:block">{branch.pr ? `#${branch.pr.number} · ${PR_LABEL[branch.pr.state].label}` : '—'}</span>
      <span className="hidden text-right text-xs tabular-nums text-ink-faint md:block">{branch.merged ? '—' : `↑${branch.ahead} ↓${branch.behind}`}</span>
      <span className="hidden text-right text-xs text-ink-faint md:block">—</span>
      <span className="hidden text-right text-xs tabular-nums text-ink-faint md:block">{elapsed(branch.lastCommitAt)}</span>
      <span />
    </li>
  )
}

/* ------------------------------------------------------------------ à nettoyer */

function CleanupSection({
  lanes,
  view,
  projectId,
  travail,
  forceOpen,
  flash,
}: {
  lanes: LaneData[]
  view: View
  projectId: string
  travail: Travail
  forceOpen: boolean
  flash: string | null
}) {
  const page = useTravailActions()!
  const [open, setOpen] = useState(false)
  const shown = open || forceOpen
  const size = lanes.reduce((sum, lane) => sum + lane.tree.sizeBytes, 0)
  return (
    <section id={anchorOf('nettoyer')} className="flex scroll-mt-4 flex-col gap-2">
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={shown} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-ink-soft hover:bg-surface-high hover:text-ink">
          <ChevronRight size={14} className={cx('transition-transform', shown && 'rotate-90')} />
          <span className="font-medium">
            {lanes.length} arbre{lanes.length > 1 ? 's' : ''} fusionné{lanes.length > 1 ? 's' : ''}
          </span>
          <span className="text-xs tabular-nums text-ink-faint">{formatBytes(size)} · rien à perdre</span>
        </button>
        <button type="button" onClick={() => page.cleanTrees(lanes.map((lane) => lane.tree))} className={cx(toolbarButtonClass(false), 'ml-auto')}>
          <Trash2 size={13} /> Nettoyer
        </button>
      </div>
      {shown ? (
        view === 'tableau' ? (
          <ul className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-line">
            {lanes.map((lane) => (
              <TreeLine
                key={lane.tree.key}
                projectId={projectId}
                tree={lane.tree}
                demo={travail.code.demo}
                onSimulate={page.simulate}
                onClean={() => page.cleanTrees([lane.tree])}
                onOpen={() => page.openTree(lane.tree.key)}
              />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col gap-2.5">
            {lanes.map((lane) => (
              <Lane
                key={lane.tree.key}
                tree={lane.tree}
                live={lane.live}
                entries={lane.entries}
                travail={travail}
                projectId={projectId}
                dense
                dim
                anchorId={anchorOf(lane.tree.key)}
                highlight={flash === lane.tree.key}
              />
            ))}
          </div>
        )
      ) : null}
    </section>
  )
}

/* ------------------------------------------------------------------ l'index */

function Index({
  lanes,
  branches,
  showProject,
  current,
  onChoose,
  filtering,
}: {
  lanes: LaneData[]
  branches: BranchInfo[]
  showProject: boolean
  current: string | null
  onChoose: (key: string | null) => void
  /** Vrai dans le Fil : l'index filtre ; faux dans les Couloirs : il fait défiler. */
  filtering: boolean
}) {
  const item = 'flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors'
  const state = (key: string | null) => (current === key ? 'bg-surface-high' : 'hover:bg-surface-high/60')
  return (
    <ul className="flex flex-col gap-0.5 px-4 pt-2.5 pb-2">
      <li>
        <button type="button" onClick={() => onChoose(null)} className={cx(item, filtering ? state(null) : 'hover:bg-surface-high/60')}>
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full border border-ink-faint" />
          <span className="min-w-0 flex-1 text-sm font-medium">Tous</span>
          <span className="text-xs text-ink-faint">{filtering ? 'tout le fil' : 'en haut'}</span>
        </button>
      </li>
      {lanes.map((lane) => {
        const tone = VERDICT_TONE[lane.tree.verdict]
        return (
          <li key={lane.tree.key}>
            <button type="button" onClick={() => onChoose(lane.tree.key)} className={cx(item, state(lane.tree.key))} title={lane.tree.branch ?? lane.tree.name}>
              <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cx('min-w-0 truncate font-mono text-[13px]', lane.tree.root && 'font-semibold')}>{lane.tree.root ? (lane.tree.branch ?? lane.tree.name) : shortBranch(lane.tree)}</span>
                <span className={cx('min-w-0 truncate text-xs', tone.text)}>{lane.tree.reason}</span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">{lane.tree.sizeBytes ? formatBytes(lane.tree.sizeBytes) : ''}</span>
            </button>
          </li>
        )
      })}
      {branches.length > 0 ? (
        <li className="mt-2 flex items-center gap-1.5 border-t border-line px-2 pt-3 pb-1 text-xs font-medium tracking-wide text-ink-faint uppercase">
          <GitBranch size={11} /> Branches
        </li>
      ) : null}
      {branches.map((branch) => (
        <li key={branch.key}>
          <IndexBranch branch={branch} className={cx(item, state(branch.key))} onClick={() => onChoose(branch.key)} />
        </li>
      ))}
      {showProject && !filtering ? (
        <li className="mt-2 border-t border-line pt-2">
          <button type="button" onClick={() => onChoose('projet')} className={cx(item, state('projet'))}>
            <Layers size={13} className="mt-0.5 shrink-0 text-ink-faint" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm font-medium">Projet</span>
              <span className="text-xs text-ink-faint">ce qui ne vit dans aucun arbre</span>
            </span>
          </button>
        </li>
      ) : null}
    </ul>
  )
}
