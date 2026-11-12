import type { Maturity } from '../../lib/milestone-model'

/** La teinte d'une pastille de maturité (MAT-1) : l'idée grise, l'affinage ambre, le lancé accent. */
export const MATURITY_TONE: Record<Maturity, string> = {
  idea: 'bg-surface-high text-ink-soft',
  refine: 'bg-caution/15 text-caution',
  split: 'bg-surface-high text-ink',
  ready: 'bg-positive/15 text-positive',
  launched: 'bg-accent/20 text-accent',
  delivered: 'bg-positive/25 text-positive',
}
