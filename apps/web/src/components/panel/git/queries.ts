import { useQuery } from '@tanstack/react-query'
import type {
  BlameDto,
  CommitDetailDto,
  ConflictsDto,
  FileHistoryDto,
  GitStateDto,
  GraphDto,
  RebasePlanDto,
  RefsDto,
  StashesDto,
} from '@solera/protocol'
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

/**
 * L'état d'écriture : l'index, l'arbre, le verrou, ce qui s'annule.
 *
 * Lu à l'ouverture de la vue et après chaque geste, comme le reste — mais aussi à la
 * fin d'un tour, parce que c'est le moment où tout a pu changer sous la vue, et le
 * seul où le verrou se lève.
 */
export function useGitState(scope: WorkspaceScope) {
  return useQuery({
    queryKey: ['git-state', scope],
    queryFn: () => api.get<GitStateDto>(`${workspaceApiBase(scope)}/git/state`),
    staleTime: Infinity,
    refetchOnMount: 'always',
  })
}

/** Les remises, aperçu compris : une lecture par remise, donc seulement à la demande. */
export function useStashes(scope: WorkspaceScope, enabled: boolean) {
  return useQuery({
    queryKey: ['git-stashes', scope],
    queryFn: () => api.get<StashesDto>(`${workspaceApiBase(scope)}/git/stashes`),
    staleTime: Infinity,
    refetchOnMount: 'always',
    enabled,
  })
}

/**
 * Les conflits ouverts, contenu des fichiers compris.
 *
 * Lus seulement quand on ouvre la destination : c'est une lecture par fichier en
 * conflit, et le rail, lui, n'a besoin que du compte que `GitStateDto.conflicted`
 * donne déjà.
 */
export function useConflicts(scope: WorkspaceScope, enabled: boolean) {
  return useQuery({
    queryKey: ['git-conflicts', scope],
    queryFn: () => api.get<ConflictsDto>(`${workspaceApiBase(scope)}/git/conflicts`),
    staleTime: Infinity,
    refetchOnMount: 'always',
    enabled,
  })
}

/** Ce qu'il y aurait à rebaser, demandé en ouvrant l'écran et pas avant. */
export function useRebasePlan(scope: WorkspaceScope, onto: string | null, enabled: boolean) {
  const search = onto ? `?onto=${encodeURIComponent(onto)}` : ''
  return useQuery({
    queryKey: ['git-rebase-plan', scope, onto],
    queryFn: () => api.get<RebasePlanDto>(`${workspaceApiBase(scope)}/git/rebase/plan${search}`),
    staleTime: Infinity,
    refetchOnMount: 'always',
    enabled,
  })
}

export function useFileHistory(scope: WorkspaceScope, path: string | null) {
  return useQuery({
    queryKey: ['git-file-history', scope, path],
    queryFn: () =>
      api.get<FileHistoryDto>(
        `${workspaceApiBase(scope)}/git/file/history?path=${encodeURIComponent(path ?? '')}`,
      ),
    staleTime: Infinity,
    refetchOnMount: 'always',
    enabled: path !== null,
  })
}

/** Le blâme, qui coûte un `git blame` entier : seulement quand l'onglet est ouvert. */
export function useBlame(scope: WorkspaceScope, path: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['git-blame', scope, path],
    queryFn: () =>
      api.get<BlameDto>(
        `${workspaceApiBase(scope)}/git/file/blame?path=${encodeURIComponent(path ?? '')}`,
      ),
    staleTime: Infinity,
    refetchOnMount: 'always',
    enabled: enabled && path !== null,
  })
}
