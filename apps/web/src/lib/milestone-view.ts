import type { MilestoneCardStatus, MilestoneRunCardDto, MilestoneRunDto } from '@solera/protocol'

/**
 * Ce qu'on lit d'un jalon lancé (#116), en fonctions pures : le bandeau de l'Activité et
 * de l'Aperçu, la vue du jalon et sa ligne dans la frise le disent avec les mêmes mots,
 * ceux de `milestoneRun.status.*` (« fusionnée », « prête, en file »…). Les mots plus
 * courts de `milestone.status.*` restent à la fiche de la carte.
 *
 * Référence : planches C1, C2 et C3 de `docs/audits/2026-10-21-page-projet/final/`.
 */

/**
 * La teinte d'un segment, d'une carte de la vue ou d'une barre de la frise : l'exécution
 * de la carte plutôt que sa colonne. Une carte bloquée garde l'ambre de « te demande
 * quelque chose », puisqu'elle attend une personne.
 */
export type MilestoneTone = 'merged' | 'review' | 'working' | 'blocked' | 'queued' | 'waiting' | 'failed' | 'dropped'

const TONE_OF: Record<MilestoneCardStatus, MilestoneTone> = {
  done: 'merged',
  merging: 'review',
  reviewing: 'review',
  launching: 'working',
  working: 'working',
  blocked: 'blocked',
  queued: 'queued',
  waiting: 'waiting',
  failed: 'failed',
  abandoned: 'dropped',
}

export function milestoneToneOf(status: MilestoneCardStatus): MilestoneTone {
  return TONE_OF[status]
}

/**
 * Les raisons de blocage qui attendent vraiment une personne. `idle` n'en est pas : une
 * session qui a fini son tour sans PR n'a rien demandé, elle reste « bloquée » pour le
 * pilotage mais ne compte pas dans « te demande quelque chose ».
 */
const ASKING_REASONS: ReadonlySet<string> = new Set([
  'to_clarify',
  'awaiting_input',
  'error',
  'interrupted',
  'escalated',
  'merge_failed',
  'review_closed',
])

/** Les comptes du bandeau : fusionnées, prêtes en file, en attente, ce qui te demande. */
export interface MilestoneCounts {
  merged: number
  total: number
  queued: number
  waiting: number
  /** Les cartes bloquées qui attendent une personne (hors session au repos sans PR). */
  asking: number
}

export function milestoneCounts(run: Pick<MilestoneRunDto, 'cards'>): MilestoneCounts {
  const live = run.cards.filter((card) => card.status !== 'abandoned')
  return {
    merged: live.filter((card) => card.status === 'done').length,
    total: live.length,
    queued: live.filter((card) => card.status === 'queued').length,
    waiting: live.filter((card) => card.status === 'waiting').length,
    asking: live.filter((card) => card.status === 'blocked' && ASKING_REASONS.has(card.blockReason ?? '')).length,
  }
}

/** L'ordre des vagues : l'étage, les cartes d'un cycle (étage -1) en dernier. */
function waveRank(layer: number): number {
  return layer < 0 ? Infinity : layer
}

/**
 * Les cartes dans l'ordre des colonnes de la vue : vague par vague, puis par numéro. Les
 * segments du bandeau et de la frise le suivent, pour qu'une carte ait la même place
 * partout — le serveur, lui, range un cycle en tête.
 */
export function milestoneOrder(cards: MilestoneRunCardDto[]): MilestoneRunCardDto[] {
  return [...cards].sort((a, b) => waveRank(a.layer) - waveRank(b.layer) || a.number - b.number)
}

/** Une colonne de la vue du jalon : les cartes d'un même étage du graphe des « bloque ». */
export interface MilestoneWave {
  /** 0 pour la première vague ; null pour les cartes prises dans un cycle. */
  layer: number | null
  cards: MilestoneRunCardDto[]
}

/**
 * Les vagues, dans l'ordre : une carte part quand la vague de gauche qui la bloque est
 * fusionnée. Les cartes d'un cycle (étage -1) ferment la marche dans une colonne à part,
 * plutôt que d'être tues.
 */
export function milestoneWaves(cards: MilestoneRunCardDto[]): MilestoneWave[] {
  const byLayer = new Map<number, MilestoneRunCardDto[]>()
  for (const card of cards) {
    const bucket = byLayer.get(card.layer)
    if (bucket) bucket.push(card)
    else byLayer.set(card.layer, [card])
  }
  return [...byLayer.entries()]
    .sort(([a], [b]) => waveRank(a) - waveRank(b))
    .map(([layer, members]) => ({
      layer: layer < 0 ? null : layer,
      cards: [...members].sort((a, b) => a.number - b.number),
    }))
}

/**
 * La file : ce qui partira aux prochaines places libres, dans l'ordre du pilotage (la
 * vague, puis le numéro). La tête dit aussi combien de cartes l'attendent : c'est ce
 * qu'on gagne à lui faire de la place.
 */
export function milestoneQueue(cards: MilestoneRunCardDto[]): { queue: MilestoneRunCardDto[]; unblocks: number } {
  const queue = milestoneOrder(cards).filter((card) => card.status === 'queued')
  const head = queue[0]
  const unblocks = head ? cards.filter((card) => card.blockedBy.some((blocker) => blocker.number === head.number)).length : 0
  return { queue, unblocks }
}

/** Les cartes d'un jalon, par identifiant : la frise et l'Activité y cherchent les leurs. */
export function milestoneCardIndex(runs: MilestoneRunDto[] | undefined): Map<string, { run: MilestoneRunDto; card: MilestoneRunCardDto }> {
  const index = new Map<string, { run: MilestoneRunDto; card: MilestoneRunCardDto }>()
  for (const run of runs ?? []) for (const card of run.cards) index.set(card.cardId, { run, card })
  return index
}
