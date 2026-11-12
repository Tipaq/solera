import { useMemo } from 'react'
import type { CardDto } from '@solera/protocol'
import { boardModel, type BoardModel } from './board-model'
import { useCards } from './cards'
import { useLiveCardStatuses } from './milestones'

/**
 * Les tuiles et les jalons du Tableau d'un projet (B-2), au statut vivant des sessions.
 * Pas de déplacement local : un glissement passe par `useMoveCard`, qui écrit le cache.
 */
export function useBoardData(projectId: string | undefined): BoardModel & {
  /** Toutes les cartes du projet, parentes comprises. */
  all: CardDto[]
  isPending: boolean
  isError: boolean
  refetch: () => void
} {
  const { data: cards, isPending, isError, refetch } = useCards(projectId)
  const statusOf = useLiveCardStatuses(cards)
  const model = useMemo(() => boardModel(cards ?? [], { statusOf }), [cards, statusOf])
  return { ...model, all: cards ?? NO_CARDS, isPending, isError, refetch: () => void refetch() }
}

const NO_CARDS: CardDto[] = []
