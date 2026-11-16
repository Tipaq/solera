import { useLayoutEffect, useState, type RefObject } from 'react'
import type { Scale } from './scale'

/**
 * La largeur que l'axe peut occuper dans `ref` (sa largeur moins la liste collée à
 * gauche), suivie au redimensionnement. 0 tant que le conteneur n'est pas monté.
 */
export function useAxisWidth(ref: RefObject<HTMLElement | null>, listWidth: number): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(Math.max(0, Math.floor(element.clientWidth - listWidth)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, listWidth])
  return width
}

/**
 * Au montage et à chaque changement d'échelle, fait défiler le conteneur pour que
 * « aujourd'hui » tombe au milieu de la zone de l'axe (la liste collée à gauche exclue).
 */
export function useScrollToNow(ref: RefObject<HTMLElement | null>, scale: Scale, listWidth: number, now = Date.now()) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const visible = element.clientWidth - listWidth
    element.scrollLeft = Math.max(0, scale.x(now) - visible / 2)
    // `now` change à chaque rendu : seule l'échelle doit redéclencher le recentrage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, scale.from, scale.ppd, listWidth])
}
