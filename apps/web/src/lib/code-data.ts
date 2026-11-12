import { useMemo } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { useLiveConversations, type LiveConversation } from './activity'
import { useAllCards, useCards } from './cards'
import { branchInfosOf, codeDataOf, type BranchInfo, type CodeData, type CodeSession, type SessionTone, type TreeRow } from './code-model'
import { useAllConversations } from './conversations'
import { usePortfolioPullRequests, usePullRequests } from './pull-requests'
import { threadState, type ThreadState } from './signals'
import { usePortfolioWorktreeStatuses, useWorktreeStatuses } from './worktrees'

const TONE: Partial<Record<ThreadState, SessionTone>> = { broken: 'broken', awaiting: 'awaiting', working: 'running' }

/** Une session vivante, telle que l'assemblage des arbres en a besoin. */
export function codeSessionOf(entry: LiveConversation): CodeSession & { projectId: string | null } {
  const state = threadState({ status: entry.status, busy: entry.running, unread: false })
  return {
    id: entry.conversation.id,
    title: entry.conversation.title,
    agent: entry.conversation.agent,
    worktreeId: entry.conversation.worktreeId,
    tone: state ? (TONE[state] ?? null) : null,
    at: entry.since,
    projectId: entry.conversation.projectId,
  }
}

/**
 * Les arbres d'un projet, jugés (`lib/code-model.ts`), à partir des requêtes que
 * l'Activité lit déjà : l'état des worktrees, les PR, les cartes et les sessions vivantes.
 * Aucune commande git ne part d'ici.
 */
export function useCodeData(projectId: string | undefined, project: ProjectDto | undefined): CodeData & { pending: boolean } {
  const git = Boolean(project?.git)
  const { data: statuses, isPending } = useWorktreeStatuses(git ? projectId : undefined)
  const { data: pullRequests } = usePullRequests(git ? projectId : undefined)
  const { data: cards } = useCards(projectId)
  const { data: conversations } = useAllConversations()
  const mine = useMemo(
    () => (conversations ?? []).filter((entry) => entry.projectId === projectId && entry.archivedAt === null),
    [conversations, projectId],
  )
  const live = useLiveConversations(mine)

  return useMemo(() => {
    const sessions = live.map(codeSessionOf)
    const data = project
      ? codeDataOf({ project, statuses, pullRequests, cards: cards ?? [], sessions, now: Date.now() })
      : { base: null, trees: [], branches: [], forge: false }
    return { ...data, pending: git && isPending }
  }, [live, project, statuses, pullRequests, cards, git, isPending])
}

/** Les branches sans arbre du projet, avec leur PR et leur carte. */
export function useBranchInfos(projectId: string | undefined, project: ProjectDto | undefined, code: CodeData): BranchInfo[] {
  const { data: pullRequests } = usePullRequests(project?.git ? projectId : undefined)
  const { data: cards } = useCards(projectId)
  return useMemo(
    () => branchInfosOf({ branches: code.branches, pullRequests, cards: cards ?? [] }),
    [code.branches, pullRequests, cards],
  )
}

/**
 * Les arbres de tous les projets donnés, jugés comme dans un projet : deux requêtes pour
 * tous (état des worktrees, PR), les cartes de chacun et les sessions vivantes.
 * `live` : les sessions vivantes de ces projets, déjà lues par l’appelant.
 */
export function usePortfolioCode(
  projects: ProjectDto[],
  live: LiveConversation[],
): { groups: { project: ProjectDto; trees: TreeRow[] }[]; pending: boolean } {
  const { data: statuses, isPending } = usePortfolioWorktreeStatuses()
  const { data: pullRequests } = usePortfolioPullRequests()
  const { cards } = useAllCards(projects)

  return useMemo(() => {
    const sessions = live.map(codeSessionOf)
    const now = Date.now()
    const groups = projects.flatMap((project) => {
      if (!project.git) return []
      const { trees } = codeDataOf({
        project,
        statuses: statuses?.projects[project.id],
        pullRequests: pullRequests?.projects[project.id],
        cards: cards.filter((card) => card.projectId === project.id),
        sessions: sessions.filter((session) => session.projectId === project.id),
        now,
      })
      return [{ project, trees }]
    })
    return { groups, pending: isPending }
  }, [projects, live, statuses, pullRequests, cards, isPending])
}
