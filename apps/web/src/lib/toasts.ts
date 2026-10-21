import { useSyncExternalStore } from 'react'
import type { InAppNotification } from '@solera/protocol'

/**
 * Les toasts de l'application : un CLI qui attend dans une autre conversation. Le
 * serveur ne les envoie qu'aux onglets visibles ; ils restent jusqu'à ce qu'on les
 * traite ou les écarte, une demande n'étant pas une information qu'on laisse filer en
 * cinq secondes.
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
 * La clé de ce que le toast annonce : une conversation n'en garde qu'un, le plus
 * récent. Une sorte nouvelle aura sa propre clé.
 */
function keyOf(notification: InAppNotification): string {
  return `cli:${notification.conversationId}`
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

/** La conversation qu'on vient d'ouvrir n'a plus rien à annoncer. */
export function dismissConversationToasts(conversationId: string): void {
  const next = toasts.filter((toast) => toast.notification.conversationId !== conversationId)
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
