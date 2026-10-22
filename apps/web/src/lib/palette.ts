import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  fuzzyTokens,
  matchFields,
  type FuzzyField,
  type PaletteCatalogDto,
  type PaletteFilesDto,
} from '@solera/protocol'
import { api } from './api'
import { useDebounced } from './search'

/**
 * Ce que la palette demande au serveur en plus des listes de la navigation.
 *
 * Le catalogue (les skills) se relit à chaque ouverture plutôt que de se tenir à jour :
 * un skill renommé ou éteint depuis la dernière fois doit s'y lire tel qu'il est.
 */
export function usePaletteCatalog(open: boolean) {
  return useQuery({
    queryKey: ['palette', 'catalog'],
    queryFn: () => api.get<PaletteCatalogDto>('/api/palette/catalog'),
    enabled: open,
    staleTime: 0,
  })
}

/**
 * Fichiers de tous les projets visibles, rendus par projet.
 *
 * La conversation sous les yeux fait chercher son projet dans son répertoire, worktree
 * compris : c'est là que le fichier choisi s'ouvrira.
 */
export function usePaletteFiles(query: string, conversationId: string | null) {
  const settled = useDebounced(query.trim())

  const result = useQuery({
    queryKey: ['palette', 'files', settled, conversationId],
    queryFn: () => {
      const params = new URLSearchParams({ q: settled })
      if (conversationId) params.set('conversationId', conversationId)
      return api.get<PaletteFilesDto>(`/api/palette/files?${params}`)
    },
    enabled: settled.length > 0,
    // Sans lui, chaque frappe viderait la famille avant de la remplir.
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
  return { ...result, data: settled.length > 0 ? result.data : undefined }
}

/**
 * Classe une liste contre la saisie, chaque mot dans le champ où il vaut le plus.
 *
 * La correspondance floue est celle du serveur (`@solera/protocol`) : « power » ne
 * retrouve plus « ApprovalsReviewer » en piochant une lettre par mot, et « nimbus
 * cache » trouve une conversation de Nimbus qui parle de cache.
 */
export function rankByFields<T>(
  source: readonly T[],
  query: string,
  fields: (entry: T) => FuzzyField[],
  boost: (entry: T) => number = () => 0,
): T[] {
  const tokens = fuzzyTokens(query)
  if (tokens.length === 0) return [...source]
  return source
    .map((entry) => {
      const match = matchFields(fields(entry), tokens)
      return match ? { entry, score: match.score + boost(entry) } : null
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.entry)
}

/**
 * Les poids d'un fichier, les mêmes que ceux du serveur qui les a présélectionnés : le
 * nom compte plus que le dossier, et le nom du projet ne fait que restreindre.
 */
export function fileFields(path: string, projectName: string): FuzzyField[] {
  const slash = path.lastIndexOf('/')
  return [
    { text: path.slice(slash + 1), weight: 1 },
    { text: path.slice(0, Math.max(slash, 0)), weight: 0.6, mode: 'strict' },
    { text: projectName, weight: 0.35, mode: 'strict' },
  ]
}
