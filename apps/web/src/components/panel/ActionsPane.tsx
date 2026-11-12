import { memo, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { flushSync } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarDays, LayoutGrid, List, Loader, Maximize2, Plus } from 'lucide-react'
import { Button, PanelGroup, PanelNotice, PanelToolbar, Tooltip, panelToolClass } from '@solera/ui'
import type { EditorSeed } from '../../lib/action-editor'
import { newActionPanel, type ActionPanel } from '../../lib/action-panel'
import { suggestionDraft, suggestionWhy, useActionSuggestions } from '../../lib/actions'
import {
  PANE_SECTIONS,
  paneOffersExpand,
  paneSectionsOf,
  paneShowsSearch,
  paneSuggestions,
  readPaneView,
  suggestionSeed,
} from '../../lib/actions-pane'
import { actionsStatus, launcherGroupsOf, worksShown, type ActionsView } from '../../lib/actions-tab'
import type { AgendaScope } from '../../lib/agenda-layout'
import { LAUNCHER_GROUPS, NO_FILTERS, matchesQuery, type Automation, type LauncherGroup, type Section } from '../../lib/automations'
import { useAutomations } from '../../lib/automations-query'
import { useEscapeLayer } from '../../lib/escape-layers'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import { showTerminal, useActionEditRequest } from '../../lib/panel'
import { humanLabel } from '../../lib/session-works'
import { useSessionWorks } from '../../lib/session-works-query'
import { useStoredPref } from '../../lib/use-view'
import { viewStorageKey } from '../../lib/view-pref'
import { ActionDrawer, panelShows } from '../automations/ActionDrawer'
import { ActionLine, type LineWhere } from '../automations/ActionLine'
import { ActionsAgenda } from '../automations/ActionsAgenda'
import { ActionsStatusMeta } from '../automations/ActionsStatusMeta'
import { NewActionMenu } from '../automations/NewActionMenu'
import { SessionWorksSection } from '../automations/session-works/SessionWorksSection'
import { useActionGestures, type ActionHandlers } from '../automations/useActionGestures'
import { ToolbarSearch } from '../toolbar/OneLineToolbar'
import { DisplayMenu, MenuHeading, MenuSegment, type ViewOption } from '../toolbar/ToolbarMenus'
import { CommandRunDetail, CommandRunsGroup, useCommandRuns } from './CommandRuns'

const GROUP_TITLE: Record<LauncherGroup, MessageKey> = {
  services: 'actionsTab.group.services',
  commands: 'actionsTab.group.commands',
  agents: 'actionsTab.group.agents',
}

const SECTION_TITLE: Record<Section, MessageKey> = {
  live: 'panel.actions.group.live',
  review: 'actionsTab.section.review',
  scheduled: 'actionsTab.section.scheduled',
  demand: 'actionsTab.section.demand',
}

/** Les ancres de la Liste, où mènent « N en marche » et « N à relire » (PACT-1). */
const RUNNING_ANCHOR = 'pane-actions-running'
const REVIEW_ANCHOR = 'pane-actions-review'

/**
 * L'onglet Actions du panneau d'une conversation (`actions.md` §1.K, AC-23) : **toutes**
 * les actions du projet, sans quitter la session. Une ligne d'outils — le titre et son
 * compte, ce qui tourne et ce qui attend, la recherche au-delà de huit actions,
 * « Affichage », « + Nouvelle ▾ » et ↗ vers l'onglet du projet —, puis l'une des trois
 * vues de l'onglet du projet, à l'échelle du panneau : le **Lanceur** en lignes (les
 * commandes lancées ici et les processus des sessions en tête, puis services,
 * commandes, agents), la **Liste** par état, l'**Agenda** en liste par jour.
 *
 * Lancer part dans le worktree de la conversation. Le détail d'une commande lancée, celui
 * d'une action, son édition et le choix d'une action à planifier s'ouvrent **en pile**,
 * à la place de la liste (`ActionDrawer`) ; Échap y remonte d'un niveau. « En faire une
 * action », venu d'un autre onglet (`requestActionEdit`), ouvre ici l'éditeur pré-rempli.
 */
