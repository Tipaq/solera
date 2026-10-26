import type { MessageKey } from './i18n'

/**
 * Pourquoi une demande d'agent n'est plus applicable (#119), commun aux trois blocs du
 * fil : rangement de conversation, changement de cartes, brouillon. Le serveur envoie
 * un code, que chaque bloc traduit ici avant de se replier sur ses motifs propres.
 */
const STALE_KEYS: Record<string, MessageKey> = {
  conversation_archived: 'requests.stale.conversationArchived',
  conversation_deleted: 'requests.stale.conversationDeleted',
  project_changed: 'requests.stale.projectChanged',
  option_disabled: 'requests.stale.optionDisabled',
  background_running: 'requests.stale.backgroundRunning',
}

export function staleReasonLabel(reason: string, t: (key: MessageKey) => string): string | null {
  const key = STALE_KEYS[reason]
  return key ? t(key) : null
}
