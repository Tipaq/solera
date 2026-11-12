import type { CardDto } from '@solera/protocol'
import { barOf } from '../components/gantt/scale'
import { cardState, type CardState } from './card-state'
import { isMilestone, type MilestoneEntry } from './milestone-model'

/*
 * Le Gantt détaillé des Jalons (#191, spec jalons GNT) en fonctions pures : ses groupes,
 * leur repli, la grille des lignes au pixel, la jauge et l'étendue d'un jalon. Testé seul
 * (`apps/server/test/milestone-gantt.test.ts`).
 */

/** L'en-tête d'un groupe (GNT-7). */
export const GANTT_HEAD = 40
/** La ligne d'une carte (GNT-9). */
export const GANTT_ROW = 32

/** Un groupe : un jalon, ou « Hors jalon » (`entry` nul). */
export interface GanttGroup {
  key: string
  entry: MilestoneEntry | null
  /** Ses cartes non abandonnées, par début de barre : elles comptent dans l'échelle. */
  members: CardDto[]
  /** Celles qui ont une ligne : aucune quand le groupe est replié. */
  cards: CardDto[]
}

/** La clé du groupe « Hors jalon ». */
export const LOOSE_GROUP = 'loose'

const byStart = (now: number) => (a: CardDto, b: CardDto) => barOf(a, now).start - barOf(b, now).start

/** Les cartes datées sans parente, ni abandonnées ni jalons elles-mêmes (GNT-5). */
export function looseCards(cards: readonly CardDto[]): CardDto[] {
  return cards.filter((card) => card.parent === null && card.dueAt !== null && card.column !== 'abandoned' && !isMilestone(card))
}

/** Les jalons livrés : repliés au départ (GNT-7). */
export function deliveredIds(entries: readonly MilestoneEntry[]): Set<string> {
  return new Set(entries.filter((entry) => entry.maturity === 'delivered').map((entry) => entry.card.id))
}

/**
 * Les groupes du Gantt : un par jalon qui a des cartes, dans l'ordre de `entries`
 * (`horizonOf` les range par échéance, sans date à la fin), déjà filtrés par la barre ;
 * puis « Hors jalon », que la barre ne filtre pas — elle cherche des jalons.
 */
export function ganttGroups(
  entries: readonly MilestoneEntry[],
  cards: readonly CardDto[],
  folded: ReadonlySet<string>,
  now = Date.now(),
): GanttGroup[] {
  const groups: GanttGroup[] = []
  for (const entry of entries) {
    const members = entry.children.filter((card) => card.column !== 'abandoned').sort(byStart(now))
    if (members.length === 0) continue
    groups.push({ key: entry.card.id, entry, members, cards: folded.has(entry.card.id) ? [] : members })
  }
  const loose = looseCards(cards).sort(byStart(now))
  if (loose.length > 0) groups.push({ key: LOOSE_GROUP, entry: null, members: loose, cards: loose })
  return groups
}

/**
 * Le centre de chaque ligne de carte et la hauteur totale : la liste collée et l'axe se
 * lisent sur cette même grille, et les flèches s'y accrochent.
 */
export function ganttRows(groups: readonly GanttGroup[]): { centers: Map<string, number>; height: number } {
  const centers = new Map<string, number>()
  let y = 0
  for (const group of groups) {
    y += GANTT_HEAD
    for (const card of group.cards) {
      centers.set(card.id, y + GANTT_ROW / 2)
      y += GANTT_ROW
    }
  }
  return { centers, height: y }
}

/**
 * Ce que l'échelle englobe : les jalons et toutes leurs cartes, repliées comprises — un
 * repli ne fait pas sauter l'axe — et les cartes libres.
 */
export function plottedCards(groups: readonly GanttGroup[]): CardDto[] {
  return groups.flatMap((group) => (group.entry ? [group.entry.card, ...group.members] : group.members))
}

const MIX_ORDER: CardState[] = ['done', 'review', 'running', 'blocked', 'todo']

/** La répartition des cartes par état, faites d'abord, pour la jauge d'un jalon (GNT-8). */
export function stateMix(cards: readonly CardDto[]): { state: CardState; count: number }[] {
  const states = cards.map(cardState)
  return MIX_ORDER.map((state) => ({ state, count: states.filter((entry) => entry === state).length })).filter(
    (entry) => entry.count > 0,
  )
}

/**
 * L'étendue d'un jalon (GNT-8) : de la plus ancienne création, la sienne comprise, à son
 * échéance ; sans échéance, jusqu'à la fin de sa dernière carte, aujourd'hui au moins.
 */
export function milestoneSpan(entry: MilestoneEntry, now = Date.now()): { start: number; end: number } {
  const start = Math.min(entry.card.createdAt, ...entry.children.map((card) => card.createdAt))
  const open = entry.children.filter((card) => card.column !== 'abandoned')
  const end = entry.card.dueAt ?? Math.max(now, ...open.map((card) => barOf(card, now).end))
  return { start, end: Math.max(end, start) }
}
