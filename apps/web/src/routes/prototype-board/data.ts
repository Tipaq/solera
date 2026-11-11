/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseSubtasks, type CardColumn, type CardDto } from '@solera/protocol'
import { DRAWER_PARAM } from '../prototype-milestones/CardDrawer'
import { isFlaggedMilestone, useMilestoneFlagsVersion } from '../prototype-milestones/flags'
import { awaitsMe, isLate, liveSessions, useProtoData, type ProtoData } from '../prototype-milestones/model'

/** Les colonnes montrées d'office ; « abandonnée » est derrière un interrupteur. */
export const OPEN_COLUMNS: CardColumn[] = ['todo', 'in_progress', 'review']
export const ALL_COLUMNS: CardColumn[] = ['todo', 'in_progress', 'review', 'done', 'abandoned']

export const COLUMN_WORD: Record<CardColumn, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  review: 'À relire',
  done: 'Fait',
  abandoned: 'Abandonné',
}

/**
 * Une teinte par jalon, pour l'étiquette de la carte et l'en-tête de son couloir. Le
 * vrai board les prendrait dans une palette du design system ; ici, des classes fixes.
 */
const MILESTONE_TINTS = [
  { dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', wash: 'bg-sky-500/10' },
  { dot: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-300', wash: 'bg-violet-500/10' },
  { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', wash: 'bg-emerald-500/10' },
  { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', wash: 'bg-rose-500/10' },
  { dot: 'bg-teal-500', text: 'text-teal-700 dark:text-teal-300', wash: 'bg-teal-500/10' },
  { dot: 'bg-orange-500', text: 'text-orange-700 dark:text-orange-300', wash: 'bg-orange-500/10' },
]
export type Tint = (typeof MILESTONE_TINTS)[number]
export const NO_TINT: Tint = { dot: 'bg-line-strong', text: 'text-ink-faint', wash: 'bg-surface-high/40' }

export interface BoardMilestone {
  card: CardDto
  tint: Tint
  /** Feuilles du jalon, toutes colonnes. */
  leaves: CardDto[]
  done: number
}

export interface BoardCard {
  card: CardDto
  /** La colonne affichée : celle de la carte, ou celle d'un glissement local. */
  column: CardColumn
  milestone: BoardMilestone | null
  subtasks: { done: number; total: number }
  waiting: boolean
  live: number
  late: boolean
  /** Déplacée dans ce navigateur seulement. */
  moved: boolean
}

export interface BoardData {
  proto: ProtoData
  cards: BoardCard[]
  milestones: BoardMilestone[]
  move: (cardId: string, column: CardColumn) => void
  resetMoves: () => void
  movedCount: number
}

/**
 * Les feuilles du board, chacune rattachée à son jalon : la plus proche parente qui a
 * des enfants. Une carte qui a des enfants n'est pas une tuile (décision de la page
 * projet v2) : elle devient un filtre et un couloir.
 */
export function useBoardData(projectId: string | undefined): BoardData {
  const proto = useProtoData(projectId)
  // Une idée de jalon (drapeau posé, sans enfants) n'est pas une tâche du board.
  const flags = useMilestoneFlagsVersion()
  // PROTOTYPE : les glissements ne vont pas au serveur.
  const [moves, setMoves] = useState<ReadonlyMap<string, CardColumn>>(() => new Map())

  const milestones = useMemo(() => {
    const byId = new Map(proto.cards.map((card) => [card.id, card]))
    const leavesOf = (id: string): CardDto[] => {
      const card = byId.get(id)
      if (!card) return []
      if (card.children.length === 0) return [card]
      return card.children.flatMap((child) => leavesOf(child.id))
    }
    return proto.cards
      .filter((card) => card.children.length > 0 && card.parent === null)
      .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || a.number - b.number)
      .map((card, index): BoardMilestone => {
        const leaves = leavesOf(card.id)
        return {
          card,
          tint: MILESTONE_TINTS[index % MILESTONE_TINTS.length]!,
          leaves,
          done: leaves.filter((leaf) => leaf.column === 'done' || leaf.column === 'abandoned').length,
        }
      })
  }, [proto.cards])

  const cards = useMemo(() => {
    // Le drapeau vit hors de React : sa version force le recalcul quand il change.
    void flags
    const milestoneOf = new Map<string, BoardMilestone>()
    for (const milestone of milestones) for (const leaf of milestone.leaves) milestoneOf.set(leaf.id, milestone)
    return proto.cards
      .filter((card) => card.children.length === 0 && !(card.parent === null && isFlaggedMilestone(card)))
      .map((card): BoardCard => {
        const subtasks = parseSubtasks(card.description)
        const moved = moves.get(card.id)
        return {
          card,
          column: moved ?? card.column,
          milestone: milestoneOf.get(card.id) ?? null,
          subtasks: { done: subtasks.filter((task) => task.checked).length, total: subtasks.length },
          waiting: awaitsMe(card),
          live: liveSessions(card).length,
          late: isLate(card),
          moved: moved !== undefined && moved !== card.column,
        }
      })
  }, [proto.cards, milestones, moves, flags])

  const move = useCallback((cardId: string, column: CardColumn) => {
    setMoves((current) => new Map(current).set(cardId, column))
  }, [])

  return {
    proto,
    cards,
    milestones,
    move,
    resetMoves: () => setMoves(new Map()),
    movedCount: cards.filter((entry) => entry.moved).length,
  }
}

/** Ouvre la fiche latérale d'une carte, sans quitter le board. */
export function useOpenFiche() {
  const [, setParams] = useSearchParams()
  return (number: number) =>
    setParams((current) => {
      current.set(DRAWER_PARAM, String(number))
      return current
    })
}

/** Le filtre texte du board : `#12` vise un numéro, le reste cherche dans le titre. */
export function matches(entry: BoardCard, query: string): boolean {
  const search = query.trim().toLocaleLowerCase()
  if (!search) return true
  if (search.startsWith('#')) return String(entry.card.number).startsWith(search.slice(1))
  return `${entry.card.number} ${entry.card.title} ${entry.milestone?.card.title ?? ''}`.toLocaleLowerCase().includes(search)
}

/** La puce de jalon choisie : un id, `none` pour « sans jalon », `null` pour tout. */
export type MilestoneFilter = string | 'none' | null

export function inMilestone(entry: BoardCard, filter: MilestoneFilter): boolean {
  if (filter === null) return true
  if (filter === 'none') return entry.milestone === null
  return entry.milestone?.card.id === filter
}

/* ------------------------------------------------------------------ barre sur une ligne */

/** Les réglages de présentation, tenus par « Affichage ▾ » (variante `une-ligne`). */
export interface BoardDisplay {
  /** Couloirs par jalon. */
  lanes: boolean
  /** La colonne Fait : les plus récentes, toutes, ou masquée. */
  done: 'recent' | 'all' | 'hidden'
  abandoned: boolean
  sort: BoardSort
}
export type BoardSort = 'geste' | 'recent' | 'due' | 'number'

export const DEFAULT_DISPLAY: BoardDisplay = { lanes: false, done: 'recent', abandoned: false, sort: 'geste' }

/**
 * Ce qu'une vue reçoit quand la barre est tenue au-dessus d'elle : le filtre déjà
 * composé (recherche + filtres), les réglages d'affichage, et le geste « Tout voir ».
 */
export interface ExternalControls {
  predicate: (entry: BoardCard) => boolean
  display: BoardDisplay
  onSeeAllDone?: () => void
}

/** Le titre court d'un jalon : sans préfixe « Jalon — », coupé au premier deux-points. */
export function shortTitle(title: string, max = 26): string {
  const bare = title.replace(/^jalon\s*[—:–-]\s*/i, '')
  const head = bare.split(/\s[:—–]\s/)[0]!.trim()
  return head.length > max ? `${head.slice(0, max - 1).trimEnd()}…` : head
}

/** L'ordre d'une colonne selon le tri choisi ; « geste » : ce qui t'attend d'abord. */
export function sortEntries(entries: BoardCard[], sort: BoardSort = 'geste'): BoardCard[] {
  const list = [...entries]
  switch (sort) {
    case 'recent':
      return list.sort((a, b) => b.card.updatedAt - a.card.updatedAt)
    case 'due':
      return list.sort((a, b) => (a.card.dueAt ?? Infinity) - (b.card.dueAt ?? Infinity) || b.card.columnSince - a.card.columnSince)
    case 'number':
      return list.sort((a, b) => b.card.number - a.card.number)
    case 'geste':
      return list.sort(
        (a, b) =>
          Number(b.waiting) - Number(a.waiting) ||
          Number(a.card.acceptedAt !== null) - Number(b.card.acceptedAt !== null) ||
          Number(b.late) - Number(a.late) ||
          b.card.columnSince - a.card.columnSince,
      )
  }
}
