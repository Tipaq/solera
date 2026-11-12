import { CalendarDays, LayoutGrid, List, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { Banner, Button, Menu, MenuItem, MenuLabel } from '@solera/ui'
import { ActionsAgenda } from '../components/automations/ActionsAgenda'
import { LauncherView } from '../components/automations/LauncherView'
import { useActionGestures, type ActionHandlers } from '../components/automations/useActionGestures'
import { ProjectGroupHeader, ProjectPip } from '../components/places/ProjectPip'
import { PortfolioActionsList, PortfolioRunningNow } from '../components/portfolio/PortfolioActions'
import { PortfolioToolbar } from '../components/portfolio/PortfolioToolbar'
import { FilterChip } from '../components/toolbar/OneLineToolbar'
import { MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../components/toolbar/ToolbarMenus'
import { newActionPanel } from '../lib/action-panel'
import { ACTIONS_VIEWS, WHAT_FILTERS, WHAT_LABEL, WHEN_FILTERS, WHEN_LABEL, filterTally, toggleFilter, type ActionsView } from '../lib/actions-tab'
import type { AgendaScope } from '../lib/agenda-layout'
import type { Automation } from '../lib/automations'
import { useAutomations } from '../lib/automations-query'
import { pluralOf } from '../lib/code-model'
import { useTranslate } from '../lib/i18n'
import {
  NO_PORTFOLIO_ACTION_FILTERS,
  actionHref,
  byProject,
  newActionHref,
  panelHref,
  portfolioActionMatches,
  portfolioActionPasses,
  portfolioActionsActive,
  projectActionCounts,
  projectActionsHref,
  runningNow,
  type PortfolioActionFilters,
  type RunningEntry,
} from '../lib/portfolio-actions'
import { useProjects } from '../lib/projects'
import { useAllSessionWorks } from '../lib/session-works-query'
import { useView } from '../lib/use-view'

/**
 * Les Actions du portefeuille (#241, `coque.md` PF-32 à PF-37) : celles de tous les
 * projets, avec la barre du portefeuille. En tête, ce qui tourne sur l'instance ; puis le
 * Lanceur d'un projet répété par projet, la Liste, ou l'Agenda commun. Une action vit dans
 * son projet : l'ouvrir, la modifier ou en créer une mène à l'onglet Actions du projet.
 * Les gestes d'une tuile (lancer, l'interrupteur d'un service, supprimer) agissent sur place.
 */
export function PortfolioActionsPage() {
  const t = useTranslate()
  const navigate = useNavigate()

  const { data: all, isPending: projectsPending } = useProjects()
  const projects = useMemo(() => (all ?? []).filter((project) => !project.archivedAt), [all])
  const projectIds = useMemo(() => projects.map((project) => project.id), [projects])
  const projectOf = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id, project]))
    return (id: string) => byId.get(id)
  }, [projects])

  const data = useAutomations({ all: true })
  // Les actions des projets qu'on montre : ni celles d'un projet archivé, ni celles sans projet.
  const items = useMemo(() => data.items.filter((item) => item.projectId !== null && projectOf(item.projectId)), [data.items, projectOf])
  const works = useAllSessionWorks(projectIds)
  const running = useMemo(() => runningNow(items, works, projectIds), [items, works, projectIds])
  const counts = useMemo(() => projectActionCounts(items), [items])
  const tally = useMemo(() => filterTally(items), [items])

  const [query, setQuery] = useState('')
  /* Les filtres sont un état de la page, non retenus, comme dans l'onglet d'un projet. */
  const [filters, setFilters] = useState<PortfolioActionFilters>(NO_PORTFOLIO_ACTION_FILTERS)
  const [view, setView] = useView<ActionsView>('portefeuille.actions', null, ACTIONS_VIEWS)
  const [agendaScope, setAgendaScope] = useState<AgendaScope>('week')

  const shown = useMemo(
    () => items.filter((item) => portfolioActionPasses(item, filters) && portfolioActionMatches(item, query, projectOf(item.projectId!)?.name ?? '')),
    [items, filters, query, projectOf],
  )

  if (projectsPending || (data.isPending && items.length === 0)) return null

  const toggle = <G extends 'what' | 'when'>(group: G, value: PortfolioActionFilters[G][number]) =>
    setFilters((current) => toggleFilter(current, group, value))
  const open = (item: Automation) => navigate(actionHref(item.projectId!, item.id))
  const openRunning = (entry: RunningEntry) =>
    navigate(entry.kind === 'action' ? actionHref(entry.projectId, entry.item.id) : projectActionsHref(entry.projectId))

  const views: ViewOption<ActionsView>[] = [
    { key: 'lanceur', label: t('actionsTab.view.lanceur'), icon: <LayoutGrid size={16} /> },
    { key: 'liste', label: t('actionsTab.view.liste'), icon: <List size={16} /> },
    { key: 'agenda', label: t('actionsTab.view.agenda'), icon: <CalendarDays size={16} /> },
  ]
  const narrowed = Boolean(query.trim()) || filters.projects.length > 0 || portfolioActionsActive(filters) > 0
  const empty = shown.length === 0 && view !== 'agenda'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PortfolioToolbar
        search={query}
        onSearch={setQuery}
        placeholder={t('actionsTab.search')}
        projects={projects}
        selected={new Set(filters.projects)}
        onSelected={(next) => setFilters((current) => ({ ...current, projects: [...next] }))}
        counts={counts}
        filterExtra={
          <>
            <MenuHeading>{t('actionsTab.filter.what')}</MenuHeading>
            {WHAT_FILTERS.map((entry) => (
              <MenuCheck key={entry} checked={filters.what.includes(entry)} onChange={() => toggle('what', entry)} aside={tally.what[entry]}>
                {t(WHAT_LABEL[entry])}
              </MenuCheck>
            ))}
            <MenuHeading>{t('actionsTab.filter.when')}</MenuHeading>
            {WHEN_FILTERS.map((entry) => (
              <MenuCheck key={entry} checked={filters.when.includes(entry)} onChange={() => toggle('when', entry)} aside={tally.when[entry]}>
                {t(WHEN_LABEL[entry])}
              </MenuCheck>
            ))}
          </>
        }
        extraActive={portfolioActionsActive(filters)}
        onClearExtra={() => setFilters((current) => ({ ...current, what: [], when: [] }))}
        extraChips={
          <>
            {filters.what.map((entry) => (
              <FilterChip key={`what-${entry}`} onClear={() => toggle('what', entry)}>
                {t(WHAT_LABEL[entry])}
              </FilterChip>
            ))}
            {filters.when.map((entry) => (
              <FilterChip key={`when-${entry}`} onClear={() => toggle('when', entry)}>
                {t(WHEN_LABEL[entry])}
              </FilterChip>
            ))}
          </>
        }
        views={views}
        view={view}
        onView={setView}
        displayExtra={
          view === 'agenda' ? (
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
          ) : null
        }
        meta={t(`portfolio.actions.meta.${pluralOf(items.length)}`, { count: items.length })}
        action={projects.length === 0 ? null : <NewActionIn projects={projects} onPick={(projectId) => navigate(newActionHref(projectId, 'any'))} />}
      />
      <div data-portfolio-actions className="min-h-0 flex-1 overflow-y-auto">
        {view !== 'agenda' ? <PortfolioRunningNow entries={running} projectOf={projectOf} onOpen={openRunning} /> : null}
        {empty ? (
          <p role="status" className="px-4 pt-4 text-sm text-ink-faint md:px-6">
            {t(narrowed ? 'actionsTab.noMatch' : 'portfolio.actions.empty')}
          </p>
        ) : view === 'agenda' ? (
          <div className="px-4 pt-4 pb-28 md:px-6 md:pt-6">
            <ActionsAgenda items={shown} scope={agendaScope} onScope={setAgendaScope} onOpen={open} />
          </div>
        ) : view === 'liste' ? (
          <div className="pb-28">
            <PortfolioActionsList items={shown} projectOf={projectOf} onOpen={open} />
          </div>
        ) : (
          <div className="pb-28">
            {byProject(projects, shown).map((group) => (
              <ProjectLauncher key={group.project.id} project={group.project} items={group.items} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Le Lanceur d'un projet, sous l'en-tête de son groupe (PF-34) : les mêmes tuiles et les
 * mêmes gestes que dans son onglet Actions. Ce qui ouvrirait son tiroir mène à cet onglet.
 */
function ProjectLauncher({ project, items }: { project: ProjectDto; items: Automation[] }) {
  const navigate = useNavigate()
  const gestures = useActionGestures(project.id, (panel) => navigate(panelHref(project.id, panel)))
  const handlers: ActionHandlers = {
    ...gestures.handlers,
    // Le brouillon d'une copie ne tient pas dans une adresse : on la fait depuis son détail.
    onDuplicate: (item) => navigate(actionHref(project.id, item.id)),
  }
  return (
    <section data-portfolio-launcher={project.id} className="border-b border-line last:border-b-0">
      <div className="px-4 pt-4 md:px-6">
        <ProjectGroupHeader project={project} count={items.length} />
      </div>
      <div className="flex flex-col gap-7 p-4 md:p-6">
        {gestures.error ? <Banner>{gestures.error}</Banner> : null}
        <LauncherView
          items={items}
          handlers={handlers}
          servedOf={gestures.servedOf}
          serving={gestures.serving}
          onNew={(kind) => navigate(panelHref(project.id, newActionPanel(kind)))}
        />
      </div>
      {gestures.dialogs}
    </section>
  )
}

/** « + Action » (PF-37) : une action appartient à un projet ; on choisit lequel, et sa création s'ouvre chez lui. */
function NewActionIn({ projects, onPick }: { projects: ProjectDto[]; onPick: (projectId: string) => void }) {
  const t = useTranslate()
  return (
    <Menu
      trigger={
        <Button size="sm" icon={<Plus size={15} />} aria-label={t('actionsTab.new.label')}>
          <span className="hidden sm:inline">{t('actionsTab.new.button')}</span>
        </Button>
      }
    >
      <MenuLabel>{t('portfolio.actions.newIn')}</MenuLabel>
      {projects.map((project) => (
        <MenuItem key={project.id} onSelect={() => onPick(project.id)}>
          <ProjectPip project={project} plain className="text-sm" />
        </MenuItem>
      ))}
    </Menu>
  )
}
