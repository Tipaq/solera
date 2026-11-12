import { AlarmClock, Bot, CalendarClock, CalendarDays, Hand, LayoutGrid, List, Pause, SquareTerminal } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Banner, EmptyState } from '@solera/ui'
import { ActionDrawer } from '../components/automations/ActionDrawer'
import { ActionsAgenda } from '../components/automations/ActionsAgenda'
import { LauncherGroup } from '../components/automations/LauncherGroup'
import { NewActionMenu, type NewActionEntry } from '../components/automations/NewActionMenu'
import { PlaceBand } from '../components/places/PlaceShell'
import { PlannedHealth } from '../components/planned/PlannedHealth'
import { PlannedTile, type PlannedHandlers } from '../components/planned/PlannedTile'
import { ScopeMark } from '../components/planned/ScopeMarks'
import { usePlannedGestures } from '../components/planned/usePlannedGestures'
import { FilterChip, OneLineToolbar, ToolbarSearch } from '../components/toolbar/OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../components/toolbar/ToolbarMenus'
import type { EditorSeed } from '../lib/action-editor'
import type { ActionPanel } from '../lib/action-panel'
import type { AgendaScope } from '../lib/agenda-layout'
import { scheduleTargetOf, type What } from '../lib/automations'
import { useAutomations } from '../lib/automations-query'
import { useTranslate, type MessageKey } from '../lib/i18n'
import {
  DUE_GROUPS,
  NEXT_FILTERS,
  NO_PLANNED_FILTERS,
  PLANNED_STATES,
  defaultTarget,
  groupByDue,
  groupByScope,
  launchWhere,
  matchesPlanned,
  matchesPlannedQuery,
  plannedFilterCount,
  plannedOf,
  plannedTally,
  scopeLabel,
  scopeOfTarget,
  scopeOptions,
  targetOf,
  togglePlanned,
  type DueGroup,
  type NextFilter,
  type PlannedFilters,
  type PlannedItem,
  type PlannedState,
  type ScopeOption,
} from '../lib/planned'
import { useProjects } from '../lib/projects'
import type { ScheduleTarget } from '../lib/schedules'
import { useStoredPref, useView } from '../lib/use-view'
import { viewStorageKey } from '../lib/view-pref'
import { useVaultState } from '../lib/vault'

const VIEWS = ['lanceur', 'agenda', 'liste'] as const
type View = (typeof VIEWS)[number]
type Grouping = 'due' | 'scope'

const WHAT: What[] = ['agent', 'command']
const WHAT_LABEL: Record<What, MessageKey> = { agent: 'planned.filter.what.agent', command: 'planned.filter.what.command' }
const STATE_LABEL: Record<PlannedState, MessageKey> = {
  active: 'planned.filter.state.active',
  paused: 'planned.filter.state.paused',
  failing: 'planned.filter.state.failing',
  review: 'planned.filter.state.review',
}
const NEXT_LABEL: Record<NextFilter, MessageKey> = { today: 'planned.filter.next.today', week: 'planned.filter.next.week' }

const DUE_TEXT: Record<DueGroup, { title: MessageKey; icon: ReactNode }> = {
  today: { title: 'planned.due.today', icon: <AlarmClock size={14} /> },
  week: { title: 'planned.due.week', icon: <CalendarDays size={14} /> },
  later: { title: 'planned.due.later', icon: <CalendarClock size={14} /> },
  idle: { title: 'planned.due.idle', icon: <Pause size={14} /> },
  demand: { title: 'planned.due.demand', icon: <Hand size={14} /> },
}

/** « + Tâche ▾ » (PLF-1) : un agent, une commande, ou planifier une action qui existe. */
const NEW_ENTRIES: NewActionEntry[] = [
  { kind: 'agent', icon: <Bot size={15} />, title: 'planned.new.agent', hint: 'planned.new.agentHint' },
  { kind: 'command', icon: <SquareTerminal size={15} />, title: 'planned.new.command', hint: 'planned.new.commandHint' },
  { kind: 'schedule', icon: <AlarmClock size={15} />, title: 'planned.new.schedule', hint: 'planned.new.scheduleHint' },
]

const readGrouping = (raw: string | null): Grouping => (raw === '"scope"' ? 'scope' : 'due')

/**
 * La page globale des **Planifiées** (`actions.md` §1.J, AC-20) : tout ce qui part seul, à
 * sa cadence, dans les projets, le Savoir et l'instance — chaque tâche avec sa portée.
 *
 * Une page de lieu sans rangée d'onglets : la bande, la barre sur une ligne, puis l'une
 * des trois vues d'« Affichage ▾ ». Le **Lanceur** (des tuiles au gabarit de l'onglet
 * Actions, par échéance ou par portée), l'**Agenda** (quand tout tombe), la **Liste** (la
 * santé : ce qui échoue d'abord, la réussite, le coût). Une tâche s'ouvre dans le tiroir
 * unifié des Actions, dans son projet ; « + Tâche » la crée planifiée d'office, dans la
 * portée qu'on choisit.
 */
