import { Check } from 'lucide-react'
import { cx } from '@solera/ui'

/**
 * La case d'une coche, seule et muette : celui qui la porte dit son rôle (`checkbox`,
 * `radio`) et son état. `round` pour un choix unique.
 *
 * Celle des menus de la barre (`MenuCheck`) et des lignes cochables de `/sessions`.
 */
export function CheckBox({ checked, round = false }: { checked: boolean; round?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid size-4 shrink-0 place-items-center border',
        round ? 'rounded-full' : 'rounded',
        checked ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
      )}
    >
      {checked ? round ? <span className="size-1.5 rounded-full bg-accent-ink" /> : <Check size={11} strokeWidth={3} /> : null}
    </span>
  )
}
