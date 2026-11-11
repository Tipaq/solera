/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Un passage de relais entre deux onglets du panneau : l'onglet Agent demande à l'onglet
 * Actions d'ouvrir son éditeur pré-rempli (« En faire une action »). L'onglet Actions
 * n'est pas forcément monté au moment de la demande : la graine attend qu'il la prenne.
 */
import type { EditorSeed } from '../../../routes/prototype-automations/Editor'

const EVENT = 'proto-action-edit'
let pending: EditorSeed | null = null

export function requestActionEdit(seed: EditorSeed) {
  pending = seed
  window.dispatchEvent(new Event(EVENT))
}

/** La graine en attente, une seule fois. */
export function takeActionEdit(): EditorSeed | null {
  const seed = pending
  pending = null
  return seed
}

export function onActionEdit(listener: () => void): () => void {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
