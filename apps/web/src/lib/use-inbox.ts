import { useMemo } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { useLiveConversations } from './activity'
import { useAllCards, useCards } from './cards'
import { useAllConversations } from './conversations'
import { buildInbox, type HeavyInboxItem, type InboxInput, type InboxItem } from './inbox'
import { useProjects } from './projects'
import { usePortfolioPullRequests, usePullRequests } from './pull-requests'
import { useSessionRequests } from './session-requests'

/**
 * Où la liste est posée : un projet (Aperçu, Travail, panneau), le portefeuille, ou
 * `/sessions`, qui ne montre que des sessions.
 */
export type InboxScope = { projectId: string } | { portfolio: true } | { sessions: true }

const NO_PROJECTS: ProjectDto[] = []

/**
 * « Ce qui t'attend » pour une portée (#163) : les requêtes qu'elle demande, passées au
 * constructeur unique. `extra` reçoit les demandes du domaine Jalons (affinage,
 * découpage, PR de jalon).
 *
 * Toutes les requêtes sont celles que les écrans lisent déjà — liste des conversations,
 * demandes ouvertes, cartes, PR — et React Query les partage : poser la liste ne coûte
 * aucune requête de plus.
 */
export function useInbox(scope: InboxScope, extra?: HeavyInboxItem[]): InboxItem[] {
  const projectId = 'projectId' in scope ? scope.projectId : null
  const portfolio = 'portfolio' in scope

  const { data: projects } = useProjects()
  const { data: conversations } = useAllConversations()
  const visible = useMemo(() => (projects ?? NO_PROJECTS).filter((project) => !project.archivedAt), [projects])
  const project = projectId ? visible.find((entry) => entry.id === projectId) : undefined

  const mine = useMemo(() => {
    const all = conversations ?? []
    if (projectId) return all.filter((entry) => entry.projectId === projectId)
    // `/sessions` garde les fils libres ; le portefeuille, les projets visibles.
    if (!portfolio) return all
    const ids = new Set(visible.map((entry) => entry.id))
    return all.filter((entry) => entry.projectId !== null && ids.has(entry.projectId))
  }, [conversations, projectId, portfolio, visible])
  const live = useLiveConversations(mine)
  const requests = useSessionRequests(projectId, live)

  const { data: projectCards } = useCards(projectId ?? undefined)
  const { cards: portfolioCards } = useAllCards(portfolio ? visible : NO_PROJECTS)
  const { data: projectPullRequests } = usePullRequests(project?.git ? project.id : undefined)
  const { data: portfolioPullRequests } = usePortfolioPullRequests(portfolio)

  return useMemo(() => {
    let pullRequests: InboxInput['pullRequests'] = []
    if (projectId && projectPullRequests?.available) {
      pullRequests = projectPullRequests.pullRequests.map((pullRequest) => ({ projectId, pullRequest }))
    } else if (portfolio && portfolioPullRequests) {
      pullRequests = Object.entries(portfolioPullRequests.projects).flatMap(([id, list]) =>
        list.available ? list.pullRequests.map((pullRequest) => ({ projectId: id, pullRequest })) : [],
      )
    }
    return buildInbox({
      live,
      requests,
      projects: new Map(visible.map((entry) => [entry.id, entry])),
      reviewCards: projectId ? (projectCards ?? []) : portfolio ? portfolioCards : [],
      pullRequests,
      prefixProject: projectId === null,
      extra,
    })
  }, [live, requests, visible, projectId, portfolio, projectCards, portfolioCards, projectPullRequests, portfolioPullRequests, extra])
}
