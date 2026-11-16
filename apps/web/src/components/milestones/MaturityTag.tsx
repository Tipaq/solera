import { cx } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import type { Maturity } from '../../lib/milestone-model'
import { MATURITY_DOT } from './tones'

/** Le texte d'une maturité : une couleur par étape, et sobre. */
const MATURITY_TEXT: Record<Maturity, string> = {
  idea: 'text-ink-faint',
  refine: 'text-caution',
  split: 'text-ink-soft',
  ready: 'text-positive',
  launched: 'text-accent',
  delivered: 'text-positive',
}

/**
 * L'étape d'un jalon en texte, précédée de son point : lisible sans pastille pleine, là
 * où une `MaturityPill` serait trop lourde (le phare de l'Aperçu et sa file).
 */
export function MaturityTag({ maturity, className }: { maturity: Maturity; className?: string }) {
  const t = useTranslate()
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap', MATURITY_TEXT[maturity], className)}>
      <span aria-hidden className={cx('size-1.5 rounded-full', MATURITY_DOT[maturity])} />
      {t(`milestones.maturity.label.${maturity}`)}
    </span>
  )
}
