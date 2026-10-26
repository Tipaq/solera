import { useMemo } from 'react'
import { CARD_CLOSED_COLUMNS, type CardDto, type ProjectDto } from '@solera/protocol'
import type { SessionMarker, SessionSummary } from '../components/project/SessionRow'
import { askingCount, useLiveConversations, type LiveConversation } from './activity'
import type { ActivityGroup } from './activity-groups'
import { activityRowsOf, type ActivityRow } from './activity-rows'
import { useAllCards } from './cards'
import { useAllConversations } from './conversations'
import { shortAge } from './dates'
import { useTranslate } from './i18n'
import { useProjects } from './projects'
import { usePortfolioPullRequests } from './pull-requests'
import { usePortfolioSessionRequests } from './session-requests'
import { usePortfolioWorktreeStatuses } from './worktrees'

/** Une carte du portefeuille, qui sait d'où elle vient. */
export type PortfolioCard = CardDto & { project: ProjectDto }

/**
 * Une ligne de l'Activité du portefeuille (#117, planche D1) : une session, comme dans
 * un projet, ou une carte qui réclame quelqu'un sans qu'aucune session ne la porte.
 * Les deux savent leur projet, pour la colonne Projet et le regroupement par projet.
 */
export type PortfolioRow =
  | (ActivityRow & { kind: 'session'; key: string; project: ProjectDto; updatedAt: number })
  | {
      kind: 'card'
      key: string
      project: ProjectDto
      card: PortfolioCard
      group: ActivityGroup
      marker: SessionMarker
      summary: SessionSummary
      /** Depuis quand elle réclame : son entrée en *À vérifier*, ou sa mise « à préciser ». */
      updatedAt: number
    }

/** Les projets du portefeuille, et leurs conversations vivantes. */
function usePortfolioLive(): { projects: ProjectDto[]; live: LiveConversation[]; isPending: boolean } {
  const { data: projects, isPending } = useProjects()
  const { data: conversations } = useAllConversations()
  const visible = useMemo(() => (projects ?? []).filter((project) => !project.archivedAt), [projects])
  const mine = useMemo(() => {
    const ids = new Set(visible.map((project) => project.id))
    return (conversations ?? []).filter((entry) => entry.projectId !== null && ids.has(entry.projectId))
  }, [conversations, visible])
  return { projects: visible, live: useLiveConversations(mine), isPending }
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
 * qui les a faites est archivée, ou il n'y en a jamais eu. Une carte portée par une
 * session visible se lit déjà sur la ligne de celle-ci, et la compter deux fois ferait
 * douter du total.
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
 * Les lignes de l'Activité du portefeuille, la plus récente d'abord : les sessions de
 * tous les projets visibles, calculées comme dans un projet (`activityRowsOf`), et les
 * cartes qui réclament quelqu'un sans session. C'est ce qui reste de l'ancienne vue
 * *Travail* : son regroupement par demande est devenu celui des groupes de l'Activité.
 *
 * Trois requêtes pour tous les projets — arbres, PR, demandes ouvertes — au lieu de
 * trois par projet. Les cartes, elles, se lisent projet par projet, mais ce sont celles
 * du board du portefeuille et de son onglet : React Query les partage.
 */
export function usePortfolioActivityRows(): { rows: PortfolioRow[]; isPending: boolean } {
  const t = useTranslate()
  const { projects, live, isPending } = usePortfolioLive()
  const { cards } = useAllCards(projects)
  const { data: trees } = usePortfolioWorktreeStatuses()
  const { data: pullRequests } = usePortfolioPullRequests()
  const requests = usePortfolioSessionRequests(live)

  const rows = useMemo(() => {
    const byId = new Map(projects.map((project) => [project.id, project]))
    const sessions = activityRowsOf(
      live,
      requests,
      cards,
      (projectId) => ({
        trees: projectId ? trees?.projects[projectId] : undefined,
        pullRequests: projectId ? pullRequests?.projects[projectId] : undefined,
        rootBranch: (projectId ? byId.get(projectId)?.git?.branch : null) ?? null,
      }),
      t,
    ).flatMap((row): PortfolioRow[] => {
      const project = byId.get(row.entry.conversation.projectId ?? '')
      return project
        ? [{ ...row, kind: 'session', key: row.entry.conversation.id, project, updatedAt: row.entry.conversation.updatedAt }]
        : []
    })
    const orphans = orphanCardsOf(cards, live).map(({ card, group, since }): PortfolioRow => ({
      kind: 'card',
      key: `card-${card.id}`,
      project: card.project,
      card,
      group,
      marker: group === 'review' ? 'review' : 'awaiting',
      summary:
        group === 'review'
          ? {
              text: t(card.conversations.length > 0 ? 'portfolioActivity.card.reviewArchived' : 'portfolioActivity.card.review', {
                age: shortAge(since),
              }),
              tone: 'soft',
            }
          : { text: t('portfolioActivity.card.toClarify', { age: shortAge(since) }), tone: 'caution' },
      updatedAt: since,
    }))
    return [...sessions, ...orphans].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [projects, live, requests, cards, trees, pullRequests, t])

  return { rows, isPending }
}

/**
 * Le compte ambre de l'onglet Activité du portefeuille : ce qui te demande quelque
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
