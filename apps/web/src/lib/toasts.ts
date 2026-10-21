import { useSyncExternalStore } from 'react'
import type { InAppNotification } from '@solera/protocol'

/**
 * Les toasts de l'application : un CLI qui attend dans une autre conversation, une
 * décision qu'une session demande. Le serveur ne les envoie qu'aux onglets visibles ;
 * ils restent jusqu'à ce qu'on les traite ou les écarte, une demande n'étant pas une
 * information qu'on laisse filer en cinq secondes.
 *
 * Une fin de tour n'en fait jamais : la sidebar la montre déjà, et un toast par tour
 * fini apprendrait vite à les écarter sans les lire.
 */

export interface Toast {
  id: string
  notification: InAppNotification
  at: number
}

let toasts: Toast[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * La clé de ce que le toast annonce : une conversation ne garde qu'une demande de CLI,
 * la plus récente ; une décision a la sienne, puisqu'elle se tranche pour elle-même.
 */
function keyOf(notification: InAppNotification): string {
  return notification.kind === 'decision'
    ? `decision:${notification.decisionId}`
    : `cli:${notification.conversationId}`
}

export function pushToast(notification: InAppNotification): void {
  const id = keyOf(notification)
  toasts = [...toasts.filter((toast) => toast.id !== id), { id, notification, at: Date.now() }]
  emit()
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

/**
 * La conversation qu'on vient d'ouvrir n'a plus de demande de CLI à annoncer. Une
 * décision, elle, ne se règle pas en ouvrant le fil : son toast reste.
 */
export function dismissConversationToasts(conversationId: string): void {
  const next = toasts.filter(
    (toast) =>
      toast.notification.kind !== 'cliRequest' || toast.notification.conversationId !== conversationId,
  )
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

/**
 * Les décisions tranchées, ici ou ailleurs, n'ont plus de toast : on les a traitées.
 *
 * `fetchedAt` est l'heure de la liste relue : un toast plus récent qu'elle annonce une
 * décision qu'elle ne pouvait pas encore connaître, et il reste — le toast arrive par le
 * socket avant que la liste ait fini de se relire.
 */
export function keepDecisionToasts(pending: ReadonlySet<string>, fetchedAt: number): void {
  const next = toasts.filter(
    (toast) =>
      toast.notification.kind !== 'decision' ||
      pending.has(toast.notification.decisionId) ||
      toast.at > fetchedAt,
  )
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts,
    () => toasts,
  )
}
