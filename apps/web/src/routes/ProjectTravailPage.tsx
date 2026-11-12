import { Activity, FolderGit2, GitBranch, GitFork, Plus, Rows3 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { ProjectDto, WorktreeStatusDto } from '@solera/protocol'
import { Button, EmptyState, Menu, MenuItem, MenuLabel, MenuSeparator, cx } from '@solera/ui'
import { AgentIcon, AGENT_LABELS } from '../components/AgentIcon'
import { ActivityRail, type RailModel } from '../components/activity/ActivityRail'
import { BaseLine } from '../components/code/BaseLine'
import { TreeChip } from '../components/code/TreeChip'
import { VerdictDot } from '../components/code/VerdictDot'
import { AskInbox } from '../components/inbox/AskInbox'
import { journalDestination } from '../components/journal/JournalView'
import { CardSheetHost } from '../components/cards/CardSheetHost'
import { WorktreeCleanupDialog } from '../components/WorktreeCleanupDialog'
import { FilterChip, OneLineToolbar, ToolbarSearch } from '../components/toolbar/OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../components/toolbar/ToolbarMenus'
import { CleanMergedDialog } from '../components/travail/CleanMergedDialog'
import { CouloirsView, PROJECT_KEY } from '../components/travail/CouloirsView'
import { ProjectGitGraph } from '../components/travail/ProjectGitGraph'
import { TravailIndex } from '../components/travail/TravailIndex'
import { TravailNoticeHost } from '../components/travail/TravailNotice'
import { TreeDrawer } from '../components/travail/TreeDrawer'
import { isActiveFilter, matchesActivity, parseActivityFilter } from '../lib/activity-groups'
import type { ActivityRow } from '../lib/activity-rows'
import { formatBytes, isCleanable, pluralOf, shortBranch, type TreeRow } from '../lib/code-model'
import { locale, useTranslate, type MessageKey } from '../lib/i18n'
import type { InboxItem } from '../lib/inbox'
import { useAutomations } from '../lib/automations-query'
import { useJournalDays } from '../lib/journal'
import { useProjects } from '../lib/projects'
import { servedByTree } from '../lib/served'
import { laneAnchor, laneLayout, lanesOf, spiedKey } from '../lib/travail-lanes'
import {
  NO_FILTERS,
  PERIODS,
  STATE_KEYS,
  STATE_PARAM,
  WHAT_KEYS,
  agentOptions,
  arrivalFilters,
  branchPasses,
  entryMatches,
  entryPasses,
  filterCount,
  inboxPasses,
  indexTrees,
  milestoneOptions,
  periodStart,
  readDisplay,
  readFilters,
  rowPasses,
  targetOf,
  treePasses,
  treeSummary,
  type Grouping,
  type Period,
  type Sorting,
  type TravailFilters,
  type TravailView,
} from '../lib/travail-model'
import { useStoredPref, useView } from '../lib/use-view'
import { useTravail } from '../lib/use-travail'
import { viewStorageKey } from '../lib/view-pref'
import { useWorktreeStatuses } from '../lib/worktrees'

/** L'arbre ou la branche choisis, portés par l'adresse pour qu'un rechargement les garde. */
const TARGET_PARAM = 'arbre'

/**
 * Les vues livrées, dans l'ordre de leurs tuiles. Les trois autres de `TRAVAIL_VIEWS`
 * (Tableau, Par état, Frise) arrivent avec leurs cartes (#177, #179).
 */
const VIEW_ICONS: Partial<Record<TravailView, ReactNode>> = {
  couloirs: <Rows3 size={16} />,
  fil: <Activity size={16} />,
  graphe: <GitFork size={16} />,
}
/** Les vues où l'index des arbres a un sens : il fait défiler les couloirs, il filtre le fil. */
const WITH_INDEX: TravailView[] = ['couloirs', 'fil']
/** Les vues qu'on regroupe et qu'on trie, et où « À nettoyer » et les fusionnées se montrent. */
const WITH_GROUPS: TravailView[] = ['couloirs']

/** La ligne de lecture du scroll-spy, sous le haut de la zone qui défile. */
const SPY_LINE = 96
/** Le temps de l'anneau d'accent autour du couloir où l'index vient de mener. */
const FLASH_MS = 1_600

const GROUPS: Grouping[] = ['none', 'milestone', 'state']
const SORTS: Sorting[] = ['waiting', 'recent', 'size']

const WHAT_LABEL: Record<(typeof WHAT_KEYS)[number], MessageKey> = {
  trees: 'travail.what.trees',
  branches: 'travail.what.branches',
  sessions: 'travail.what.sessions',
  events: 'travail.what.events',
}
const PERIOD_LABEL: Record<Period, MessageKey> = { today: 'travail.period.today', '7': 'travail.period.7', '30': 'travail.period.30' }
const PERIOD_SHORT: Record<Period | 'all', MessageKey> = {
  all: 'travail.period.all',
  today: 'travail.period.today',
  '7': 'travail.period.7.short',
  '30': 'travail.period.30.short',
}

/**
 * L'onglet **Travail** d'un projet (`projet.md` T-1 à T-5, T-14), qui remplace
 * l'Activité et le Journal : une seule barre, et des vues qui lisent les mêmes filtres.
 *
 * La barre tient sur une ligne : la recherche (le vivant et l'historique), « Filtrer ▾ »
 * (Quoi, État, Jalon, Agent, Période) et ses puces, le bilan des arbres, « Affichage ▾ »
 * (la vue, l'index), « + Session » au bout. Choisir un arbre ou une branche est un filtre
 * comme un autre, porté par l'adresse (`?arbre=`) ; la vue aussi (`?vue=`). Les filtres
 * et l'affichage sont retenus par projet.
 */
export function ProjectTravailPage() {
  const { projectId } = useParams()
  const t = useTranslate()
  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  if (isPending) return null
  if (!projectId || !project) return <EmptyState title={t('project.notFound')} />
  return <TravailPage projectId={projectId} project={project} />
}

/** Les jours que la période réclame au journal : « Aujourd'hui » tient dans un. */
const PERIOD_DAYS: Record<Period, number> = { today: 1, '7': 7, '30': 30 }

function TravailPage({ projectId, project }: { projectId: string; project: ProjectDto }) {
  const t = useTranslate()
  const [params, setParams] = useSearchParams()
  const hasGit = Boolean(project.git)

  const views: ViewOption<TravailView>[] = (hasGit ? (['couloirs', 'fil', 'graphe'] as const) : (['fil'] as const)).map((key) => ({
    key,
    label: t(`travail.view.${key}`),
    icon: VIEW_ICONS[key]!,
  }))
  const [view, setView] = useView<TravailView>('travail', projectId, views.map((option) => option.key))
  const [filters, setFilters] = useStoredPref(viewStorageKey('travail.filtres', projectId), readFilters)
  const travail = useTravail(projectId, project, filters.period ? PERIOD_DAYS[filters.period] : 0)
  const [display, setDisplay] = useStoredPref(viewStorageKey('travail.affichage', projectId), readDisplay)
  const { code, branches, milestones } = travail
  const [query, setQuery] = useState('')
  const search = useMemo(() => parseActivityFilter(query), [query])

  const targetKey = params.get(TARGET_PARAM)
  const target = useMemo(() => targetOf(targetKey, code.trees, branches, travail.scopes), [targetKey, code.trees, branches, travail.scopes])
  const setTarget = (key: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (key) next.set(TARGET_PARAM, key)
        else next.delete(TARGET_PARAM)
        return next
      },
      { replace: true },
    )
  const toggleTarget = (key: string) => setTarget(key === targetKey ? null : key)
  // Une arrivée filtrée (`?etat=`, depuis l'Aperçu) remplace les filtres retenus, puis
  // quitte l'adresse : ensuite, ce sont des filtres comme les autres.
  const arrival = params.get(STATE_PARAM)
  useEffect(() => {
    if (arrival === null) return
    const imposed = arrivalFilters(arrival)
    if (imposed) setFilters(imposed)
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete(STATE_PARAM)
        return next
      },
      { replace: true },
    )
  }, [arrival, setFilters, setParams])
  const set = (patch: Partial<TravailFilters>) => setFilters({ ...filters, ...patch })
  const clearAll = () => {
    setFilters(NO_FILTERS)
    setTarget(null)
  }

  /* ---------------------------------------------------------------- le filtrage */

  const now = Date.now()
  const from = periodStart(filters.period, now)
  const milestoneOfRow = (row: ActivityRow) => milestones.ofCard(row.entry.conversation.card?.number ?? null)
  /** Une session que la recherche et les filtres gardent, vivante ou non. */
  const keepsRow = (row: ActivityRow) =>
    matchesActivity(search, { group: row.group, title: row.entry.conversation.title, branch: row.place.branch, card: row.entry.conversation.card }) &&
    rowPasses(row, filters, target, milestoneOfRow(row)?.number ?? null)

  const live = travail.live.filter(keepsRow)
  const inbox = travail.inbox.filter((item) => inboxSearched(search, item) && inboxPasses(item, filters, target))
  const entries = travail.history.filter(
    (entry) =>
      entryMatches(search, entry) &&
      entryPasses(entry, filters, target, {
        milestone: milestones.ofCard(entry.cardNumber)?.number ?? null,
        agent: travail.agentOf(entry),
        tree: filters.states.length > 0 ? travail.treeOfEntry(entry) : null,
        from,
      }),
  )
  const days = useJournalDays(entries, 'all')

  const active = filterCount(filters, target !== null)
  const narrowed = active > 0 || isActiveFilter(search)
  // Un filtre d'état réclame ce qui est à nettoyer ou fusionné : on le montre, déplié.
  const forceCleanup = filters.states.includes('cleanup') || filters.states.includes('merged')

  // « Par arbre » : un couloir par arbre et par branche que les filtres gardent, qui
  // porte le vivant et l'historique de l'arbre.
  const layout =
    view === 'couloirs'
      ? laneLayout({
          lanes: lanesOf({ trees: code.trees.filter((tree) => treePasses(tree, filters, target)), live, entries, scopes: travail.scopes, now }),
          branches: branches.filter((branch) => branchPasses(branch, filters, target, now)),
          display,
          forced: forceCleanup,
          targeted: target !== null,
          now,
        })
      : null
  const shown = layout
    ? layout.trees.length + layout.branches.length + Number(layout.project !== null) + Number(layout.cleanup !== null) + Number(layout.merged !== null)
    : live.length + entries.length
  // Le graphe dit lui-même qu'il n'a aucun commit dans la période.
  const nothing = view !== 'graphe' && active > 0 && shown === 0 && inbox.length === 0

  /* ---------------------------------------------------------------- la barre */

  const options = useMemo(() => milestoneOptions(code.trees, branches, travail.cards), [code.trees, branches, travail.cards])
  const agents = useMemo(() => agentOptions(code.trees, travail.live), [code.trees, travail.live])

  const chips = [
    target?.kind === 'tree' ? (
      <FilterChip key="tree" title={target.tree.path} onClear={() => setTarget(null)}>
        <span className="inline-flex items-center gap-1.5">
          <VerdictDot verdict={target.tree.verdict} className="size-1.5" />
          {t('travail.chip.tree')} <span className="font-mono">{shortBranch(target.tree.branch ?? target.tree.name)}</span>
        </span>
      </FilterChip>
    ) : null,
    target?.kind === 'branch' ? (
      <FilterChip key="branch" title={target.branch.name} onClear={() => setTarget(null)}>
        {t('travail.chip.branch')} <span className="font-mono">{target.branch.name}</span>
      </FilterChip>
    ) : null,
    ...filters.what.map((what) => (
      <FilterChip key={`w-${what}`} onClear={() => set({ what: filters.what.filter((item) => item !== what) })}>
        {t(WHAT_LABEL[what])}
      </FilterChip>
    )),
    ...filters.states.map((state) => (
      <FilterChip key={`s-${state}`} onClear={() => set({ states: filters.states.filter((item) => item !== state) })}>
        {t(`travail.state.${state}`)}
      </FilterChip>
    )),
    ...filters.milestones.map((number) => (
      <FilterChip key={`m-${number}`} onClear={() => set({ milestones: filters.milestones.filter((item) => item !== number) })}>
        {t('code.milestone', { number })}
      </FilterChip>
    )),
    ...filters.agents.map((agent) => (
      <FilterChip key={`a-${agent}`} onClear={() => set({ agents: filters.agents.filter((item) => item !== agent) })}>
        {AGENT_LABELS[agent]}
      </FilterChip>
    )),
    filters.period ? (
      <FilterChip key="period" onClear={() => set({ period: null })}>
        {t(PERIOD_LABEL[filters.period])}
      </FilterChip>
    ) : null,
  ].filter(Boolean)

  const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])

  const filterMenu = (
    <FilterMenu active={active} onClearAll={clearAll}>
      <MenuHeading>{t('travail.section.what')}</MenuHeading>
      {WHAT_KEYS.map((what) => (
        <MenuCheck key={what} checked={filters.what.includes(what)} onChange={() => set({ what: toggleIn(filters.what, what) })}>
          {t(WHAT_LABEL[what])}
        </MenuCheck>
      ))}
      <MenuHeading>{t('travail.section.state')}</MenuHeading>
      {STATE_KEYS.map((state) => (
        <MenuCheck key={state} checked={filters.states.includes(state)} onChange={() => set({ states: toggleIn(filters.states, state) })}>
          {t(`travail.state.${state}`)}
        </MenuCheck>
      ))}
      {options.length > 0 ? (
        <>
          <MenuHeading>{t('travail.section.milestone')}</MenuHeading>
          {options.map((option) => (
            <MenuCheck
              key={option.number}
              checked={filters.milestones.includes(option.number)}
              onChange={() => set({ milestones: toggleIn(filters.milestones, option.number) })}
              aside={option.progress ? `${option.progress.done}/${option.progress.total}` : undefined}
            >
              <span className="inline-flex min-w-0 items-center gap-1.5" title={option.title}>
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{option.number}</span>
                <span className="truncate">{option.title}</span>
              </span>
            </MenuCheck>
          ))}
        </>
      ) : null}
      {agents.length > 0 ? (
        <>
          <MenuHeading>{t('travail.section.agent')}</MenuHeading>
          {agents.map((agent) => (
            <MenuCheck key={agent} checked={filters.agents.includes(agent)} onChange={() => set({ agents: toggleIn(filters.agents, agent) })}>
              <span className="inline-flex items-center gap-1.5">
                <AgentIcon agent={agent} size={13} decorative /> {AGENT_LABELS[agent]}
              </span>
            </MenuCheck>
          ))}
        </>
      ) : null}
      <MenuHeading>{t('travail.section.period')}</MenuHeading>
      <MenuSegment<Period | 'all'>
        label={t('travail.section.period')}
        segments={(['all', ...PERIODS] as const).map((value) => ({ value, label: t(PERIOD_SHORT[value]) }))}
        value={filters.period ?? 'all'}
        onChange={(next) => set({ period: next === 'all' ? null : next })}
      />
    </FilterMenu>
  )

  const displayMenu = (
    <DisplayMenu views={views} value={view} onChange={setView}>
      {WITH_INDEX.includes(view) && hasGit ? (
        <MenuCheck checked={display.index} onChange={(next) => setDisplay({ ...display, index: next })}>
          {t('travail.display.index')}{' '}
          <span className="text-xs text-ink-faint">{t(view === 'fil' ? 'travail.display.indexFilter' : 'travail.display.indexScroll')}</span>
        </MenuCheck>
      ) : null}
      {WITH_GROUPS.includes(view) && hasGit ? (
        <>
          <MenuHeading>{t('travail.display.group')}</MenuHeading>
          <MenuSegment<Grouping>
            label={t('travail.display.group')}
            segments={GROUPS.map((value) => ({ value, label: t(`travail.display.group.${value}`) }))}
            value={display.group}
            onChange={(next) => setDisplay({ ...display, group: next })}
          />
          <MenuHeading>{t('travail.display.sort')}</MenuHeading>
          <MenuSegment<Sorting>
            label={t('travail.display.sort')}
            segments={SORTS.map((value) => ({ value, label: t(`travail.display.sort.${value}`) }))}
            value={display.sort}
            onChange={(next) => setDisplay({ ...display, sort: next })}
          />
          <MenuHeading>{t('travail.display.show')}</MenuHeading>
          <MenuCheck checked={display.showCleanup} onChange={(next) => setDisplay({ ...display, showCleanup: next })}>
            {t('travail.display.showCleanup')}
          </MenuCheck>
          <MenuCheck checked={display.showMerged} onChange={(next) => setDisplay({ ...display, showMerged: next })}>
            {t('travail.display.showMerged')}
          </MenuCheck>
          <MenuCheck checked={display.showProject} onChange={(next) => setDisplay({ ...display, showProject: next })}>
            {t('travail.display.showProject')}
          </MenuCheck>
        </>
      ) : null}
    </DisplayMenu>
  )

  /* Le bilan : un texte méta neutre, qui ne se clique pas. */
  const summary = treeSummary(code.trees)
  const summaryText = hasGit ? (
    <span className="hidden shrink-0 items-center gap-1.5 px-1 text-xs text-ink-faint tabular-nums xl:inline-flex">
      {t(`travail.summary.trees.${pluralOf(summary.count)}`, { count: summary.count })}
      {summary.bytes !== null ? (
        <>
          <span aria-hidden>·</span>
          {formatBytes(summary.bytes, locale())}
        </>
      ) : null}
    </span>
  ) : null

  /* ---------------------------------------------------------------- le rendu */

  const index = hasGit && display.index && WITH_INDEX.includes(view)
  const indexed = indexTrees(code.trees.filter((tree) => treePasses(tree, filters, null)), forceCleanup)
  const indexedBranches = branches.filter((branch) => branch.kind !== 'merged' && branchPasses(branch, filters, null, now))
  const base = hasGit && !target ? <BaseLine code={code} /> : null

  const rail: RailModel = {
    projectId,
    live,
    inbox,
    // Le bandeau d'un jalon lancé parle de tout le projet, pas d'un arbre.
    runs: target ? [] : travail.runs,
    days,
    journalDays: travail.journal.days,
    narrowed,
    older: { can: travail.journal.canLoadOlder, loading: travail.journal.loadingOlder, load: travail.journal.loadOlder },
    milestoneOfRow,
    milestoneOfEntry: (entry) => milestones.ofCard(entry.cardNumber),
    isMilestone: milestones.isMilestone,
    agentOf: travail.agentOf,
    entryHref: journalDestination,
  }
  const chipOf = (tree: TreeRow | null) => (tree ? <TreeChip tree={tree} active={tree.key === targetKey} onSelect={toggleTarget} /> : null)

  /* ---------------------------------------------------------------- « Par arbre » */

  const { data: statuses } = useWorktreeStatuses(hasGit ? projectId : undefined)
  const { items: automations } = useAutomations({ projectId })
  const served = useMemo(() => servedByTree(automations, code.trees), [automations, code.trees])
  const scroller = useRef<HTMLDivElement>(null)
  const scroll = useLaneScroll(scroller, layout ? [...layout.index.trees.map((tree) => tree.key), ...layout.index.branches.map((branch) => branch.key), ...(layout.index.project ? [PROJECT_KEY] : [])] : null)
  const [openTreeKey, setOpenTreeKey] = useState<string | null>(null)
  const openTree = code.trees.find((tree) => tree.key === openTreeKey) ?? null
  // Le nettoyage d'un arbre, et celui de tous les fusionnés : les dialogues lisent le
  // statut tel que le serveur l'a rendu.
  const [cleaning, setCleaning] = useState<{ one: WorktreeStatusDto } | { all: WorktreeStatusDto[] } | null>(null)
  const statusOf = (tree: TreeRow) => statuses?.worktrees.find((entry) => entry.path === tree.path) ?? null
  const cleanTree = (tree: TreeRow) => {
    const status = statusOf(tree)
    if (status) setCleaning({ one: status })
  }
  const cleanTrees = (trees: TreeRow[]) => {
    const all = trees.flatMap((tree) => statusOf(tree) ?? [])
    if (all.length > 0) setCleaning({ all })
  }
  const laneRail = { isMilestone: rail.isMilestone, agentOf: rail.agentOf, entryHref: rail.entryHref }
  const drawerScope = openTree ? travail.scopes.get(openTree.key) : undefined

  return (
    <TravailNoticeHost>
    <div className="flex h-full min-h-0 flex-col">
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder={t('travail.search.placeholder')} />}
        filter={filterMenu}
        chips={chips}
        extra={summaryText}
        display={displayMenu}
        action={<NewSession projectId={projectId} trees={code.trees} />}
      />
      <div className={cx('min-h-0 flex-1', index && 'lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]')}>
        {index ? (
          <aside className="hidden min-h-0 overflow-y-auto border-r border-line lg:block">
            {layout ? (
              <TravailIndex trees={layout.index.trees} branches={layout.index.branches} project={layout.index.project} current={scroll.current} onChoose={scroll.go} mode="scroll" />
            ) : (
              <TravailIndex trees={indexed} branches={indexedBranches} current={targetKey} onChoose={setTarget} mode="filter" />
            )}
          </aside>
        ) : null}
        <div ref={scroller} onScroll={scroll.onScroll} className="h-full min-h-0 overflow-y-auto">
          {nothing ? (
            <div className="flex flex-col gap-5 px-4 pt-4 pb-28 md:px-6">
              {base}
              <NoMatch onClear={clearAll} />
            </div>
          ) : view === 'graphe' ? (
            <div className="flex flex-col gap-5 px-4 pt-4 pb-28 md:px-6">
              {base}
              {inbox.length > 0 ? <AskInbox items={inbox} /> : null}
              <ProjectGitGraph
                projectId={projectId}
                trees={code.trees}
                branches={branches}
                targetKey={target ? targetKey : null}
                from={from}
                showMerged={forceCleanup}
                served={served}
                onSelect={setTarget}
                onOpenTree={setOpenTreeKey}
                sources={{
                  conversations: travail.conversations,
                  live: travail.rows.map((row) => row.entry),
                  scopes: travail.scopes,
                  cards: travail.cards,
                  inbox: travail.inbox,
                }}
              />
            </div>
          ) : view === 'fil' ? (
            <ActivityRail
              model={rail}
              before={base ?? undefined}
              entryAside={(entry) => chipOf(travail.treeOfEntry(entry))}
              rowAside={(row) => chipOf(travail.treeOfRow(row))}
            />
          ) : layout ? (
            <div className="flex flex-col gap-5 px-4 pt-4 pb-28 md:px-6">
              {base}
              {inbox.length > 0 ? <AskInbox items={inbox} /> : null}
              <CouloirsView
                projectId={projectId}
                layout={layout}
                rail={laneRail}
                served={served}
                flash={scroll.flash}
                onOpen={setOpenTreeKey}
                onCleanTree={cleanTree}
                onCleanTrees={cleanTrees}
              />
            </div>
          ) : null}
        </div>
      </div>
      <TreeDrawer
        projectId={projectId}
        tree={openTree}
        sessions={drawerScope ? travail.conversations.filter((entry) => drawerScope.sessionIds.has(entry.id)) : []}
        entries={openTree ? travail.history.filter((entry) => travail.treeOfEntry(entry)?.key === openTree.key) : []}
        journalDays={travail.journal.days}
        rail={laneRail}
        served={openTree ? served.get(openTree.key) : undefined}
        onClose={() => setOpenTreeKey(null)}
        onClean={cleanTree}
      />
      {cleaning && 'one' in cleaning ? <WorktreeCleanupDialog projectId={projectId} tree={cleaning.one} base={code.base} onClose={() => setCleaning(null)} /> : null}
      {cleaning && 'all' in cleaning ? <CleanMergedDialog projectId={projectId} trees={cleaning.all} onClose={() => setCleaning(null)} /> : null}
      <CardSheetHost projectId={projectId} />
    </div>
    </TravailNoticeHost>
  )
}

