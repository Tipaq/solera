import { cx } from '@solera/ui'
import { VERDICT_DOT } from './VerdictDot'
import { shortBranch, type TreeRow } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'

/**
 * La puce d'arbre d'une ligne du fil : son point de verdict et sa branche, sans préfixe.
 * Un clic filtre le fil sur l'arbre. Un `span` qui agit, et non un bouton : elle vit
 * souvent dans une ligne qui est déjà un lien.
 */
export function TreeChip({ tree, active = false, onSelect }: { tree: TreeRow; active?: boolean; onSelect: (key: string) => void }) {
  const t = useTranslate()
  const name = tree.branch ?? tree.name
  const run = (event: { preventDefault: () => void; stopPropagation: () => void }) => {
    event.preventDefault()
    event.stopPropagation()
    onSelect(tree.key)
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-pressed={active}
      title={t('code.chip.filter', { branch: name })}
      onClick={run}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') run(event)
      }}
      className={cx(
        'inline-flex h-5 max-w-[11rem] shrink cursor-pointer items-center gap-1 rounded px-1.5 font-mono text-micro transition-colors focus-visible:outline-2 focus-visible:outline-accent',
        active ? 'bg-accent-wash text-ink' : 'bg-sunken text-ink-soft hover:bg-surface-high hover:text-ink',
      )}
    >
      <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', VERDICT_DOT[tree.verdict])} />
      <span className="min-w-0 truncate">{shortBranch(name)}</span>
    </span>
  )
}
