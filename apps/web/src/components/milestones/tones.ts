import type { Maturity } from '../../lib/milestone-model'
import type { CardState } from '../../lib/card-state'

/** La teinte d'une pastille de maturité (MAT-1) : l'idée grise, l'affinage ambre, le lancé accent. */
export const MATURITY_TONE: Record<Maturity, string> = {
  idea: 'bg-surface-high text-ink-soft',
  refine: 'bg-caution/15 text-caution',
  split: 'bg-surface-high text-ink',
  ready: 'bg-positive/15 text-positive',
  launched: 'bg-accent/20 text-accent',
  delivered: 'bg-positive/25 text-positive',
}

/** Un nœud du graphe des vagues : cadre et fond, à la teinte de l'état. */
export const STATE_NODE: Record<CardState, string> = {
  todo: 'border-line-strong bg-surface',
  blocked: 'border-caution/60 bg-caution/8',
  running: 'border-accent/70 bg-accent-wash/60',
  review: 'border-positive/60 bg-positive/8',
  done: 'border-positive/40 bg-positive/5',
  abandoned: 'border-dashed border-line opacity-50',
}
