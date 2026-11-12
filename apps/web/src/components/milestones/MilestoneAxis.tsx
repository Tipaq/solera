import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Tooltip, cx } from '@solera/ui'
import { loadedStatus, type StatusOf } from '../../lib/card-state'
import { pluralOf } from '../../lib/code-model'
import { formatDay } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { livesOf, milestoneBar, type MilestoneBarGeometry } from '../../lib/milestone-horizon'
import { maturityTooltip, type MilestoneEntry } from '../../lib/milestone-model'
import { useMediaQuery } from '../../lib/viewport'
import { CardInfoButton } from '../cards/CardInfoButton'
import { FloatingTip } from '../gantt/FloatingTip'
import { AXIS_H, GanttAxis } from '../gantt/GanttAxis'
import { GanttGrid, TodayLine } from '../gantt/GanttGrid'
import { useAxisWidth, useScrollToNow } from '../gantt/hooks'
import { scaleOf, type Scale, type Zoom } from '../gantt/scale'
import { MaturityPill } from './MaturityPill'

/** La colonne des noms ; plus étroite au téléphone, où 280 px ne laissaient que 76 px à l'axe. */
const LABEL_WIDE = 280
const LABEL_NARROW = 150
const ROW_H = 52
const BAR_TOP = 15
const BAR_H = 22
const DIAMOND = 12
/** En deçà, la barre ne dit que « fait/total », sans le pourcentage. */
const PERCENT_MIN = 90

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
                top={index * ROW_H}
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

/**
 * La barre d'un jalon (HOR-5..8) : de sa première carte à son échéance, remplie de ce
 * qui est fait, avec le trait du lancement posé dessus — ce qui est ajouté ensuite est à
 * sa droite. Le retard se lit au losange rouge et au prolongement hachuré, pas à une
 * barre entièrement rouge.
 */
function MilestoneBar({
  entry,
  scale,
  top,
  now,
  statusOf,
  hovered,
  dimmed,
  onHover,
}: {
  entry: MilestoneEntry
  scale: Scale
  top: number
  now: number
  statusOf: StatusOf
  hovered: boolean
  dimmed: boolean
  onHover: (id: string) => void
}) {
  const t = useTranslate()
  const anchor = useRef<HTMLDivElement>(null)
  const bar = milestoneBar(entry, now)
  const left = scale.x(bar.start)
  const width = Math.max(scale.x(bar.end) - left, 8)
  const delivered = entry.maturity === 'delivered'
  const overdue = bar.lateDays > 0 && entry.card.dueAt !== null ? Math.max(scale.x(now) - scale.x(entry.card.dueAt), 2) : 0
  const live = livesOf(entry, statusOf)
  const asking = entry.awaiting.length

  return (
    <div
      ref={anchor}
      data-milestone-bar={entry.card.number}
      className={cx('absolute transition-opacity duration-150', dimmed && 'opacity-40', hovered && 'z-30')}
      style={{ top: top + BAR_TOP, left, width, height: BAR_H }}
      onMouseEnter={() => onHover(entry.card.id)}
    >
      {overdue > 0 ? (
        <span
          aria-hidden
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r-full"
          style={{
            left: width,
            width: overdue,
            background:
              'repeating-linear-gradient(135deg, color-mix(in oklab, var(--color-critical) 55%, transparent) 0 3px, transparent 3px 6px)',
          }}
        />
      ) : null}
      <div
        className={cx(
          'relative h-full overflow-hidden rounded-[6px] border',
          delivered ? 'border-positive/50 bg-positive/15' : 'border-line-strong bg-surface-high',
          bar.loose && 'border-dashed',
          entry.run && !delivered && 'border-accent/70',
          hovered && 'shadow-[0_0_0_2px_var(--color-accent)]',
        )}
      >
        <div className={cx('h-full', delivered ? 'bg-positive/40' : 'bg-accent/35')} style={{ width: `${bar.share * 100}%` }} />
        <span className="absolute inset-0 flex items-center gap-2 px-2 text-xs font-medium whitespace-nowrap text-ink">
          <span className="tabular-nums">
            {bar.done}/{bar.total}
          </span>
          {width > PERCENT_MIN ? (
            <span className="font-normal text-ink-soft tabular-nums">
              {t('milestones.horizon.percent', { value: Math.round(bar.share * 100) })}
            </span>
          ) : null}
          {asking ? (
            <span className="flex items-center gap-1 text-caution" title={t('milestones.horizon.awaitingTip')}>
              <span aria-hidden className="size-2 rounded-full bg-caution" />
              {t(`milestones.horizon.awaiting.${pluralOf(asking)}`, { count: asking })}
            </span>
          ) : live ? (
            <span className="flex items-center gap-1 text-accent" title={t(`milestones.tooltip.live.${pluralOf(live)}`, { count: live })}>
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
              {live}
            </span>
          ) : null}
        </span>
      </div>
      {/* Le lancement, posé sur la barre : ce qui a été ajouté ensuite est à sa droite. */}
      {entry.launchedAt !== null ? (
        <span aria-hidden data-launch className="absolute -top-1 -bottom-1 w-0.5 rounded bg-accent" style={{ left: scale.x(entry.launchedAt) - left }} />
      ) : null}
      {entry.card.dueAt !== null ? (
        <span
          aria-hidden
          data-due
          className={cx(
            'absolute rotate-45 rounded-[2px] border-2 bg-canvas',
            bar.lateDays > 0 ? 'border-critical' : delivered ? 'border-positive' : 'border-ink-soft',
          )}
          style={{ left: width - DIAMOND / 2, top: BAR_H / 2 - DIAMOND / 2, width: DIAMOND, height: DIAMOND }}
        />
      ) : null}
      {hovered ? (
        <FloatingTip anchor={anchor}>
          <MilestoneTip entry={entry} bar={bar} live={live} />
        </FloatingTip>
      ) : null}
    </div>
  )
}

