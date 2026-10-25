import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentConfig,
  MilestonePlanDto,
  MilestoneRunDto,
  UpdateMilestoneRunBody,
} from '@solera/protocol'
import { api } from './api'

/**
 * Lancer un jalon (#72) : l'aperçu, le pilotage et sa conduite. Le serveur pilote ; ces
 * hooks ne font que lire ce qu'il en dit et lui transmettre les gestes.
 */

const runKey = (cardId: string) => ['milestone-run', cardId]
const planKey = (cardId: string) => ['milestone-plan', cardId]

/** Un jalon qui tourne se relit à ce rythme : c'est la vue de qui travaille où. */
const LIVE_REFETCH_MS = 3_000

/** Le pilotage d'une carte parente ; `null` si elle n'a jamais été lancée. */
export function useMilestoneRun(cardId: string, enabled: boolean) {
  return useQuery({
    queryKey: runKey(cardId),
    queryFn: () => api.get<MilestoneRunDto | null>(`/api/cards/${cardId}/milestone`),
    enabled,
    refetchInterval: (query) => {
      const state = query.state.data?.state
      return state === 'running' || state === 'paused' ? LIVE_REFETCH_MS : false
    },
  })
}

/** Ce que ferait le lancement, lu à l'ouverture de l'aperçu et jamais mis en cache. */
export function useMilestonePlan(cardId: string, enabled: boolean) {
  return useQuery({
    queryKey: planKey(cardId),
    queryFn: () => api.get<MilestonePlanDto>(`/api/cards/${cardId}/milestone/plan`),
    enabled,
    staleTime: 0,
    gcTime: 0,
  })
}

export function useLaunchMilestone(projectId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { concurrency: number; config: AgentConfig; cards: Record<string, AgentConfig> }) =>
      api.post<MilestoneRunDto>(`/api/cards/${cardId}/milestone`, body),
    onSuccess: (run) => {
      queryClient.setQueryData(runKey(cardId), run)
      void queryClient.invalidateQueries({ queryKey: ['cards', projectId] })
    },
  })
}

export function useUpdateMilestone(cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateMilestoneRunBody) => api.patch<MilestoneRunDto>(`/api/cards/${cardId}/milestone`, body),
    onSuccess: (run) => queryClient.setQueryData(runKey(cardId), run),
  })
}
