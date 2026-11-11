import { ArrowDown, ArrowUp, HardDrive } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge, cx } from '@solera/ui'
import { BEHIND_ALERT, PR_TONE, formatBytes, pluralOf, type TreeRow } from '../../lib/code-model'
import { useLocale, useTranslate } from '../../lib/i18n'

/** Un fait en signes, et sa phrase pour un lecteur d'écran : l'infobulle n'existe pas au doigt. */
function Fact({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span title={label}>
      <span aria-hidden className={className}>
        {children}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/**
 * Les faits d'un arbre en une ligne : sa PR, son avance et son retard sur la base (↓
 * ambre au-delà de 20), ses fichiers non commités, sa taille quand elle est mesurée.
 */
export function TreeFacts({ tree, className }: { tree: TreeRow; className?: string }) {
  const t = useTranslate()
  const locale = useLocale()
  return (
    <span className={cx('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-faint', className)}>
      {tree.pr ? (
        <Badge tone={PR_TONE[tree.pr.state]}>
          #{tree.pr.number} {t(`code.pr.${tree.pr.state}`)}
        </Badge>
      ) : null}
      {tree.root ? null : (
        <span className="inline-flex items-center gap-1">
          <Fact label={t(`code.drift.ahead.${pluralOf(tree.ahead)}`, { count: tree.ahead })} className="inline-flex items-center">
            <ArrowUp size={11} />
            {tree.ahead}
          </Fact>
          <Fact
            label={t(`code.drift.behind.${pluralOf(tree.behind)}`, { count: tree.behind })}
            className={cx('inline-flex items-center', tree.behind > BEHIND_ALERT.tree && 'text-caution')}
          >
            <ArrowDown size={11} />
            {tree.behind}
          </Fact>
        </span>
      )}
      {tree.uncommitted > 0 ? (
        <Fact label={t(`code.drift.dirty.${pluralOf(tree.uncommitted)}`, { count: tree.uncommitted })} className="text-caution">
          ●{tree.uncommitted}
        </Fact>
      ) : null}
      {tree.sizeBytes !== null ? (
        <Fact label={t('code.size')} className="inline-flex items-center gap-1">
          <HardDrive size={11} />
          {formatBytes(tree.sizeBytes, locale)}
        </Fact>
      ) : null}
    </span>
  )
}
