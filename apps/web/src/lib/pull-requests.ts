import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CardBranchPrDto,
  PortfolioPullRequestsDto,
  ProjectPullRequestDto,
  ProjectPullRequestListDto,
  PullRequestMergeResultDto,
} from '@solera/protocol'
import { api } from './api'

/**
 * Les PR d'un projet, une par branche, pour les badges de l'onglet Activité (#115).
 *
 * Une seule requête par projet, que toutes les lignes lisent. Le serveur ne relit la
 * forge qu'une fois par minute : relire ici plus souvent ne ferait que resservir son
 * cache.
 */
export function usePullRequests(projectId: string | undefined) {
  return useQuery({
    queryKey: ['pull-requests', projectId ?? ''],
    queryFn: () => api.get<ProjectPullRequestListDto>(`/api/projects/${projectId}/pull-requests`),
    enabled: Boolean(projectId),
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/** Les mêmes pour tous les projets visibles, d'une requête : l'Activité du portefeuille (#117). */
export function usePortfolioPullRequests(enabled = true) {
  return useQuery({
    queryKey: ['pull-requests'],
    queryFn: () => api.get<PortfolioPullRequestsDto>('/api/pull-requests'),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
}

/**
 * Fusionne une PR prête, en squash, sans supprimer sa branche (S7). La confirmation est
 * celle de l'appelant ; le serveur rejuge « prête » et rend sa raison en 409 sinon.
 * Les PR et l'avancement des arbres sont relus après : la branche vient d'atterrir.
 */
export function useMergePullRequest(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (number: number) =>
      api.post<PullRequestMergeResultDto>(`/api/projects/${projectId}/pull-requests/${number}/merge`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pull-requests'] })
      void queryClient.invalidateQueries({ queryKey: ['worktree-status'] })
    },
  })
}

/**
 * Fusionne la PR finale d'un jalon, de sa branche vers la branche par défaut (#187).
 * Les mêmes refus que `useMergePullRequest`, plus `branch_pr_missing` ; la carte n'est
 * pas close. Ses cartes sont relues : `branchPr.mergedAt` fait passer le jalon « Livré ».
 */
export function useMergeBranchPullRequest(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    // Le jalon en variable : « Ce qui t'attend » en fusionne plusieurs d'une même mutation.
    mutationFn: (cardId: string) => api.post<CardBranchPrDto>(`/api/cards/${cardId}/branch-pr/merge`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pull-requests'] })
      void queryClient.invalidateQueries({ queryKey: ['worktree-status'] })
    },
    // Même refusée : une PR déjà fusionnée sur GitHub vient d'y recevoir sa date et sa note.
    onSettled: (_data, _error, cardId) => {
      void queryClient.invalidateQueries({ queryKey: ['cards', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['card-notes', cardId] })
    },
  })
}

/** La PR d'une branche, s'il y en a une. La branche par défaut n'en porte pas. */
export function pullRequestFor(
  list: ProjectPullRequestListDto | undefined,
  branch: string | null,
): ProjectPullRequestDto | null {
  if (!list?.available || !branch) return null
  return list.pullRequests.find((pr) => pr.branch === branch) ?? null
}

/** Une PR ouverte attend une relecture, quel que soit l'état de ses checks. */
export function isOpenPullRequest(pr: ProjectPullRequestDto | null): boolean {
  return pr !== null && pr.state !== 'merged'
}
