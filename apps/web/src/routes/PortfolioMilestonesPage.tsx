import { CalendarRange, Compass } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { ProjectAvatar } from '../components/ProjectAvatar'
import type { Zoom } from '../components/gantt/scale'
import { PortfolioGantt } from '../components/portfolio/PortfolioGantt'
import { PortfolioMilestoneTile } from '../components/portfolio/PortfolioMilestoneTile'
import { ProjectGroupHeader } from '../components/places/ProjectPip'
import { FilterChip, OneLineToolbar, ToolbarSearch } from '../components/toolbar/OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../components/toolbar/ToolbarMenus'
import { useAllCards } from '../lib/cards'
import { pluralOf } from '../lib/code-model'
import { useTranslate } from '../lib/i18n'
import { maturityCounts } from '../lib/milestone-horizon'
import { MATURITIES, type Maturity } from '../lib/milestone-model'
import { useLiveCardStatuses, usePortfolioActiveMilestones } from '../lib/milestones'
import { usePortfolioLive } from '../lib/portfolio'
import {
  NO_PORTFOLIO_MILESTONE_FILTERS,
  keepPortfolioMilestone,
  milestoneGroups,
  openMilestoneCounts,
  portfolioMilestoneFilterCount,
  portfolioMilestones,
  type PortfolioMilestoneFilters,
} from '../lib/portfolio-milestones'
import { usePortfolioSessionRequests } from '../lib/session-requests'
import { useView } from '../lib/use-view'

const VIEWS = ['horizon', 'gantt'] as const
type View = (typeof VIEWS)[number]
const VIEW_ICONS: Record<View, ReactNode> = { horizon: <Compass size={16} />, gantt: <CalendarRange size={16} /> }
const VIEW_LABELS: Record<View, 'milestones.view.horizon' | 'portfolio.milestones.view.gantt'> = {
  horizon: 'milestones.view.horizon',
  gantt: 'portfolio.milestones.view.gantt',
}

const toggled = <T,>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])

/**
 * Les **Jalons du portefeuille** (`coque.md` PF-28 à PF-31) : les jalons de tous les
 * projets, sur le modèle de maturité de la page d'un projet. **Horizon** : une bande par
 * projet, une tuile par jalon ; **Gantt** : un axe commun, une bande par projet, les
 * dépendances entre jalons. Un clic mène au jalon dans son projet.
 *
 * La barre est celle des Jalons d'un projet (recherche, maturité, retard, échelle), avec
 * la section Projet en tête de « Filtrer ▾ » ; les jalons livrés sont masqués par défaut.
 * Les données sont celles que la coque lit déjà (projets, conversations, cartes), plus
 * les jalons lancés de tous les projets, d'une requête.
 */
