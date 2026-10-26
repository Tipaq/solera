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
/** Le préfixe des listes de jalons lancés : une pause doit rafraîchir celle du projet. */
const ACTIVE_PREFIX = 'milestone-runs'
const activeKey = (projectId: string) => [ACTIVE_PREFIX, projectId]

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

/** Sans jalon lancé, le projet se relit moins souvent : on attend seulement qu'il parte. */
const IDLE_REFETCH_MS = 15_000

/**
 * Les jalons lancés d'un projet, en marche ou en pause (#116) : le bandeau de l'Activité
 * et de l'Aperçu, le groupe de leurs sessions et leur ligne dans la frise.
 */
export function useActiveMilestones(projectId: string | undefined) {
  return useQuery({
    queryKey: activeKey(projectId ?? ''),
    queryFn: () => api.get<MilestoneRunDto[]>(`/api/projects/${projectId}/milestones/active`),
    enabled: Boolean(projectId),
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? LIVE_REFETCH_MS : IDLE_REFETCH_MS),
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
      void queryClient.invalidateQueries({ queryKey: activeKey(projectId) })
    },
  })
}

export function useUpdateMilestone(cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateMilestoneRunBody) => api.patch<MilestoneRunDto>(`/api/cards/${cardId}/milestone`, body),
    onSuccess: (run) => {
      queryClient.setQueryData(runKey(cardId), run)
      // Le bandeau et la frise suivent : une pause s'y lit, un arrêt les retire.
      void queryClient.invalidateQueries({ queryKey: [ACTIVE_PREFIX] })
    },
  })
}
