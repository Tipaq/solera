import { Columns3, List, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Menu, MenuItem, MenuLabel } from '@solera/ui'
import { PortfolioBoardView, type PortfolioView } from '../components/portfolio/PortfolioBoardView'
import { PortfolioToolbar } from '../components/portfolio/PortfolioToolbar'
import { ProjectPip } from '../components/places/ProjectPip'
import { FilterChip } from '../components/toolbar/OneLineToolbar'
import { MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../components/toolbar/ToolbarMenus'
import { useAllCards } from '../lib/cards'
import { useTranslate } from '../lib/i18n'
import { useLiveCardStatuses } from '../lib/milestones'
import { NEW_PARAM } from '../lib/place'
import {
  LANE_MODES,
  NO_PORTFOLIO_FILTERS,
  lanesOf,
  portfolioActive,
  portfolioBoardModel,
  portfolioHref,
  portfolioMatches,
  portfolioPasses,
  projectCounts,
  type LaneMode,
  type PortfolioFilters,
} from '../lib/portfolio-board'
import { useProjects } from '../lib/projects'
import { useStoredPref, useView } from '../lib/use-view'
import { viewStorageKey } from '../lib/view-pref'

const VIEW_KEYS: readonly PortfolioView[] = ['kanban', 'liste']

/** Les couloirs retenus ; une valeur qui n'a plus cours reprend « Par projet ». */
const readLanes = (raw: string | null): LaneMode => {
  try {
    const value: unknown = JSON.parse(raw ?? 'null')
    return LANE_MODES.includes(value as LaneMode) ? (value as LaneMode) : 'project'
  } catch {
    return 'project'
  }
}

/**
 * Le Tableau du portefeuille (#239, `coque.md` PF-22 à PF-27) : les feuilles de tous les
 * projets, avec la barre du portefeuille. Kanban ou Liste, sans couloir, par projet ou
 * par jalon. Hors du Tableau d'un projet, une carte se pilote par sa session : un clic
 * mène là où `cardDestination` le dit, la fiche du portefeuille pour une carte qui
 * t'attend. « + Carte » demande dans quel projet, et ouvre sa création chez lui.
 */
export function PortfolioTableauPage() {
  const t = useTranslate()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const { data: all, isPending: projectsPending } = useProjects()
  const projects = useMemo(() => (all ?? []).filter((project) => !project.archivedAt), [all])
  const { cards, isPending } = useAllCards(projects)
  const statusOf = useLiveCardStatuses(cards)
  const { entries, milestones } = useMemo(() => portfolioBoardModel(cards, projects, { statusOf }), [cards, projects, statusOf])
  const counts = useMemo(() => projectCounts(entries), [entries])

  const [query, setQuery] = useState('')
  /* Les filtres sont un état de la page, non retenus, comme au Tableau d'un projet. */
  const [filters, setFilters] = useState<PortfolioFilters>(NO_PORTFOLIO_FILTERS)
  const set = (patch: Partial<PortfolioFilters>) => setFilters((current) => ({ ...current, ...patch }))
  const [view, setView] = useView<PortfolioView>('portefeuille.tableau', null, VIEW_KEYS)
  const [mode, setMode] = useStoredPref(viewStorageKey('portefeuille.tableau.couloirs', null), readLanes)

  const shown = useMemo(
    () => entries.filter((entry) => portfolioMatches(entry, query) && portfolioPasses(entry, filters)),
    [entries, query, filters],
  )
  const lanes = useMemo(() => lanesOf(shown, { mode, projects, milestones }), [shown, mode, projects, milestones])

  if (projectsPending || (isPending && cards.length === 0)) return null

  const views: ViewOption<PortfolioView>[] = [
    { key: 'kanban', label: t('board.view.kanban'), icon: <Columns3 size={16} /> },
    { key: 'liste', label: t('board.view.list'), icon: <List size={16} /> },
  ]
  const narrowed = Boolean(query.trim()) || portfolioActive(filters) > 0
  const empty = shown.length === 0 || (view === 'liste' && lanes.every((lane) => lane.entries.every((entry) => entry.card.column === 'done')))
  const create = (projectId: string) => navigate(`/p/${projectId}/board?${NEW_PARAM}=1`)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PortfolioToolbar
        search={query}
        onSearch={setQuery}
        placeholder={t('board.search.short')}
        projects={projects}
        selected={new Set(filters.projects)}
        onSelected={(next) => set({ projects: [...next] })}
        counts={counts}
        filterExtra={
          <>
            <MenuHeading>{t('board.filter.state')}</MenuHeading>
            <MenuCheck checked={filters.waiting} onChange={(waiting) => set({ waiting })}>{t('board.filter.waiting')}</MenuCheck>
            <MenuCheck checked={filters.late} onChange={(late) => set({ late })}>{t('board.filter.late')}</MenuCheck>
          </>
        }
        extraActive={Number(filters.waiting) + Number(filters.late)}
        onClearExtra={() => set({ waiting: false, late: false })}
        extraChips={
          <>
            {filters.waiting ? <FilterChip onClear={() => set({ waiting: false })}>{t('board.tile.waiting')}</FilterChip> : null}
            {filters.late ? <FilterChip onClear={() => set({ late: false })}>{t('board.chip.late')}</FilterChip> : null}
          </>
        }
        views={views}
        view={view}
        onView={setView}
        displayExtra={
          <>
            <MenuHeading>{t('portfolio.board.lanes')}</MenuHeading>
            <MenuSegment
              label={t('portfolio.board.lanes')}
              segments={[
                { value: 'none', label: t('portfolio.board.lanes.none') },
                { value: 'project', label: t('portfolio.board.lanes.project') },
                { value: 'milestone', label: t('portfolio.board.lanes.milestone') },
              ]}
              value={mode}
              onChange={setMode}
            />
          </>
        }
        action={
          projects.length === 0 ? null : (
            <Menu
              trigger={
                <Button size="sm" icon={<Plus size={15} />} aria-label={t('project.action.newCard')}>
                  <span className="hidden sm:inline">{t('project.action.newCard')}</span>
                </Button>
              }
            >
              <MenuLabel>{t('portfolio.board.newCardIn')}</MenuLabel>
              {projects.map((project) => (
                <MenuItem key={project.id} onSelect={() => create(project.id)}>
                  <ProjectPip project={project} plain className="text-sm" />
                </MenuItem>
              ))}
            </Menu>
          )
        }
      />
      <div data-portfolio-board className="min-h-0 flex-1 overflow-auto">
        {empty ? (
          <p role="status" className="px-4 pt-4 text-sm text-ink-faint md:px-6">
            {t(narrowed ? 'board.noResults' : 'portfolio.board.empty')}
          </p>
        ) : (
          <PortfolioBoardView lanes={lanes} mode={mode} view={view} onOpen={(entry) => navigate(portfolioHref(entry, { search: params, statusOf }))} />
        )}
      </div>
    </div>
  )
}
