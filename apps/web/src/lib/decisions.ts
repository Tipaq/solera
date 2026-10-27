import { useEffect, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AwaitingRequestDto, DecisionDto, RequestHistoryDto } from '@solera/protocol'
import { api } from './api'
import { formatAgo } from './loops'
import { translate } from './i18n'
import { wsClient } from './ws-client'

/**
 * Les décisions qu'une session demande (`request_decision`), et ce qui t'attend dans
 * l'Activité (#121), qui y ajoute les accords en attente.
 *
 * Tout ce qui attend une personne est relu sur le signal `awaiting-changed` du socket,
 * et toutes les minutes en repli : une échéance passe sans que personne n'ait rien fait,
 * et le serveur ne prévient que de ce qu'il a lui-même changé.
 */

export const AWAITING_KEY = ['awaiting']
const DECISIONS_KEY = ['decisions']

export function useAwaiting() {
  return useQuery({
    queryKey: AWAITING_KEY,
    queryFn: async () => (await api.get<{ requests: AwaitingRequestDto[] }>('/api/awaiting')).requests,
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

/** L'historique de ce qui t'attend, accords compris : la page `/decisions` (#121). */
export function useRequestHistory(scope: 'pending' | 'all') {
  return useQuery({
    queryKey: [...DECISIONS_KEY, 'history', scope],
    queryFn: async () =>
      (await api.get<{ entries: RequestHistoryDto[] }>(`/api/awaiting/history?status=${scope}`)).entries,
    staleTime: 15_000,
  })
}

export function useDecision(id: string | null) {
  return useQuery({
    queryKey: ['decision', id],
    queryFn: () => api.get<DecisionDto>(`/api/decisions/${id}`),
    enabled: id !== null,
  })
}

export function useAnswerDecision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, option, text }: { id: string; option: string | null; text: string }) =>
      api.post<DecisionDto>(`/api/decisions/${id}/answer`, { option, text }),
    onSuccess: (decision) => {
      queryClient.setQueryData(['decision', decision.id], decision)
      void queryClient.invalidateQueries({ queryKey: AWAITING_KEY })
      return queryClient.invalidateQueries({ queryKey: DECISIONS_KEY })
    },
  })
}

/**
 * Suit les changements poussés par le serveur, et tient la pastille de l'icône de
 * l'application installée au nombre de décisions en attente (Badging API). Monté une
 * fois, dans la coque.
 *
 * La pastille ne compte que les décisions, pas les rangements : ce sont elles qui ont
 * une échéance, et qu'on laisse filer sans s'en apercevoir.
 */
export function useAwaitingLive(): void {
  const queryClient = useQueryClient()
  const { data } = useAwaiting()
  useEffect(
    () =>
      wsClient.onAwaitingChanged(() => {
        void queryClient.invalidateQueries({ queryKey: AWAITING_KEY })
        void queryClient.invalidateQueries({ queryKey: DECISIONS_KEY })
        void queryClient.invalidateQueries({ queryKey: ['decision'] })
      }),
    [queryClient],
  )
  const count = (data ?? []).filter((entry) => entry.kind === 'decision').length
  useEffect(() => {
    const badge = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (count > 0) void badge.setAppBadge?.(count).catch(() => {})
    else void badge.clearAppBadge?.().catch(() => {})
  }, [count])
}

/** « Expire dans 23 h », « Échéance passée » ou « Sans échéance », pour une décision en attente. */
export function decisionDue(expiresAt: number | null, now = Date.now()): string {
  if (expiresAt === null) return translate('decision.noDeadline')
  const left = expiresAt - now
  return left > 0
    ? translate('decision.expiresIn', { left: formatAgo(left) })
    : translate('decision.expiring')
}

// --- La décision ouverte, partagée hors de React -----------------------------------

let openId: string | null = null
const listeners = new Set<() => void>()

/** Ouvre le dialogue d'une décision, d'où qu'on le demande : colonne, toast, fil, historique. */
export function openDecision(id: string | null): void {
  openId = id
  for (const listener of listeners) listener()
}

export function useOpenDecision(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => openId,
    () => openId,
  )
}
