import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useSessionLimit } from '../../lib/display-settings'
import { DEFAULT_BUDGET, FIT_MEMORY, fitNext } from '../../lib/sidebar-budget'

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
 * La colonne dit ce qui déborde (ou ce qui reste) et `fitNext` en tire le budget suivant,
 * borné par ceux déjà essayés ; chaque rendu remesure, quelques passes suffisent et la
 * recherche finit toujours (#262). Un `ResizeObserver` sur la colonne
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
  /** Ce que la recherche a appris de la colonne : les budgets essayés, l'Activité. */
  const memory = useRef(FIT_MEMORY)

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
    const activity = inner.querySelector<HTMLElement>('[data-sidebar-activity]')?.offsetHeight ?? null
    const next = fitNext(memory.current, {
      budget, overflow, rowHeight, lists, cutLists, collapsed, column: column.clientHeight, activity,
    })
    memory.current = next.memory
    if (next.budget !== budget) setBudget(next.budget)
    if (next.collapsed !== collapsed) setCollapsed(next.collapsed)
  }, [enabled, budget, tick, collapsed, scroller, content])

  return { budget, activityCollapsed: enabled && collapsed }
}
