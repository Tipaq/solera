import { useEffect, useRef } from 'react'

/**
 * Échap ferme la couche la plus haute, et elle seule (TIR-7).
 *
 * Une couche, c'est un tiroir, ou ce qui s'ouvre dedans sans être un menu Radix : une
 * autocomplétion, un champ en ligne, une confirmation sur place, un détail en pile dans
 * le panneau. La dernière ouverte passe devant ; Échap la ferme, puis la précédente au
 * coup suivant — jamais deux d'un coup.
 *
 * Une seule écoute, sur `window` en phase de capture : elle passe avant les écoutes de
 * Radix (sur `document`) et les `onKeyDown` de React. Elle ne s'en remet pas à un
 * `stopPropagation` posé par chaque composant, qui dépend de l'ordre des écoutes et casse
 * dès qu'un menu vit dans un portail.
 */

/** Ce que la pile lit d'un appui. */
export interface EscapeKey {
  key: string
  defaultPrevented: boolean
  isComposing: boolean
}

export interface EscapeStack {
  /** Inscrit une couche au sommet ; rend de quoi la retirer, où qu'elle soit. */
  push(close: () => void): () => void
  /**
   * Ferme le sommet si l'appui lui revient, et dit si c'est le cas. Un menu Radix
   * ouvert (`radixOpen`) garde son Échap : il se ferme lui-même, la pile s'efface.
   */
  handle(event: EscapeKey, radixOpen: boolean): boolean
}

export function createEscapeStack(): EscapeStack {
  const layers: Array<{ close: () => void }> = []
  return {
    push(close) {
      const layer = { close }
      layers.push(layer)
      return () => {
        const at = layers.indexOf(layer)
        if (at >= 0) layers.splice(at, 1)
      }
    },
    handle(event, radixOpen) {
      // `isComposing` : la saisie d'un accent ou d'un idéogramme, qu'Échap annule.
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return false
      const top = layers.at(-1)
      if (!top || radixOpen) return false
      top.close()
      return true
    },
  }
}

/**
 * Un menu Radix ouvert : menu, liste d'un `Select`, popover, ou confirmation. Pas une
 * infobulle (`role="tooltip"`), qui ne retient pas Échap.
 */
const RADIX_OPEN = [
  '[data-radix-popper-content-wrapper] [role="menu"]',
  '[data-radix-popper-content-wrapper] [role="listbox"]',
  '[data-radix-popper-content-wrapper] [role="dialog"]',
  '[role="alertdialog"][data-state="open"]',
].join(', ')

const stack = createEscapeStack()
let listening = false

function onKeyDown(event: KeyboardEvent) {
  if (!stack.handle(event, document.querySelector(RADIX_OPEN) !== null)) return
  event.preventDefault()
  event.stopPropagation()
}

/**
 * Inscrit une couche fermable par Échap tant que `active` est vrai. À utiliser pour tout
 * ce qui s'ouvre dans un tiroir ou dans le panneau sans être un menu Radix.
 */
export function useEscapeLayer(active: boolean, close: () => void): void {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!active) return
    if (!listening) {
      window.addEventListener('keydown', onKeyDown, true)
      listening = true
    }
    return stack.push(() => closeRef.current())
  }, [active])
}