export function SchedulesPage() {
  const t = useTranslate()
  const data = useAutomations({ all: true })
  const { data: projects } = useProjects()
  const { data: vault } = useVaultState()
  const [view, setView] = useView<View>('planifiees-v2', 'all', VIEWS)
  const [grouping, setGrouping] = useStoredPref<Grouping>(viewStorageKey('planifiees-v2-groupe', 'all'), readGrouping)
  const [agendaScope, setAgendaScope] = useState<AgendaScope>('week')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<PlannedFilters>(NO_PLANNED_FILTERS)
  const [panel, setPanel] = useState<ActionPanel | null>(null)
  const gestures = usePlannedGestures(setPanel)

  const open = useMemo(() => (projects ?? []).filter((project) => !project.archivedAt), [projects])
  const projectOf = (id: string) => projects?.find((project) => project.id === id) ?? null
  const planned = useMemo(() => plannedOf(data.items, projects ?? []), [data.items, projects])
  const scopes = useMemo(() => scopeOptions(planned, t), [planned, t])
  const now = Date.now()
  const shown = planned.filter((item) => matchesPlanned(item, filters, now) && matchesPlannedQuery(item, query, t))
  const tally = plannedTally(planned)
  const active = plannedFilterCount(filters)

  /** Une création d'ici est planifiée d'office (PLF-1), dans la portée donnée ou la première. */
  const create = (seed: EditorSeed, target: ScheduleTarget = defaultTarget(open, { vault: vault?.configured === true })) =>
    setPanel({ mode: 'edit', seed: { ...seed, schedule: true, target }, back: null })
  const onNew = (kind: NewActionEntry['kind']) => {
    if (kind === 'schedule') setPanel({ mode: 'pick' })
    else create({ preset: kind === 'agent' ? { what: 'agent' } : { what: 'command', kind: 'task' } })
  }

  const toggle = <G extends 'scopes' | 'what' | 'state'>(group: G, value: PlannedFilters[G][number]) =>
    setFilters((current) => togglePlanned(current, group, value))
  const scopeName = (key: string) => {
    const option = scopes.find((entry) => entry.key === key)
    return option ? scopeLabel(option.scope, t) : key
  }
  const chips = [
    ...filters.scopes.map((key) => ({ key: `scope-${key}`, label: scopeName(key), clear: () => toggle('scopes', key) })),
    ...filters.what.map((entry) => ({ key: `what-${entry}`, label: t(WHAT_LABEL[entry]), clear: () => toggle('what', entry) })),
    ...filters.state.map((entry) => ({ key: `state-${entry}`, label: t(STATE_LABEL[entry]), clear: () => toggle('state', entry) })),
    ...(filters.next ? [{ key: 'next', label: t(NEXT_LABEL[filters.next]), clear: () => setFilters((current) => ({ ...current, next: null })) }] : []),
  ]

  const views: ViewOption<View>[] = [
    { key: 'lanceur', label: t('planned.view.lanceur'), icon: <LayoutGrid size={16} /> },
    { key: 'agenda', label: t('planned.view.agenda'), icon: <CalendarDays size={16} /> },
    { key: 'liste', label: t('planned.view.liste'), icon: <List size={16} /> },
  ]

  const filterMenu = (
    <FilterMenu active={active} onClearAll={() => setFilters(NO_PLANNED_FILTERS)}>
      <MenuHeading>{t('planned.filter.scope')}</MenuHeading>
      {scopes.map((option) => (
        <MenuCheck key={option.key} checked={filters.scopes.includes(option.key)} onChange={() => toggle('scopes', option.key)} aside={option.count}>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <ScopeMark scope={option.scope} /> <span className="truncate">{scopeLabel(option.scope, t)}</span>
          </span>
        </MenuCheck>
      ))}
      <MenuHeading>{t('planned.filter.what')}</MenuHeading>
      {WHAT.map((entry) => (
        <MenuCheck key={entry} checked={filters.what.includes(entry)} onChange={() => toggle('what', entry)} aside={tally.what[entry]}>
          {t(WHAT_LABEL[entry])}
        </MenuCheck>
      ))}
      <MenuHeading>{t('planned.filter.state')}</MenuHeading>
      {PLANNED_STATES.map((entry) => (
        <MenuCheck key={entry} checked={filters.state.includes(entry)} onChange={() => toggle('state', entry)} aside={tally.state[entry]}>
          {t(STATE_LABEL[entry])}
        </MenuCheck>
      ))}
      <MenuHeading>{t('planned.filter.next')}</MenuHeading>
      {NEXT_FILTERS.map((entry) => (
        <MenuCheck
          key={entry}
          checked={filters.next === entry}
          onChange={() => setFilters((current) => ({ ...current, next: current.next === entry ? null : entry }))}
        >
          {t(NEXT_LABEL[entry])}
        </MenuCheck>
      ))}
    </FilterMenu>
  )

  const displayMenu = (
    <DisplayMenu views={views} value={view} onChange={setView}>
      {view === 'agenda' ? (
        <>
          <MenuHeading>{t('planned.display.period')}</MenuHeading>
          <MenuSegment<AgendaScope>
            label={t('planned.display.period')}
            segments={[
              { value: 'week', label: t('agenda.scope.week') },
              { value: 'day', label: t('agenda.scope.day') },
            ]}
            value={agendaScope}
            onChange={setAgendaScope}
          />
        </>
      ) : (
        <>
          <MenuHeading>{t('planned.display.group')}</MenuHeading>
          <MenuSegment<Grouping>
            label={t('planned.display.group')}
            segments={[
              { value: 'due', label: t(view === 'liste' ? 'planned.group.state' : 'planned.group.due') },
              { value: 'scope', label: t('planned.group.scope') },
            ]}
            value={grouping}
            onChange={setGrouping}
          />
        </>
      )}
    </DisplayMenu>
  )

  const empty = !data.isPending && planned.length === 0

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-clip">
      <PlaceBand
        icon={<CalendarClock size={16} className="text-ink-faint" />}
        title={t('planned.title')}
        actions={<NewActionMenu onPick={onNew} entries={NEW_ENTRIES} label="planned.new.label" button="planned.new.button" />}
      />
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder={t('planned.search')} />}
        filter={filterMenu}
        chips={chips.map((chip) => (
          <FilterChip key={chip.key} onClear={chip.clear}>
            {chip.label}
          </FilterChip>
        ))}
        extra={
          <span className="hidden text-xs whitespace-nowrap tabular-nums text-ink-faint lg:inline" data-planned-summary>
            {t(planned.length === 1 ? 'planned.summary.tasks.one' : 'planned.summary.tasks.other', { count: planned.length })}
            {' · '}
            {t(scopes.length === 1 ? 'planned.summary.scopes.one' : 'planned.summary.scopes.other', { count: scopes.length })}
          </span>
        }
        display={displayMenu}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-7 px-4 pt-4 pb-28 md:px-6 md:pt-6">
          {gestures.error ? <Banner>{gestures.error}</Banner> : null}
          {data.isPending && planned.length === 0 ? (
            <p role="status" className="text-sm text-ink-faint">{t('schedule.loading')}</p>
          ) : empty ? (
            <EmptyState
              icon={<CalendarClock size={22} />}
              title={t('planned.empty.title')}
              description={t('planned.empty.body')}
              action={<NewActionMenu onPick={onNew} entries={NEW_ENTRIES} label="planned.new.label" button="planned.new.button" />}
            />
          ) : view === 'agenda' ? (
            <ActionsAgenda items={shown} scope={agendaScope} onScope={setAgendaScope} onOpen={(item) => gestures.handlers.onOpen(item)} />
          ) : shown.length === 0 && !data.isPending ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">{t('planned.noMatch')}</p>
          ) : view === 'lanceur' ? (
            <Launcher items={shown} scopes={scopes} grouping={grouping} now={now} handlers={gestures.handlers} onAdd={(target) => create({}, target)} />
          ) : (
            <PlannedHealth items={shown} group={grouping} costOf={data.costOf} onOpen={gestures.handlers.onOpen} />
          )}
        </div>
      </div>

      <ActionDrawer
        projectId={null}
        items={data.items}
        panel={panel}
        onPanel={setPanel}
        onClose={() => setPanel(null)}
        launchWhere={(item) => launchWhere(scopeOfTarget(scheduleTargetOf(item), projectOf), t)}
      />
      {gestures.dialogs}
    </div>
  )
}

