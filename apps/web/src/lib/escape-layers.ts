import { useEffect, useRef, type RefObject } from 'react'

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
export interface EscapeKey<T = unknown> {
  key: string
  defaultPrevented: boolean
  isComposing: boolean
  /** D'où vient l'appui : l'élément qui avait le focus. */
  target?: T
}

export interface EscapeStack<T = unknown> {
  /**
   * Inscrit une couche au sommet ; rend de quoi la retirer, où qu'elle soit.
   *
   * `owns` borne une couche qui ne recouvre pas la page — un détail en pile dans le
   * panneau : elle ne prend Échap que s'il vient de chez elle. Tapé ailleurs (le champ
   * de la conversation, son autocomplétion), l'appui reste à qui l'a reçu.
   */
  push(close: () => void, owns?: (target: T | undefined) => boolean): () => void
  /**
   * Ferme le sommet si l'appui lui revient, et dit si c'est le cas. Un menu Radix
   * ouvert (`radixOpen`) garde son Échap : il se ferme lui-même, la pile s'efface.
   */
  handle(event: EscapeKey<T>, radixOpen: boolean): boolean
}

export function createEscapeStack<T = unknown>(): EscapeStack<T> {
  const layers: Array<{ close: () => void; owns?: (target: T | undefined) => boolean }> = []
  return {
    push(close, owns) {
      const layer = { close, owns }
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
      if (!top || radixOpen || (top.owns && !top.owns(event.target))) return false
      top.close()
      return true
    },
  }
}

/**
 * Un calque Radix ouvert : menu, liste d'un `Select`, popover, ou dialogue — une
 * confirmation ouverte depuis un tiroir passe au-dessus de lui (`data-state` : le tiroir,
 * lui, n'en porte pas). Pas une infobulle (`role="tooltip"`), qui ne retient pas Échap.
 */
const RADIX_OPEN = [
  '[data-radix-popper-content-wrapper] [role="menu"]',
  '[data-radix-popper-content-wrapper] [role="listbox"]',
  '[data-radix-popper-content-wrapper] [role="dialog"]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
].join(', ')

const stack = createEscapeStack<EventTarget | null>()
let listening = false

function onKeyDown(event: KeyboardEvent) {
  if (!stack.handle(event, document.querySelector(RADIX_OPEN) !== null)) return
  event.preventDefault()
  event.stopPropagation()
}

/**
 * Inscrit une couche fermable par Échap tant que `active` est vrai. À utiliser pour tout
 * ce qui s'ouvre dans un tiroir ou dans le panneau sans être un menu Radix.
 *
 * `scope` borne la couche à un élément (voir `EscapeStack.push`) ; un appui sans focus
 * précis, sur `body`, lui revient encore.
 */
export function useEscapeLayer(active: boolean, close: () => void, scope?: RefObject<HTMLElement | null>): void {
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!active) return
    if (!listening) {
      window.addEventListener('keydown', onKeyDown, true)
      listening = true
    }
    const owns = scope
      ? (target: EventTarget | null | undefined) => target === document.body || (target instanceof Node && scope.current?.contains(target) === true)
      : undefined
    return stack.push(() => closeRef.current(), owns)
  }, [active, scope])
}
