import { useMemo, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentConfig,
  CardDraft,
  CardDto,
  CardRefinementDetailDto,
  ConversationStatus,
  LaunchMilestoneCardBody,
  MilestonePlanDto,
  MilestoneRunDto,
  MilestoneRunMode,
  UpdateMilestoneRunBody,
} from '@solera/protocol'
import { useLiveConversations } from './activity'
import { api } from './api'
import type { StatusOf } from './card-state'
import { useCards } from './cards'
import { liveStatus, subscribeStatus } from './conversation-status'
import { answerQuestion, decideCardDraft, useAllConversations } from './conversations'
import { horizonOf, type MilestoneEntry } from './milestone-model'
import { useSessionRequests } from './session-requests'

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

/**
 * Ce qu'un geste sur l'affinage d'un jalon fait relire : son détail, les cartes (le
 * brouillon validé y entre, le compte du brouillon en sort) et les demandes ouvertes.
 * Rendu, pour que le geste reste en cours jusqu'à ce que la page ait changé.
 */
function refreshRefinement(queryClient: ReturnType<typeof useQueryClient>, projectId: string, cardId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['card-refinement', cardId] }),
    queryClient.invalidateQueries({ queryKey: ['cards', projectId] }),
    queryClient.invalidateQueries({ queryKey: ['prompts'] }),
  ])
}

/** Répond d'un coup à toutes les questions d'une demande de la session d'affinage (#195). */
export function useAnswerRefinement(projectId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, requestId, answers }: { conversationId: string; requestId: string; answers: Record<string, string[]> }) =>
      answerQuestion(conversationId, requestId, 'answered', answers),
    onSuccess: () => refreshRefinement(queryClient, projectId, cardId),
  })
}

/** Valide le brouillon de découpage tel que corrigé sur la page du jalon (#195). */
export function useValidateRefinementDraft(projectId: string, cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ conversationId, requestId, draft }: { conversationId: string; requestId: string; draft: CardDraft }) =>
      decideCardDraft(conversationId, requestId, { decision: 'created', draft }),
    onSuccess: () => refreshRefinement(queryClient, projectId, cardId),
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
    // Sans `config`, le CLI d'une session neuve du projet (#197, « comme une session neuve »).
    mutationFn: (body: {
      mode?: MilestoneRunMode
      concurrency: number
      config?: AgentConfig
      cards?: Record<string, AgentConfig>
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

/**
 * Le statut vivant des sessions de ces cartes, affinage compris : celui du socket quand
 * il en a poussé un, celui du chargement sinon. `CardConversationDto.status` est une
 * photo, que la liste des cartes ne relit qu'au bout de son `staleTime`.
 *
 * L'instantané est une chaîne : elle ne change, et ne fait rerendre, que quand l'une de
 * ces sessions-là change d'état — pas à chaque relevé de volume du socket.
 */
export function useLiveCardStatuses(cards: readonly Pick<CardDto, 'conversations' | 'refinement'>[] | undefined): StatusOf {
  const ids = useMemo(
    () =>
      (cards ?? []).flatMap((card) => [
        ...card.conversations.map((session) => session.id),
        ...(card.refinement ? [card.refinement.conversationId] : []),
      ]),
    [cards],
  )
  const signature = useSyncExternalStore(
    subscribeStatus,
    () => ids.flatMap((id) => {
      const status = liveStatus(id)
      return status ? [`${id}=${status}`] : []
    }).join(','),
    () => '',
  )
  return useMemo(() => {
    const live = new Map(
      signature ? signature.split(',').map((pair) => pair.split('=') as [string, ConversationStatus]) : [],
    )
    return (session) => live.get(session.id) ?? session.status
  }, [signature])
}

/**
 * Les jalons d'un projet, analysés (#188) : ses cartes, ses pilotages actifs, les
 * demandes ouvertes de ses sessions et leurs statuts vivants, passés à `horizonOf`.
 * `statusOf` sert aux vues qui montrent aussi les cartes (repère ambre, destination).
 */
export function useMilestones(projectId: string | undefined): {
  entries: MilestoneEntry[]
  cards: CardDto[]
  statusOf: StatusOf
  isPending: boolean
} {
  const { data: cards, isPending } = useCards(projectId)
  const { data: runs } = useActiveMilestones(projectId)
  const { data: conversations } = useAllConversations()
  const mine = useMemo(
    () => (conversations ?? []).filter((entry) => entry.projectId === projectId),
    [conversations, projectId],
  )
  const requests = useSessionRequests(projectId, useLiveConversations(mine))
  const statusOf = useLiveCardStatuses(cards)

  return useMemo(() => {
    const list = cards ?? NO_CARDS
    return {
      entries: horizonOf({ cards: list, runs: runs ?? [], requests, statusOf }),
      cards: list,
      statusOf,
      isPending,
    }
  }, [cards, runs, requests, statusOf, isPending])
}

const NO_CARDS: CardDto[] = []
