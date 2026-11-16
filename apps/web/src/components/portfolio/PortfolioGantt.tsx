import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { loadedStatus, type StatusOf } from '../../lib/card-state'
import { useTranslate } from '../../lib/i18n'
import { maturityTooltip } from '../../lib/milestone-model'
import { milestoneAnchors, type PortfolioMilestone, type PortfolioMilestoneGroup } from '../../lib/portfolio-milestones'
import { useMediaQuery } from '../../lib/viewport'
import { GanttArrows } from '../gantt/GanttArrows'
import { AXIS_H, GanttAxis } from '../gantt/GanttAxis'
import { GanttGrid, TodayLine } from '../gantt/GanttGrid'
import { useAxisWidth, useScrollToNow } from '../gantt/hooks'
import { chainOf, scaleOf, type Zoom } from '../gantt/scale'
import { MILESTONE_BAR_H, MilestoneBar } from '../milestones/MilestoneBar'
import { MATURITY_DOT } from '../milestones/tones'
import { ProjectGroupHeader } from '../places/ProjectPip'

/** La liste collée à gauche (PF-30) ; plus étroite au téléphone, pour laisser l'axe lisible. */
const LIST_WIDE = 300
const LIST_NARROW = 150
const ROW_H = 40
const BAR_TOP = (ROW_H - MILESTONE_BAR_H) / 2

type Line = { kind: 'project'; project: ProjectDto; count: number } | { kind: 'row'; row: PortfolioMilestone }

/**
 * Le **Gantt commun** des Jalons du portefeuille (PF-30) : un seul axe pour tous les
 * projets, une bande d'en-tête par projet, une barre par jalon — la même que sur l'axe
 * d'un projet (`MilestoneBar`) —, et les flèches « bloque » entre jalons, d'un projet à
 * l'autre aussi. Au survol d'une barre, sa chaîne s'éclaire et les autres pâlissent. Un
 * clic, sur le nom ou la barre, mène à la page du jalon dans son projet (PF-31).
 *
 * `groups` arrivent filtrés et triés par la page (`milestoneGroups`).
 */
export function PortfolioGantt({
  groups,
  zoom,
  statusOf = loadedStatus,
  now = Date.now(),
}: {
  groups: PortfolioMilestoneGroup[]
  zoom: Zoom
  statusOf?: StatusOf
  now?: number
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const scroller = useRef<HTMLDivElement>(null)
  const narrow = !useMediaQuery('(min-width: 40rem)')
  const listWidth = narrow ? LIST_NARROW : LIST_WIDE
  const axisWidth = useAxisWidth(scroller, listWidth)

  const lines = useMemo<Line[]>(
    () => groups.flatMap(({ project, rows }) => [{ kind: 'project', project, count: rows.length } as const, ...rows.map((row) => ({ kind: 'row', row }) as const)]),
    [groups],
  )
  const entries = useMemo(() => groups.flatMap(({ rows }) => rows.map((row) => row.entry)), [groups])
  const scale = useMemo(
    () => scaleOf(entries.flatMap((entry) => [entry.card, ...entry.children]), zoom, now, axisWidth),
    // `now` change à chaque rendu : l'échelle ne suit que les jalons, le zoom et la largeur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, zoom, axisWidth],
  )
  useScrollToNow(scroller, scale, listWidth, now)

  const centerY = useMemo(
    () => new Map(lines.flatMap((line, index) => (line.kind === 'row' ? [[line.row.entry.card.id, index * ROW_H + ROW_H / 2] as const] : []))),
    [lines],
  )
  const anchors = milestoneAnchors(entries, centerY, scale, now)
  const [hovered, setHovered] = useState<string | null>(null)
  const chain = useMemo(() => chainOf(entries.map((entry) => entry.card), hovered), [entries, hovered])
  const height = lines.length * ROW_H
  const href = ({ project, entry }: PortfolioMilestone) => `/p/${project.id}/timeline/${entry.card.number}`

  return (
    <div ref={scroller} className="overflow-x-auto" onMouseLeave={() => setHovered(null)}>
      <div className="flex" style={{ width: listWidth + scale.width }}>
        <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-canvas" style={{ width: listWidth }}>
          <div className="border-b border-line" style={{ height: AXIS_H }} />
          {lines.map((line) =>
            line.kind === 'project' ? (
              <div key={line.project.id} className="flex items-center bg-surface/40 px-4 md:px-6" style={{ height: ROW_H }}>
                <ProjectGroupHeader project={line.project} count={line.count} />
              </div>
            ) : (
              <Link
                key={line.row.entry.card.id}
                to={href(line.row)}
                title={maturityTooltip(line.row.entry, t)}
                onMouseEnter={() => setHovered(line.row.entry.card.id)}
                className={cx(
                  'flex items-center gap-2 pr-3 pl-6 text-sm transition-colors md:pl-10',
                  hovered === line.row.entry.card.id ? 'bg-surface-high' : 'bg-canvas',
                )}
                style={{ height: ROW_H }}
              >
                <span aria-hidden className={cx('size-2 shrink-0 rounded-full', MATURITY_DOT[line.row.entry.maturity])} />
                <span className="shrink-0 text-xs text-ink-faint tabular-nums">#{line.row.entry.card.number}</span>
                <span className="min-w-0 truncate">{line.row.entry.card.title}</span>
              </Link>
            ),
          )}
        </div>
        {/* `isolate` : la barre survolée monte d'une couche sans passer sur les noms collants. */}
        <div className="relative isolate">
          <GanttAxis scale={scale} zoom={zoom} now={now} inset={listWidth} />
          <div className="relative" style={{ height }}>
            <GanttGrid scale={scale} zoom={zoom} height={height} now={now} today={false} />
            {lines.map((line, index) =>
              line.kind === 'project' ? (
                <div key={line.project.id} aria-hidden className="absolute right-0 left-0 bg-surface/40" style={{ top: index * ROW_H, height: ROW_H }} />
              ) : (
                <div
                  key={line.row.entry.card.id}
                  aria-hidden
                  onMouseEnter={() => setHovered(line.row.entry.card.id)}
                  className={cx('absolute right-0 left-0 transition-colors', hovered === line.row.entry.card.id && 'bg-accent/[0.07]')}
                  style={{ top: index * ROW_H, height: ROW_H }}
                />
              ),
            )}
            <GanttArrows anchors={anchors} width={scale.width} height={height} chain={chain} />
            {lines.map((line, index) =>
              line.kind === 'row' ? (
                <MilestoneBar
                  key={line.row.entry.card.id}
                  entry={line.row.entry}
                  scale={scale}
                  top={index * ROW_H + BAR_TOP}
                  now={now}
                  statusOf={statusOf}
                  hovered={hovered === line.row.entry.card.id}
                  dimmed={chain !== null && !chain.has(line.row.entry.card.id)}
                  onHover={setHovered}
                  onOpen={() => navigate(href(line.row))}
                />
              ) : null,
            )}
            <div className="pointer-events-none absolute inset-0">
              <TodayLine scale={scale} height={height} now={now} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
