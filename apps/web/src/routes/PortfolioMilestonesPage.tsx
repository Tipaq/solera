import { CalendarRange, Compass } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { Zoom } from '../components/gantt/scale'
import { PortfolioGantt } from '../components/portfolio/PortfolioGantt'
import { PortfolioHorizon } from '../components/portfolio/PortfolioHorizon'
import { PortfolioToolbar } from '../components/portfolio/PortfolioToolbar'
import { FilterChip } from '../components/toolbar/OneLineToolbar'
import { MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../components/toolbar/ToolbarMenus'
import { useAllCards } from '../lib/cards'
import { pluralOf } from '../lib/code-model'
import { useTranslate } from '../lib/i18n'
import { maturityCounts } from '../lib/milestone-horizon'
import { toggled } from '../lib/filters'
import { MATURITIES } from '../lib/milestone-model'
import { useLiveCardStatuses, usePortfolioActiveMilestones } from '../lib/milestones'
import { usePortfolioLive } from '../lib/portfolio'
import {
  NO_PORTFOLIO_MILESTONE_FILTERS,
  keepPortfolioMilestone,
  milestoneGroups,
  openMilestoneCounts,
  milestoneExtraFilterCount,
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
  // La méta suit le filtre Projet : ce qu'il reste à livrer dans les projets regardés.
  const openTotal = [...open].reduce((sum, [id, count]) => (filters.projects.size === 0 || filters.projects.has(id) ? sum + count : sum), 0)
  const now = Date.now()
  const shown = rows.filter((row) => keepPortfolioMilestone(row, query, filters, now))
  const groups = milestoneGroups(shown, projects)

  const set = (patch: Partial<PortfolioMilestoneFilters>) => setFilters((current) => ({ ...current, ...patch }))

  if (isPending || cardsPending) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PortfolioToolbar
        search={query}
        onSearch={setQuery}
        placeholder={t('milestones.toolbar.search')}
        projects={projects}
        selected={filters.projects}
        onSelected={(selected) => set({ projects: selected })}
        counts={open}
        filterExtra={
          <>
            <MenuHeading>{t('milestones.filter.maturity')}</MenuHeading>
            {MATURITIES.map((maturity) => (
              <MenuCheck
                key={maturity}
                checked={filters.maturities.has(maturity)}
                onChange={() => set({ maturities: toggled(filters.maturities, maturity) })}
                aside={totals[maturity]}
              >
                {t(`milestones.maturity.label.${maturity}`)}
              </MenuCheck>
            ))}
            <MenuHeading>{t('milestones.filter.due')}</MenuHeading>
            <MenuCheck checked={filters.late} onChange={(late) => set({ late })}>
              {t('milestones.filter.late')}
            </MenuCheck>
          </>
        }
        extraActive={milestoneExtraFilterCount(filters)}
        onClearExtra={() => set({ maturities: new Set(), late: false })}
        extraChips={
          <>
            {[...filters.maturities].map((maturity) => (
              <FilterChip key={maturity} onClear={() => set({ maturities: toggled(filters.maturities, maturity) })}>
                {t(`milestones.maturity.label.${maturity}`)}
              </FilterChip>
            ))}
            {filters.late ? <FilterChip onClear={() => set({ late: false })}>{t('milestones.filter.lateChip')}</FilterChip> : null}
          </>
        }
        views={views}
        view={view}
        onView={setView}
        displayExtra={
          <>
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
          </>
        }
        meta={t(`portfolio.milestones.meta.${pluralOf(openTotal)}`, { count: openTotal })}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="p-4 text-sm text-ink-faint md:p-6">{t('portfolio.milestones.empty')}</p>
        ) : view === 'horizon' ? (
          <PortfolioHorizon groups={groups} now={now} />
        ) : (
          <PortfolioGantt groups={groups} zoom={zoom} statusOf={statusOf} now={now} />
        )}
      </div>
    </div>
  )
}
