import { useState } from 'react'

/**
 * Champ de renommage, ouvert par double-clic sur le nom.
 *
 * Le texte est sélectionné à l'ouverture : renommer part presque toujours d'un nom
 * proposé par le CLI qu'on remplace, et le curseur posé en fin de ligne obligeait à
 * tout effacer à la main.
 *
 * Sert aussi à **créer** : le titre d'une note se tape là où la note va vivre, dans
 * l'arbre du vault, et c'est le même champ — un nom qu'on pose sur une ligne.
 */
export function RenameInput({
  value,
  onCommit,
  onCancel,
  className,
  placeholder,
}: {
  value: string
  onCommit: (next: string) => void
  onCancel: () => void
  className: string
  /** Pour une création, où le champ naît vide et doit dire ce qu'on y tape. */
  placeholder?: string
}) {
  const [draft, setDraft] = useState(value)

  return (
    <input
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft)
        if (event.key === 'Escape') onCancel()
      }}
      className={className}
    />
  )
}
