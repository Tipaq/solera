import { useMemo } from 'react'
import { CARD_CLOSED_COLUMNS, type CardDto, type ProjectDto } from '@solera/protocol'
import { askingCount, useLiveConversations, type LiveConversation } from './activity'
import type { ActivityGroup } from './activity-groups'
import { useAllCards } from './cards'
import { useAllConversations } from './conversations'
import { useProjects } from './projects'
import { usePortfolioSessionRequests } from './session-requests'

/** Une carte du portefeuille, qui sait d'où elle vient. */
export type PortfolioCard = CardDto & { project: ProjectDto }

/** Les projets du portefeuille, et leurs conversations vivantes. */
function usePortfolioLive(): { projects: ProjectDto[]; live: LiveConversation[] } {
  const { data: projects } = useProjects()
  const { data: conversations } = useAllConversations()
  const visible = useMemo(() => (projects ?? []).filter((project) => !project.archivedAt), [projects])
  const mine = useMemo(() => {
    const ids = new Set(visible.map((project) => project.id))
    return (conversations ?? []).filter((entry) => entry.projectId !== null && ids.has(entry.projectId))
  }, [conversations, visible])
  return { projects: visible, live: useLiveConversations(mine) }
}

/**
 * Ce qu'une carte sans session demande, ou null si elle ne demande rien : *À vérifier*
 * attend une relecture, « à préciser » des réponses. Le reste du board est un
 * inventaire, que l'onglet d'à côté montre déjà.
 */
function cardDemandOf(card: CardDto): { group: ActivityGroup; since: number } | null {
  if (CARD_CLOSED_COLUMNS.includes(card.column)) return null
  if (card.column === 'review') return { group: 'review', since: card.columnSince }
  if (card.toClarifySince !== null) return { group: 'asking', since: card.toClarifySince }
  return null
}

/**
 * Les cartes qui réclament quelqu'un et qu'aucune ligne de session ne porte : la session
 * qui les a faites est archivée ou privée à quelqu'un d'autre, ou il n'y en a jamais eu.
 * Une carte portée par une session visible se lit déjà sur la ligne de celle-ci, et la
 * compter deux fois ferait douter du total.
 */
function orphanCardsOf(cards: PortfolioCard[], live: LiveConversation[]) {
  const carried = new Set(live.flatMap((entry) => (entry.conversation.card ? [entry.conversation.card.id] : [])))
  return cards.flatMap((card) => {
    if (carried.has(card.id)) return []
    const demand = cardDemandOf(card)
    return demand ? [{ card, ...demand }] : []
  })
}

/**
 * Le compte ambre de l'onglet Travail du portefeuille : ce qui te demande quelque
 * chose, sessions et cartes « à préciser » sans session. Sans les arbres ni les PR,
 * dont le groupe « te demande » ne dépend pas : la coque ne les lit donc pas.
 */
export function usePortfolioAskingCount(): number {
  const { projects, live } = usePortfolioLive()
  const { cards } = useAllCards(projects)
  const requests = usePortfolioSessionRequests(live)
  return useMemo(
    () => askingCount(live, requests) + orphanCardsOf(cards, live).filter((entry) => entry.group === 'asking').length,
    [live, requests, cards],
  )
}