export const ActionsPane = memo(function ActionsPane({
  projectId,
  conversationId,
  onExpand,
}: {
  projectId: string
  conversationId?: string
  /** Passe le panneau en plein écran ; absent quand il couvre déjà l'écran. */
  onExpand?: () => void
}) {
  const t = useTranslate()
  const data = useAutomations({ projectId })
  const works = useSessionWorks(projectId, { conversationId })
  const runs = useCommandRuns(projectId, conversationId)
  const [view, setView] = useStoredPref<ActionsView>(viewStorageKey('panneau-actions', projectId), readPaneView)
  const [agendaScope, setAgendaScope] = useState<AgendaScope>('day')
  const [query, setQuery] = useState('')
  const [panel, setPanel] = useState<ActionPanel | null>(null)
  const [openRun, setOpenRun] = useState<string | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const gestures = useActionGestures(projectId, setPanel, { conversationId })
  const root = useRef<HTMLDivElement>(null)
  const width = useWidth(root)
  const where: LineWhere = conversationId ? 'here' : 'root'

  // « En faire une action » venu de l'onglet Agent : l'éditeur pré-rempli, en pile.
  useActionEditRequest((seed) => {
    setOpenRun(null)
    setPanel({ mode: 'edit', seed, back: null })
  })
  // Une action supprimée ailleurs referme son détail, sans le rouvrir si elle revenait.
  if (panel && !data.isPending && !panelShows(panel, data.items)) setPanel(null)
  // Un terminal fermé ailleurs ramène à la liste.
  const shownRun = runs.find((run) => run.terminalId === openRun) ?? null
  useEscapeLayer(shownRun !== null, () => setOpenRun(null), root)

  const handlers: ActionHandlers = {
    ...gestures.handlers,
    // Une commande qui tourne : son terminal, dans l'onglet Terminaux.
    onTerminal: (_item, terminalId) => showTerminal(terminalId),
  }
  const items = data.items.filter((item) => matchesQuery(item, query))
  const worksHere = worksShown(works, NO_FILTERS, query, (work) => humanLabel(work, t))
  const empty = !data.isPending && data.items.length === 0

  /** « N en marche », « N à relire » : la Liste, descendue jusqu'au groupe. */
  const showInList = (anchor: string) => {
    flushSync(() => setView('liste'))
    root.current?.querySelector(`#${anchor}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  const views: ViewOption<ActionsView>[] = [
    { key: 'lanceur', label: t('actionsTab.view.lanceur'), icon: <LayoutGrid size={14} /> },
    { key: 'liste', label: t('actionsTab.view.liste'), icon: <List size={14} /> },
    { key: 'agenda', label: t('actionsTab.view.agenda'), icon: <CalendarDays size={14} /> },
  ]

  const line = (item: Automation) => <ActionLine key={item.id} item={item} where={where} handlers={handlers} />
  const runsGroup = <CommandRunsGroup projectId={projectId} runs={runs} onOpen={(run) => setOpenRun(run.terminalId)} onError={setRunError} />
  const worksGroup = (
    <SessionWorksSection
      projectId={projectId}
      works={worksHere}
      variant="compact"
      currentConversationId={conversationId}
      onMakeAction={(seed) => setPanel({ mode: 'edit', seed, back: null })}
      onError={setRunError}
    />
  )

  let body: ReactNode
  if (shownRun) {
    body = (
      <CommandRunDetail
        key={shownRun.terminalId}
        projectId={projectId}
        conversationId={conversationId}
        run={shownRun}
        onBack={() => setOpenRun(null)}
        onRelaunched={setOpenRun}
      />
    )
  } else if (panelShows(panel, data.items)) {
    body = (
      <>
        {onExpand && paneOffersExpand(panel, width, onExpand !== undefined) ? (
          <PanelNotice>
            <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {t('panel.actions.narrow')}
              <Button size="sm" variant="secondary" icon={<Maximize2 size={13} />} onClick={onExpand}>
                {t('panel.actions.expand')}
              </Button>
            </span>
          </PanelNotice>
        ) : null}
        <ActionDrawer
          projectId={projectId}
          items={data.items}
          panel={panel}
          onPanel={setPanel}
          onClose={() => setPanel(null)}
          conversationId={conversationId}
          backLabel={t('panel.actions.title')}
        />
      </>
    )
  } else {
    body = (
      <>
        <PanelToolbar
          title={t('panel.actions.title')}
          meta={data.items.length}
          lead={
            <ActionsStatusMeta
              compact
              status={actionsStatus(data.items, works)}
              onRunning={() => showInList(RUNNING_ANCHOR)}
              onReview={() => showInList(REVIEW_ANCHOR)}
            />
          }
        >
          {paneShowsSearch(data.items.length) ? (
            <ToolbarSearch value={query} onChange={setQuery} placeholder={t('panel.actions.search')} widthClass={query ? 'w-40' : 'w-28 focus-within:w-40'} />
          ) : null}
          <DisplayMenu compact views={views} value={view} onChange={setView}>
            {view === 'agenda' ? (
              <>
                <MenuHeading>{t('actionsTab.display.period')}</MenuHeading>
                <MenuSegment<AgendaScope>
                  label={t('actionsTab.display.period')}
                  segments={[
                    { value: 'day', label: t('agenda.scope.day') },
                    { value: 'week', label: t('agenda.scope.week') },
                  ]}
                  value={agendaScope}
                  onChange={setAgendaScope}
                />
              </>
            ) : (
              <p className="px-3 pt-1 text-xs text-ink-faint">{t(view === 'lanceur' ? 'actionsTab.display.lanceurHint' : 'panel.actions.hint.list')}</p>
            )}
          </DisplayMenu>
          <NewActionMenu inPanel onPick={(kind) => setPanel(newActionPanel(kind))} />
          <Link to={`/p/${projectId}/actions`} aria-label={t('panel.actions.openTab')} title={t('panel.actions.openTab')} className={panelToolClass()}>
            <ArrowUpRight size={14} aria-hidden />
          </Link>
        </PanelToolbar>

        <div data-panel-actions-view={view} className="min-h-0 flex-1 overflow-y-auto pb-2">
          {data.isPending ? (
            <p className="flex items-center gap-1.5 px-3 py-3 text-xs text-ink-faint">
              <Loader size={12} className="animate-spin" />
              {t('actions.loading')}
            </p>
          ) : null}
          {empty ? <EmptyPane projectId={projectId} onSeed={(seed) => setPanel({ mode: 'edit', seed, back: null })} /> : null}
          {view === 'agenda' ? (
            <div className="p-3">
              <ActionsAgenda items={items} scope={agendaScope} onScope={setAgendaScope} onOpen={(item) => handlers.onOpen(item)} />
            </div>
          ) : view === 'liste' ? (
            <ListView items={items} line={line} runs={runsGroup} works={worksGroup} />
          ) : (
            <>
              {runsGroup}
              {worksGroup}
              <Launcher items={items} line={line} />
            </>
          )}
        </div>
      </>
    )
  }

  return (
    // Les repères servent aux suites : l'onglet, et la vue qu'il montre.
    <div ref={root} data-panel-actions className="flex min-h-0 min-w-0 flex-1 flex-col">
      {gestures.error ? <PanelNotice tone="critical">{gestures.error}</PanelNotice> : null}
      {runError ? (
        <PanelNotice tone="critical" onClose={() => setRunError(null)}>
          {runError}
        </PanelNotice>
      ) : null}
      {body}
      {gestures.dialogs}
    </div>
  )
})

/** Le Lanceur du panneau (PACT-2) : services, commandes, agents en lignes ; un groupe vide se tait. */
function Launcher({ items, line }: { items: Automation[]; line: (item: Automation) => ReactNode }) {
  const t = useTranslate()
  const groups = launcherGroupsOf(items)
  return (
    <>
      {LAUNCHER_GROUPS.map((key) => (
        <Group key={key} title={t(GROUP_TITLE[key])} items={groups[key]} line={line} />
      ))}
    </>
  )
}

/**
 * La Liste du panneau (PACT-4) : ce qui tourne — les commandes lancées ici, les actions
 * en marche, les processus des sessions —, puis à relire, planifiées, à la demande.
 */
function ListView({ items, line, runs, works }: { items: Automation[]; line: (item: Automation) => ReactNode; runs: ReactNode; works: ReactNode }) {
  const t = useTranslate()
  const sections = paneSectionsOf(items)
  const group = (key: Section) => <Group key={key} title={t(SECTION_TITLE[key])} items={sections[key]} line={line} />
  return (
    <>
      <div id={RUNNING_ANCHOR} className="scroll-mt-2">
        {runs}
        {group('live')}
        {works}
      </div>
      <div id={REVIEW_ANCHOR} className="scroll-mt-2">
        {group('review')}
      </div>
      {PANE_SECTIONS.filter((key) => key === 'scheduled' || key === 'demand').map(group)}
    </>
  )
}

function Group({ title, items, line }: { title: string; items: Automation[]; line: (item: Automation) => ReactNode }) {
  if (items.length === 0) return null
  return (
    <section className="pt-1.5 pb-1">
      <PanelGroup title={title} count={items.length} />
      <ul className="flex flex-col">{items.map(line)}</ul>
    </section>
  )
}

/**
 * Aucune action encore (PACT-6) : une ligne, et un pas plus loin — ce que le dépôt sait
 * lancer, à un clic de l'éditeur pré-rempli. Les mêmes suggestions que dans l'éditeur.
 */
function EmptyPane({ projectId, onSeed }: { projectId: string; onSeed: (seed: EditorSeed) => void }) {
  const t = useTranslate()
  const { data } = useActionSuggestions(projectId)
  const suggestions = paneSuggestions(data)
  return (
    <section data-actions-empty className="flex flex-col gap-2 px-3 pt-3 pb-2">
      <p className="text-sm text-ink-soft">{t('panel.actions.empty')}</p>
      {suggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((suggestion) => {
            const draft = suggestionDraft(suggestion, t)
            return (
              <Tooltip key={`${suggestion.source}:${suggestion.name}`} label={suggestionWhy(suggestion, t)}>
                <button
                  type="button"
                  aria-label={t('panel.actions.suggestion', { label: draft.label, command: suggestion.command })}
                  onClick={() => onSeed(suggestionSeed(draft))}
                  className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-md border border-line px-2.5 text-xs text-ink-soft transition-colors hover:border-line-strong hover:text-ink pointer-coarse:h-11 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <Plus size={12} className="shrink-0 text-ink-faint" aria-hidden />
                  <span className="shrink-0">{draft.label}</span>
                  <code className="min-w-0 truncate font-mono text-[11px] text-ink-faint">{suggestion.command}</code>
                </button>
              </Tooltip>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

/** La largeur du panneau, pour proposer de l'agrandir quand l'éditeur y est à l'étroit. */
function useWidth(root: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [root])
  return width
}
