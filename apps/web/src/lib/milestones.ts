import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentConfig,
  CardRefinementDetailDto,
  LaunchMilestoneCardBody,
  MilestonePlanDto,
  MilestoneRunDto,
  MilestoneRunMode,
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

/**
 * L'affinage d'une carte lu hors du fil (#184) : la session, sa question ouverte, son
 * brouillon et son changement en attente. Relu au rythme d'un jalon qui tourne tant que
 * la session travaille ou attend : sa question ou son brouillon peut arriver à tout moment.
 */
export function useCardRefinement(cardId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['card-refinement', cardId],
    queryFn: () => api.get<CardRefinementDetailDto>(`/api/cards/${cardId}/refinement`),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.session?.status
      return status === 'running' || status === 'awaiting_input' ? LIVE_REFETCH_MS : false
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
    mutationFn: (body: {
      mode?: MilestoneRunMode
      concurrency: number
      config: AgentConfig
      cards: Record<string, AgentConfig>
      confined: boolean | null
    }) =>
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

/**
 * Lance une enfant du jalon `cardId` à la main (#186) ; le serveur ouvre un pilotage à
 * la main s'il n'y en a pas de vivant, et rend le pilotage.
 */
export function useLaunchMilestoneCard(projectId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ childId, ...body }: LaunchMilestoneCardBody & { childId: string }) =>
      api.post<MilestoneRunDto>(`/api/cards/${cardId}/milestone/cards/${childId}/launch`, body),
    onSuccess: (run) => {
      queryClient.setQueryData(runKey(cardId), run)
      // La carte passe « en cours » et sa session apparaît.
      void queryClient.invalidateQueries({ queryKey: ['cards', projectId] })
      void queryClient.invalidateQueries({ queryKey: [ACTIVE_PREFIX] })
    },
  })
}
