import type { ReactNode } from 'react'
import { cx } from '@solera/ui'

/**
 * Le titre d'une section et son compte.
 *
 * `section` pour un bloc de page (« Projets », « Code ») ; `group` en petites capitales
 * pour une tranche d'une liste (« Aujourd'hui », « Hier »), qui ne doit pas peser
 * autant que les lignes qu'elle range.
 */
export function SectionTitle({ children, count, aside, size = 'section' }: { children: ReactNode; count?: number; aside?: ReactNode; size?: 'section' | 'group' }) {
  return (
    <div className={cx('flex min-w-0 items-baseline gap-2', size === 'group' && 'py-1')}>
      <h2 className={size === 'group' ? 'text-xs font-medium tracking-wide text-ink-faint uppercase' : 'text-sm font-medium text-ink'}>{children}</h2>
      {count !== undefined ? <span className="text-xs tabular-nums text-ink-faint">{count}</span> : null}
      {aside ? <span className="ml-auto">{aside}</span> : null}
    </div>
  )
}
