import { cx } from './cx'

/**
 * Le rail d'un interrupteur, sans interaction.
 *
 * Séparé du bouton parce qu'il a deux hôtes : `SwitchRow`, où toute la ligne est le
 * bouton et où le rail ne peut donc pas en être un second, et `Switch`, où il est
 * seul. Deux copies de ces quatre classes auraient divergé au premier changement de
 * teinte.
 */
export function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'flex h-5 w-8 shrink-0 items-center rounded-full p-0.5 transition-colors',
        checked ? 'justify-end bg-accent' : 'bg-line-strong',
      )}
    >
      <span className="size-4 rounded-full bg-surface" />
    </span>
  )
}

/**
 * Un interrupteur seul, pour les endroits où l'intitulé est déjà porté par la ligne
 * ou par l'en-tête de colonne — une cellule de tableau, typiquement.
 *
 * Ailleurs, c'est `SwitchRow` qu'il faut : un interrupteur sans phrase à côté de lui
 * n'apprend pas ce que l'allumer change, et son `label` ne sert alors qu'au lecteur
 * d'écran. La cible fait 44 px de haut, le rail n'en faisant que 20.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Nom accessible : obligatoire, puisque rien n'est écrit à côté. */
  label: string
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cx(
        'flex min-h-11 shrink-0 items-center rounded px-1',
        'focus-visible:outline-2 focus-visible:outline-accent',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
    >
      <SwitchTrack checked={checked} />
    </button>
  )
}
