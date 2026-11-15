import { useQuery } from '@tanstack/react-query'
import type { ConversationDto, ConversationStatus } from '@solera/protocol'
import type { StatusTone } from '@solera/ui'
import { useMemo } from 'react'
import { api } from './api'
import { useConversations } from './conversations'
import { useWorktrees } from './worktrees'

/**
 * Les **coéquipiers** d'une session (#74) : les sessions qu'elle a lancées avec
 * `start_session`, montrées dans son onglet Agent à côté de ses sous-agents.
 *
 * Le serveur ne rend que leurs identifiants ; tout le reste vient de la liste du projet,
 * déjà en cache et tenue à jour, et l'état de la ligne du flux des statuts en direct.
 */
export interface Teammate {
  id: string
  projectId: string | null
  title: string
  status: ConversationStatus
  card: { number: number; title: string } | null
  /** Le nom de son worktree, nul quand elle travaille à la racine du projet. */
  worktree: string | null
}

export function teammateTone(status: ConversationStatus): StatusTone {
  if (status === 'running') return 'accent'
  if (status === 'awaiting_input') return 'caution'
  if (status === 'error' || status === 'interrupted') return 'critical'
  return 'neutral'
}

export function useTeammates(conversationId: string | undefined, projectId: string | undefined): Teammate[] {
  const { data: list } = useConversations(projectId)
  const { data: trees } = useWorktrees(projectId)
  const { data: ids } = useQuery({
    // Sous `conversations` : le flux des listes, qui relit toutes ces clés quand une
    // session naît ou change, relit aussi celle-ci, sans minuterie à tenir.
    queryKey: ['conversations', 'teammates', conversationId],
    queryFn: () => api.get<string[]>(`/api/conversations/${conversationId}/teammates`),
    enabled: Boolean(conversationId && projectId),
    staleTime: 15_000,
  })
  return useMemo(() => {
    if (!ids || ids.length === 0 || !list) return []
    const byId = new Map(list.map((entry) => [entry.id, entry]))
    const treeName = new Map((trees ?? []).map((tree) => [tree.id, tree.name]))
    return ids.flatMap((id) => {
      const entry = byId.get(id)
      return entry && entry.archivedAt === null ? [teammateOf(entry, treeName)] : []
    })
  }, [ids, list, trees])
}

function teammateOf(entry: ConversationDto, treeName: Map<string, string>): Teammate {
  return {
    id: entry.id,
    projectId: entry.projectId,
    title: entry.title,
    status: entry.status,
    card: entry.card ? { number: entry.card.number, title: entry.card.title } : null,
    worktree: entry.worktreeId ? (treeName.get(entry.worktreeId) ?? null) : null,
  }
}
