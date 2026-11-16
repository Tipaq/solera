import type { CardDto, CardLinkDto } from '@solera/protocol'

/**
 * « À régler avant de partir » (#196, spec jalons RGL) : ce qui retient un jalon découpé
 * en dehors de la session d'affinage — cartes à préciser, pas encore acceptées, cycle de
 * blocages. Les questions et le brouillon, eux, sont dans le résumé d'affinage.
 */

type Settled = Pick<CardDto, 'id' | 'number' | 'blockedBy'>

/** Un lien « bloque » qui referme le cycle : `blocker` bloque `card`, tous deux dedans. */
export interface CycleLink<T extends Settled = Settled> {
  card: T
  blocker: CardLinkDto
}

/**
 * Les liens du cycle, un par blocage entre deux de ses cartes (RGL-5) : c'est l'un d'eux
 * qu'on retire pour le rompre. Un bloqueur hors du cycle n'y est pas : le retirer ne
 * libérerait rien.
 */
export function cycleLinks<T extends Settled>(cycle: readonly T[]): CycleLink<T>[] {
  const inside = new Set(cycle.map((card) => card.id))
  return cycle.flatMap((card) => card.blockedBy.filter((blocker) => inside.has(blocker.id)).map((blocker) => ({ card, blocker })))
}

/** Les points en attente (RGL-1) : chaque carte à préciser ou à accepter, et le cycle pour un seul. */
export function settleCount(entry: { toClarify: readonly unknown[]; notAccepted: readonly unknown[]; cycle: readonly unknown[] }): number {
  return entry.toClarify.length + entry.notAccepted.length + (entry.cycle.length > 0 ? 1 : 0)
}
