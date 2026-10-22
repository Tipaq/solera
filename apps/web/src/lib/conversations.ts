import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AgentConfig,
  ElicitationAction,
  ElicitationValue,
  ConversationDto,
  HandoffDto,
  JournalPageDto,
  SoleraEvent,
} from '@solera/protocol'
import { api } from './api'
import { uuidv4 } from './uuid'

/** `null` est la clé des fils libres : ils forment leur propre groupe, pas un projet. */
export const conversationsKey = (projectId: string | null) => ['conversations', projectId]
const ALL_CONVERSATIONS_KEY = ['conversations', 'all']

/** Toutes les conversations visibles, pour la sidebar. Une requête, pas une par projet. */
export function useAllConversations() {
  return useQuery({
    queryKey: ALL_CONVERSATIONS_KEY,
    queryFn: () => api.get<ConversationDto[]>('/api/conversations'),
    staleTime: 10_000,
  })
}

/**
 * Épingle une conversation en tête de sa liste.
 *
 * Le seul écart à l'ordre par activité, et le même que partout ailleurs : ChatGPT
 * épingle, Claude met en favori, aucun des deux ne laisse ordonner à la main. Le champ
 * existait déjà en base — l'archivage automatique l'épargne — il n'avait pas de bouton.
 */
export function usePinConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      api.patch<{ ok: true }>(`/api/conversations/${id}`, { pinned }),
    onSuccess: (_result, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['conversation', id] })
    },
  })
}

export function useRenameConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<{ ok: true }>(`/api/conversations/${id}`, { title }),
    onSuccess: (_result, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['conversation', id] })
    },
  })
}

export function useArchiveConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.patch<{ ok: true }>(`/api/conversations/${id}`, { archived }),
    onSuccess: (_result, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['conversation', id] })
    },
  })
}

export function useConversations(projectId: string | undefined) {
  return useQuery({
    queryKey: conversationsKey(projectId ?? ''),
    queryFn: () => api.get<ConversationDto[]>(`/api/projects/${projectId}/conversations`),
    enabled: Boolean(projectId),
    staleTime: 15_000,
  })
}

export function useConversation(conversationId: string | undefined) {
  return useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<ConversationDto>(`/api/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
  })
}

/**
 * Ouvre une conversation, dans un projet ou libre.
 *
 * `null` vise la route sans projet, qui ne prend ni worktree ni carte : les deux
 * appartiennent à un projet, et un fil libre n'en désigne aucun. Un seul hook plutôt que
 * deux, parce que la page de brouillon est la même et que sa destination se change d'un
 * sélecteur, sans rien remonter.
 */
export function useCreateConversation(projectId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      agent: AgentConfig['agent']
      config: AgentConfig
      title?: string
      /** null signifie « dossier du projet », sans worktree. */
      worktreeId?: string | null
      /** Carte traitée, quand le brouillon a été ouvert depuis le board. */
      cardId?: string | null
      /** Envoyé avec la création : sans message, aucune conversation n'est écrite. */
      firstMessage?: {
        clientMessageId: string
        text: string
        attachmentIds: string[]
        mentions: string[]
        skills: string[]
      }
    }) =>
      projectId === null
        ? api.post<ConversationDto>('/api/conversations', {
            agent: input.agent,
            config: input.config,
            title: input.title,
            firstMessage: input.firstMessage,
          })
        : api.post<ConversationDto>(`/api/projects/${projectId}/conversations`, {
            worktreeId: null,
            cardId: null,
            ...input,
          }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      // Lancer depuis une carte lui ajoute une session et peut la faire changer de
      // colonne : le board affiché derrière serait faux sans cette relecture.
      void queryClient.invalidateQueries({ queryKey: ['cards'] })
    },
  })
}

/**
 * *Ranger…* : la destination d'une conversation, choisie après coup.
 *
 * `null` la ressort de son projet. Le serveur détache au passage le worktree, la carte
 * et la session native du CLI — le répertoire de travail a changé, et ce qui s'y
 * rapportait ne suit pas.
 */
export function useMoveConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) =>
      api.post<ConversationDto>(`/api/conversations/${id}/project`, { projectId }),
    onSuccess: (_result, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['conversation', id] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: ['cards'] })
    },
  })
}

export function useDeleteConversation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/conversations/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function sendMessage(
  conversationId: string,
  text: string,
  attachmentIds: string[] = [],
  mentions: string[] = [],
  skills: string[] = [],
): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/messages`, {
    // Identifiant stable côté client : un renvoi après timeout réseau est ignoré
    // par le serveur au lieu de poster le message deux fois (invariant I5).
    clientMessageId: uuidv4(),
    text,
    attachmentIds,
    mentions,
    skills,
  })
}

