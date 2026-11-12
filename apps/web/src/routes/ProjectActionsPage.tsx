import { Bot, CalendarDays, LayoutGrid, List, Server, SquareTerminal } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Banner } from '@solera/ui'
import { ActionDrawer } from '../components/automations/ActionDrawer'
import { ActionRow, ActionSection } from '../components/automations/ActionRow'
import { ActionTile } from '../components/automations/ActionTile'
import { ActionsAgenda } from '../components/automations/ActionsAgenda'
import { ActionsStatusMeta } from '../components/automations/ActionsStatusMeta'
import { LauncherGroup } from '../components/automations/LauncherGroup'
import { NewActionMenu } from '../components/automations/NewActionMenu'
import { SessionWorksSection } from '../components/automations/session-works/SessionWorksSection'
import { useActionGestures, type ActionHandlers } from '../components/automations/useActionGestures'
import { PanelHost } from '../components/shell/PanelHost'
import { FilterChip, OneLineToolbar, ToolbarSearch } from '../components/toolbar/OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../components/toolbar/ToolbarMenus'
import type { AgendaScope } from '../lib/agenda-layout'
import { newActionPanel, type ActionPanel } from '../lib/action-panel'
import {
  ACTIONS_VIEWS,
  ACTION_PARAM,
  actionsStatus,
  filterTally,
  launcherGroupsOf,
  panelAddress,
  panelFromAddress,
  sectionsOf,
  toggleFilter,
  withAddress,
  worksShown,
  type ActionsView,
  type PanelAddress,
} from '../lib/actions-tab'
import {
  NO_FILTERS,
  filterCount,
  matchesFilters,
  matchesQuery,
  type Automation,
  type AutomationFilters,
  type LauncherGroup as Group,
  type Section,
  type StateFilter,
  type What,
  type WhenFilter,
} from '../lib/automations'
import { useAutomations } from '../lib/automations-query'
import { NEW_PARAM } from '../lib/place'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { humanLabel } from '../lib/session-works'
import { useSessionWorks } from '../lib/session-works-query'
import { useView } from '../lib/use-view'

const WHAT: What[] = ['command', 'agent']
const WHEN: WhenFilter[] = ['demand', 'scheduled']
const STATE: StateFilter[] = ['live', 'review', 'failing']

const WHAT_LABEL: Record<What, MessageKey> = { command: 'actionsTab.filter.what.command', agent: 'actionsTab.filter.what.agent' }
const WHEN_LABEL: Record<WhenFilter, MessageKey> = { demand: 'actionsTab.filter.when.demand', scheduled: 'actionsTab.filter.when.scheduled' }
const STATE_LABEL: Record<StateFilter, MessageKey> = {
  live: 'actionsTab.filter.state.live',
  review: 'actionsTab.filter.state.review',
  failing: 'actionsTab.filter.state.failing',
}

const GROUPS: { key: Group; icon: ReactNode; title: MessageKey; add: MessageKey; kind: 'service' | 'command' | 'agent' }[] = [
  { key: 'services', icon: <Server size={14} />, title: 'actionsTab.group.services', add: 'actionsTab.group.addService', kind: 'service' },
  { key: 'commands', icon: <SquareTerminal size={14} />, title: 'actionsTab.group.commands', add: 'actionsTab.group.addCommand', kind: 'command' },
  { key: 'agents', icon: <Bot size={14} />, title: 'actionsTab.group.agents', add: 'actionsTab.group.addAgent', kind: 'agent' },
]

const SECTION_TEXT: Record<Section, { title: MessageKey; hint: MessageKey }> = {
  live: { title: 'actionsTab.section.live', hint: 'actionsTab.section.liveHint' },
  review: { title: 'actionsTab.section.review', hint: 'actionsTab.section.reviewHint' },
  scheduled: { title: 'actionsTab.section.scheduled', hint: 'actionsTab.section.scheduledHint' },
  demand: { title: 'actionsTab.section.demand', hint: 'actionsTab.section.demandHint' },
}

/**
 * L'onglet **Actions** d'un projet (`actions.md` §1.B, AC-19) : les actions et les tâches
 * planifiées, un seul objet (Quoi × Quand). Une barre sur une ligne, puis le **Lanceur**
 * (des tuiles rangées par nature), la **Liste** (par état) ou l'**Agenda** (les passages).
 * Une action s'ouvre dans le tiroir unifié ; `?action=` et `?nouvelle=` l'ouvrent depuis
 * un lien, et le suivent.
 */
export function ProjectActionsPage() {
  const { projectId } = useParams()
  if (!projectId) return null
  return <ActionsTab key={projectId} projectId={projectId} />
}

