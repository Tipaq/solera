import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { VaultReindexDto, VaultStateDto } from '@solera/protocol'
import { api } from './api'

/**
 * L'index du vault, côté interface.
 *
 * Tout passe par l'index et rien par le disque : c'est ce qui rend les liens entrants,
 * les liens cassés et les compteurs immédiats. Un index en retard rend des faits en
 * retard, et c'est l'état du vault — `indexedCommit` contre `headCommit` — qui le dit,
 * pas un silence.
 *
 * Les listes et les faits d'une note ont leurs routes — `/api/vault/notes`,
 * `/api/vault/folders` — mais pas encore de crochet : le panneau et la page du vault
 * les poseront quand ils les liront, plutôt que de laisser ici des requêtes que rien
 * n'appelle.
 */

const VAULT_KEY = ['vault']

export function useVaultState() {
  return useQuery({
    queryKey: [...VAULT_KEY, 'state'],
    queryFn: () => api.get<VaultStateDto>('/api/vault'),
  })
}

/**
 * Tout réindexer.
 *
 * Invalide tout ce qui vient de l'index, et pas seulement son état : les listes et les
 * faits d'une note en sortent aussi, et les laisser en cache afficherait l'index
 * d'avant sous un compteur d'après.
 */
export function useReindexVault() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<VaultReindexDto>('/api/vault/reindex', {}),
    onSuccess: (result) => {
      queryClient.setQueryData([...VAULT_KEY, 'state'], result.state)
      queryClient.invalidateQueries({ queryKey: VAULT_KEY })
    },
  })
}
