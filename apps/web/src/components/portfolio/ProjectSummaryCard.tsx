import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { pluralOf } from '../../lib/code-model'
import { elapsed, relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import type { ProjectSummary } from '../../lib/portfolio-overview'
import { ProjectAvatar } from '../ProjectAvatar'

/**
 * La carte d'un projet à l'Aperçu du portefeuille (PF-10) : son nom, ce qui l'attend,
 * son jalon en cours et son avancement, puis ses cartes ouvertes, ses sessions vivantes
 * et l'ancienneté de son dernier événement. Elle mène au projet.
 *
 * Le bord ambre dit qu'une session y attend : c'est ce qui la fait passer en tête.
 */
export function ProjectSummaryCard({ summary }: { summary: ProjectSummary }) {
  const t = useTranslate()
  const { project, milestone, waiting, live, open, lastAt } = summary
  const share = milestone && milestone.total > 0 ? milestone.done / milestone.total : 0
  return (
    <Link
      to={`/p/${project.id}`}
      className={cx(
        'flex flex-col gap-3 rounded-xl border bg-surface/40 p-4 transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent',
        waiting > 0 ? 'border-caution/50' : 'border-line',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ProjectAvatar project={project} className="size-5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{project.name}</span>
        {waiting > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-caution">
            <span aria-hidden className="size-1.5 rounded-full bg-caution" />
            {t(`portfolio.card.waiting.${pluralOf(waiting)}`, { count: waiting })}
          </span>
        ) : null}
      </span>
      {milestone ? (
        <span className="flex flex-col gap-1.5">
          <span className="flex min-w-0 items-baseline gap-2 text-xs text-ink-faint">
            <span className="tabular-nums">#{milestone.number}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{milestone.title}</span>
          </span>
          <span
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={milestone.total}
            aria-valuenow={milestone.done}
            aria-label={t('portfolio.card.progress')}
            className="h-1.5 overflow-hidden rounded-full bg-surface-high"
          >
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
          <span className="flex items-center gap-1 text-xs text-ink-faint tabular-nums">
            {milestone.done}/{milestone.total}
            {milestone.dueAt !== null ? <span>· {relativeDate(milestone.dueAt)}</span> : null}
          </span>
        </span>
      ) : (
        <span className="text-xs text-ink-faint">{t('portfolio.card.noMilestone')}</span>
      )}
      <span className="mt-auto flex items-center gap-3 text-xs text-ink-faint tabular-nums">
        <span>{t(`portfolio.card.openCards.${pluralOf(open)}`, { count: open })}</span>
        {live > 0 ? (
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-accent" />
            {t(`portfolio.card.sessions.${pluralOf(live)}`, { count: live })}
          </span>
        ) : null}
        {lastAt !== null ? <span className="ml-auto">{elapsed(lastAt)}</span> : null}
      </span>
    </Link>
  )
}
