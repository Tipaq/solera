import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Tooltip, cx } from '@solera/ui'
import { loadedStatus, type StatusOf } from '../../lib/card-state'
import { useTranslate } from '../../lib/i18n'
import type { MilestoneEntry } from '../../lib/milestone-model'
import { useMediaQuery } from '../../lib/viewport'
import { CardInfoButton } from '../cards/CardInfoButton'
import { AXIS_H, GanttAxis } from '../gantt/GanttAxis'
import { GanttGrid, TodayLine } from '../gantt/GanttGrid'
import { useAxisWidth, useScrollToNow } from '../gantt/hooks'
import { scaleOf, type Zoom } from '../gantt/scale'
import { MaturityPill } from './MaturityPill'
import { MILESTONE_BAR_H, MilestoneBar } from './MilestoneBar'

/** La colonne des noms ; plus étroite au téléphone, où 280 px ne laissaient que 76 px à l'axe. */
const LABEL_WIDE = 280
const LABEL_NARROW = 150
const ROW_H = 52
/** Le haut de la barre dans sa ligne : centrée. */
const BAR_TOP = (ROW_H - MILESTONE_BAR_H) / 2

/**
 * « Maintenant » sur l'axe daté (HOR-3..8) : les jalons en mouvement, une ligne chacun,
 * la colonne des noms collée à gauche, l'axe à deux étages, aujourd'hui au milieu. Seul
 * l'axe défile en largeur ; au survol, la ligne s'éclaire et les autres barres pâlissent.
 */
export function MilestoneAxis({
  projectId,
  entries,
  zoom,
  statusOf = loadedStatus,
  now = Date.now(),
}: {
  projectId: string
  entries: MilestoneEntry[]
  zoom: Zoom
  statusOf?: StatusOf
  now?: number
}) {
  const t = useTranslate()
  const scroller = useRef<HTMLDivElement>(null)
  const narrow = !useMediaQuery('(min-width: 40rem)')
  const labelWidth = narrow ? LABEL_NARROW : LABEL_WIDE
  const axisWidth = useAxisWidth(scroller, labelWidth)
  const scale = useMemo(
    () => scaleOf(entries.flatMap((entry) => [entry.card, ...entry.children]), zoom, now, axisWidth),
    // `now` change à chaque rendu : l'échelle ne suit que les jalons, le zoom et la largeur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, zoom, axisWidth],
  )
  const [hovered, setHovered] = useState<string | null>(null)
  useScrollToNow(scroller, scale, labelWidth, now)
  const height = entries.length * ROW_H

  return (
    <div ref={scroller} className="overflow-x-auto rounded-xl border border-line" onMouseLeave={() => setHovered(null)}>
      <div className="flex" style={{ width: labelWidth + scale.width }}>
        <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-canvas" style={{ width: labelWidth }}>
          <div className="flex items-end border-b border-line px-3 pb-1.5 text-xs font-medium text-ink-faint" style={{ height: AXIS_H }}>
            {t('milestones.horizon.axisHead')}
          </div>
          {entries.map((entry) => (
            <NameRow key={entry.card.id} projectId={projectId} entry={entry} hovered={hovered === entry.card.id} onHover={setHovered} />
          ))}
        </div>
        <div className="relative">
          <GanttAxis scale={scale} zoom={zoom} now={now} inset={labelWidth} />
          <div className="relative" style={{ height }}>
            <GanttGrid scale={scale} zoom={zoom} height={height} now={now} today={false} />
            {/* le fond des lignes : séparateurs et surlignage du survol, sur toute la largeur */}
            {entries.map((entry, index) => (
              <div
                key={entry.card.id}
                aria-hidden
                onMouseEnter={() => setHovered(entry.card.id)}
                className={cx('absolute right-0 left-0 border-b border-line/60 transition-colors', hovered === entry.card.id && 'bg-accent/[0.07]')}
                style={{ top: index * ROW_H, height: ROW_H }}
              />
            ))}
            {entries.map((entry, index) => (
              <MilestoneBar
                key={entry.card.id}
                entry={entry}
                scale={scale}
                top={index * ROW_H + BAR_TOP}
                now={now}
                statusOf={statusOf}
                hovered={hovered === entry.card.id}
                dimmed={hovered !== null && hovered !== entry.card.id}
                onHover={setHovered}
              />
            ))}
            <div className="pointer-events-none absolute inset-0 z-[4]">
              <TodayLine scale={scale} height={height} now={now} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Le nom d'un jalon, lien vers sa page (HOR-4) : `#N`, titre, `ℹ`, pastille, ajouts. */
function NameRow({
  projectId,
  entry,
  hovered,
  onHover,
}: {
  projectId: string
  entry: MilestoneEntry
  hovered: boolean
  onHover: (id: string) => void
}) {
  const t = useTranslate()
  const added = entry.addedSinceLaunch
  return (
    <Link
      to={`/p/${projectId}/timeline/${entry.card.number}`}
      onMouseEnter={() => onHover(entry.card.id)}
      className={cx('flex flex-col justify-center gap-1 border-b border-line/60 px-3 transition-colors', hovered ? 'bg-surface-high' : 'bg-canvas')}
      style={{ height: ROW_H }}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="text-xs text-ink-faint tabular-nums">#{entry.card.number}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{entry.card.title}</span>
        <CardInfoButton card={entry.card} />
      </span>
      <span className="flex min-w-0 items-center gap-1.5">
        <MaturityPill maturity={entry.maturity} entry={entry} />
        {added.length ? (
          <Tooltip label={added.map((card) => `#${card.number} ${card.title}`).join('\n')}>
            <span className="truncate text-xs text-caution">{t('milestones.horizon.sinceLaunch', { count: added.length })}</span>
          </Tooltip>
        ) : null}
      </span>
    </Link>
  )
}
