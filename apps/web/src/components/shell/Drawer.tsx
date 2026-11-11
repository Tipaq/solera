import { X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconButton, cx } from '@solera/ui'
import { useEscapeLayer } from '../../lib/escape-layers'
import { useTranslate } from '../../lib/i18n'
import { PANEL_TRANSITION_MS } from '../../lib/panel'
import { useMediaQuery } from '../../lib/viewport'
import { PanelFocus } from '../PanelFocus'

/*
 * Le tiroir commun : un détail passager — la fiche d'une carte, l'éditeur d'une action,
 * le détail d'un commit — qui passe **par-dessus** le contenu. Le panneau (git,
 * fichiers, terminal), lui, est ancré et pousse. Les deux ont la même géométrie : sous
 * la rangée d'onglets jusqu'en bas, bord gauche fin, sans coins arrondis ; le tiroir
 * seul a une ombre, parce qu'il flotte. Les règles sont dans le design system,
 * *Gabarits/Panneau et tiroir*.
 */

export const DRAWER_LAYER_ID = 'drawer-layer'

/**
 * Le calque où les tiroirs se posent, dans le conteneur `relative` sous la rangée :
 * `PlaceShell` le pose, `/sessions` aussi. Transparent aux clics, masqué quand il est
 * vide. Une page qui veut un autre point d'ancrage pose le sien sous un autre `id`.
 */
export function DrawerLayer({ id = DRAWER_LAYER_ID }: { id?: string }) {
  return <div id={id} className="pointer-events-none absolute inset-0 z-30 empty:hidden" />
}

const WIDTH = {
  normal: 'md:w-[min(36rem,calc(100%-3rem))]',
  /** L'éditeur d'une action, et rien d'autre : deux largeurs, pas plus. */
  wide: 'md:w-[min(48rem,calc(100%-3rem))]',
} as const

/** L'en-tête commun : méta facultative au-dessus, le titre, `✕` à droite. */
export function DrawerHeader({ title, subtitle, onClose }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void }) {
  const t = useTranslate()
  return (
    <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {subtitle ? <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">{subtitle}</div> : null}
        <h2 className="min-w-0 text-base leading-snug font-semibold text-ink">{title}</h2>
      </div>
      <IconButton label={t('drawer.close')} size="sm" onClick={onClose}>
        <X size={15} />
      </IconButton>
    </header>
  )
}

interface DrawerProps {
  open: boolean
  onClose: () => void
  /** Nom accessible du dialogue, quand `title` n'est pas une chaîne. */
  label: string
  /** Sans `title`, le contenu porte lui-même son `DrawerHeader`. */
  title?: ReactNode
  subtitle?: ReactNode
  width?: keyof typeof WIDTH
  /** Un autre calque que celui de la coque ; absent du document, on retombe sur elle. */
  layerId?: string
  children: ReactNode
}

/**
 * Le tiroir reste monté le temps de sortir de l'écran, comme `CardPanel` : le démonter
 * à la fermeture le ferait disparaître d'un coup.
 */
export function Drawer(props: DrawerProps) {
  const { open } = props
  const [present, setPresent] = useState(open)
  /* Le déclencheur, retenu avant que le tiroir monte : un champ `autoFocus` du contenu
     prend le focus dans le même rendu, et `PanelFocus` ne saurait plus où le rendre. */
  const opener = useRef<Element | null>(null)
  useEffect(() => {
    if (open) {
      opener.current = document.activeElement
      setPresent(true)
      return
    }
    const timer = setTimeout(() => setPresent(false), PANEL_TRANSITION_MS)
    return () => clearTimeout(timer)
  }, [open])
  if (!present) return null
  return <DrawerPanel {...props} opener={opener.current} />
}

function DrawerPanel({ open, onClose, label, title, subtitle, width = 'normal', layerId, children, opener }: DrawerProps & { opener: Element | null }) {
  const t = useTranslate()
  const aside = useRef<HTMLElement>(null)
  /* Le calque est cherché après le rendu, pas pendant : un tiroir ouvert dès l'arrivée
     (par l'adresse) se rend dans le même passage que la coque qui le porte. */
  const [layer, setLayer] = useState<HTMLElement | null | undefined>(undefined)
  useLayoutEffect(() => {
    setLayer((layerId ? document.getElementById(layerId) : null) ?? document.getElementById(DRAWER_LAYER_ID))
  }, [layerId])

  /* L'entrée glissée : le premier rendu se fait hors écran, et la position finale n'est
     posée qu'à l'image suivante, une fois le style de départ calculé. */
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (layer === undefined) return
    aside.current?.getBoundingClientRect()
    const frame = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(frame)
  }, [layer])

  useEscapeLayer(open, onClose)
  const modal = !useMediaQuery('(min-width: 48rem)')

  useEffect(() => {
    // Le focus entre dans le tiroir, sauf si un champ du contenu l'y a déjà mis.
    if (open && layer !== undefined && !aside.current?.contains(document.activeElement)) aside.current?.focus({ preventScroll: true })
  }, [open, layer])

  if (layer === undefined) return null
  const shown = entered && open
  const inLayer = layer !== null
  return createPortal(
    <>
      <button
        type="button"
        aria-label={t('drawer.close')}
        tabIndex={-1}
        onClick={onClose}
        className={cx(
          'veil cursor-default transition-opacity duration-200 ease-out',
          inLayer ? 'absolute inset-0' : 'fixed inset-0 z-40',
          shown ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <PanelFocus open={open} modal={modal} onClose={onClose} opener={opener}>
        <aside
          ref={aside}
          tabIndex={-1}
          inert={!open}
          role="dialog"
          aria-label={label}
          aria-modal={modal && open ? true : undefined}
          className={cx(
            'pointer-events-auto flex flex-col overflow-hidden border-l border-line bg-canvas shadow-drawer outline-none',
            inLayer ? 'absolute inset-y-0 right-0 w-full' : 'fixed inset-y-0 right-0 z-40 w-full',
            WIDTH[width],
            // `translate` et non `transform` : voir `CardPanel`.
            'transition-[translate] duration-200 ease-out',
            shown ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          {title ? <DrawerHeader title={title} subtitle={subtitle} onClose={onClose} /> : null}
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>
        </aside>
      </PanelFocus>
    </>,
    layer ?? document.body,
  )
}