/**
 * Le Lanceur (PLF-4) : par échéance (aujourd'hui, cette semaine, plus tard, en pause, à la
 * demande) ou par portée ; chaque groupe a sa tuile « + Tâche », un groupe vide se tait.
 */
function Launcher({
  items,
  scopes,
  grouping,
  now,
  handlers,
  onAdd,
}: {
  items: readonly PlannedItem[]
  scopes: readonly ScopeOption[]
  grouping: Grouping
  now: number
  handlers: PlannedHandlers
  /** Une tâche neuve, dans la portée du groupe quand on range par portée. */
  onAdd: (target?: ScheduleTarget) => void
}) {
  const t = useTranslate()
  const add = (target?: ScheduleTarget) => ({ label: t('planned.new.button'), onClick: () => onAdd(target) })
  const groups =
    grouping === 'scope'
      ? groupByScope(items, scopes).map((group) => ({
          key: group.key,
          icon: <ScopeMark scope={group.scope} />,
          name: scopeLabel(group.scope, t),
          items: group.items,
          add: add(targetOf(group.scope)),
        }))
      : (() => {
          const byDue = groupByDue(items, now)
          return DUE_GROUPS.map((key) => ({ key, icon: DUE_TEXT[key].icon, name: t(DUE_TEXT[key].title), items: byDue[key], add: add() }))
        })()
  return (
    <>
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <LauncherGroup key={group.key} icon={group.icon} title={group.name} count={group.items.length} add={group.add}>
            {group.items.map((item) => (
              <PlannedTile key={item.id} item={item} handlers={handlers} />
            ))}
          </LauncherGroup>
        ),
      )}
    </>
  )
}
