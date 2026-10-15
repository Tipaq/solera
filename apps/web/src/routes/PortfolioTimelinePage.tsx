import { Flag } from 'lucide-react'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ProjectAvatar } from '../components/ProjectAvatar'
import { Timeline, type TimelineRow } from '../components/project/Timeline'
import { useAllCards } from '../lib/cards'
import { useTranslate } from '../lib/i18n'
import { useProjects } from '../lib/projects'
import { milestoneSpan, milestonesOf, windowOf } from '../lib/timeline'

/**
 * La **Chronologie du portefeuille** : les projets en lignes, leurs jalons en barres.
 *
 * Un cran au-dessus de celle d'un projet, et c'est tout l'intérêt : on y lit lequel est
 * chargé, lequel n'a rien de daté, et **si deux livraisons tombent la même semaine** —
 * ce qu'aucune chronologie de projet ne peut dire, puisqu'elle n'en voit qu'un.
 *
 * Une barre de jalon court du plus ancien de ses travaux à sa propre échéance : un jalon
 * qui n'aurait que sa date serait un point, pas une barre, et on ne verrait plus la
 * charge. Verte quand toutes ses cartes sont sorties, en pointillé quand il n'a pas de
 * date.
 */
export function PortfolioTimelinePage() {
  const t = useTranslate()
  const navigate = useNavigate()
  const { data: projects, isPending } = useProjects()
  const visible = useMemo(
    () => (projects ?? []).filter((project) => !project.archivedAt),
    [projects],
  )
  const { cards } = useAllCards(visible)

  const perProject = useMemo(
    () =>
      visible.map((project) => ({
        project,
        milestones: milestonesOf(cards.filter((card) => card.projectId === project.id)),
      })),
    [visible, cards],
  )

  const bounds = useMemo(
    () =>
      windowOf(
        perProject.flatMap(({ milestones }) =>
          milestones.flatMap((milestone) => {
            const span = milestoneSpan(milestone)
            return [span.start, span.end]
          }),
        ),
      ),
    [perProject],
  )

  if (isPending) return null

  const rows: TimelineRow[] = perProject.map(({ project, milestones }) => ({
    key: project.id,
    head: (
      <button
        type="button"
        onClick={() => navigate(`/p/${project.id}/timeline`)}
        className="flex min-w-0 items-center gap-2 rounded px-1 text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
      >
        <ProjectAvatar project={project} className="size-4 shrink-0" />
        <span className="min-w-0 truncate text-sm font-medium">{project.name}</span>
      </button>
    ),
    empty: t('timeline.project.empty'),
    bars: milestones.map((milestone) => {
      const span = milestoneSpan(milestone)
      return {
        key: milestone.card.id,
        start: span.start,
        end: span.end,
        loose: span.loose,
        tone: span.delivered ? ('done' as const) : span.late ? ('late' as const) : ('neutral' as const),
        label: milestone.card.title,
        prefix: <Flag size={11} className="shrink-0 opacity-70" />,
        title: `${project.name} — ${milestone.card.title}`,
        onOpen: () => navigate(`/p/${project.id}/board?carte=${milestone.card.number}`),
      }
    }),
  }))

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <Timeline from={bounds.from} to={bounds.to} rows={rows} />
    </div>
  )
}
