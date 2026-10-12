import { useQuery } from '@tanstack/react-query'
import type { ContentReplaceDto, ContentSearchDto } from '@solera/protocol'
import { api } from './api'
import { workspaceApiBase, type WorkspaceScope } from './workspace-scope'

/**
 * Critères de la vue *Recherche*, tels qu'ils voyagent jusqu'au serveur.
 *
 * Les mêmes servent à chercher et à remplacer : la liste affichée est l'aperçu du
 * remplacement, et deux jeux de critères distincts feraient écrire autre chose que ce
 * qui est montré.
 */
export interface SearchCriteria {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  include: string
  exclude: string
}

export const EMPTY_CRITERIA: SearchCriteria = {
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: '',
  exclude: '',
}

function params(criteria: SearchCriteria): string {
  return new URLSearchParams({
    q: criteria.query,
    caseSensitive: criteria.caseSensitive ? '1' : '0',
    wholeWord: criteria.wholeWord ? '1' : '0',
    regex: criteria.regex ? '1' : '0',
    include: criteria.include,
    exclude: criteria.exclude,
  }).toString()
}

/**
 * Recherche par contenu. Inerte tant que la requête est vide.
 *
 * `staleTime` court et non infini, contrairement au diff d'une écriture passée : le
 * disque bouge sous la recherche, un agent écrit pendant qu'on lit ses résultats.
 */
export function useContentSearch(scope: WorkspaceScope, criteria: SearchCriteria) {
  const enabled = criteria.query.length > 0
  return useQuery({
    queryKey: ['content-search', scope, criteria],
    queryFn: () => api.get<ContentSearchDto>(`${workspaceApiBase(scope)}/search/content?${params(criteria)}`),
    enabled,
    staleTime: 10_000,
  })
}

export function replaceAll(
  scope: WorkspaceScope,
  criteria: SearchCriteria,
  replacement: string,
): Promise<ContentReplaceDto> {
  return api.post<ContentReplaceDto>(`${workspaceApiBase(scope)}/search/replace`, {
    q: criteria.query,
    caseSensitive: criteria.caseSensitive ? '1' : '0',
    wholeWord: criteria.wholeWord ? '1' : '0',
    regex: criteria.regex ? '1' : '0',
    include: criteria.include,
    exclude: criteria.exclude,
    replacement,
  })
}
