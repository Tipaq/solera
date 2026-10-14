import { useSyncExternalStore } from 'react'

/**
 * La vue ouverte du panneau en contexte *Savoir*.
 *
 * Un magasin à part de `panel.ts`, qui tient l'ouverture et la géométrie : celles-ci
 * sont les mêmes partout, la **vue** ne l'est pas. Les quatre vues du Savoir n'ont
 * aucune des cinq du Travail, et partager la clé ferait retomber sur *Fichiers* en
 * ouvrant une note, ou sur *Liens* en ouvrant un dépôt.
 *
 * L'ordre est celui du dessin, et il est symétrique du Travail : les vues du
 * **contexte** d'abord, puis *Agent* après un trait.
 */

export const VAULT_PANEL_TABS = ['notes', 'rapprochements', 'links', 'history'] as const
export type VaultPanelTab = (typeof VAULT_PANEL_TABS)[number]

const KEY = 'solera.vaultPanelTab'

let tab: VaultPanelTab = (() => {
  const stored = localStorage.getItem(KEY)
  return VAULT_PANEL_TABS.includes(stored as VaultPanelTab) ? (stored as VaultPanelTab) : 'notes'
})()

const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useVaultPanelTab(): VaultPanelTab {
  return useSyncExternalStore(
    subscribe,
    () => tab,
    () => 'notes' as VaultPanelTab,
  )
}

export function setVaultPanelTab(next: VaultPanelTab): void {
  if (next === tab) return
  tab = next
  localStorage.setItem(KEY, next)
  for (const notify of listeners) notify()
}
