import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** Le titre d'une sous-catégorie est « lu » quand il a passé cette ligne, sous le haut. */
const READING_LINE = 96

const MANUAL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '])

/**
 * La sous-catégorie qu'on lit dans une page qui défile, pour l'allumer dans le menu
 * (R-1.4).
 *
 * - Lue : la dernière dont le titre a passé la ligne `haut + 96 px`.
 * - En bas de page, cette ligne n'est plus atteignable pour les dernières : la
 *   dernière dont le titre est à l'écran l'emporte.
 * - `pin` fixe un ancre choisie dans le menu jusqu'au prochain défilement à la main
 *   (molette, toucher, pointeur, touches de défilement) : le défilement doux qu'un
 *   clic déclenche ne doit pas rallumer, en passant, ce qu'il survole.
 */
export function useReadingAnchor(scroller: RefObject<HTMLElement | null>, anchors: readonly string[]) {
  const key = anchors.join(',')
  const [active, setActive] = useState<string | null>(anchors[0] ?? null)
  const pinned = useRef(false)

  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const ids = key ? key.split(',') : []
    const topOf = (id: string) => root.querySelector<HTMLElement>(`#${CSS.escape(id)}`)?.getBoundingClientRect().top

    const follow = () => {
      if (pinned.current) return
      const frame = root.getBoundingClientRect()
      let current: string | null = null
      for (const id of ids) {
        const top = topOf(id)
        if (top !== undefined && top <= frame.top + READING_LINE) current = id
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
        const visible = ids.filter((id) => {
          const top = topOf(id)
          return top !== undefined && top >= frame.top && top < frame.bottom
        })
        if (visible.length > 0) current = visible[visible.length - 1]!
      }
      setActive(current ?? ids[0] ?? null)
    }
    const release = () => {
      if (!pinned.current) return
      pinned.current = false
      follow()
    }
    const onKey = (event: KeyboardEvent) => {
      if (MANUAL_KEYS.has(event.key)) release()
    }

    follow()
    root.addEventListener('scroll', follow, { passive: true })
    root.addEventListener('wheel', release, { passive: true })
    root.addEventListener('touchmove', release, { passive: true })
    root.addEventListener('pointerdown', release)
    window.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('scroll', follow)
      root.removeEventListener('wheel', release)
      root.removeEventListener('touchmove', release)
      root.removeEventListener('pointerdown', release)
      window.removeEventListener('keydown', onKey)
    }
  }, [scroller, key])

  const pin = useCallback((anchor: string) => {
    pinned.current = true
    setActive(anchor)
  }, [])

  return { active, pin }
}
