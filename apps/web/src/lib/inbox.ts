import type { AgentKind, CardDto, ProjectDto, ProjectPullRequestDto } from '@solera/protocol'
import type { LiveConversation } from './activity'
import type { SessionRequest } from './session-request-summary'
import { threadState } from './signals'

/*
 * « Ce qui t'attend » (#163) : la liste unique de ce qui réclame Tim, que l'Aperçu,
 * Travail, le panneau, `/sessions` et le portefeuille montrent tous par `AskInbox`.
 *
 * Le prototype en avait quatre constructeurs, un par écran, qui divergeaient déjà (le
 * jalon d'une session manquait sur `/sessions`, la PR prête au portefeuille). Il n'en
 * reste qu'un, pur, et chaque écran ne choisit que ce qu'il lui passe (`useInbox`).
 */

/** Le jalon d'une demande : de quoi rendre l'étiquette « Jalon #N » et son lien. */
export interface InboxMilestone {
  number: number
  title: string
  to: string
}

/**
 * Une ligne. Les *lourdes* demandent une réponse (`session`, et pour le domaine Jalons
 * `refine`, `draft`, `merge`) ; les *légères* un coup d'œil (`light`).
 */
export type InboxItem =
  | {
      kind: 'session'
      key: string
      conversationId: string
      title: string
      /** Le nom du projet, quand la liste en mêle plusieurs. */
      project: string | null
      agent: AgentKind
      /** `broken` : la session s'est arrêtée (erreur, interruption) et attend qu'on la relance. */
      tone: 'awaiting' | 'broken'
      since: number
      milestone: InboxMilestone | null
      cardNumber: number | null
      /** Le chemin du fil de la session. */
      threadPath: string
      /** La demande ouverte, null quand le journal n'en dit aucune de lisible. */
      request: SessionRequest | null
      /** Seul le propriétaire du fil y répond. */
      canDecide: boolean
    }
  | {
      kind: 'refine'
      key: string
      milestone: InboxMilestone
      /**
       * Les questions encore ouvertes : l'appelant retire celles qui sont répondues, et la
       * dernière répondue referme la ligne.
       */
      questions: { id: string; text: string }[]
      onAnswer: (id: string, text: string) => void
    }
  | {
      kind: 'draft'
      key: string
      milestone: InboxMilestone
      cards: { key: string; title: string; after: string[] }[]
      onValidate: () => void
    }
  | {
      kind: 'merge'
      key: string
      milestone: InboxMilestone
      /** La branche du jalon, et celle où elle se fusionne : la branche par défaut. */
      branch: string
      base: string
      onMerge: () => void
    }
  | {
      kind: 'light'
      key: string
      tone: 'review-card' | 'review-pr'
      title: string
      project: string | null
      /** Le numéro de la carte ou de la PR. */
      number: number
      to: string
      /** Hors de Solera (une PR) : s'ouvre dans un nouvel onglet. */
      external: boolean
      since: number | null
    }

export type SessionInboxItem = Extract<InboxItem, { kind: 'session' }>
export type HeavyInboxItem = Exclude<InboxItem, { kind: 'light' }>
export type LightInboxItem = Extract<InboxItem, { kind: 'light' }>

export interface InboxInput {
  /** Les sessions de la portée, déjà filtrées par l'appelant. */
  live: LiveConversation[]
  requests: ReadonlyMap<string, SessionRequest>
  projects: ReadonlyMap<string, Pick<ProjectDto, 'id' | 'name'>>
  /** Les cartes de la portée ; seules les feuilles à relire deviennent des lignes. */
  reviewCards?: Pick<CardDto, 'id' | 'number' | 'title' | 'projectId' | 'column' | 'columnSince' | 'children'>[]
  /** Les PR de la portée ; seules les prêtes deviennent des lignes. */
  pullRequests?: { projectId: string; pullRequest: ProjectPullRequestDto }[]
  /** Préfixer chaque ligne de son projet : hors d'un projet, la liste les mêle. */
  prefixProject: boolean
  /** Les demandes du domaine Jalons (`refine`, `draft`, `merge`). */
  extra?: HeavyInboxItem[]
}