function ActionsTab({ projectId }: { projectId: string }) {
  const t = useTranslate()
  const data = useAutomations({ projectId })
  const works = useSessionWorks(projectId)
  const [view, setView] = useView<ActionsView>('actions', projectId, ACTIONS_VIEWS)
  const [agendaScope, setAgendaScope] = useState<AgendaScope>('week')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<AutomationFilters>(NO_FILTERS)
  const [panel, setPanel] = usePanelAddress()
  const gestures = useActionGestures(projectId, setPanel)

  const shown = useMemo(
    () => data.items.filter((item) => matchesFilters(item, filters) && matchesQuery(item, query)),
    [data.items, filters, query],
  )
  const worksHere = worksShown(works, filters, query, (work) => humanLabel(work, t))
  const tally = filterTally(data.items)
  const status = actionsStatus(data.items, works)
  const active = filterCount(filters)

  const toggle = <G extends keyof AutomationFilters>(group: G, value: AutomationFilters[G][number]) =>
    setFilters((current) => toggleFilter(current, group, value))
  const chips = [
    ...filters.what.map((entry) => ({ key: `what-${entry}`, label: t(WHAT_LABEL[entry]), clear: () => toggle('what', entry) })),
    ...filters.when.map((entry) => ({ key: `when-${entry}`, label: t(WHEN_LABEL[entry]), clear: () => toggle('when', entry) })),
    ...filters.state.map((entry) => ({ key: `state-${entry}`, label: t(STATE_LABEL[entry]), clear: () => toggle('state', entry) })),
  ]

  const { handlers } = gestures

  const views: ViewOption<ActionsView>[] = [
    { key: 'lanceur', label: t('actionsTab.view.lanceur'), icon: <LayoutGrid size={16} /> },
    { key: 'liste', label: t('actionsTab.view.liste'), icon: <List size={16} /> },
    { key: 'agenda', label: t('actionsTab.view.agenda'), icon: <CalendarDays size={16} /> },
  ]

  const filterMenu = (
    <FilterMenu active={active} onClearAll={() => setFilters(NO_FILTERS)}>
      <MenuHeading>{t('actionsTab.filter.what')}</MenuHeading>
      {WHAT.map((entry) => (
        <MenuCheck key={entry} checked={filters.what.includes(entry)} onChange={() => toggle('what', entry)} aside={tally.what[entry]}>
          {t(WHAT_LABEL[entry])}
        </MenuCheck>
      ))}
      <MenuHeading>{t('actionsTab.filter.when')}</MenuHeading>
      {WHEN.map((entry) => (
        <MenuCheck key={entry} checked={filters.when.includes(entry)} onChange={() => toggle('when', entry)} aside={tally.when[entry]}>
          {t(WHEN_LABEL[entry])}
        </MenuCheck>
      ))}
      <MenuHeading>{t('actionsTab.filter.state')}</MenuHeading>
      {STATE.map((entry) => (
        <MenuCheck key={entry} checked={filters.state.includes(entry)} onChange={() => toggle('state', entry)} aside={tally.state[entry]}>
          {t(STATE_LABEL[entry])}
        </MenuCheck>
      ))}
    </FilterMenu>
  )

  const displayMenu = (
    <DisplayMenu views={views} value={view} onChange={setView}>
      {view === 'agenda' ? (
        <>
          <MenuHeading>{t('actionsTab.display.period')}</MenuHeading>
          <MenuSegment<AgendaScope>
            label={t('actionsTab.display.period')}
            segments={[
              { value: 'week', label: t('agenda.scope.week') },
              { value: 'day', label: t('agenda.scope.day') },
            ]}
            value={agendaScope}
            onChange={setAgendaScope}
          />
        </>
      ) : (
        <p className="px-3 pt-1 text-xs text-ink-faint">{t(view === 'lanceur' ? 'actionsTab.display.lanceurHint' : 'actionsTab.display.listeHint')}</p>
      )}
    </DisplayMenu>
  )

  const worksSection = (variant: 'tiles' | 'rows') => (
    <SessionWorksSection
      projectId={projectId}
      works={worksHere}
      variant={variant}
      onMakeAction={(seed) => setPanel({ mode: 'edit', seed, back: null })}
    />
  )
  const nothing = !data.isPending && data.items.length === 0 && works.length === 0
  const noMatch = !nothing && shown.length === 0 && worksHere.length === 0 && (active > 0 || query.trim() !== '')

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-clip">
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder={t('actionsTab.search')} />}
        filter={filterMenu}
        chips={chips.map((chip) => (
          <FilterChip key={chip.key} onClear={chip.clear}>
            {chip.label}
          </FilterChip>
        ))}
        extra={
          <span className="hidden sm:flex">
            <ActionsStatusMeta
              status={status}
              onRunning={() => setFilters({ ...NO_FILTERS, state: ['live'] })}
              onReview={() => setFilters({ ...NO_FILTERS, state: ['review'] })}
            />
          </span>
        }
        display={displayMenu}
        action={<NewActionMenu onPick={(kind) => setPanel(newActionPanel(kind))} />}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-7 px-4 pt-4 pb-28 md:px-6 md:pt-6">
          {gestures.error ? <Banner>{gestures.error}</Banner> : null}
          {view === 'lanceur' ? (
            <>
              {worksSection('tiles')}
              <Launcher items={shown} handlers={handlers} gestures={gestures} onNew={(kind) => setPanel(newActionPanel(kind))} />
            </>
          ) : view === 'agenda' ? (
            <ActionsAgenda items={shown} scope={agendaScope} onScope={setAgendaScope} onOpen={(item) => handlers.onOpen(item)} />
          ) : nothing || noMatch ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
              {t(nothing ? 'actionsTab.empty' : 'actionsTab.noMatch')}
            </p>
          ) : (
            <ListView items={shown} handlers={handlers} gestures={gestures} works={worksSection('rows')} />
          )}
        </div>
      </div>

      <ActionDrawer projectId={projectId} items={data.items} panel={panel} onPanel={setPanel} onClose={() => setPanel(null)} />
      {gestures.dialogs}
      <PanelHost projectId={projectId} />
    </div>
  )
}

