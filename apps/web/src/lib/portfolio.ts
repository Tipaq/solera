import { useMemo } from 'react'
import type { CardDto, ProjectDto } from '@solera/protocol'
import { useAllCards } from './cards'
import { useAllConversations } from './conversations'
import { useLiveConversations } from './activity'
import { useProjects } from './projects'

/** Une carte du portefeuille, qui sait d'où elle vient. */
export type PortfolioCard = CardDto & { project: ProjectDto }

/**
 * Ce qu'une carte demande à une personne, et dans quel ordre on s'en occupe.
 *
 * Groupé par la **demande** et non par la colonne : c'est ce qui distingue la vue
 * *Travail* du board global, qui montre les mêmes cartes rangées par état. L'une répond
 * à « où en est le chantier », l'autre à « par quoi je m'y remets ».
 *
 * La maquette F7 nommait un quatrième groupe, « À trancher — une carte de décision
 * attend une personne ». Il n'est pas là, et **il ne viendra pas** : rien ne distingue
 * une carte de décision d'une autre, et la carte #32 a refusé ce qui aurait pu le faire
 * — les étiquettes, écartées le 2026-10-15
 * (`docs/audits/2026-10-15-champs-de-carte/`). Le seul classement qu'une carte gagnera
 * est le jalon, qui dit à quelle livraison elle appartient, pas ce qu'elle réclame.
 *
 * Ce qui attend une personne se lit donc là où c'est vrai : dans l'état des sessions
 * rattachées, ci-dessous.
 */
export type WorkKind = 'awaiting' | 'review' | 'running'

export const WORK_KINDS: readonly WorkKind[] = ['awaiting', 'review', 'running']

export const WORK_LABELS = {
  awaiting: 'portfolio.work.awaiting',
  review: 'portfolio.work.review',
  running: 'portfolio.work.running',
} as const satisfies Record<WorkKind, string>

/** Teinte du point de groupe : ce qui attend un humain, ce qui tourne tout seul. */
export const WORK_DOTS: Record<WorkKind, string> = {
  awaiting: 'bg-caution',
  review: 'bg-caution',
  running: 'bg-accent',
}

export interface WorkItem {
  card: PortfolioCard
  /** Ce que la ligne dit à droite : l'état des sessions rattachées, ou leur nombre. */
  sessions: number
  awaiting: boolean
  running: boolean
}

/**
 * Les cartes qui réclament une personne, tous projets confondus.
 *
 * Une carte n'apparaît que dans **un** groupe, le premier qui la réclame : une carte
 * dont la session attend une réponse n'a pas aussi besoin d'être comptée « en cours »,
 * et la lire deux fois ferait douter du total.
 */
export function useWorkGroups(): {
  groups: { kind: WorkKind; items: WorkItem[] }[]
  total: number
  isPending: boolean
} {
  const { data: projects } = useProjects()
  const { data: conversations } = useAllConversations()
  const visible = useMemo(
    () => (projects ?? []).filter((project) => !project.archivedAt),
    [projects],
  )
  const { cards, isPending } = useAllCards(visible)
  const live = useLiveConversations(conversations ?? [])

  return useMemo(() => {
    // L'état vivant par conversation : une carte le lit pour celles qui lui sont
    // rattachées, plutôt que de se fier au `status` figé par la dernière requête.
    const byId = new Map(live.map((entry) => [entry.conversation.id, entry]))
    const buckets = new Map<WorkKind, WorkItem[]>(WORK_KINDS.map((kind) => [kind, []]))

    for (const card of cards) {
      if (card.column === 'done' || card.column === 'abandoned') continue
      const attached = card.conversations
        .map((session) => byId.get(session.id))
        .filter((entry) => entry !== undefined)
      const awaiting = attached.some((entry) => entry.awaiting)
      const running = attached.some((entry) => entry.running)
      const item: WorkItem = { card, sessions: card.conversations.length, awaiting, running }

      if (awaiting) buckets.get('awaiting')!.push(item)
      else if (card.column === 'review') buckets.get('review')!.push(item)
      else if (running) buckets.get('running')!.push(item)
    }

    const groups = WORK_KINDS.map((kind) => ({ kind, items: buckets.get(kind)! }))
    return {
      groups,
      total: groups.reduce((sum, group) => sum + group.items.length, 0),
      isPending,
    }
  }, [cards, live, isPending])
}
