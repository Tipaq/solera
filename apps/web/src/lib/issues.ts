import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CardIssueCommentsDto, IssueSourceDto } from '@solera/protocol'
import { api } from './api'

/** La source d'issues d'un projet (#84) : le dépôt dont les issues entrent dans le board. */
const sourceKey = (projectId: string) => ['issue-source', projectId]

export function useIssueSource(projectId: string) {
  return useQuery({
    queryKey: sourceKey(projectId),
    queryFn: () => api.get<IssueSourceDto | null>(`/api/projects/${projectId}/issue-source`),
    // La lecture tourne en fond : relire de temps en temps dit si elle a réussi.
    refetchInterval: 30_000,
  })
}

export function useSetIssueSource(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (repository: string | null): Promise<void> => {
      if (repository === null) await api.delete<void>(`/api/projects/${projectId}/issue-source`)
      else await api.put<IssueSourceDto>(`/api/projects/${projectId}/issue-source`, { provider: 'github', repository })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: sourceKey(projectId) }),
  })
}

export function usePollIssueSource(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<{ accepted: true }>(`/api/projects/${projectId}/issue-source/poll`),
    // Le balayage passe toutes les cinq secondes : relire un peu après montre son effet.
    onSuccess: () => {
      setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: sourceKey(projectId) })
        void queryClient.invalidateQueries({ queryKey: ['cards', projectId] })
      }, 8_000)
    },
  })
}

/** Les commentaires de l'issue d'une carte, lus en direct par le serveur, jamais stockés. */
export function useCardIssueComments(cardId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['card-issue-comments', cardId],
    queryFn: () => api.get<CardIssueCommentsDto>(`/api/cards/${cardId}/issue/comments`),
    enabled,
    staleTime: 60_000,
  })
}
