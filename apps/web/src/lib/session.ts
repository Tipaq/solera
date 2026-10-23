import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CurrentUser } from '@solera/protocol'
import { ApiRequestError, api } from './api'

const ME_KEY = ['auth', 'me']

export function useCurrentUser() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api.get<CurrentUser>('/api/auth/me')
      } catch (err) {
        // Pas de session : ce n'est pas une erreur à afficher, c'est l'état déconnecté.
        if (err instanceof ApiRequestError && err.status === 401) return null
        throw err
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (credentials: { username: string; password: string }) =>
      api.post<CurrentUser>('/api/auth/login', credentials),
    onSuccess: (user) => queryClient.setQueryData(ME_KEY, user),
  })
}

/** Le premier compte, depuis la visite : la session s'ouvre avec lui. */
export function useSetupAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (account: { username: string; displayName: string; password: string }) =>
      api.post<CurrentUser>('/api/auth/setup', account),
    onSuccess: (user) => {
      queryClient.setQueryData(ME_KEY, user)
      // La base a désormais un compte : le profil de l'instance ne le dit plus.
      void queryClient.invalidateQueries({ queryKey: ['system', 'instance'] })
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<void>('/api/auth/logout'),
    onSuccess: () => {
      /*
       * L'état déconnecté est posé sur la requête de session, qui reste vivante. Un
       * `queryClient.clear()` la supprimerait au lieu de la remettre à zéro, et
       * l'observateur monté dans `App` resterait accroché à l'entrée disparue avec son
       * dernier résultat : l'application restait sur l'écran connecté, avec un compte
       * que le serveur ne reconnaissait déjà plus.
       *
       * Tout le reste est bien vidé : sans ça, se reconnecter sous un autre compte
       * afficherait d'abord les projets et les conversations du précédent.
       */
      queryClient.setQueryData(ME_KEY, null)
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== ME_KEY[0] })
    },
  })
}
