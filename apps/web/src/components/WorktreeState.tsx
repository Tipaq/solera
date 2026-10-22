import type { WorktreeState } from '@solera/protocol'
import { cx } from '@solera/ui'

/** Couleur d'un état de chantier, pour que le même mot ait la même teinte partout. */
export const WORKTREE_STATE_COLOR: Record<WorktreeState, string> = {
  missing: 'bg-critical',
  unreadable: 'bg-critical',
  dirty: 'bg-caution',
  unmerged: 'bg-accent',
  empty: 'bg-line-strong',
  merged: 'bg-positive',
}

export const WORKTREE_STATE_TONE: Record<WorktreeState, 'neutral' | 'critical' | 'caution' | 'accent' | 'positive'> = {
  missing: 'critical',
  unreadable: 'critical',
  dirty: 'caution',
  unmerged: 'accent',
  empty: 'neutral',
  merged: 'positive',
}

/**
 * Le repère d'état d'un arbre : un carré plein, sans arrondi, pour ne pas se confondre
 * avec les points de signal des sessions, qui parlent de l'instant et non de l'arbre.
 */
export function WorktreeStateMark({ state, className }: { state: WorktreeState; className?: string }) {
  return <span aria-hidden className={cx('size-1.5 shrink-0', WORKTREE_STATE_COLOR[state], className)} />
}
