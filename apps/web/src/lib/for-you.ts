import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AwaitingRequestDto, ConversationDto, ConversationPromptDto } from '@solera/protocol'
import type { LiveConversation } from './activity'
import { api } from './api'
import { useAwaiting } from './decisions'
import { requestOf, type SessionRequest } from './session-requests'

/**
 * Ce qui t'attend (#121) : une ligne par demande, en tête de l'Activité et dans le filtre
 * « Pour toi » de sa modale.
 *
 * Trois rangs, dans l'ordre de ce qu'ils coûtent à laisser filer :
 * - **bloqué** : un fil en `awaiting_input` — permission, question, plan —, ou une
 *   question asynchrone restée ouverte. L'agent est à l'arrêt tant que personne ne répond ;
 * - **décision** : un `request_decision`, qui a une échéance ;
 * - **accord** : un des trois rangements qu'un clic accorde (`move_conversation`,
 *   `request_card_change`, `propose_cards`). Rien ne presse, rien n'expire.
 *
 * Ce qui est réglé sur « Automatique » (#120) n'y passe jamais : le serveur ne liste que
 * ce qui attend un clic, et une permission accordée d'office ne bloque pas le fil.
 */
export type ForYouTier = 'blocked' | 'decision' | 'accord'

type DecisionRequest = Extract<AwaitingRequestDto, { kind: 'decision' }>
type AccordRequest = Exclude<AwaitingRequestDto, { kind: 'decision' }>

interface ForYouBase {
  /** Unique dans la liste : un fil bloqué et sa décision sont deux lignes. */
  key: string
  conversationId: string
  conversationTitle: string
  projectId: string | null
  /** Depuis quand elle attend. */
  since: number
}

export type ForYouRequest =
  | (ForYouBase & {
      tier: 'blocked'
      conversation: ConversationDto
      /** La demande lue dans le journal ; null le temps de la relire. */
      request: SessionRequest | null
    })
  | (ForYouBase & { tier: 'decision'; awaiting: DecisionRequest })
  | (ForYouBase & { tier: 'accord'; awaiting: AccordRequest })

const RANK: Record<ForYouTier, number> = { blocked: 0, decision: 1, accord: 2 }

/**
 * L'ordre arrêté avec Tim (Q37) : bloqué, puis décision, puis accord, quel que soit le
 * projet. `focus`, le projet que montre la colonne en mode projet (#51), passe devant
 * **à l'intérieur de chaque rang** : il ne fait pas remonter un accord au-dessus d'un
 * fil bloqué ailleurs.
 *
 * Dans un rang, la plus ancienne d'abord — sauf les décisions, par échéance : c'est
 * celle qui va tomber qui compte, et une décision sans échéance va en dernier.
 */
export function orderForYou(requests: ForYouRequest[], focus?: string | null): ForYouRequest[] {
  const due = (entry: ForYouRequest) =>
    entry.tier === 'decision' ? (entry.awaiting.expiresAt ?? Number.POSITIVE_INFINITY) : entry.since
  return [...requests].sort((a, b) =>
    RANK[a.tier] - RANK[b.tier]
    || (focus === undefined ? 0 : Number(b.projectId === focus) - Number(a.projectId === focus))
    || due(a) - due(b)
    || a.since - b.since,
  )
}

/**
 * Assemble les trois sources : l'état vivant des fils, leurs demandes du CLI lues dans le
 * journal, et ce que le serveur liste comme attendant une personne.
 */
export function assembleForYou(
  live: LiveConversation[],
  prompts: readonly ConversationPromptDto[],
  awaiting: readonly AwaitingRequestDto[],
  titles: ReadonlyMap<string, string>,
): ForYouRequest[] {
  const requests = new Map<string, SessionRequest>()
  for (const prompt of prompts) {
    const request = requestOf(prompt)
    if (request) requests.set(prompt.conversationId, request)
  }

  const rows: ForYouRequest[] = []
  for (const entry of live) {
    const { conversation } = entry
    // Le fil d'un coéquipier, dans un projet partagé, ne t'attend pas : c'est à lui de
    // répondre. Il reste dans l'Activité comme une session.
    if (!conversation.isOwner) continue
    const request = requests.get(conversation.id) ?? null
    if (!entry.awaiting && !request) continue
    rows.push({
      tier: 'blocked',
      // Une ligne par demande (Q24) : deux permissions qui se suivent dans un fil sont
      // deux lignes, et la première dit son verdict avant de céder la place.
      key: request ? `blocked:${request.requestId}` : `blocked:${conversation.id}`,
      conversationId: conversation.id,
      conversationTitle: conversation.title,
      projectId: conversation.projectId,
      since: request?.requestedAt ?? entry.since,
      conversation,
      request,
    })
  }
  for (const entry of awaiting) {
    const base = {
      key: entry.id,
      conversationId: entry.conversationId,
      conversationTitle: entry.conversationTitle || (titles.get(entry.conversationId) ?? ''),
      projectId: entry.projectId,
      since: entry.createdAt,
    }
    rows.push(entry.kind === 'decision'
      ? { ...base, tier: 'decision', awaiting: entry }
      : { ...base, tier: 'accord', awaiting: entry })
  }
  return rows
}

/**
 * Ce qui t'attend, ordonné. Les demandes du CLI se relisent quand un fil change d'état ou
 * qu'un événement notable s'y écrit : une demande ouverte en est un, et sa réponse fait
 * repartir le tour. La signature tient dans la clé, ce qui garde la réponse précédente à
 * l'écran le temps de la relecture — et la ligne ne part que quand le journal le dit.
 */
export function useForYou(live: LiveConversation[], focus?: string | null): ForYouRequest[] {
  const signature = live.map((entry) => `${entry.conversation.id}:${entry.status}:${entry.seq}`).join(',')
  const { data: prompts } = useQuery({
    queryKey: ['prompts', 'all', signature],
    queryFn: async () => (await api.get<{ prompts: ConversationPromptDto[] }>('/api/prompts')).prompts,
    placeholderData: (previous) => previous,
  })
  const { data: awaiting } = useAwaiting()

  return useMemo(() => {
    const titles = new Map(live.map((entry) => [entry.conversation.id, entry.conversation.title]))
    return orderForYou(assembleForYou(live, prompts ?? [], awaiting ?? [], titles), focus)
  }, [live, prompts, awaiting, focus])
}
