import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  GitHeadDto,
  WorktreeCleanupPlanDto,
  WorktreeCleanupResultDto,
  WorktreeDto,
  WorktreeStatusListDto,
} from '@solera/protocol'
import { api } from './api'

const worktreesKey = (projectId: string) => ['worktrees', projectId]

const statusKey = (projectId: string) => ['worktree-status', projectId]

/**
 * L'avancement des chantiers d'un projet : chaque arbre jugé contre la branche par
 * défaut, avec les sessions qui y tiennent.
 *
 * Une seule requête par projet, partagée entre toutes les lignes de la barre latérale
 * qui la lisent : aucune commande git ne part d'un rendu. Le serveur peut répondre
 * d'une liste périmée pendant qu'il recalcule (`fresh: false`) : on repasse alors
 * peu après, une fois, pour avoir la suivante.
 */
export function useWorktreeStatuses(projectId: string | undefined) {
  return useQuery({
    queryKey: statusKey(projectId ?? ''),
    queryFn: () => api.get<WorktreeStatusListDto>(`/api/projects/${projectId}/worktrees/status`),
    enabled: Boolean(projectId),
    staleTime: 15_000,
    refetchInterval: (query) => (query.state.data && !query.state.data.fresh ? 2_000 : false),
  })
}

export function useWorktrees(projectId: string | undefined) {
  return useQuery({
    queryKey: worktreesKey(projectId ?? ''),
    queryFn: () => api.get<WorktreeDto[]>(`/api/projects/${projectId}/worktrees`),
    enabled: Boolean(projectId),
    staleTime: 15_000,
  })
}

export function useCreateWorktree(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; baseRef: string; cardId?: string }) =>
      api.post<WorktreeDto>(`/api/projects/${projectId}/worktrees`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: worktreesKey(projectId) })
      void queryClient.invalidateQueries({ queryKey: statusKey(projectId) })
    },
  })
}

/**
 * La branche extraite là où le fil travaille, pour la pastille de son en-tête.
 *
 * Une lecture à part, d'une ou deux commandes git, plutôt que la liste des projets —
 * qui en coûte quatre par projet — ou celle des worktrees. Relue à la fin d'un tour
 * par l'appelant, et au retour sur la fenêtre, pour un `git switch` fait ailleurs.
 */
export function useGitHead(conversationId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['git-head', conversationId],
    queryFn: () => api.get<GitHeadDto | null>(`/api/conversations/${conversationId}/git/head`),
    enabled: enabled && Boolean(conversationId),
    staleTime: 30_000,
  })
}

export function useBranches(projectId: string | undefined) {
  return useQuery({
    queryKey: ['branches', projectId],
    queryFn: () =>
      api.get<{ branches: string[]; current: string | null }>(
        `/api/projects/${projectId}/branches`,
      ),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  })
}

/** Ce que le nettoyage ferait d'un arbre, lu à l'ouverture de la confirmation. */
export function useWorktreeCleanupPlan(projectId: string, path: string | null) {
  return useQuery({
    queryKey: ['worktree-cleanup', projectId, path],
    queryFn: () =>
      api.get<WorktreeCleanupPlanDto>(`/api/projects/${projectId}/worktrees/cleanup?path=${encodeURIComponent(path ?? '')}`),
    enabled: path !== null,
    // Relu à chaque ouverture : ce qui tourne dans l'arbre change d'une minute à l'autre.
    staleTime: 0,
    gcTime: 0,
  })
}

export function useCleanWorktree(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { path: string; deleteBranch: boolean; stopServices: boolean }) =>
      api.post<WorktreeCleanupResultDto>(`/api/projects/${projectId}/worktrees/cleanup`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: worktreesKey(projectId) })
      void queryClient.invalidateQueries({ queryKey: statusKey(projectId) })
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['branches'] })
      void queryClient.invalidateQueries({ queryKey: ['services'] })
    },
  })
}
