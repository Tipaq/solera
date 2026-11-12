import type { CSSProperties } from 'react'
import { TINT_COUNT } from '../../lib/board-model'

/*
 * Les teintes de jalon : six couloirs de la palette du design system (`--sg-lane-N`,
 * ceux du graphe Git), lisibles sur le canevas de chaque thème sans jeu à tenir. Les
 * couleurs fixes du prototype (`sky-500`…) n'en suivaient aucun.
 *
 * L'ordre écarte les voisines : deux jalons qui se suivent ne doivent pas se confondre.
 */
const LANES = [5, 6, 3, 0, 4, 1] as const satisfies readonly number[] & { length: typeof TINT_COUNT }

const lane = (tint: number) => `var(--sg-lane-${LANES[tint % LANES.length]})`

/** Le point d'un jalon. */
export const tintDot = (tint: number): CSSProperties => ({ backgroundColor: lane(tint) })

/** Le texte et le lavis de son étiquette. */
export const tintLabel = (tint: number): CSSProperties => ({
  color: lane(tint),
  backgroundColor: `color-mix(in oklch, ${lane(tint)} 12%, transparent)`,
})