type Gestures = ReturnType<typeof useActionGestures>

/** Le Lanceur (LAN-1) : Services, Commandes, Agents, chacun avec sa tuile d'ajout, même vide. */
function Launcher({
  items,
  handlers,
  gestures,
  onNew,
}: {
  items: Automation[]
  handlers: ActionHandlers
  gestures: Gestures
  onNew: (kind: 'service' | 'command' | 'agent') => void
}) {
  const t = useTranslate()
  const groups = launcherGroupsOf(items)
  return (
    <>
      {GROUPS.map((group) => (
        <LauncherGroup
          key={group.key}
          icon={group.icon}
          title={t(group.title)}
          count={groups[group.key].length}
          add={{ label: t(group.add), onClick: () => onNew(group.kind) }}
        >
          {groups[group.key].map((item) => (
            <ActionTile key={item.id} item={item} served={gestures.servedOf(item)} serving={gestures.serving(item)} handlers={handlers} />
          ))}
        </LauncherGroup>
      ))}
    </>
  )
}

/** La Liste (LST-1) : En cours, Lancés par les sessions, À relire, Planifiées, À la demande. */
function ListView({ items, handlers, gestures, works }: { items: Automation[]; handlers: ActionHandlers; gestures: Gestures; works: ReactNode }) {
  const t = useTranslate()
  const sections = sectionsOf(items)
  const section = (key: Section) => (
    <ActionSection
      key={key}
      title={t(SECTION_TEXT[key].title)}
      hint={t(SECTION_TEXT[key].hint)}
      count={sections[key].length}
      tone={key === 'review' ? 'caution' : undefined}
    >
      {sections[key].map((item) => (
        <ActionRow key={item.id} item={item} section={key} served={gestures.servedOf(item)} handlers={handlers} />
      ))}
    </ActionSection>
  )
  return (
    <>
      {section('live')}
      {works}
      {section('review')}
      {section('scheduled')}
      {section('demand')}
    </>
  )
}

/**
 * Le tiroir et l'adresse, dans les deux sens (AO-7) : `?action=` et `?nouvelle=`
 * l'ouvrent au chargement ou depuis un lien suivi sur la page ; l'ouvrir, le fermer ou
 * passer du détail à l'édition réécrivent l'adresse, sans entrée d'historique.
 */
function usePanelAddress(): [ActionPanel | null, (next: ActionPanel | null) => void] {
  const [params, setParams] = useSearchParams()
  const action = params.get(ACTION_PARAM)
  const nouvelle = params.get(NEW_PARAM)
  const [panel, setPanelState] = useState<ActionPanel | null>(() => panelFromAddress({ action, nouvelle }))
  // L'adresse que la page a écrite elle-même : une autre vient d'un lien, et se suit.
  const written = useRef(keyOf({ action, nouvelle }))
  useEffect(() => {
    const key = keyOf({ action, nouvelle })
    // Un rendu en retard sur `location` montre une adresse déjà dépassée.
    if (key === written.current || key !== keyOf(addressNow())) return
    written.current = key
    setPanelState(panelFromAddress({ action, nouvelle }))
  }, [action, nouvelle])

  /*
    L'adresse se lit au moment du geste, dans `location` : celle que rend le routeur
    retarde d'une transition sur le tiroir, et la fermeture que garde le tiroir date
    parfois d'un rendu où `?action=` n'était pas encore posé.
  */
  const write = useRef(setParams)
  write.current = setParams
  const setPanel = useCallback((next: ActionPanel | null) => {
    setPanelState(next)
    const target = panelAddress(next, addressNow().nouvelle)
    written.current = keyOf(target)
    if (written.current !== keyOf(addressNow())) write.current(withAddress(new URLSearchParams(window.location.search), target), { replace: true })
  }, [])
  return [panel, setPanel]
}

const keyOf = (address: PanelAddress) => `${address.action ?? ''}|${address.nouvelle ?? ''}`

/** L'adresse du moment, celle que le routeur vient d'écrire même s'il ne l'a pas encore rendue. */
function addressNow(): PanelAddress {
  const params = new URLSearchParams(window.location.search)
  return { action: params.get(ACTION_PARAM), nouvelle: params.get(NEW_PARAM) }
}
