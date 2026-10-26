import { ArrowRight, Flag, GitBranch } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { MilestoneRunCardDto, MilestoneRunDto } from '@solera/protocol'
import { Badge, cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { milestoneCounts, milestoneOrder, milestoneToneOf, type MilestoneTone } from '../../lib/milestone-view'

/** La teinte d'un segment : l'exécution de sa carte, du vert fusionné au lavis qui attend. */
export const MILESTONE_SEGMENT_TONES: Record<MilestoneTone, string> = {
  merged: 'bg-positive',
  review: 'bg-positive/50',
  working: 'bg-accent',
  blocked: 'bg-caution',
  queued: 'bg-ink-faint/50',
  waiting: 'bg-accent/25',
  failed: 'bg-critical',
  dropped: 'bg-line',
}

/**
 * Un segment par carte du jalon, dans l'ordre des vagues : la barre dit d'un coup d'œil
 * ce qui est fusionné, ce qui tourne et ce qui attend. Le titre de chaque segment nomme
 * sa carte et son état, au survol.
 */
export function MilestoneSegments({ cards, className }: { cards: MilestoneRunCardDto[]; className?: string }) {
  const t = useTranslate()
  return (
    <span role="img" aria-label={t('milestoneRun.segments')} className={cx('flex min-w-0 gap-1', className)}>
      {milestoneOrder(cards).map((card) => (
        <span
          key={card.cardId}
          title={`#${card.number} ${card.title} · ${t(`milestoneRun.status.${card.status}`)}`}
          className={cx('h-1.5 min-w-1.5 flex-1 rounded-full', MILESTONE_SEGMENT_TONES[milestoneToneOf(card.status)])}
        />
      ))}
    </span>
  )
}

/**
 * Le bandeau d'un jalon lancé, en tête de l'Activité et de l'Aperçu (planche C1) : il se
 * lit d'un coup d'œil, et mène à la vue du jalon pour le piloter.
 *
 * Deux étages : le nom, la pastille et la branche, puis les segments et les comptes —
 * fusionnées, places occupées, prêtes en file, en attente de leurs dépendances — et, à
 * droite et en ambre, ce qui te demande quelque chose. Un compte à zéro n'est pas écrit.
 */
export function MilestoneBanner({ projectId, run }: { projectId: string; run: MilestoneRunDto }) {
  const t = useTranslate()
  const counts = milestoneCounts(run)
  const plural = (count: number) => (count > 1 ? 'many' : 'one')

  return (
    <section
      aria-label={t('milestoneRun.banner', { number: run.cardNumber })}
      className="flex min-w-0 flex-col gap-2 rounded-xl border border-accent/30 bg-accent-wash/30 px-4 py-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Flag size={16} aria-hidden className="shrink-0 text-accent" />
        <h3 className="min-w-0 truncate text-sm font-semibold text-ink">
          <span className="tabular-nums">#{run.cardNumber}</span> {run.cardTitle}
        </h3>
        <Badge tone={run.state === 'paused' ? 'caution' : 'accent'}>
          {t(run.state === 'paused' ? 'milestoneRun.paused' : 'milestoneRun.launched')}
        </Badge>
        {run.branch ? (
          <span className="hidden min-w-0 items-center gap-1 font-mono text-xs text-ink-soft sm:flex">
            <GitBranch size={13} aria-hidden className="shrink-0 text-ink-faint" />
            <span className="truncate">{run.branch}</span>
          </span>
        ) : null}
        <Link
          to={`/p/${projectId}/timeline/${run.cardNumber}`}
          className="ml-auto flex shrink-0 items-center gap-1 rounded px-1 text-sm text-accent hover:underline"
        >
          {t('milestoneRun.open')}
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1 text-sm text-ink-soft">
        <MilestoneSegments cards={run.cards} className="w-full sm:w-48 sm:shrink-0" />
        <span className="tabular-nums">
          {t('milestoneRun.merged', { merged: counts.merged, total: counts.total })}
        </span>
        <span className="tabular-nums">{t('milestoneRun.busy', { busy: run.busy, concurrency: run.concurrency })}</span>
        {counts.queued > 0 ? (
          <span className="hidden tabular-nums sm:inline">
            {t(`milestoneRun.queued.${plural(counts.queued)}`, { count: counts.queued })}
          </span>
        ) : null}
        {counts.waiting > 0 ? (
          <span className="hidden tabular-nums md:inline">
            {t(`milestoneRun.waiting.${plural(counts.waiting)}`, { count: counts.waiting })}
          </span>
        ) : null}
        {counts.asking > 0 ? (
          <span className="tabular-nums text-caution sm:ml-auto">
            {t(`milestoneRun.asking.${plural(counts.asking)}`, { count: counts.asking })}
          </span>
        ) : null}
      </div>
    </section>
  )
}
