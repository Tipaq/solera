import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { useCallback } from 'react'
import type { AgentKind, AgentUsage } from '@solera/protocol'
import { api } from './api'

const usageKey = (agent: AgentKind) => ['usage', agent]

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
function usageQuery(agent: AgentKind) {
  return {
    queryKey: usageKey(agent),
    queryFn: () => api.get<AgentUsage>(`/api/agents/${agent}/usage`),
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
export function useAgentUsage(agent: AgentKind, enabled = true) {
  return useQuery({ ...usageQuery(agent), enabled })
}

/** Ce qu'une section de la modale a besoin de savoir sur un CLI. */
export interface AccountUsageEntry {
  agent: AgentKind
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
export function useAccountUsage(agents: AgentKind[]) {
  const combine = useCallback(
    (results: UseQueryResult<AgentUsage, Error>[]) => ({
      // Parcouru dans l'ordre des CLI et non dans celui des résultats : c'est la
      // liste des CLI qui fait foi, et elle seule garantit à chaque entrée son agent.
      entries: agents.map((agent, index) => {
        const result = results[index]
        return {
          agent,
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
    [agents],
  )

  return useQueries({ queries: agents.map(usageQuery), combine })
}

/**
 * Relecture explicite, qui court-circuite aussi le cache du serveur.
 *
 * Un CLI dont la lecture forcée échoue retombe sur la lecture ordinaire plutôt que de
 * rester muet : l'erreur revient alors par sa query, donc dans sa section, au lieu
 * d'être avalée par le bouton. Et l'échec d'un CLI n'annule pas la relecture des
 * autres, d'où les lectures menées jusqu'au bout une à une plutôt qu'un `Promise.all`
 * qui rejette au premier.
 */
export function useRefreshUsage(agents: AgentKind[]) {
  const queryClient = useQueryClient()

  return async () => {
    await Promise.all(
      agents.map(async (agent) => {
        try {
          const fresh = await api.get<AgentUsage>(`/api/agents/${agent}/usage?refresh=1`)
          queryClient.setQueryData(usageKey(agent), fresh)
        } catch {
          await queryClient.invalidateQueries({ queryKey: usageKey(agent) })
        }
      }),
    )
  }
}
