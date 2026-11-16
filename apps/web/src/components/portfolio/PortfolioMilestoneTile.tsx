import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { milestoneBar } from '../../lib/milestone-horizon'
import { maturityTooltip } from '../../lib/milestone-model'
import type { PortfolioMilestone } from '../../lib/portfolio-milestones'
import { MaturityTag } from '../milestones/MaturityTag'

/**
 * Un jalon dans l'horizon du portefeuille (PF-29) : sa maturité, `#N`, son titre sur deux
 * lignes, l'avancement, `fait/total` et l'échéance relative — rouge, avec le bord, quand
 * il est en retard. Toute la tuile mène à la page du jalon dans son projet (PF-31).
 */
export function PortfolioMilestoneTile({ row: { project, entry }, now = Date.now() }: { row: PortfolioMilestone; now?: number }) {
  const t = useTranslate()
  const bar = milestoneBar(entry, now)
  const late = bar.lateDays > 0
  const due = entry.card.dueAt
  return (
    <Link
      to={`/p/${project.id}/timeline/${entry.card.number}`}
      title={maturityTooltip(entry, t)}
      className={cx(
        'flex flex-col gap-2 rounded-xl border bg-surface/40 p-3 transition-colors hover:border-line-strong',
        late ? 'border-critical/40' : 'border-line',
      )}
    >
      <span className="flex items-center gap-2 text-xs text-ink-faint">
        <MaturityTag maturity={entry.maturity} />
        {entry.awaiting.length ? (
          <span className="inline-flex items-center gap-1 font-medium text-caution">
            <span aria-hidden className="size-2 rounded-full bg-caution" />
            {t('milestones.horizon.awaitingShort')}
          </span>
        ) : null}
        <span className="ml-auto tabular-nums">#{entry.card.number}</span>
      </span>
      <span className="line-clamp-2 text-sm text-ink">{entry.card.title}</span>
      <span aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-high">
        <span
          className={cx('block h-full rounded-full', entry.maturity === 'delivered' ? 'bg-positive' : 'bg-accent')}
          style={{ width: `${Math.round(bar.share * 100)}%` }}
        />
      </span>
      <span className="flex items-center gap-2 text-xs text-ink-faint tabular-nums">
        {bar.done}/{bar.total}
        <span className={cx('ml-auto', late && 'text-critical')}>{due === null ? t('portfolio.milestones.noDue') : relativeDate(due)}</span>
      </span>
    </Link>
  )
}
