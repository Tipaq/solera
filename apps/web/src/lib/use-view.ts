import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { VIEW_PARAM, resolveView, viewStorageKey } from './view-pref'

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * La vue d'une page et son réglage, selon `resolveView` : l'adresse, puis la mémoire du
 * projet, puis la première. Changer de vue la retient et réécrit `?vue=` **sans** ajouter
 * d'entrée d'historique : c'est un réglage, et « Retour » doit quitter la page, pas
 * rejouer les vues essayées.
 */
export function useView<K extends string>(scope: string, projectId: string | null | undefined, keys: readonly K[]): [K, (next: K) => void] {
  const [params, setParams] = useSearchParams()
  const storage = viewStorageKey(scope, projectId ?? null)
  const view = resolveView(params.get(VIEW_PARAM), remembered(storage), keys)
  const setView = useCallback(
    (next: K) => {
      try {
        localStorage.setItem(storage, next)
      } catch {
        // Stockage refusé (navigation privée) : la vue tient encore par l'adresse.
      }
      setParams(
        (current) => {
          const updated = new URLSearchParams(current)
          updated.set(VIEW_PARAM, next)
          return updated
        },
        { replace: true },
      )
    },
    [setParams, storage],
  )
  return [view, setView]
}