/**
 * Infléchit le tour en cours au lieu d'ouvrir le suivant.
 *
 * N'existe que là où le CLI le permet : le serveur refuse explicitement si aucun tour
 * n'est en cours, plutôt que de replier sur la file d'attente.
 */
export function steerConversation(
  conversationId: string,
  text: string,
  attachmentIds: string[] = [],
  mentions: string[] = [],
  skills: string[] = [],
): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/steer`, {
    clientMessageId: uuidv4(),
    text,
    attachmentIds,
    mentions,
    skills,
  })
}

/** Demande à l'agent de résumer la conversation pour libérer du contexte. */
export function compactConversation(conversationId: string): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/compact`)
}

export function interruptConversation(conversationId: string): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/interrupt`)
}

export function stopBackgroundTask(conversationId: string, taskId: string): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/background/${encodeURIComponent(taskId)}/stop`)
}

export function decidePermission(
  conversationId: string,
  requestId: string,
  decision: 'allowed' | 'denied',
  scope: 'once' | 'session',
): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/permissions/${requestId}`, {
    decision,
    scope,
  })
}

/**
 * Accorde ou refuse un rangement demandé par un agent. L'accord ne déplace pas : il pose
 * la promesse, et le daemon l'applique dès que la conversation se tait.
 */
export function decideFiling(
  conversationId: string,
  requestId: string,
  decision: 'accepted' | 'refused',
): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/filings/${requestId}`, { decision })
}

/**
 * Accorde ou refuse un déplacement de cartes. `conversationId` est celle **qui a
 * demandé**, dans le fil de laquelle la demande est apparue ; c'est le serveur qui
 * vérifie que l'appelant possède le projet.
 */
export function decideCardFiling(
  conversationId: string,
  requestId: string,
  decision: 'accepted' | 'refused',
): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/card-filings/${requestId}`, { decision })
}

export function answerQuestion(
  conversationId: string,
  requestId: string,
  status: 'answered' | 'cancelled',
  answers: Record<string, string[]>,
): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/questions/${requestId}`, {
    status,
    answers,
  })
}

/**
 * Branche la conversation à un point du fil.
 *
 * `throughSeq` est le dernier événement conservé : la branche reprend l'historique
 * jusque-là, et l'agent y est ramené au même point.
 */
export function forkConversation(
  conversationId: string,
  throughSeq: number,
): Promise<ConversationDto> {
  return api.post<ConversationDto>(`/api/conversations/${conversationId}/fork`, { throughSeq })
}

/**
 * Continue la conversation dans un autre CLI.
 *
 * La suite est créée sans message : la nouvelle demande s'écrit dans son composer, et
 * le contexte sélectionné part au CLI avec elle, au premier tour.
 */
export function handoffConversation(
  conversationId: string,
  body: { agent: AgentConfig['agent']; config: AgentConfig; budgetTokens?: number },
): Promise<ConversationDto> {
  return api.post<ConversationDto>(`/api/conversations/${conversationId}/handoff`, body)
}

/** Ce qu'une suite a reçu de sa source ; absent pour toute autre conversation. */
export function useHandoff(conversationId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['conversation', conversationId, 'handoff'],
    queryFn: () => api.get<HandoffDto>(`/api/conversations/${conversationId}/handoff`),
    enabled: Boolean(conversationId) && enabled,
    staleTime: Infinity,
  })
}

