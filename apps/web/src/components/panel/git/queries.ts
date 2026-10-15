import { useQuery } from '@tanstack/react-query'
import type { CommitDetailDto, GraphDto, RefsDto, WorkingDiffDto } from '@solera/protocol'
import { api } from '../../../lib/api'
import { workspaceApiBase, type WorkspaceScope } from '../../../lib/workspace-scope'

/**
 * Les lectures de la vue Git.
 *
 * Toutes en `staleTime: Infinity` + `refetchOnMount: 'always'`, comme le diff l'était
 * déjà : chaque lecture lance un ou plusieurs process git, donc on relit à l'ouverture
 * de la vue, à la fin d'un tour et à la demande — jamais en boucle.
 */

/** Commits chargés d'un coup, et pas à pas ensuite. */
export const GRAPH_PAGE = 60

/** Les filtres de la destination *Recherche*, tels qu'ils partent dans l'URL. */
export interface GraphFilters {
  q?: string
  author?: string
  file?: string
  branch?: string
  since?: string
  thread?: string
  hand?: 'agent' | 'human'
}

export function graphSearch(filters: GraphFilters, limit: number): string {
  const params = new URLSearchParams({ limit: String(limit) })
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  return params.toString()
}

export function useGraph(scope: WorkspaceScope, filters: GraphFilters, limit: number) {
  const search = graphSearch(filters, limit)
  return useQuery({
    queryKey: ['git-graph', scope, search],
    queryFn: () => api.get<GraphDto>(`${workspaceApiBase(scope)}/graph?${search}`),
    staleTime: Infinity,
    refetchOnMount: 'always',
  })
}

export function useRefs(scope: WorkspaceScope, enabled: boolean) {
  return useQuery({
    queryKey: ['git-refs', scope],
    queryFn: () => api.get<RefsDto>(`${workspaceApiBase(scope)}/refs`),
    staleTime: Infinity,
    refetchOnMount: 'always',
    enabled,
  })
}

/** Un commit est immuable : une fois lu, il n'y a plus de raison d'y revenir. */
export function useCommitDetail(scope: WorkspaceScope, hash: string | null) {
  return useQuery({
    queryKey: ['git-commit', scope, hash],
    queryFn: () => api.get<CommitDetailDto>(`${workspaceApiBase(scope)}/commits/${hash}/detail`),
    staleTime: Infinity,
    enabled: hash !== null,
  })
}

export function useWorkingDiff(scope: WorkspaceScope) {
  return useQuery({
    queryKey: ['diff', scope],
    queryFn: () => api.get<WorkingDiffDto>(`${workspaceApiBase(scope)}/diff`),
    // `refetchOnMount` était le manque : un agent qui commite pendant que le panneau
    // est fermé laissait le cache servir un diff périmé au rouvrir.
    staleTime: Infinity,
    refetchOnMount: 'always',
  })
}
