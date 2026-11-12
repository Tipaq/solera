import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useSessionLimit } from '../../lib/display-settings'
import { activityFold, DEFAULT_BUDGET, fitStep } from '../../lib/sidebar-budget'

/** Le budget mesuré par la colonne en « Ajuster à la hauteur », `null` hors de ce mode. */
export const SidebarFitBudget = createContext<number | null>(null)

/** Le nombre de sessions qu'une liste de la colonne peut montrer, réglage et mesure compris. */
export function useSessionBudget(): number {
  const limit = useSessionLimit()
  const measured = useContext(SidebarFitBudget)
  if (limit !== 'fit') return limit
  // Au téléphone, et avant la première mesure, « Ajuster » vaut 10.
  return measured ?? DEFAULT_BUDGET
}

/**
 * « Ajuster à la hauteur » : le nombre de lignes de session par liste qui tient dans la
 * colonne sans la faire défiler, et le repli de l'Activité qui leur rend la place.
 *
 * La colonne dit ce qui déborde (ou ce qui reste) et `fitStep` en tire le budget suivant ;
 * chaque rendu remesure, deux ou trois passes suffisent. Un `ResizeObserver` sur la colonne
 * et sur son contenu relance la mesure à chaque redimensionnement ou changement de
 * contenu. Les lignes comptées sont celles des listes marquées `data-session-list`, et
 * leur hauteur se lit sur la première (36 px, 44 au doigt). L'Activité se reconnaît à
 * `data-sidebar-activity`.
 */
export function useFitBudget(
  scroller: RefObject<HTMLDivElement | null>,
  content: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): { budget: number; activityCollapsed: boolean } {
  const [budget, setBudget] = useState(DEFAULT_BUDGET)
  const [tick, setTick] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  /** La hauteur de l'Activité dépliée, mesurée la dernière fois qu'elle l'était. */
  const fullActivity = useRef(0)

  useEffect(() => {
    const column = scroller.current
    const inner = content.current
    if (!enabled || !column || !inner) return
    const observer = new ResizeObserver(() => setTick((value) => value + 1))
    observer.observe(column)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [enabled, scroller, content])

  useLayoutEffect(() => {
    const column = scroller.current
    const inner = content.current
    if (!enabled || !column || !inner) return
    const rowHeight = inner.querySelector<HTMLElement>('[data-session-list] > li')?.offsetHeight || 36
    const overflow = inner.offsetHeight - column.clientHeight
    const lists = inner.querySelectorAll('[data-session-list]').length
    const cutLists = inner.querySelectorAll('[data-session-list][data-cut="true"]').length
    const next = fitStep({ budget, overflow, rowHeight, lists, cutLists })
    if (next !== budget) {
      setBudget(next)
      return
    }

    // Le budget est stable : l'Activité se décide sur cette mesure.
    const activity = inner.querySelector<HTMLElement>('[data-sidebar-activity]')
    if (!activity) return
    if (!collapsed) fullActivity.current = activity.offsetHeight
    const gain = collapsed ? fullActivity.current - activity.offsetHeight : 0
    setCollapsed(activityFold({ collapsed, budget, cutLists, overflow, rowHeight, gain }))
  }, [enabled, budget, tick, collapsed, scroller, content])

  return { budget, activityCollapsed: enabled && collapsed }
}
