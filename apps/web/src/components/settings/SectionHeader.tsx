import type { ReactNode } from 'react'

/**
 * Le chapeau d'une section de réglages : la phrase qui dit ce qu'on y règle.
 *
 * Le titre ne s'écrit plus ici. La modale le porte dans sa barre, au-dessus du trait,
 * et l'écrire une seconde fois en tête du contenu le répétait à deux lignes d'écart.
 * Le prop reste reçu — chaque section le donne, et il dit au lecteur du code de quelle
 * section il s'agit — mais c'est le catalogue qui le rend, une fois, dans la barre.
 */
export function SectionHeader({ description }: { title: string; description?: string }) {
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
