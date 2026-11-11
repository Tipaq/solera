/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Combien de sessions la sidebar montre, au choix de l'utilisateur (Tim, 2026-11-11) :
 * - `fit` (défaut) : autant qu'il en tient sans faire défiler la colonne ; le reste est
 *   compté dans « Toutes les sessions · N → » ;
 * - 10 / 20 / 50 : ce nombre, et le bloc qui défile prend le relais.
 * Dans tous les cas, la session ouverte et celles qui t'attendent restent affichées.
 */
import { createContext, useContext, useSyncExternalStore } from 'react'
import type { ConversationDto } from '@solera/protocol'

export type SidebarSessionLimit = 'fit' | 10 | 20 | 50
export const SIDEBAR_SESSION_LIMITS: SidebarSessionLimit[] = ['fit', 10, 20, 50]

const KEY = 'proto-sidebar-sessions'
const listeners = new Set<() => void>()

function read(): SidebarSessionLimit {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
  if (raw === '10' || raw === '20' || raw === '50') return Number(raw) as SidebarSessionLimit
  return 'fit'
}

export function setSidebarSessionLimit(next: SidebarSessionLimit): void {
  localStorage.setItem(KEY, String(next))
  listeners.forEach((listener) => listener())
}

export function useSidebarSessionLimit(): SidebarSessionLimit {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
    () => 'fit',
  )
}

/** Le budget mesuré par la colonne en mode `fit` (nombre de lignes de session par liste). */
export const SidebarFitBudget = createContext<number | null>(null)

/** Le nombre de sessions qu'une liste de la colonne peut montrer, réglage et mesure compris. */
export function useSessionBudget(): number {
  const limit = useSidebarSessionLimit()
  const measured = useContext(SidebarFitBudget)
  if (limit !== 'fit') return limit
  return measured ?? 10
}

/** Une session qui ne se cache jamais : l'ouverte, et celles qui attendent une réponse. */
export function mustShow(entry: ConversationDto, openId: string | null | undefined): boolean {
  return entry.id === openId || entry.status === 'awaiting_input' || entry.status === 'error'
}

/**
 * Coupe une liste ordonnée au budget, sans jamais retirer une session à garder : elles
 * comptent dans le budget, et le reste se remplit dans l'ordre.
 */
export function cutToBudget<T extends ConversationDto>(entries: T[], budget: number, openId: string | null | undefined): T[] {
  const kept = new Set(entries.filter((entry) => mustShow(entry, openId)).map((entry) => entry.id))
  let room = Math.max(0, budget - kept.size)
  return entries.filter((entry) => {
    if (kept.has(entry.id)) return true
    if (room <= 0) return false
    room -= 1
    return true
  })
}
