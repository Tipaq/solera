/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le **tiroir** : un détail passager (fiche de carte, gérer les actions, éditeur
 * d'action…) qui passe **par-dessus** le contenu. Même géométrie que le **panneau**
 * (`SidePanel`, l'outil qu'on garde ouvert et qui pousse le contenu) : sous la rangée
 * d'onglets, jusqu'en bas, bord gauche fin, sans coins arrondis. Seule différence
 * visible : une ombre légère, parce qu'il flotte.
 *
 * Deux largeurs, pas plus : `normal` (36 rem) et `wide` (48 rem, l'éditeur d'action).
 * Plein écran au téléphone. Un clic dehors ferme le tiroir.
 *
 * **Échap ferme la couche la plus haute, et elle seule.** Une seule écoute, posée sur
 * `window` en phase de *capture* : elle passe avant tout le reste, y compris les écoutes
 * de Radix (sur `document`, en capture elles aussi) et les `onKeyDown` de React. Elle
 * ne s'en remet pas à un `stopPropagation` posé par chaque composant, qui dépend de
 * l'ordre des écoutes et casse dès qu'un menu vit dans un portail. Deux sources :
 * - la pile des **couches** : chaque tiroir s'y inscrit, et tout ce qui s'ouvre dedans
 *   sans être un menu Radix (autocomplétion `#`, champ de lien en ligne…) aussi, par
 *   `useEscapeLayer(actif, fermer)`. Échap ferme celle du dessus ;
 * - un **menu Radix** ouvert (menu, popover, liste de `Select` — pas une infobulle) :
 *   l'écoute s'efface, Radix le ferme lui-même et le tiroir reste ouvert.
 *
 * Il se pose dans le calque `#proto-drawer-layer` de la coque du projet (sous la
 * rangée d'onglets) ; hors de la coque, il retombe en `fixed` sur toute la hauteur.
 */
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton, cx } from '@solera/ui'

export const DRAWER_LAYER_ID = 'proto-drawer-layer'

/** Le calque où les tiroirs se posent : à mettre dans le conteneur `relative` sous les onglets. */
export function DrawerLayer() {
  return <div id={DRAWER_LAYER_ID} className="pointer-events-none absolute inset-0 z-30 empty:hidden" />
}

/* La pile des couches ouvertes (tiroirs et ce qui s'ouvre dedans) : Échap ne ferme que
   celle du dessus. */
interface Layer { id: number; close: () => void }
const layers: Layer[] = []
let nextId = 1
let listening = false

/** Un menu Radix ouvert garde son Échap ; une infobulle (`role="tooltip"`) non. */
const RADIX_OPEN =
  '[data-radix-popper-content-wrapper] [role="menu"], [data-radix-popper-content-wrapper] [role="listbox"], [data-radix-popper-content-wrapper] [role="dialog"], [role="alertdialog"][data-state="open"]'

function onEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return
  if (document.querySelector(RADIX_OPEN)) return
  const top = layers[layers.length - 1]
  if (!top) return
  event.preventDefault()
  event.stopPropagation()
  top.close()
}

/**
 * Inscrit une couche fermable par Échap tant que `active` est vrai : la dernière ouverte
 * passe devant. À utiliser pour tout ce qui s'ouvre dans un tiroir sans être un menu
 * Radix (une autocomplétion, un champ en ligne, une confirmation sur place).
 */
export function useEscapeLayer(active: boolean, close: () => void) {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!active || typeof window === 'undefined') return
    if (!listening) {
      window.addEventListener('keydown', onEscape, true)
      listening = true
    }
    const id = nextId++
    layers.push({ id, close: () => closeRef.current() })
    return () => {
      const at = layers.findIndex((layer) => layer.id === id)
      if (at >= 0) layers.splice(at, 1)
    }
  }, [active])
}

const WIDTH = {
  normal: 'md:w-[min(36rem,calc(100%-3rem))]',
  wide: 'md:w-[min(48rem,calc(100%-3rem))]',
} as const

/** L'en-tête commun : titre, sous-titre facultatif, ✕ à droite. */
export function DrawerHeader({ title, subtitle, onClose }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void }) {
  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {subtitle ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">{subtitle}</div> : null}
        <h2 className="min-w-0 text-base leading-snug font-semibold text-ink">{title}</h2>
      </div>
      <IconButton label="Fermer" size="sm" onClick={onClose}>
        <X size={15} />
      </IconButton>
    </header>
  )
}

export function Drawer({
  open,
  onClose,
  label,
  title,
  subtitle,
  width = 'normal',
  layerId,
  children,
}: {
  open: boolean
  onClose: () => void
  /** Nom accessible, quand `title` n'est pas une chaîne. */
  label: string
  /** Sans `title`, le contenu porte lui-même son `DrawerHeader`. */
  title?: ReactNode
  subtitle?: ReactNode
  width?: keyof typeof WIDTH
  /**
   * Un autre calque que celui de la coque du projet : la conversation pose le sien, à
   * gauche de son panneau. Absent du document, le tiroir retombe sur celui de la coque.
   */
  layerId?: string
  children: ReactNode
}) {
  // Lu au rendu : le calque est dans la coque, déjà montée quand un tiroir s'ouvre.
  const layer =
    open && typeof document !== 'undefined'
      ? ((layerId ? document.getElementById(layerId) : null) ?? document.getElementById(DRAWER_LAYER_ID))
      : null
  const aside = useRef<HTMLElement>(null)
  useEscapeLayer(open, onClose)

  useEffect(() => {
    // Le focus entre dans le tiroir, sauf si un champ `autoFocus` l'y a déjà mis.
    if (open && !aside.current?.contains(document.activeElement)) aside.current?.focus({ preventScroll: true })
  }, [open])

  if (!open) return null
  const inLayer = layer !== null
  const body = (
    <>
      <button
        type="button"
        aria-label="Fermer"
        tabIndex={-1}
        onClick={onClose}
        className={cx('pointer-events-auto cursor-default bg-black/15', inLayer ? 'absolute inset-0' : 'fixed inset-0 z-40')}
      />
      <aside
        ref={aside}
        tabIndex={-1}
        role="dialog"
        aria-label={label}
        className={cx(
          'pointer-events-auto flex flex-col overflow-hidden border-l border-line bg-canvas outline-none',
          'shadow-[-12px_0_32px_-16px_rgb(0_0_0/0.35)]',
          inLayer ? 'absolute inset-y-0 right-0 w-full' : 'fixed inset-y-0 right-0 z-40 w-full',
          WIDTH[width],
        )}
      >
        {title ? <DrawerHeader title={title} subtitle={subtitle} onClose={onClose} /> : null}
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </aside>
    </>
  )
  return createPortal(body, layer ?? document.body)
}
