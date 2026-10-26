import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ConversationPromptDto, SoleraEvent } from '@solera/protocol'
import type { LiveConversation } from './activity'
import { api } from './api'
import { useAwaiting } from './decisions'
import type { useTranslate } from './i18n'

type EventOf<T extends SoleraEvent['type']> = Extract<SoleraEvent, { type: T }>

/**
 * Ce qu'une session te demande, tel que l'onglet Activité le déplie sous sa ligne (#112,
 * planche B2) : une demande du CLI, lue dans le journal, ou une décision (#77), lue dans
 * la section « À décider ».
 *
 * Les demandes du CLI gardent leur événement tel quel : la réponse part par les mêmes
 * routes que depuis le fil, et rien n'est retraduit en chemin.
 */
export type SessionRequest =
  | { kind: 'permission'; requestId: string; requestedAt: number; event: EventOf<'permission.requested'> }
  | { kind: 'question'; requestId: string; requestedAt: number; event: EventOf<'question.requested'> }
  | { kind: 'plan'; requestId: string; requestedAt: number; event: EventOf<'plan.review_requested'> }
  | { kind: 'elicitation'; requestId: string; requestedAt: number; event: EventOf<'elicitation.requested'> }
  | { kind: 'decision'; requestId: string; requestedAt: number; question: string }

/**
 * Les demandes ouvertes des sessions d'un projet, par conversation.
 *
 * Une seule requête pour tout le projet, relue quand une session change d'état ou
 * qu'un événement notable s'y écrit : une demande ouverte en est un, et sa réponse fait
 * repartir le tour. La signature tient dans la clé, ce qui garde la réponse précédente
 * à l'écran le temps de la relecture.
 *
 * Une demande du CLI passe devant une décision : c'est elle qui tient le tour.
 */
export function useSessionRequests(
  projectId: string | undefined,
  live: LiveConversation[],
): ReadonlyMap<string, SessionRequest> {
  const signature = live.map((entry) => `${entry.conversation.id}:${entry.status}:${entry.seq}`).join(',')
  const { data: prompts } = useQuery({
    queryKey: ['prompts', projectId, signature],
    queryFn: async () =>
      (await api.get<{ prompts: ConversationPromptDto[] }>(`/api/projects/${projectId}/prompts`)).prompts,
    enabled: projectId !== undefined,
    placeholderData: (previous) => previous,
  })
  const { data: awaiting } = useAwaiting()

  return useMemo(() => {
    const requests = new Map<string, SessionRequest>()
    for (const entry of awaiting ?? []) {
      if (entry.kind !== 'decision' || entry.projectId !== projectId) continue
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

function requestOf(prompt: ConversationPromptDto): SessionRequest | null {
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

/**
 * Ce qui identifie une permission : la commande, le chemin, l'URL, ou rien. Repris par
 * l'aperçu, qui la montre en code, et par la ligne, qui la résume.
 */
export function permissionTarget(input: unknown): { content: string; language: string } | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'string') return { content: input, language: '' }

  const fields = input as Record<string, unknown>
  if (typeof fields.command === 'string' && fields.command.length > 0) {
    return { content: fields.command, language: 'bash' }
  }
  for (const key of ['file_path', 'path', 'url']) {
    const value = fields[key]
    if (typeof value === 'string' && value.length > 0) return { content: value, language: '' }
  }
  return { content: JSON.stringify(input, null, 2), language: 'json' }
}

/** Le titre d'une permission : celui du CLI, ou une phrase faite du nom de l'outil. */
export function permissionTitle(event: EventOf<'permission.requested'>, t: ReturnType<typeof useTranslate>): string {
  return event.title ?? t('permission.title.pending', { tool: event.toolName })
}

/**
 * La demande en une ligne, pour la quatrième colonne : la question posée, ou ce que la
 * permission ferait.
 */
export function requestLine(request: SessionRequest, t: ReturnType<typeof useTranslate>): string {
  switch (request.kind) {
    case 'question':
      return request.event.questions[0]?.question ?? t('question.prompt.title')
    case 'permission': {
      const target = permissionTarget(request.event.input)
      return target && target.language !== 'json'
        ? `${request.event.toolName} : ${target.content}`
        : permissionTitle(request.event, t)
    }
    case 'plan':
      return t('projectActivity.request.plan')
    case 'elicitation':
      return `${request.event.serverName} : ${request.event.message}`
    case 'decision':
      return request.question
  }
}