/**
 * La liste, dans son ordre : les lourdes, puis les légères, chacune de la plus ancienne
 * à la plus récente — ce qui attend depuis le plus longtemps passe d'abord.
 *
 * Une session y entre quand elle te demande quelque chose : une demande ouverte (une
 * décision, une question asynchrone comprises), une attente, ou un arrêt — la même règle
 * que le compteur ambre de l'Activité (`askingCount`).
 */
export function buildInbox(input: InboxInput): InboxItem[] {
  const projectName = (id: string | null) => (input.prefixProject && id ? (input.projects.get(id)?.name ?? null) : null)

  const sessions = input.live.flatMap((entry): SessionInboxItem[] => {
    const { conversation } = entry
    const request = input.requests.get(conversation.id) ?? null
    const state = threadState({ status: entry.status, busy: entry.running, unread: false })
    if (!request && state !== 'broken' && state !== 'awaiting') return []
    const projectId = conversation.projectId
    return [{
      kind: 'session',
      key: `s-${conversation.id}`,
      conversationId: conversation.id,
      title: conversation.title,
      project: projectName(projectId),
      agent: conversation.agent,
      tone: state === 'broken' ? 'broken' : 'awaiting',
      // L'âge de la demande, comme dans l'Activité ; à défaut, la dernière écriture du fil.
      since: request?.requestedAt ?? entry.since,
      milestone:
        conversation.milestone && projectId
          ? {
              number: conversation.milestone.number,
              title: conversation.milestone.title,
              to: `/p/${projectId}/timeline/${conversation.milestone.number}`,
            }
          : null,
      cardNumber: conversation.card?.number ?? null,
      threadPath: projectId ? `/p/${projectId}/c/${conversation.id}` : `/c/${conversation.id}`,
      request,
      canDecide: conversation.isOwner,
    }]
  })

  // Une carte qui a des enfants se déduit d'eux : ce sont eux qu'on relit.
  const cards = (input.reviewCards ?? [])
    .filter((card) => card.column === 'review' && card.children.length === 0)
    .map((card): LightInboxItem => ({
      kind: 'light',
      key: `c-${card.id}`,
      tone: 'review-card',
      title: card.title,
      project: projectName(card.projectId),
      number: card.number,
      to: `/p/${card.projectId}/board?carte=${card.number}`,
      external: false,
      since: card.columnSince,
    }))

  const pullRequests = (input.pullRequests ?? [])
    .filter(({ pullRequest }) => pullRequest.state === 'ready')
    .map(({ projectId, pullRequest }): LightInboxItem => ({
      kind: 'light',
      key: `pr-${projectId}-${pullRequest.number}`,
      tone: 'review-pr',
      title: pullRequest.title,
      project: projectName(projectId),
      number: pullRequest.number,
      to: pullRequest.url,
      external: true,
      since: pullRequest.updatedAt,
    }))

  const bySince = (a: { since: number | null }, b: { since: number | null }) =>
    (a.since ?? Number.POSITIVE_INFINITY) - (b.since ?? Number.POSITIVE_INFINITY)
  return [
    ...sessions.sort(bySince),
    ...(input.extra ?? []),
    ...[...cards, ...pullRequests].sort(bySince),
  ]
}

/** Ce qui demande une réponse, par opposition à ce qui demande un coup d'œil. */
export function isHeavy(item: InboxItem): item is HeavyInboxItem {
  return item.kind !== 'light'
}

/** L'en-tête : « N demande(s) · N à relire ». */
export function inboxSummary(items: InboxItem[]): { requests: number; review: number } {
  const requests = items.filter(isHeavy).length
  return { requests, review: items.length - requests }
}

/** Le jalon d'une demande, pour compter ce qui attend dans chacun (INB-14). */
export function inboxMilestoneNumber(item: InboxItem): number | null {
  if (item.kind === 'light') return null
  return item.milestone?.number ?? null
}

/**
 * Ce qui attend dans chaque jalon, et la première demande à ouvrir : le repère
 * « ● N t'attend » d'un jalon, qui déplie cette ligne (`openInboxItem`) plutôt que de
 * redire la demande.
 */
export function waitingByMilestone(items: InboxItem[]): Map<number, { count: number; key: string }> {
  const waiting = new Map<number, { count: number; key: string }>()
  for (const item of items) {
    const number = inboxMilestoneNumber(item)
    if (number === null) continue
    const current = waiting.get(number)
    waiting.set(number, current ? { ...current, count: current.count + 1 } : { count: 1, key: item.key })
  }
  return waiting
}
