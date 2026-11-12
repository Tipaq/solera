import { useRef } from 'react'
import { cx } from '@solera/ui'
import type { StatusOf } from '../../lib/card-state'
import { pluralOf } from '../../lib/code-model'
import { formatDay } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { liveSessionCount, milestoneBar, type MilestoneBarGeometry } from '../../lib/milestone-horizon'
import { maturityTooltip, type MilestoneEntry } from '../../lib/milestone-model'
import { FloatingTip } from '../gantt/FloatingTip'
import type { Scale } from '../gantt/scale'

export const MILESTONE_BAR_H = 22
const DIAMOND = 12
/** En deçà, la barre ne dit que « fait/total », sans le pourcentage. */
const PERCENT_MIN = 90

/**
 * La barre d'un jalon (HOR-5..8) : de sa première carte à son échéance, remplie de ce
 * qui est fait, avec le trait du lancement posé dessus — ce qui est ajouté ensuite est à
 * sa droite. Le retard se lit au losange rouge et au prolongement hachuré, pas à une
 * barre entièrement rouge.
 *
 * `top` est le haut de la barre ; `onOpen` la rend cliquable, en raccourci du nom de la
 * ligne, qui reste le lien qu'on atteint au clavier.
 */
export function MilestoneBar({
  entry,
  scale,
  top,
  now,
  statusOf,
  hovered,
  dimmed,
  onHover,
  onOpen,
}: {
  entry: MilestoneEntry
  scale: Scale
  top: number
  now: number
  statusOf: StatusOf
  hovered: boolean
  dimmed: boolean
  onHover: (id: string) => void
  onOpen?: () => void
}) {
  const t = useTranslate()
  const anchor = useRef<HTMLDivElement>(null)
  const bar = milestoneBar(entry, now)
  const left = scale.x(bar.start)
  const width = Math.max(scale.x(bar.end) - left, 8)
  const delivered = entry.maturity === 'delivered'
  const overdue = bar.lateDays > 0 && entry.card.dueAt !== null ? Math.max(scale.x(now) - scale.x(entry.card.dueAt), 2) : 0
  const live = liveSessionCount(entry, statusOf)
  const asking = entry.awaiting.length

  return (
    <div
      ref={anchor}
      data-milestone-bar={entry.card.number}
      className={cx('absolute transition-opacity duration-150', dimmed && 'opacity-40', hovered && 'z-10', onOpen && 'cursor-pointer')}
      style={{ top, left, width, height: MILESTONE_BAR_H }}
      onMouseEnter={() => onHover(entry.card.id)}
      onClick={onOpen}
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
          style={{ left: width - DIAMOND / 2, top: MILESTONE_BAR_H / 2 - DIAMOND / 2, width: DIAMOND, height: DIAMOND }}
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
