import { useSyncExternalStore } from 'react'

/**
 * Ouverture de la modale du registre MCP, partagée hors de React.
 *
 * Elle s'ouvre depuis le « + » du composer, c'est-à-dire depuis un menu — et une
 * boîte de dialogue rendue *dans* un menu meurt avec lui à la première sélection. La
 * modale vit donc au niveau de la coque, et c'est un magasin qui la lui demande,
 * comme pour le panneau latéral.
 */
let open = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setMcpRegistryOpen(next: boolean): void {
  if (next === open) return
  open = next
  for (const listener of listeners) listener()
}

export function useMcpRegistryOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false,
  )
}
