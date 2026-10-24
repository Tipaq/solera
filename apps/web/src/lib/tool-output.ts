import { useQuery } from '@tanstack/react-query'
import type { EventBodyRef, ToolOutputDto } from '@solera/protocol'
import { api } from './api'

/**
 * Sortie complète d'un appel d'outil, quand la relecture ne l'a pas transmise.
 *
 * Le journal ne bouge plus une fois le tour passé : une carte ouverte n'a pas à se
 * rafraîchir. La requête n'est armée qu'à l'ouverture de la carte : une conversation
 * longue porte des centaines de sorties volumineuses dont on n'en ouvre presque aucune,
 * et c'est précisément pour ça qu'elles ne sont plus transférées avec le fil.
 */
export function useToolOutput(conversationId: string, toolCallId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['tool-output', conversationId, toolCallId],
    queryFn: ({ signal }) =>
      api.get<ToolOutputDto>(
        `/api/conversations/${conversationId}/tools/${encodeURIComponent(toolCallId)}/output`,
        signal,
      ),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    enabled,
  })
}

/**
 * Un corps laissé au serveur par la relecture (entrée, sortie ou patch), désigné par
 * sa référence. Pas de cache inactif : fermer la carte libère la donnée et annule une
 * requête inachevée. La carte ouverte possède son corps ; le fil n'en garde que la
 * référence.
 */
export function useEventBody(conversationId: string, ref: EventBodyRef | undefined) {
  return useQuery({
    queryKey: ['event-body', conversationId, ref?.seq, ref?.field, ref?.block],
    queryFn: ({ signal }) =>
      api.get<{ value: unknown }>(
        `/api/conversations/${conversationId}/events/${ref!.seq}/body/${ref!.field}${ref!.block === undefined ? '' : `?block=${ref!.block}`}`,
        signal,
      ),
    enabled: ref !== undefined,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
}
