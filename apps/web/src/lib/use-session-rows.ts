import { useMemo } from 'react'
import type { ConversationDto, ProjectDto } from '@solera/protocol'
import { useLiveConversations } from './activity'
import { useAllConversations } from './conversations'
import { useProjects } from './projects'
import { sessionRows, type SessionRow } from './sessions-view'
import { usePortfolioWorktreeStatuses } from './worktrees'

const NO_CONVERSATIONS: ConversationDto[] = []

/**
 * Les lignes de `/sessions` et les projets à proposer au filtre.
 *
 * Aucune requête à elle : la liste des conversations (archivées comprises), les statuts
 * vivants poussés par le socket et l'état des arbres sont ceux que la sidebar et le
 * portefeuille lisent déjà.
 */
export function useSessionRows(): { rows: SessionRow[]; projects: ProjectDto[]; pending: boolean } {
  const { data: projectList } = useProjects()
  const { data: conversations, isPending } = useAllConversations()
  const all = conversations ?? NO_CONVERSATIONS
  const live = useLiveConversations(all)
  const { data: statuses } = usePortfolioWorktreeStatuses()

  return useMemo(() => {
    const branches = new Map<string, string>()
    for (const list of Object.values(statuses?.projects ?? {})) {
      for (const tree of list.worktrees) if (tree.id && tree.branch) branches.set(tree.id, tree.branch)
    }
    const rows = sessionRows({
      conversations: all,
      live: new Map(live.map((entry) => [entry.conversation.id, { status: entry.status, busy: entry.running }])),
      projects: new Map((projectList ?? []).map((project) => [project.id, project])),
      branches,
    })
    return { rows, projects: (projectList ?? []).filter((project) => !project.archivedAt), pending: isPending }
  }, [all, live, statuses, projectList, isPending])
}
