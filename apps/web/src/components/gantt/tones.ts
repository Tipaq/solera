import type { CardState } from '../../lib/card-state'

/** Barre de Gantt : fond, texte et bord, à la teinte de l'état. */
export const STATE_BAR: Record<CardState, string> = {
  todo: 'bg-surface-high text-ink-soft border border-line-strong',
  blocked: 'bg-caution/15 text-caution border border-caution/40',
  running: 'bg-accent/25 text-accent border border-accent/50',
  review: 'bg-positive/15 text-positive border border-positive/40',
  done: 'bg-positive/30 text-positive border border-positive/50',
  abandoned: 'bg-surface-high text-ink-faint border border-dashed border-line opacity-60',
}

/** Pastille d'état, dans une liste ou une infobulle. */
export const STATE_DOT: Record<CardState, string> = {
  todo: 'bg-ink-faint',
  blocked: 'bg-caution',
  running: 'bg-accent',
  review: 'bg-positive',
  done: 'bg-positive',
  abandoned: 'bg-line-strong',
}
