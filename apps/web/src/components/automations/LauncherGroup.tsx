import { Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '@solera/ui'

/*
 * Le gabarit du Lanceur de l'onglet Actions (LAN-*) : des tuiles de taille égale, rangées
 * en groupes. Une tuile d'action, une tuile de processus de session : la même boîte.
 */

/** La grille commune : des colonnes de largeur fixe, 3 à 4 selon la place. */
export const TILE_GRID =
  'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(16.5rem,1fr))] 2xl:[grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]'

/** Hauteur fixe, rien ne dépasse : chaque rangée interne tronque, la boîte coupe le reste. */
export const TILE_BOX = '@container/tile flex h-[9.5rem] min-w-0 flex-col overflow-hidden rounded-xl border p-3'

/** Un groupe : en-tête sobre (icône, titre, compte), puis la grille et sa tuile d'ajout. */
export function LauncherGroup({
  icon,
  title,
  count,
  add,
  children,
}: {
  icon: ReactNode
  title: string
  count: number
  add?: { label: string; onClick: () => void }
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex items-center gap-2 text-ink-soft">
        <span aria-hidden className="text-ink-faint">{icon}</span>
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <span className="text-xs tabular-nums text-ink-faint">{count}</span>
      </header>
      <div className={TILE_GRID}>
        {children}
        {add ? (
          <button
            type="button"
            onClick={add.onClick}
            className={cx(
              TILE_BOX,
              'items-center justify-center gap-1.5 border-dashed border-line text-xs text-ink-faint transition-colors hover:border-line-strong hover:text-ink',
            )}
          >
            <Plus size={15} aria-hidden /> {add.label}
          </button>
        ) : null}
      </div>
    </section>
  )
}
