/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le squelette commun d'un onglet du panneau de droite, tiré d'Agent et d'Actions (les
 * références) et appliqué à Git, Terminaux, Recherche, Projet et Web :
 *
 * - **Ligne d'outils** : 48 px, filet bas, `px-3`. À gauche le titre court de l'onglet
 *   (`text-sm font-medium`) et son compte en méta grise ; à droite les outils, à la
 *   hauteur de `Button size="sm"` (`toolbarButtonClass`), la recherche compacte de la
 *   sidebar (`ToolbarSearch`) quand il y a de quoi chercher.
 * - **En-tête de groupe** : petites capitales, compte, `px-3 pt-1.5 pb-1`.
 * - **Ligne** : 36 px (44 au doigt), icône de nature avec son point d'état, libellé,
 *   méta grise à droite, un seul geste qui paraît au survol.
 * - **Détail en pile** : il remplace la liste dans le panneau, avec « ‹ Onglet » pour
 *   revenir — jamais un second tiroir.
 * - **État vide** : une ligne, et le geste utile à côté.
 * - **Retour** (« Simulé : … », erreur) : une bande fine sous la ligne d'outils, au même
 *   endroit dans tous les onglets.
 * - Pas de cartes bordées ; la couleur ne sert qu'aux points d'état.
 */
import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '@solera/ui'

/** Une ligne de liste : la même hauteur et les mêmes marges partout. */
export const PANEL_ROW =
  'group flex h-11 w-full items-center gap-2.5 px-3 text-left transition-colors hover:bg-surface-high/50 md:h-9'

/** Un geste de pied ou de détail, à la hauteur de `Button size="sm"`. */
export const PANEL_GESTURE =
  'inline-flex h-11 items-center gap-1.5 rounded-md px-2.5 text-xs text-ink-soft hover:bg-surface-high hover:text-ink disabled:opacity-40 md:h-9'

export function PanelToolbar({ title, meta, children, className }: {
  title: ReactNode
  meta?: ReactNode
  /** Les outils, posés à droite. */
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('@container flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-3', className)}>
      <span className="flex min-w-0 shrink items-baseline gap-1.5">
        <span className="truncate text-sm font-medium text-ink">{title}</span>
        {meta !== undefined && meta !== null && meta !== '' ? (
          <span className="truncate text-xs tabular-nums text-ink-faint">{meta}</span>
        ) : null}
      </span>
      <span className="flex-1" />
      {children}
    </div>
  )
}

export function PanelGroup({ title, count, aside }: { title: ReactNode; count?: number; aside?: ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 px-3 pt-1.5 pb-1 text-meta font-medium tracking-wide text-ink-faint uppercase">
      <span className="min-w-0 truncate">{title}</span>
      {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
      {aside ? <span className="ml-auto normal-case tracking-normal">{aside}</span> : null}
    </h3>
  )
}

/** L'icône de nature, avec le point d'état posé dessus. */
export function PanelIcon({ icon, dot }: { icon: ReactNode; dot?: string }) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center text-ink-faint">
      {icon}
      {dot ? <span aria-hidden className={cx('absolute -top-0.5 -right-0.5 size-1.5 rounded-full ring-2 ring-canvas', dot)} /> : null}
    </span>
  )
}

/** L'en-tête d'un détail en pile : « ‹ Onglet », puis ce qu'on regarde. */
export function PanelStackHeader({ back, onBack, title, meta, aside }: {
  back: string
  onBack: () => void
  title: ReactNode
  meta?: ReactNode
  aside?: ReactNode
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-2">
      <button type="button" onClick={onBack} className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-ink-soft hover:bg-surface-high hover:text-ink">
        <ChevronLeft size={14} /> {back}
      </button>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-ink">{title}</span>
        {meta ? <span className="truncate text-xs text-ink-faint">{meta}</span> : null}
      </span>
      {aside}
    </div>
  )
}

/** L'état vide : une ligne, et le geste utile à côté. */
export function PanelEmpty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 md:min-h-9">
      <p className="text-sm text-ink-faint">{children}</p>
      {action}
    </div>
  )
}

/** Le retour d'un geste ou une erreur, au même endroit dans tous les onglets. */
export function PanelNotice({ children, tone = 'neutral', onClose }: {
  children: ReactNode
  tone?: 'neutral' | 'critical' | 'caution'
  onClose?: () => void
}) {
  return (
    <p
      role={tone === 'critical' ? 'alert' : 'status'}
      className={cx(
        'flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 text-xs',
        tone === 'critical' ? 'text-critical' : tone === 'caution' ? 'text-caution' : 'text-ink-soft',
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {onClose ? (
        <button type="button" onClick={onClose} aria-label="Fermer" className="text-ink-faint hover:text-ink">✕</button>
      ) : null}
    </p>
  )
}
