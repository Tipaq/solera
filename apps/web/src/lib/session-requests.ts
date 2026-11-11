import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ConversationPromptDto } from '@solera/protocol'
import type { LiveConversation } from './activity'
import { api } from './api'
import { useAwaiting } from './decisions'
import type { SessionRequest } from './session-request-summary'

export type { SessionRequest }

/**
 * Les demandes ouvertes des sessions d'un projet, par conversation.
 *
 * Une seule requête pour tout le projet, relue quand une session change d'état ou
 * qu'un événement notable s'y écrit : une demande ouverte en est un, et sa réponse fait
 * repartir le tour. La signature tient dans la clé, ce qui garde la réponse précédente
 * à l'écran le temps de la relecture.
 *
 * Une demande du CLI passe devant une décision : c'est elle qui tient le tour.
 *
 * `null` lit celles de tous les projets visibles, pour une liste qui les mêle (« Ce qui
 * t'attend » au portefeuille ou sur `/sessions`, #163).
 */
export function useSessionRequests(
  projectId: string | null | undefined,
  live: LiveConversation[],
): ReadonlyMap<string, SessionRequest> {
  return useRequests(projectId, live)
}

/**
 * Les mêmes, pour tous les projets visibles et non archivés : l'Activité du
 * portefeuille (#117), d'une requête pour tous.
 */
export function usePortfolioSessionRequests(live: LiveConversation[]): ReadonlyMap<string, SessionRequest> {
  return useRequests(null, live)
}

/** `null` pour tous les projets, `undefined` tant que le projet n'est pas connu. */
function useRequests(projectId: string | null | undefined, live: LiveConversation[]): ReadonlyMap<string, SessionRequest> {
  const signature = live.map((entry) => `${entry.conversation.id}:${entry.status}:${entry.seq}`).join(',')
  const { data: prompts } = useQuery({
    queryKey: ['prompts', projectId, signature],
    queryFn: async () =>
      (
        await api.get<{ prompts: ConversationPromptDto[] }>(
          projectId === null ? '/api/prompts' : `/api/projects/${projectId}/prompts`,
        )
      ).prompts,
    enabled: projectId !== undefined,
    placeholderData: (previous) => previous,
  })
  const { data: awaiting } = useAwaiting()

  return useMemo(() => {
    const requests = new Map<string, SessionRequest>()
    for (const entry of awaiting ?? []) {
      if (entry.kind !== 'decision' || (projectId !== null && entry.projectId !== projectId)) continue
      requests.set(entry.conversationId, {
        kind: 'decision',
        requestId: entry.id,
        requestedAt: entry.createdAt,
        question: entry.question,
      })
    }
    for (const prompt of prompts ?? []) {
      const request = requestOf(prompt)
      if (request) requests.set(prompt.conversationId, request)
    }
    return requests
  }, [awaiting, prompts, projectId])
}

export function requestOf(prompt: ConversationPromptDto): SessionRequest | null {
  const { requestId, requestedAt, event } = prompt
  switch (event.type) {
    case 'permission.requested':
      return { kind: 'permission', requestId, requestedAt, event }
    case 'question.requested':
      return { kind: 'question', requestId, requestedAt, event }
    case 'plan.review_requested':
      return { kind: 'plan', requestId, requestedAt, event }
    case 'elicitation.requested':
      return { kind: 'elicitation', requestId, requestedAt, event }
    default:
      return null
  }
}