/**
 * L'index qui fait défiler (`projet.md` T-3.5) : un clic mène au couloir et l'entoure
 * d'accent un instant ; « Tous » remonte. En défilant, la ligne du couloir qu'on lit
 * s'éclaire (scroll-spy).
 */
function useLaneScroll(scroller: RefObject<HTMLDivElement | null>, keys: string[] | null) {
  const [spied, setSpied] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const frame = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const keyList = keys?.join('\n') ?? null

  const spy = useCallback(() => {
    const box = scroller.current
    if (!box || keyList === null) return
    const top = box.getBoundingClientRect().top
    const tops = keyList
      .split('\n')
      .flatMap((key) => {
        const element = document.getElementById(laneAnchor(key))
        return element ? [{ key, top: element.getBoundingClientRect().top - top }] : []
      })
      .sort((a, b) => a.top - b.top)
    // Tout en haut, rien n'est encore lu : « Tous ».
    setSpied(box.scrollTop < 8 ? null : spiedKey(tops, SPY_LINE))
  }, [scroller, keyList])

  useEffect(() => {
    spy()
  }, [spy])
  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    window.clearTimeout(timer.current)
  }, [])

  return {
    current: flash ?? spied,
    flash,
    onScroll: () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(spy)
    },
    go: (key: string | null) => {
      if (key === null) {
        scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
        return
      }
      document.getElementById(laneAnchor(key))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setFlash(key)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setFlash(null), FLASH_MS)
    },
  }
}

