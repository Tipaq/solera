import { useState } from 'react'

/**
 * Champ de renommage, ouvert par double-clic sur le nom.
 *
 * Le texte est sélectionné à l'ouverture : renommer part presque toujours d'un nom
 * proposé par le CLI qu'on remplace, et le curseur posé en fin de ligne obligeait à
 * tout effacer à la main.
 */
export function RenameInput({
  value,
  onCommit,
  onCancel,
  className,
}: {
  value: string
  onCommit: (next: string) => void
  onCancel: () => void
  className: string
}) {
  const [draft, setDraft] = useState(value)

  return (
    <input
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
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
