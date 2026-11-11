import { ArrowDown, ArrowUp, HardDrive } from 'lucide-react'
import { Badge, cx } from '@solera/ui'
import { PR_TONE, formatBytes, type TreeRow } from '../../lib/code-model'
import { useLocale, useTranslate } from '../../lib/i18n'

/**
 * Les faits d'un arbre en une ligne : sa PR, son avance et son retard sur la base (↓
 * ambre au-delà de 20), ses fichiers non commités, sa taille quand elle est mesurée.
 */
export function TreeFacts({ tree, className }: { tree: TreeRow; className?: string }) {
  const t = useTranslate()
  const locale = useLocale()
  const many = (count: number) => (count === 1 ? 'one' : 'other')
  return (
    <span className={cx('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-faint', className)}>
      {tree.pr ? (
        <Badge tone={PR_TONE[tree.pr.state]}>
          #{tree.pr.number} {t(`code.pr.${tree.pr.state}`)}
        </Badge>
      ) : null}
      {tree.root ? null : (
        <span className="inline-flex items-center gap-1">
          <span className="inline-flex items-center" title={t(`code.drift.ahead.${many(tree.ahead)}`, { count: tree.ahead })}>
            <ArrowUp size={11} />
            {tree.ahead}
          </span>
          <span
            className={cx('inline-flex items-center', tree.behind > 20 && 'text-caution')}
            title={t(`code.drift.behind.${many(tree.behind)}`, { count: tree.behind })}
          >
            <ArrowDown size={11} />
            {tree.behind}
          </span>
        </span>
      )}
      {tree.uncommitted > 0 ? (
        <span className="text-caution" title={t(`code.drift.dirty.${many(tree.uncommitted)}`, { count: tree.uncommitted })}>
          ●{tree.uncommitted}
        </span>
      ) : null}
      {tree.sizeBytes !== null ? (
        <span className="inline-flex items-center gap-1" title={t('code.size')}>
          <HardDrive size={11} />
          {formatBytes(tree.sizeBytes, locale)}
        </span>
      ) : null}
    </span>
  )
}
