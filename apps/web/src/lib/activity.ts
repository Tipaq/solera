import { useMemo, useSyncExternalStore } from 'react'
import type { CardDto, ConversationDto, ConversationStatus, ProjectDto } from '@solera/protocol'
import { liveBackground, liveSeq, liveSettledAt, liveStatus, subscribeStatus } from './conversation-status'
import { isUnread } from './reads'
import { threadState } from './signals'

/**
 * Ce que les pages de lieu lisent d'une conversation : son statut vivant, et non celui
 * figé par la dernière requête REST.
 *
 * Les pages agrègent ; elles ne peuvent donc pas s'abonner ligne par ligne comme une
 * vue de conversation. Le socket pousse par identifiant, et c'est à l'agrégat de
 * recomposer son instantané — ce que fait `useLiveConversations`.
 */
export interface LiveConversation {
  conversation: ConversationDto
  status: ConversationStatus
  running: boolean
  awaiting: boolean
  /** Non lue : des messages ont été poussés depuis la dernière visite. */
  unread: boolean
  /** Quand elle s'est posée, pour écrire son ancienneté. */
  settledAt: number
  /** Depuis quand elle est dans cet état : la dernière écriture du journal. */
  since: number
}

/**
 * Les conversations, relues à chaque poussée du socket.
 *
 * L'instantané est une chaîne et non un tableau d'objets : `useSyncExternalStore`
 * compare par identité, et un tableau recomposé à chaque lecture rendrait sans fin.
 *
 * Une session rangée qui travaille encore reste comptée — c'est elle qui réclame, pas
 * son classement.
 */
export function useLiveConversations(
  conversations: ConversationDto[],
  /** La conversation ouverte, qui n'est jamais « non lue » : on est dedans. */
  openId?: string,
): LiveConversation[] {
  const snapshot = () =>
    JSON.stringify(
      conversations.map((entry) => ({
        status: liveStatus(entry.id) ?? entry.status,
        background: liveBackground(entry.id) > 0,
        unread: entry.id !== openId && isUnread(entry, liveSeq(entry.id)),
        settledAt: liveSettledAt(entry.id),
      })),
    )
  const serialized = useSyncExternalStore(subscribeStatus, snapshot, snapshot)

  return useMemo(() => {
    const states = JSON.parse(serialized) as {
      status: ConversationStatus
      background: boolean
      unread: boolean
      settledAt: number
    }[]
    return conversations.flatMap((conversation, index) => {
      const state = states[index]!
      const awaiting = state.status === 'awaiting_input'
      const running = !awaiting && (state.status === 'running' || state.background)
      // Une session archivée qui travaille encore compte bien dans le total global.
      if (conversation.archivedAt && !running && !awaiting) return []
      return [{
        conversation,
        status: state.status,
        running,
        awaiting,
        // Suspendu tant que ça produit : voir `isUnreadSettled`. L'attente, elle, garde
        // sa marque — c'est le seul cas où un fil occupé réclame bien un regard.
        unread: state.unread && !running,
        settledAt: state.settledAt,
        since: conversation.updatedAt,
      }]
    })
  }, [conversations, serialized])
}

/**
 * Ce qui réclame, dans un projet ou dans tous.
 *
 * Quatre demandes et pas un inventaire : « 7 cartes » dit ce qui existe, « 1 attend ta
 * réponse depuis 1 h » dit ce qu'on a à faire. Chaque compte à zéro fait disparaître sa
 * tuile, c'est pour ça qu'ils sont rendus tels quels et non enveloppés.
 */
export interface Demands {
  awaiting: LiveConversation[]
  running: LiveConversation[]
  /** Cartes en colonne « à relire » : la file d'attente humaine. */
  review: CardDto[]
  /** Fichiers non commités du workspace, zéro hors dépôt git. */
  uncommitted: number
}

/** Le plus ancien horodatage d'une liste, ou null si elle est vide. */
export function oldest(entries: LiveConversation[]): number | null {
  if (entries.length === 0) return null
  return entries.reduce((min, entry) => Math.min(min, entry.since), Number.POSITIVE_INFINITY)
}

export function demandsOf(
  live: LiveConversation[],
  cards: CardDto[],
  project: ProjectDto | undefined,
): Demands {
  return {
    awaiting: live.filter((entry) => entry.awaiting),
    running: live.filter((entry) => entry.running),
    review: cards.filter((card) => card.column === 'review'),
    uncommitted: project?.git?.changedFiles ?? 0,
  }
}

/**
 * Les sessions qui te demandent quelque chose : une question, une permission, **ou une
 * erreur** — dans les deux cas c'est à toi d'agir. Le compteur ambre de l'onglet
 * Activité, et son premier groupe.
 */
export function askingCount(live: LiveConversation[]): number {
  return live.filter((entry) => {
    const state = threadState({ status: entry.status, busy: entry.running, unread: false })
    return state === 'broken' || state === 'awaiting'
  }).length
}
