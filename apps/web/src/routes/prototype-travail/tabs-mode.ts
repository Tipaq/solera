/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useEffect, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * La rangée d'onglets à comparer : « Activité + Code » (deux onglets) ou « Travail » (un
 * seul à leur place). Gardée dans le navigateur, pour survivre au passage d'un onglet à
 * l'autre, dont les liens ne portent pas les paramètres ; `?onglets=combines|separes`
 * la pose depuis une adresse.
 */
export type TabsMode = 'separes' | 'combines'

/* `-v2` : « Travail » devient le défaut (2026-11-11) ; un choix gardé sous l'ancienne clé
   ne doit pas le masquer. */
const KEY = 'proto-onglets-v2'
const listeners = new Set<() => void>()

function read(): TabsMode {
  return localStorage.getItem(KEY) === 'separes' ? 'separes' : 'combines'
}

export function setTabsMode(mode: TabsMode) {
  localStorage.setItem(KEY, mode)
  listeners.forEach((listener) => listener())
}

export function useTabsMode(): TabsMode {
  const [params] = useSearchParams()
  const asked = params.get('onglets')
  useEffect(() => {
    if (asked === 'combines' || asked === 'separes') setTabsMode(asked)
  }, [asked])
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
  )
}
