import { DEFAULT_MILESTONE_CONCURRENCY, type AgentKind, type CardDto } from '@solera/protocol'
import { cardState, isOpen, liveSessions, loadedStatus, type CardState, type StatusOf } from './card-state'
import type { Maturity, MilestoneEntry } from './milestone-model'

/*
 * Le phare des jalons de l'Aperçu (#174, `projet.md` A-3) : le jalon courant en grand,
 * les suivants en file. Pur : `MilestoneBeacon` lui passe les jalons de `useMilestones`.
 */

/** Le rang d'un jalon dans le phare (A-3.3) : ce qui avance d'abord, l'idée en dernier. */
export const MATURITY_RANK: Record<Maturity, number> = {
  launched: 0,
  ready: 1,
  split: 2,
  refine: 3,
  idea: 4,
  delivered: 5,
}

export interface Beacon {
  /** Le premier jalon non livré par rang, puis par numéro. */
  current: MilestoneEntry | null
  /** Ce qui part ensuite : prêts, à régler, et les lancés au-delà du premier. */
  next: MilestoneEntry[]
  /** À affiner et idées. */
  later: MilestoneEntry[]
  delivered: number
}

export function beaconOf(entries: readonly MilestoneEntry[]): Beacon {
  const open = entries
    .filter((entry) => entry.maturity !== 'delivered')
    .sort((a, b) => MATURITY_RANK[a.maturity] - MATURITY_RANK[b.maturity] || a.card.number - b.card.number)
  const [current = null, ...rest] = open
  return {
    current,
    next: rest.filter((entry) => MATURITY_RANK[entry.maturity] <= MATURITY_RANK.split),
    later: rest.filter((entry) => MATURITY_RANK[entry.maturity] > MATURITY_RANK.split),
    delivered: entries.length - open.length,
  }
}

/** Combien de cartes le pilotage fait tourner à la fois ; sans pilotage, le défaut du lancement. */
export function concurrencyOf(entry: MilestoneEntry): number {
  return entry.run?.concurrency ?? DEFAULT_MILESTONE_CONCURRENCY
}

/* ------------------------------------------------------------------ vagues */

export interface BeaconWave {
  cards: { card: CardDto; state: CardState }[]
  open: number
  done: number
}

/** Les vagues du jalon (A-3.7), comptées : ce qui reste à faire et ce qui est fait. */
export function beaconWaves(entry: MilestoneEntry): BeaconWave[] {
  return wavesOf(entry.children).map((wave) => {
    const open = wave.filter(isOpen).length
    return { cards: wave.map((card) => ({ card, state: cardState(card) })), open, done: wave.length - open }
  })
}

/** La vague en cours : la première qui a encore du travail ; -1 quand tout est fait. */
export function currentWave(waves: readonly BeaconWave[]): number {
  return waves.findIndex((wave) => wave.open > 0)
}

/* ------------------------------------------------------------------ sessions */

export interface BeaconSession {
  id: string
  agent: AgentKind
  tone: 'running' | 'awaiting'
  cardNumber: number
  /** Le titre de sa carte : la session se nomme par ce qu'elle fait. */
  title: string
}

/** Les sessions vivantes des cartes du jalon (A-3.6), dans l'ordre des cartes. */
export function beaconSessions(entry: MilestoneEntry, statusOf: StatusOf = loadedStatus): BeaconSession[] {
  return entry.children.flatMap((card) =>
    liveSessions(card, statusOf).map((session) => ({
      id: session.id,
      agent: session.agent,
      tone: statusOf(session) === 'awaiting_input' ? ('awaiting' as const) : ('running' as const),
      cardNumber: card.number,
      title: card.title,
    })),
  )
}

/* ------------------------------------------------------------------ provisoire */

/*
 * Copie de `layersOf` / `wavesOf` de la page d'un jalon (#194), en cours dans sa propre
 * branche : à remplacer par leur import de `milestone-model` dès qu'elle est dans main.
 */

function layersOf<T extends Pick<CardDto, 'id' | 'blockedBy'>>(cards: readonly T[]): Map<string, number> {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const layers = new Map<string, number>()
  const visiting = new Set<string>()
  const visit = (card: T): number => {
    const known = layers.get(card.id)
    if (known !== undefined) return known
    if (visiting.has(card.id)) return 0
    visiting.add(card.id)
    const blockers = card.blockedBy.flatMap((blocker) => byId.get(blocker.id) ?? [])
    const layer = blockers.length === 0 ? 0 : 1 + Math.max(...blockers.map(visit))
    visiting.delete(card.id)
    layers.set(card.id, layer)
    return layer
  }
  for (const card of cards) visit(card)
  const rank = new Map([...new Set(layers.values())].sort((a, b) => a - b).map((layer, index) => [layer, index]))
  return new Map([...layers].map(([id, layer]) => [id, rank.get(layer)!]))
}

function wavesOf(cards: readonly CardDto[]): CardDto[][] {
  const shown = cards.filter((card) => card.column !== 'abandoned')
  const layers = layersOf(shown)
  const waves: CardDto[][] = []
  for (const card of shown) (waves[layers.get(card.id)!] ??= []).push(card)
  return waves.map((wave) => wave.sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || a.number - b.number))
}
