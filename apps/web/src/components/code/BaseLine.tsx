import { Check, GitBranch, TriangleAlert } from 'lucide-react'
import { cx } from '@solera/ui'
import { baseLineOf, type TreeRow } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'

/**
 * La ligne de base (T-2) : la branche de comparaison, et la racine du projet. En gris
 * quand la racine y est ; en ambre quand elle est sortie sur une autre branche, avec ses
 * fichiers non commités. Rien hors dépôt.
 */
export function BaseLine({ code, className }: { code: { base: string | null; trees: TreeRow[] }; className?: string }) {
  const t = useTranslate()
  const line = baseLineOf(code)
  if (!line) return null
  // La branche s'insère dans la phrase traduite, à la place que chaque langue lui donne.
  const [before, after] = t('code.base.rootOff', { branch: '\u0000' }).split('\u0000')
  return (
    <p className={cx('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs', line.off ? 'text-caution' : 'text-ink-faint', className)}>
      <GitBranch size={12} className="shrink-0" />
      <span>
        {t('code.base.label')} <code className="font-mono text-[12px] font-semibold text-ink">{line.base}</code>
      </span>
      <span aria-hidden>·</span>
      {line.off ? (
        <>
          <TriangleAlert size={12} className="shrink-0" />
          <span>
            {before}
            <code className="font-mono text-[12px] font-semibold">{line.rootBranch}</code>
            {after}
            {line.uncommitted > 0
              ? t(`code.base.rootOffDirty.${line.uncommitted === 1 ? 'one' : 'other'}`, { count: line.uncommitted })
              : null}
          </span>
        </>
      ) : (
        <span className="inline-flex items-center gap-1">
          <Check size={12} className="shrink-0 text-positive" />
          {t('code.base.rootHere')}
        </span>
      )}
    </p>
  )
}
