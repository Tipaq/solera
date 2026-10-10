import { cx } from './cx'

export interface Preset {
  /** Identifiant rendu à `onSelect` ; c'est l'écran qui sait ce qu'il remplit. */
  key: string
  label: string
}

/**
 * Des valeurs toutes faites qui remplissent le champ au-dessus d'elles — un cron, une
 * adresse de service, une cadence. Ce n'est **pas** un choix exclusif : le champ reste
 * saisissable, et aucune pastille n'est retenue quand on a écrit autre chose. D'où des
 * boutons ordinaires plutôt que des `radio`, et `selected` facultatif.
 *
 * Trois écrans portaient la même rangée mot pour mot (`rounded-md border px-2 py-0.5
 * text-xs`, retenue en `border-accent bg-accent-wash`), avec le même défaut : vingt-deux
 * pixels de haut, pour une cible qu'on vise au doigt dans un formulaire de réglages.
 * Elles font ici 44 px au doigt et restent fines au pointeur (§11).
 */
export function Presets({
  label,
  presets,
  selected,
  onSelect,
  className,
}: {
  label: string
  presets: Preset[]
  selected?: string
  onSelect: (key: string) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cx('flex flex-wrap gap-1.5', className)}>
      {presets.map((preset) => (
        <button
          key={preset.key}
          type="button"
          onClick={() => onSelect(preset.key)}
          className={cx(
            'inline-flex h-11 items-center rounded-md border px-2 text-xs',
            'transition-[background,border-color,color] duration-150 md:h-7 pointer-coarse:h-11',
            preset.key === selected
              ? 'border-accent bg-accent-wash text-ink'
              : 'border-line text-ink-faint hover:border-line-strong hover:text-ink-soft',
          )}
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
