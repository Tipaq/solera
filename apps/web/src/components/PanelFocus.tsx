import { FocusScope } from '@radix-ui/react-focus-scope'
import { cloneElement, useEffect, useRef, type HTMLAttributes, type ReactElement } from 'react'

// Seul le panneau plein écran au premier plan neutralise le reste de l'interface.
// Recalculer la pile évite que deux panneaux ouverts rendent chacun l'autre inerte.
const modals: HTMLElement[] = []
let restoreOutside = () => {}

function updateModalBackground() {
  restoreOutside()
  const changed: Array<[HTMLElement, boolean]> = []
  let current = modals.at(-1)
  while (current && current.parentElement && current.parentElement !== document.body) {
    for (const sibling of current.parentElement.children) {
      if (!(sibling instanceof HTMLElement) || sibling === current) continue
      changed.push([sibling, sibling.inert])
      sibling.inert = true
    }
    current = current.parentElement
  }
  restoreOutside = () => {
    for (const [element, inert] of changed) element.inert = inert
  }
}

/**
 * Le dernier bord du piège de Radix (`getTabbableEdges`), avec ses critères à l'identique :
 * ailleurs, Tab depuis l'élément choisi ne serait pas reconnu comme le bord, et sortirait.
 */
function lastTabbable(container: HTMLElement) {
  const candidates = [...container.querySelectorAll<HTMLElement>('*')].filter((element) =>
    !(element as HTMLElement & { disabled?: boolean }).disabled
    && !element.hidden
    && !(element instanceof HTMLInputElement && element.type === 'hidden')
    && element.tabIndex >= 0)
  return candidates.findLast((element) => element.checkVisibility({ checkVisibilityCSS: true }))
}

/** Même contenu en panneau libre ou plein écran, sans remonter l'éditeur au redimensionnement. */
export function PanelFocus({ open, modal, onClose, fallbackFocus, opener, protectEditor = false, children }: {
  open: boolean
  modal: boolean
  onClose: () => void
  fallbackFocus?: string
  /**
   * Ce qui avait le focus avant l'ouverture, quand le contenu le prend dès son montage
   * (un champ `autoFocus`) : à ce moment, le déclencheur est déjà oublié.
   */
  opener?: Element | null
  protectEditor?: boolean
  children: ReactElement<HTMLAttributes<HTMLElement>>
}) {
  const container = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const fallback = useRef(fallbackFocus)
  fallback.current = fallbackFocus
  const openerRef = useRef(opener)
  openerRef.current = opener

  useEffect(() => {
    const node = container.current
    if (!node || !open) return
    const previous = openerRef.current ?? document.activeElement
    if (previous instanceof HTMLElement && previous !== document.body && !node.contains(previous)) returnTo.current = previous
    if (!node.contains(document.activeElement)) {
      node.querySelector<HTMLElement>('[data-panel-initial-focus]')?.focus({ preventScroll: true })
    }
    return () => {
      // Laisser la désactivation du piège de focus et de l'arrière-plan se terminer.
      queueMicrotask(() => {
        const focused = document.activeElement
        if (focused !== document.body && focused?.isConnected && !node.contains(focused)) return
        const candidates = [returnTo.current, ...document.querySelectorAll<HTMLElement>(fallback.current ?? '[data-navigation-trigger]')]
        candidates.find((target) => target?.isConnected && !target.closest('[inert]') && target.getClientRects().length > 0)?.focus({ preventScroll: true })
      })
    }
  }, [open])

  useEffect(() => {
    const node = container.current
    if (!node || !open || !modal) return
    if (!node.contains(document.activeElement)) {
      node.querySelector<HTMLElement>('[data-panel-initial-focus]')?.focus({ preventScroll: true })
    }
    modals.push(node)
    updateModalBackground()
    return () => {
      const index = modals.indexOf(node)
      if (index !== -1) modals.splice(index, 1)
      updateModalBackground()
    }
  }, [open, modal])

  return (
    <FocusScope
      asChild
      ref={container}
      trapped={open && modal}
      loop={open && modal}
      onMountAutoFocus={(event) => event.preventDefault()}
      onUnmountAutoFocus={(event) => event.preventDefault()}
    >
      {cloneElement(children, { onKeyDown: (event) => {
        children.props.onKeyDown?.(event)
        // Le piège de Radix ne boucle que depuis ses bords : focalisé sur lui-même (à
        // l'ouverture, ou par un clic dans son blanc), le conteneur laisserait Maj+Tab
        // sortir du dialogue vers un arrière-plan inerte (#254).
        const shiftTab = event.key === 'Tab' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey
        if (open && modal && shiftTab && event.target === container.current) {
          // Sans élément tabulable, Radix retient lui-même la touche sur le conteneur.
          const last = lastTabbable(container.current)
          if (!last) return
          event.preventDefault()
          last.focus({ preventScroll: true })
          if (last instanceof HTMLInputElement) last.select()
          return
        }
        if (!open || event.key !== 'Escape' || event.defaultPrevented) return
        const target = event.target
        if (!(target instanceof HTMLElement) || !container.current?.contains(target)) return
        // Échap reste disponible pour l'autocomplétion et les programmes du terminal.
        if (protectEditor && target.closest('input, textarea, [contenteditable="true"], .cm-editor, .xterm')) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      } })}
    </FocusScope>
  )
}
