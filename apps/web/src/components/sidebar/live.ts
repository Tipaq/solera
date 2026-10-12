import { useSyncExternalStore } from 'react'
import type { ConversationDto } from '@solera/protocol'
import { liveBackground, liveStatus, subscribeStatus } from '../../lib/conversation-status'

/**
 * Les sessions qui travaillent ou qui attendent une réponse, en direct.
 *
 * La zone basse s'en sert pour **ne pas** les lister : elles sont déjà dans l'activité,
 * juste au-dessus, et les répéter était le défaut corrigé au cinquième tour. Le statut
 * du socket prime sur celui de la liste REST, qui date de son chargement.
 *
 * Un instantané en chaîne plutôt qu'un `Set` : `useSyncExternalStore` compare par
 * identité, et un `Set` reconstruit à chaque appel re-rendrait toute la colonne à chaque
 * jeton reçu.
 */
export function useActiveIds(conversations: ConversationDto[]): Set<string> {
  const snapshot = () => conversations
    .filter((entry) => {
      const status = liveStatus(entry.id) ?? entry.status
      return status === 'running' || status === 'awaiting_input' || liveBackground(entry.id) > 0
    })
    .map((entry) => entry.id)
    .join(' ')
  const serialized = useSyncExternalStore(subscribeStatus, snapshot, snapshot)
  return new Set(serialized ? serialized.split(' ') : [])
}
