import { useCallback, useSyncExternalStore } from 'react'

/**
 * Suit une media query.
 *
 * Il vit dans le design system parce que les primitives en dépendent — `Tooltip` doit
 * savoir si le pointeur est grossier — et qu'il est parfaitement générique : il ne sait
 * rien de Solera. L'application le réexporte depuis `lib/viewport`, où ses appelants
 * l'ont toujours trouvé.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // Rendu serveur absent ici, mais `useSyncExternalStore` réclame l'instantané.
    () => false,
  )
}