/** L'infobulle d'une barre (HOR-8) : l'essentiel du jalon, sans quitter l'axe. */
function MilestoneTip({ entry, bar, live }: { entry: MilestoneEntry; bar: MilestoneBarGeometry; live: number }) {
  const t = useTranslate()
  const due = entry.card.dueAt
  const added = entry.addedSinceLaunch.length
  return (
    <div className="w-64 rounded-lg border border-line bg-surface p-2.5 text-xs shadow-lg">
      <p className="flex items-start gap-1.5 text-sm leading-snug font-medium text-ink">
        <span className="shrink-0 font-normal text-ink-faint tabular-nums">#{entry.card.number}</span>
        <span className="min-w-0">{entry.card.title}</span>
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-soft">
        <dt className="text-ink-faint">{t('milestones.tooltip.maturity')}</dt>
        <dd>{maturityTooltip(entry, t)}</dd>
        <dt className="text-ink-faint">{t('milestones.tooltip.cards')}</dt>
        <dd className="tabular-nums">
          {t('milestones.tooltip.cardsValue', { done: bar.done, total: bar.total })}
          {added ? ` · ${t('milestones.horizon.sinceLaunch', { count: added })}` : ''}
        </dd>
        <dt className="text-ink-faint">{t('milestones.tooltip.created')}</dt>
        <dd className="tabular-nums">{formatDay(entry.card.createdAt)}</dd>
        {entry.launchedAt !== null ? (
          <>
            <dt className="text-ink-faint">{t('milestones.tooltip.launched')}</dt>
            <dd className="tabular-nums">{formatDay(entry.launchedAt)}</dd>
          </>
        ) : null}
        <dt className="text-ink-faint">{t('milestones.tooltip.due')}</dt>
        <dd className={cx('tabular-nums', bar.lateDays > 0 && 'font-medium text-critical')}>
          {due === null ? t('milestones.tooltip.noDue') : formatDay(due)}
          {bar.lateDays > 0 ? ` · ${t('milestones.tooltip.lateBy', { days: bar.lateDays })}` : ''}
        </dd>
        {live ? (
          <>
            <dt className="text-ink-faint">{t('milestones.tooltip.sessions')}</dt>
            <dd className="text-accent">{t(`milestones.tooltip.live.${pluralOf(live)}`, { count: live })}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}