/** La recherche sur une demande : son titre, sa carte ; `s:attend` la garde. */
function inboxSearched(search: ReturnType<typeof parseActivityFilter>, item: InboxItem): boolean {
  if (!isActiveFilter(search)) return true
  const title = item.kind === 'session' || item.kind === 'light' ? item.title : item.milestone.title
  const card = item.kind === 'session' && item.cardNumber !== null ? { number: item.cardNumber, title: '' } : null
  return matchesActivity(search, { group: 'asking', title, branch: null, card })
}

/** T-14.1 : rien à montrer sous ces filtres, et de quoi les effacer. */
function NoMatch({ onClear }: { onClear: () => void }) {
  const t = useTranslate()
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line px-4 py-6 text-sm text-ink-faint">
      <p>{t('travail.empty.filters')}</p>
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t('travail.empty.clear')}
      </Button>
    </div>
  )
}

/**
 * « + Session » (T-1.7) : où travailler — la racine, puis chaque arbre utilisable (ni à
 * nettoyer, ni introuvable, créé par Solera), puis un nouveau worktree.
 */
function NewSession({ projectId, trees }: { projectId: string; trees: TreeRow[] }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const usable = trees.filter((tree) => tree.root || (tree.id !== null && !isCleanable(tree) && tree.verdict !== 'missing'))
  return (
    <Menu
      align="end"
      trigger={
        <Button size="sm" icon={<Plus size={15} />}>
          {t('travail.session.button')}
        </Button>
      }
    >
      <MenuLabel>{t('travail.session.where')}</MenuLabel>
      {usable.map((tree) => {
        const name = tree.branch ?? tree.name
        return (
          <MenuItem
            key={tree.key}
            icon={tree.root ? <FolderGit2 size={14} /> : <GitBranch size={14} />}
            onSelect={() => navigate(tree.root || !tree.id ? `/p/${projectId}/c/new` : `/p/${projectId}/c/new?worktree=${tree.id}`)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono">{tree.root ? t('travail.session.root', { branch: name }) : shortBranch(name)}</span>
              <VerdictDot verdict={tree.verdict} className="size-1.5" />
            </span>
          </MenuItem>
        )
      })}
      <MenuSeparator />
      <MenuItem icon={<Plus size={14} />} onSelect={() => navigate(`/p/${projectId}/c/new`)}>
        {t('travail.session.newTree')}
      </MenuItem>
    </Menu>
  )
}