/** Retire un message de la file avant son envoi au CLI. */
export function cancelQueuedMessage(conversationId: string, queueId: string): Promise<unknown> {
  return api.delete(`/api/conversations/${conversationId}/queue/${queueId}`)
}

/** Fait passer un message en attente dans le tour en cours au lieu du suivant. */
export function steerQueuedMessage(conversationId: string, queueId: string): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/queue/${queueId}/steer`)
}

/** Remet un message de session retenu, malgré les garde-fous qui l'ont arrêté. */
export function releaseSessionMessage(conversationId: string, messageId: string): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/session-messages/${messageId}/release`)
}

export function discardSessionMessage(conversationId: string, messageId: string): Promise<unknown> {
  return api.delete(`/api/conversations/${conversationId}/session-messages/${messageId}`)
}

export function answerElicitation(
  conversationId: string,
  requestId: string,
  action: ElicitationAction,
  content: Record<string, ElicitationValue>,
): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/elicitations/${requestId}`, {
    action,
    content,
  })
}

export function decidePlan(
  conversationId: string,
  requestId: string,
  decision: 'approved' | 'rejected',
  /** L'`id` d'une option de suite annoncée par le plan, opaque pour le client. */
  followUpMode: string | null,
): Promise<unknown> {
  return api.post(`/api/conversations/${conversationId}/plans/${requestId}`, {
    decision,
    followUpMode,
  })
}

export type JournalPage = { seq: number; ts: number; event: SoleraEvent }[]

/**
 * Rattrapage complet depuis un curseur. La route est paginée, donc on boucle
 * jusqu'à rejoindre le dernier `seq` connu du serveur : s'arrêter à la première page
 * laisserait des trous invisibles dans le fil.
 *
 * Chaque page est rendue à l'appelant dès son arrivée plutôt qu'à la fin. Une
 * conversation de vingt mille événements en demande une quarantaine, et les attendre
 * toutes laissait l'écran vide le temps d'autant d'allers-retours enchaînés. Le fil
 * s'affiche maintenant dès la première et grandit jusqu'à sa fin.
 *
 * Les pages ne peuvent pas être demandées en parallèle : le curseur d'une page est le
 * dernier `seq` lu par la précédente, et rien ne permet de le prévoir, une page rendant
 * moins d'entrées qu'elle n'en lit depuis que ses deltas y sont fusionnés.
 *
 * Rend le dernier `seq` lu, qui n'est pas celui de la dernière entrée rendue et devient
 * le curseur d'abonnement du WebSocket.
 */
export async function fetchJournal(
  conversationId: string,
  afterSeq: number,
  onPage: (entries: JournalPage) => void,
): Promise<number> {
  let cursor = afterSeq

  for (;;) {
    const page = await api.get<JournalPageDto>(
      `/api/conversations/${conversationId}/events?after=${cursor}`,
    )

    if (page.entries.length > 0) {
      onPage(
        page.entries.map((entry) => ({
          seq: entry.seq,
          ts: entry.ts,
          event: entry.event as SoleraEvent,
        })),
      )
    }

    // Le web s'échange sans redémarrage, le serveur non : entre les deux, ce client
    // parle à un serveur qui ignore `nextAfter`. On retombe alors sur la dernière entrée
    // rendue, ce qu'il faisait avant, plutôt que d'avancer sur un `undefined` qui
    // relirait la première page sans fin.
    const next = page.nextAfter ?? page.entries.at(-1)?.seq ?? cursor

    // Une page qui n'avance pas arrête la boucle : sans ce garde, un serveur qui rendrait
    // un curseur immobile la ferait tourner sur la même page indéfiniment.
    if (next <= cursor || next >= page.lastSeq) return Math.max(cursor, next)
    cursor = next
  }
}

/**
 * Rattache la conversation à une carte du projet, ou l'en détache avec `null`.
 *
 * Le board est relu avec : la carte gagne ou perd une session, et sa tuile l'affiche.
 */
export function useAttachCard(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, cardId }: { id: string; cardId: string | null }) =>
      api.patch<{ ok: true }>(`/api/conversations/${id}`, { cardId }),
    onSuccess: (_result, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['conversation', id] })
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['cards', projectId] })
    },
  })
}
