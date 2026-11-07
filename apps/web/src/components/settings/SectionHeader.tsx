import type { ReactNode } from 'react'

/**
 * Le chapeau d'une section de réglages : la phrase qui dit ce qu'on y règle.
 *
 * Pas de titre ici : la modale porte dans sa barre le libellé de la section, celui de
 * la liste. Un titre propre à la page finissait par dire autre chose que la liste
 * (« Comptes » sous « Utilisateurs », « Le vault » sous « Savoir ») sans jamais
 * s'afficher.
 */
export function SectionHeader({ description }: { description?: string }) {
  if (!description) return null
  return <p className="mb-4 text-sm text-ink-faint">{description}</p>
}

/**
 * Le titre d'une liste dans une section : son nom, son compte, et l'action qui lui
 * ajoute une entrée, posée à droite quand la liste n'est pas vide.
 */
export function ListHeading({
  title,
  count,
  action,
}: {
  title: string
  count?: number
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
        {title}
        {count ? (
          <span className="rounded-full bg-surface-high px-1.5 text-meta font-medium text-ink-faint tabular-nums">
            {count}
          </span>
        ) : null}
      </h2>
      {action}
    </div>
  )
}
