import { createContext, useContext } from 'react'

/**
 * Où s'ouvre un détail sur cette page (TIR-8) : jamais deux panneaux à droite.
 *
 * - `panel` : la page a un panneau, une conversation. Le détail s'ouvre **dedans**, en
 *   pile, avec « ‹ Onglet » pour revenir ;
 * - `drawer` : la page n'en a pas — les vues d'un lieu, et `/sessions` quand #232 la
 *   portera. Le détail s'ouvre dans le tiroir commun.
 *
 * La conversation fournit `panel`, la coque d'un lieu `drawer`. Un détail lit le
 * contexte (`Detail` le fait pour lui) : la règle est tenue par le code, pas par la
 * discipline de chaque vue.
 */
export type DetailSurface = 'panel' | 'drawer'

export const DetailSurfaceContext = createContext<DetailSurface>('drawer')

export function useDetailSurface(): DetailSurface {
  return useContext(DetailSurfaceContext)
}
