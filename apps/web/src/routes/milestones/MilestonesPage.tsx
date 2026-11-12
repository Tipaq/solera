import { ChartGantt, Compass, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { Button, EmptyState } from '@solera/ui'
import { NewCardDialog } from '../../components/board/NewCardDialog'
import { CardSheetHost } from '../../components/cards/CardSheetHost'
import type { Zoom } from '../../components/gantt/scale'
import { Horizon } from '../../components/milestones/Horizon'
import { MilestoneGantt } from '../../components/milestones/MilestoneGantt'
import { FilterChip, OneLineToolbar, ToolbarSearch } from '../../components/toolbar/OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../../components/toolbar/ToolbarMenus'
import { useTranslate } from '../../lib/i18n'
import { keepMilestone, maturityCounts, milestoneFilterCount, NO_MILESTONE_FILTERS, type MilestoneFilters } from '../../lib/milestone-horizon'
import { MATURITIES, type Maturity } from '../../lib/milestone-model'
import { useMilestones } from '../../lib/milestones'
import { useProjects } from '../../lib/projects'
import { useView } from '../../lib/use-view'

/** Les vues, dans l'ordre de leurs tuiles ; `useView` retient la dernière du projet. */
const VIEWS = ['horizon', 'gantt'] as const
type MilestonesView = (typeof VIEWS)[number]
const VIEW_ICONS: Record<MilestonesView, ReactNode> = { horizon: <Compass size={16} />, gantt: <ChartGantt size={16} /> }

/**
 * L'onglet **Jalons** d'un projet (spec jalons BAR, CAP, HOR). L'adresse est restée
 * `timeline`.
 *
 * La barre tient sur une ligne : « Chercher un jalon », « Filtrer ▾ » (maturité, retard)
 * et ses puces, « Affichage ▾ » (Horizon ou Gantt, l'échelle du temps), « + Jalon » au
 * bout. Le filtre et l'échelle valent pour les deux vues (BAR-8). Les jalons se
 * déduisent des cartes (`useMilestones`) : rien n'est lu de plus que le board, sinon les
 * pilotages actifs et les demandes ouvertes.
 */
export function MilestonesPage() {
  const { projectId } = useParams()
  const t = useTranslate()
  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  if (isPending) return null
  if (!projectId || !project) return <EmptyState title={t('project.notFound')} />
  return <Milestones project={project} />
}

function Milestones({ project }: { project: ProjectDto }) {
  const t = useTranslate()
  const { entries, cards, statusOf, isPending } = useMilestones(project.id)
  const [view, setView] = useView('jalons', project.id, VIEWS)
  const views: ViewOption<MilestonesView>[] = VIEWS.map((key) => ({ key, label: t(`milestones.view.${key}`), icon: VIEW_ICONS[key] }))
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<MilestoneFilters>(NO_MILESTONE_FILTERS)
  // L'échelle n'est pas retenue : on revient toujours à la vue d'ensemble.
  const [zoom, setZoom] = useState<Zoom>('month')
  const [adding, setAdding] = useState(false)

  // Les comptes du menu portent sur tous les jalons, pour qu'on voie ce qu'un filtre cacherait.
  const totals = useMemo(() => maturityCounts(entries), [entries])
  const now = Date.now()
  const shown = entries.filter((entry) => keepMilestone(entry, query, filters, now))
  const active = milestoneFilterCount(filters)

  const toggle = (maturity: Maturity) =>
    setFilters({
      ...filters,
      maturities: filters.maturities.includes(maturity)
        ? filters.maturities.filter((item) => item !== maturity)
        : [...filters.maturities, maturity],
    })

  if (isPending) return null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder={t('milestones.toolbar.search')} />}
        filter={
          <FilterMenu active={active} onClearAll={() => setFilters(NO_MILESTONE_FILTERS)}>
            <MenuHeading>{t('milestones.filter.maturity')}</MenuHeading>
            {MATURITIES.map((maturity) => (
              <MenuCheck key={maturity} checked={filters.maturities.includes(maturity)} onChange={() => toggle(maturity)} aside={totals[maturity]}>
                {t(`milestones.maturity.label.${maturity}`)}
              </MenuCheck>
            ))}
            <MenuHeading>{t('milestones.filter.due')}</MenuHeading>
            <MenuCheck checked={filters.late} onChange={(late) => setFilters({ ...filters, late })}>
              {t('milestones.filter.late')}
            </MenuCheck>
          </FilterMenu>
        }
        chips={[
          ...filters.maturities.map((maturity) => (
            <FilterChip key={maturity} onClear={() => toggle(maturity)}>
              {t(`milestones.maturity.label.${maturity}`)}
            </FilterChip>
          )),
          filters.late ? (
            <FilterChip key="late" onClear={() => setFilters({ ...filters, late: false })}>
              {t('milestones.filter.lateChip')}
            </FilterChip>
          ) : null,
        ]}
        display={
          <DisplayMenu views={views} value={view} onChange={setView}>
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
          </DisplayMenu>
        }
        action={
          <Button
            size="sm"
            icon={<Plus size={15} />}
            onClick={() => {
              setView('horizon')
              setAdding(true)
            }}
          >
            {t('milestones.toolbar.add')}
          </Button>
        }
      />
      {view === 'gantt' ? (
        // Le Gantt défile seul, dans les deux sens : l'axe et la liste y restent collés.
        <div className="min-h-0 flex-1">
          <MilestoneGantt projectId={project.id} entries={shown} cards={cards} zoom={zoom} statusOf={statusOf} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Horizon project={project} entries={shown} zoom={zoom} statusOf={statusOf} />
        </div>
      )}
      <NewCardDialog projectId={project.id} milestone open={adding} onClose={() => setAdding(false)} onCreated={() => setAdding(false)} />
      <CardSheetHost projectId={project.id} />
    </div>
  )
}
