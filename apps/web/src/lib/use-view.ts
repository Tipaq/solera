import { useCallback, useState } from 'react'
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

/**
 * Un réglage de page retenu par projet dans le navigateur (filtres, affichage), relu par
 * `read` qui écarte ce qui n'a plus cours. Changer de projet relit le sien.
 */
export function useStoredPref<T>(key: string, read: (raw: string | null) => T): [T, (next: T) => void] {
  const [state, setState] = useState(() => ({ key, value: read(remembered(key)) }))
  const value = state.key === key ? state.value : read(remembered(key))
  const set = useCallback(
    (next: T) => {
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // Stockage refusé : le réglage tient jusqu'au rechargement.
      }
      setState({ key, value: next })
    },
    [key],
  )
  return [value, set]
}
