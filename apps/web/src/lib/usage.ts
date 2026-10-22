import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { AgentKind, AgentUsage } from '@solera/protocol'
import { api } from './api'

/** `account` est l'identifiant d'un compte Claude supplémentaire, null pour la connexion du CLI. */
const usageKey = (agent: AgentKind, account: string | null) => ['usage', agent, account]

const usagePath = (agent: AgentKind, account: string | null, refresh: boolean) => {
  const params = new URLSearchParams()
  if (account) params.set('account', account)
  if (refresh) params.set('refresh', '1')
  const query = params.toString()
  return `/api/agents/${agent}/usage${query ? `?${query}` : ''}`
}

/**
 * La lecture d'un CLI, en une place.
 *
 * Les deux appelants — un CLI seul, le compte entier — partagent ces options parce
 * qu'ils lisent la même chose : deux jeux d'options divergeraient sur la fraîcheur, et
 * la même mesure n'aurait pas la même durée de vie selon l'écran qui la demande.
 *
 * `staleTime` à zéro : les hooks ne sont montés que pendant que la modale est ouverte,
 * donc chaque ouverture redemande la valeur. Le garde-fou est côté serveur, où se
 * trouve le coût réel (une lecture y démarre un process CLI) : deux caches empilés
 * donneraient une fraîcheur impossible à raisonner, et un panneau qui semble ne rien
 * relire. La valeur précédente reste en cache le temps de la relecture, donc rouvrir
 * affiche l'ancienne mesure immédiatement plutôt qu'un écran vide.
 */
function usageQuery({ agent, account }: UsageTarget) {
  return {
    queryKey: usageKey(agent, account),
    queryFn: () => api.get<AgentUsage>(usagePath(agent, account, false)),
    staleTime: 0,
    // La consommation d'un compte n'a pas d'à-coups : réessayer en boucle ne ferait
    // que relancer des CLI pour rien.
    retry: false as const,
  }
}

/**
 * Consommation d'un seul CLI.
 *
 * `enabled` sert aux appelants qui l'affichent sans qu'on l'ait demandée, comme la page
 * de brouillon : interroger un CLI absent ne rapporterait qu'une erreur.
 */
export function useAgentUsage(agent: AgentKind, enabled = true, account: string | null = null) {
  return useQuery({ ...usageQuery({ agent, account }), enabled })
}

/** Une consommation à lire : celle d'un CLI, ou d'un de ses comptes supplémentaires. */
export interface UsageTarget {
  agent: AgentKind
  account: string | null
}

/** Ce qu'une section de la modale a besoin de savoir sur un CLI. */
export interface AccountUsageEntry extends UsageTarget {
  usage: AgentUsage | undefined
  error: Error | null
  /** Première lecture en cours : il n'y a encore rien à montrer pour ce CLI. */
  isPending: boolean
}

/**
 * Consommation du compte : tous les CLI lançables, lus ensemble.
 *
 * `useQueries` et non une liste de `useAgentUsage` : le nombre de CLI dépend de ce que
 * le serveur sait lancer, donc il varie d'un rendu à l'autre, et les hooks ne se
 * posent pas dans une boucle de longueur variable. C'est exactement ce à quoi sert
 * cette API, et elle garde une entrée de cache par CLI — la modale et la page de
 * brouillon partagent donc la même mesure.
 *
 * Les lectures partent en parallèle : chacune démarre un process CLI, et les mettre à
 * la queue leu leu ferait attendre la somme de leurs temps pour un écran qui les
 * montre côte à côte. Un CLI en échec n'empêche pas les autres de s'afficher, il porte
 * son erreur dans sa section.
 */
export function useAccountUsage(targets: UsageTarget[]) {
  const combine = useCallback(
    (results: UseQueryResult<AgentUsage, Error>[]) => ({
      // Parcouru dans l'ordre des cibles et non dans celui des résultats : c'est leur
      // liste qui fait foi, et elle seule garantit à chaque entrée son agent.
      entries: targets.map((target, index) => {
        const result = results[index]
        return {
          ...target,
          usage: result?.data,
          error: result?.error ?? null,
          isPending: result?.isPending ?? true,
        }
      }),
      // La plus ancienne des lectures affichées : c'est elle qui dit depuis quand
      // l'écran peut avoir vieilli. Annoncer la plus récente donnerait de ce qui est
      // montré une fraîcheur que la moitié n'a pas.
      fetchedAt: results.reduce<number | null>(
        (oldest, result) =>
          result.data ? Math.min(oldest ?? result.data.fetchedAt, result.data.fetchedAt) : oldest,
        null,
      ),
      isFetching: results.some((result) => result.isFetching),
    }),
    [targets],
  )

  return useQueries({ queries: targets.map(usageQuery), combine })
}

/**
 * Relecture explicite, qui court-circuite aussi le cache du serveur.
 *
 * Une **mutation** et non un appel nu, pour que l'écran sache qu'elle travaille :
 * `?refresh=1` démarre un process CLI par agent, et un bouton qui ne montre rien
 * pendant ce temps se fait cliquer trois fois. `isPending` donne le garde et l'icône
 * qui tourne ; `isFetching` ne les donnerait pas, puisque rien ne passe alors par une
 * query.
 *
 * `fetchQuery` aurait fait voir la relecture aux observateurs, mais au prix d'une
 * queryFn `?refresh=1` laissée dans le cache : le prochain retour sur l'onglet
 * relancerait des CLI sans que personne ne l'ait demandé.
 *
 * Un CLI dont la lecture forcée échoue retombe sur la lecture ordinaire plutôt que de
 * rester muet : l'erreur revient alors par sa query, donc dans sa section, au lieu
 * d'être avalée par le bouton. L'échec d'un CLI n'annule pas la relecture des autres —
 * chacun a son `try`, donc aucune promesse ne rejette et le `Promise.all` les attend
 * toutes.
 */
export function useRefreshUsage(targets: UsageTarget[]) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () =>
      Promise.all(
        targets.map(async ({ agent, account }) => {
          try {
            const fresh = await api.get<AgentUsage>(usagePath(agent, account, true))
            queryClient.setQueryData(usageKey(agent, account), fresh)
          } catch {
            await queryClient.invalidateQueries({ queryKey: usageKey(agent, account) })
          }
        }),
      ),
  })
}

/** Le compte supplémentaire qu'une configuration désigne, null pour la connexion du CLI. */
export function usageAccountOf(config: { agent: AgentKind; account?: string | null } | null | undefined): string | null {
  return config?.agent === 'claude' || config?.agent === 'codex' ? (config.account ?? null) : null
}
