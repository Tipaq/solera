import { Activity, FolderGit2, GitBranch, Plus, Rows3 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { Button, EmptyState, Popover, cx } from '@solera/ui'
import { AgentIcon, AGENT_LABELS } from '../components/AgentIcon'
import { ActivityRail, type RailModel } from '../components/activity/ActivityRail'
import { BaseLine } from '../components/code/BaseLine'
import { TreeChip } from '../components/code/TreeChip'
import { VerdictDot } from '../components/code/VerdictDot'
import { AskInbox } from '../components/inbox/AskInbox'
import { journalDestination } from '../components/journal/JournalView'
import { WorktreeGroups } from '../components/project/WorktreeGroups'
import { FilterChip, OneLineToolbar, ToolbarSearch } from '../components/toolbar/OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../components/toolbar/ToolbarMenus'
import { TravailIndex } from '../components/travail/TravailIndex'
import { isActiveFilter, matchesActivity, parseActivityFilter } from '../lib/activity-groups'
import type { ActivityRow } from '../lib/activity-rows'
import { formatBytes, isCleanable, pluralOf, shortBranch, type TreeRow } from '../lib/code-model'
import { locale, useTranslate, type MessageKey } from '../lib/i18n'
import type { InboxItem } from '../lib/inbox'
import { useJournalDays } from '../lib/journal'
import { useProjects } from '../lib/projects'
import {
  NO_FILTERS,
  PERIODS,
  STATE_KEYS,
  WHAT_KEYS,
  agentOptions,
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
  type Period,
  type TravailFilters,
  type TravailView,
} from '../lib/travail-model'
import { useStoredPref, useView } from '../lib/use-view'
import { useTravail, type Travail } from '../lib/use-travail'
import { viewStorageKey } from '../lib/view-pref'
import { useWorktreeStatuses } from '../lib/worktrees'

/** L'arbre ou la branche choisis, portés par l'adresse pour qu'un rechargement les garde. */
const TARGET_PARAM = 'arbre'

/**
 * Les vues livrées, dans l'ordre de leurs tuiles. Les quatre autres de `TRAVAIL_VIEWS`
 * (Tableau, Graphe, Par état, Frise) arrivent avec leurs cartes (#177 à #179).
 *
 * « Par arbre » montre, en attendant ses couloirs (#176), le regroupement par worktree
 * de l'ancienne Activité, qui porte le nettoyage des arbres.
 */
const VIEW_ICONS: Partial<Record<TravailView, ReactNode>> = {
  couloirs: <Rows3 size={16} />,
  fil: <Activity size={16} />,
}
/** Les vues où l'index des arbres a un sens. Les couloirs le prendront avec #176. */
const WITH_INDEX: TravailView[] = ['fil']

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

function TravailPage({ projectId, project }: { projectId: string; project: ProjectDto }) {
  const t = useTranslate()
  const travail = useTravail(projectId, project)
  const { code, branches, milestones } = travail
  const [params, setParams] = useSearchParams()
  const hasGit = Boolean(project.git)

  const views: ViewOption<TravailView>[] = (hasGit ? (['couloirs', 'fil'] as const) : (['fil'] as const)).map((key) => ({
    key,
    label: t(`travail.view.${key}`),
    icon: VIEW_ICONS[key]!,
  }))
  const [view, setView] = useView<TravailView>('travail', projectId, views.map((option) => option.key))
  const [filters, setFilters] = useStoredPref(viewStorageKey('travail.filtres', projectId), readFilters)
  const [display, setDisplay] = useStoredPref(viewStorageKey('travail.affichage', projectId), readDisplay)
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
  const set = (patch: Partial<TravailFilters>) => setFilters({ ...filters, ...patch })
  const clearAll = () => {
    setFilters(NO_FILTERS)
    setTarget(null)
  }

  /* ---------------------------------------------------------------- le filtrage */

  const now = Date.now()
  const from = periodStart(filters.period, now)
  const milestoneOfRow = (row: ActivityRow) => milestones.ofCard(row.entry.conversation.card?.number ?? null)
  const searchesRow = (row: ActivityRow) =>
    matchesActivity(search, { group: row.group, title: row.entry.conversation.title, branch: row.place.branch, card: row.entry.conversation.card })

  const live = travail.live.filter((row) => searchesRow(row) && rowPasses(row, filters, target, milestoneOfRow(row)?.number ?? null))
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
  const nothing = active > 0 && live.length === 0 && inbox.length === 0 && entries.length === 0

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
          {t('travail.display.index')} <span className="text-xs text-ink-faint">{t('travail.display.indexFilter')}</span>
        </MenuCheck>
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
  const forceCleanup = filters.states.includes('cleanup') || filters.states.includes('merged')
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

  return (
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
            <TravailIndex trees={indexed} branches={indexedBranches} current={targetKey} onChoose={setTarget} mode="filter" />
          </aside>
        ) : null}
        <div className="h-full min-h-0 overflow-y-auto">
          {nothing ? (
            <div className="flex flex-col gap-5 px-4 pt-4 pb-28 md:px-6">
              {base}
              <NoMatch onClear={clearAll} />
            </div>
          ) : view === 'fil' ? (
            <ActivityRail
              model={rail}
              before={base ?? undefined}
              entryAside={(entry) => chipOf(travail.treeOfEntry(entry))}
              rowAside={(row) => chipOf(travail.treeOfRow(row))}
            />
          ) : (
            <TreesInterim travail={travail} projectId={projectId} project={project} base={base} inbox={inbox} filters={filters} target={target} search={search} />
          )}
        </div>
      </div>
    </div>
  )
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
 * « Par arbre », en attendant ses couloirs (#176) : les sessions rangées sous leur arbre,
 * avec le nettoyage des arbres fusionnés, comme l'Activité groupée par worktree.
 */
function TreesInterim({
  travail,
  projectId,
  project,
  base,
  inbox,
  filters,
  target,
  search,
}: {
  travail: Travail
  projectId: string
  project: ProjectDto
  base: ReactNode
  inbox: InboxItem[]
  filters: TravailFilters
  target: ReturnType<typeof targetOf>
  search: ReturnType<typeof parseActivityFilter>
}) {
  const { data: status } = useWorktreeStatuses(project.git ? projectId : undefined)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const rows = travail.rows.filter(
    (row) =>
      matchesActivity(search, { group: row.group, title: row.entry.conversation.title, branch: row.place.branch, card: row.entry.conversation.card }) &&
      rowPasses(row, filters, target, travail.milestones.ofCard(row.entry.conversation.card?.number ?? null)?.number ?? null),
  )
  return (
    <div className="flex flex-col gap-5 pt-4 pb-28">
      {base ? <div className="px-4 md:px-6">{base}</div> : null}
      {inbox.length > 0 ? (
        <div className="px-4 md:px-6">
          <AskInbox items={inbox} />
        </div>
      ) : null}
      <WorktreeGroups
        projectId={projectId}
        rows={rows}
        status={status}
        rootGit={project.git}
        conversations={travail.conversations}
        filtering={isActiveFilter(search)}
        words={search.words}
        expanded={expanded}
        onToggle={(id) =>
          setExpanded((current) => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
          })
        }
      />
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
  const [open, setOpen] = useState(false)
  const usable = trees.filter((tree) => tree.root || (tree.id !== null && !isCleanable(tree) && tree.verdict !== 'missing'))
  const go = (path: string) => {
    setOpen(false)
    navigate(path)
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label={t('travail.session.label')}
      side="bottom"
      align="end"
      className="w-72"
      trigger={
        <Button size="sm" icon={<Plus size={15} />}>
          {t('travail.session.button')}
        </Button>
      }
    >
      <div className="py-2">
        <MenuHeading>{t('travail.session.where')}</MenuHeading>
        {usable.map((tree) => {
          const name = tree.branch ?? tree.name
          return (
            <button
              key={tree.key}
              type="button"
              onClick={() => go(tree.root || !tree.id ? `/p/${projectId}/c/new` : `/p/${projectId}/c/new?worktree=${tree.id}`)}
              className="flex min-h-11 w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-high md:min-h-8 pointer-coarse:min-h-11"
            >
              {tree.root ? <FolderGit2 size={13} aria-hidden className="shrink-0 text-ink-faint" /> : <GitBranch size={13} aria-hidden className="shrink-0 text-ink-faint" />}
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{tree.root ? t('travail.session.root', { branch: name }) : shortBranch(name)}</span>
              <VerdictDot verdict={tree.verdict} className="size-1.5" />
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => go(`/p/${projectId}/c/new`)}
          className="mt-1 flex min-h-11 w-full items-center gap-2 border-t border-line px-3 pt-2 pb-1 text-left text-sm text-ink-soft hover:text-ink md:min-h-8 pointer-coarse:min-h-11"
        >
          <Plus size={13} aria-hidden /> {t('travail.session.newTree')}
        </button>
      </div>
    </Popover>
  )
}
