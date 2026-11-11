import { useMemo } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { useLiveConversations } from './activity'
import { useCards } from './cards'
import { branchInfosOf, codeDataOf, type BranchInfo, type CodeData, type CodeSession, type SessionTone } from './code-model'
import { useAllConversations } from './conversations'
import { usePullRequests } from './pull-requests'
import { threadState, type ThreadState } from './signals'
import { useWorktreeStatuses } from './worktrees'

const TONE: Partial<Record<ThreadState, SessionTone>> = { broken: 'broken', awaiting: 'awaiting', working: 'running' }

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
    const sessions: CodeSession[] = live.map((entry) => {
      const state = threadState({ status: entry.status, busy: entry.running, unread: false })
      return {
        id: entry.conversation.id,
        title: entry.conversation.title,
        agent: entry.conversation.agent,
        worktreeId: entry.conversation.worktreeId,
        cardId: entry.conversation.card?.id ?? null,
        tone: state ? (TONE[state] ?? null) : null,
        at: entry.since,
      }
    })
    const data = project
      ? codeDataOf({ project, statuses, pullRequests, cards: cards ?? [], sessions, now: Date.now() })
      : { base: null, trees: [], branches: [], forge: false }
    return { ...data, pending: git && isPending }
  }, [live, project, statuses, pullRequests, cards, git, isPending])
}

/** Les branches sans arbre du projet, avec leur PR et leur carte devinée. */
export function useBranchInfos(projectId: string | undefined, project: ProjectDto | undefined, code: CodeData): BranchInfo[] {
  const { data: pullRequests } = usePullRequests(project?.git ? projectId : undefined)
  const { data: cards } = useCards(projectId)
  return useMemo(
    () => branchInfosOf({ branches: code.branches, pullRequests, cards: cards ?? [] }),
    [code.branches, pullRequests, cards],
  )
}
