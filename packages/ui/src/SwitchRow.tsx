import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * Une ligne de liste qui s'allume ou s'éteint : un intitulé, sa phrase d'explication,
 * et l'interrupteur à droite.
 *
 * Toute la ligne est la cible, pas seulement le curseur : au doigt, viser un rail de
 * 32 px par 20 au bord d'un panneau rate une fois sur trois. Elle fait donc 44 px de
 * haut, comme les options de `ChoiceList`.
 *
 * `role="switch"` et non une case à cocher : le réglage prend effet au moment du clic,
 * sans formulaire à valider, et c'est ce que ce rôle annonce. Un choix entre deux
 * valeurs *nommées* — infléchir ou mettre en file — n'est pas un interrupteur et
 * revient à `ChoiceList` ; celui-ci ne convient qu'à ce qui s'allume.
 */
export function SwitchRow({
  checked,
  onCheckedChange,
  label,
  description,
  icon,
  disabled = false,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: ReactNode
  /** Repère de la catégorie, quand la ligne voisine d'autres réglages qui en portent. */
  icon?: ReactNode
  /** La phrase qui dit ce que l'allumer change. Absente quand l'intitulé suffit. */
  description?: ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cx(
        'flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left',
        'hover:bg-accent-wash focus-visible:outline-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
    >
      {icon ? <span aria-hidden className="shrink-0 text-ink-soft">{icon}</span> : null}
      <span className="min-w-0 flex-1 wrap-anywhere">
        <span className="block text-sm text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-meta text-ink-faint">{description}</span> : null}
      </span>
      <span
        aria-hidden
        className={cx(
          'flex h-5 w-8 shrink-0 items-center rounded-full p-0.5 transition-colors',
          checked ? 'justify-end bg-accent' : 'bg-line-strong',
        )}
      >
        <span className="size-4 rounded-full bg-surface" />
      </span>
    </button>
  )
}
