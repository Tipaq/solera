import { cx } from '@solera/ui'
import type { ActionsStatus } from '../../lib/actions-tab'
import { useTranslate } from '../../lib/i18n'

const ITEM =
  'inline-flex h-8 pointer-coarse:h-11 shrink-0 items-center gap-1.5 rounded px-1.5 text-xs whitespace-nowrap transition-colors hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent'

/**
 * Ce que disait le ⚡, dans la barre de l'onglet Actions (AO-4) : « ● N en marche » en
 * vert qui bat, « ● N à relire » en ambre. Un clic filtre sur ce qu'il compte. Rien
 * quand rien ne tourne ni n'attend.
 */
export function ActionsStatusMeta({
  status,
  onRunning,
  onReview,
}: {
  status: ActionsStatus
  onRunning: () => void
  onReview: () => void
}) {
  const t = useTranslate()
  if (status.running === 0 && status.toReview === 0) return null
  return (
    <span data-actions-status className="flex min-w-0 items-center gap-1">
      {status.running > 0 ? (
        <button type="button" onClick={onRunning} title={t('actionsTab.status.runningHint')} className={cx(ITEM, 'text-positive')}>
          <span aria-hidden className="size-1.5 rounded-full bg-positive motion-safe:animate-pulse" />
          {t('actionsTab.status.running', { count: status.running })}
        </button>
      ) : null}
      {status.toReview > 0 ? (
        <button type="button" onClick={onReview} title={t('actionsTab.status.reviewHint')} className={cx(ITEM, 'text-caution')}>
          <span aria-hidden className="size-1.5 rounded-full bg-caution" />
          {t('actionsTab.status.review', { count: status.toReview })}
        </button>
      ) : null}
    </span>
  )
}