export function PortfolioMilestonesPage() {
  const t = useTranslate()
  const { projects, live, isPending } = usePortfolioLive()
  const { cards, isPending: cardsPending } = useAllCards(projects)
  const runs = usePortfolioActiveMilestones()
  const requests = usePortfolioSessionRequests(live)
  const statusOf = useLiveCardStatuses(cards)

  const [view, setView] = useView('portefeuille-jalons', null, VIEWS)
  const views: ViewOption<View>[] = VIEWS.map((key) => ({ key, label: t(VIEW_LABELS[key]), icon: VIEW_ICONS[key] }))
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<PortfolioMilestoneFilters>(NO_PORTFOLIO_MILESTONE_FILTERS)
  // L'échelle n'est pas retenue, comme dans un projet : on revient à la vue d'ensemble.
  const [zoom, setZoom] = useState<Zoom>('month')

  const rows = useMemo(
    () => portfolioMilestones({ projects, cards, runs, requests, statusOf }),
    [projects, cards, runs, requests, statusOf],
  )
  // Les comptes du menu portent sur tous les jalons, pour qu'on voie ce qu'un filtre cacherait.
  const open = useMemo(() => openMilestoneCounts(rows), [rows])
  const totals = useMemo(() => maturityCounts(rows.map((row) => row.entry)), [rows])
  const openTotal = [...open.values()].reduce((sum, count) => sum + count, 0)
  const now = Date.now()
  const shown = rows.filter((row) => keepPortfolioMilestone(row, query, filters, now))
  const groups = milestoneGroups(shown, projects)
  const byId = new Map(projects.map((project) => [project.id, project]))

  const set = (patch: Partial<PortfolioMilestoneFilters>) => setFilters({ ...filters, ...patch })
  // « Effacer tous les filtres » garde le réglage d'affichage des livrés.
  const clearAll = () => setFilters({ ...NO_PORTFOLIO_MILESTONE_FILTERS, delivered: filters.delivered })

  if (isPending || cardsPending) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder={t('milestones.toolbar.search')} />}
        filter={
          <FilterMenu active={portfolioMilestoneFilterCount(filters)} onClearAll={clearAll}>
            <MenuHeading>{t('portfolio.milestones.filter.project')}</MenuHeading>
            {projects.map((project) => (
              <MenuCheck
                key={project.id}
                checked={filters.projects.includes(project.id)}
                onChange={() => set({ projects: toggled(filters.projects, project.id) })}
                aside={open.get(project.id) ?? 0}
              >
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <ProjectAvatar project={project} className="size-3.5 shrink-0" />
                  <span className="truncate">{project.name}</span>
                </span>
              </MenuCheck>
            ))}
            <MenuHeading>{t('milestones.filter.maturity')}</MenuHeading>
            {MATURITIES.map((maturity) => (
              <MenuCheck
                key={maturity}
                checked={filters.maturities.includes(maturity)}
                onChange={() => set({ maturities: toggled<Maturity>(filters.maturities, maturity) })}
                aside={totals[maturity]}
              >
                {t(`milestones.maturity.label.${maturity}`)}
              </MenuCheck>
            ))}
            <MenuHeading>{t('milestones.filter.due')}</MenuHeading>
            <MenuCheck checked={filters.late} onChange={(late) => set({ late })}>
              {t('milestones.filter.late')}
            </MenuCheck>
          </FilterMenu>
        }
        chips={[
          ...filters.projects.flatMap((id) => {
            const project = byId.get(id)
            return project
              ? [
                  <FilterChip key={id} onClear={() => set({ projects: toggled(filters.projects, id) })}>
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <ProjectAvatar project={project} className="size-3.5 shrink-0" />
                      <span className="truncate">{project.name}</span>
                    </span>
                  </FilterChip>,
                ]
              : []
          }),
          ...filters.maturities.map((maturity) => (
            <FilterChip key={maturity} onClear={() => set({ maturities: toggled(filters.maturities, maturity) })}>
              {t(`milestones.maturity.label.${maturity}`)}
            </FilterChip>
          )),
          filters.late ? (
            <FilterChip key="late" onClear={() => set({ late: false })}>
              {t('milestones.filter.lateChip')}
            </FilterChip>
          ) : null,
        ]}
        extra={
          <span className="hidden shrink-0 text-xs text-ink-faint tabular-nums lg:inline">
            {t(`portfolio.milestones.meta.${pluralOf(openTotal)}`, { count: openTotal })}
          </span>
        }
        display={
          <DisplayMenu views={views} value={view} onChange={setView}>
            {view === 'gantt' ? (
              <>
                <MenuHeading>{t('milestones.scale.title')}</MenuHeading>
                <MenuSegment<Zoom>
                  label={t('milestones.scale.title')}
                  segments={[
                    { value: 'week', label: t('milestones.scale.week') },
                    { value: 'month', label: t('milestones.scale.month') },
                  ]}
                  value={zoom}
                  onChange={setZoom}
                />
              </>
            ) : null}
            <MenuHeading>{t('toolbar.show')}</MenuHeading>
            <MenuCheck checked={filters.delivered} onChange={(delivered) => set({ delivered })}>
              {t('portfolio.milestones.show.delivered')}
            </MenuCheck>
          </DisplayMenu>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="p-4 text-sm text-ink-faint md:p-6">{t('portfolio.milestones.empty')}</p>
        ) : view === 'horizon' ? (
          <div className="flex flex-col gap-6 p-4 md:p-6">
            {groups.map(({ project, rows: list }) => (
              <section key={project.id} aria-label={project.name} className="flex flex-col gap-2">
                <ProjectGroupHeader project={project} count={list.length} />
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {list.map((row) => (
                    <PortfolioMilestoneTile key={row.entry.card.id} row={row} now={now} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <PortfolioGantt groups={groups} zoom={zoom} statusOf={statusOf} now={now} />
        )}
      </div>
    </div>
  )
}
