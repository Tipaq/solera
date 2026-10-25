import type {
  CardColumn,
  ConversationStatus,
  MilestoneBlockReason,
  MilestoneCardStatus,
} from '@solera/protocol'

/**
 * Le graphe d'un jalon et l'état de ses cartes, en fonctions pures : le pilotage les
 * applique à ce qu'il lit en base à chaque tour, et les tests les éprouvent sans base.
 */

/** Une session au repos juste après son lancement n'a pas encore démarré son tour. */
export const LAUNCH_GRACE_MS = 60_000

export interface GraphEdge {
  /** La carte qui bloque. */
  sourceId: string
  /** La carte bloquée. */
  targetId: string
}

/**
 * L'étage de chaque carte dans le graphe des blocages internes au jalon : 0 sans
 * bloqueur, puis un de plus que son bloqueur le plus haut. Les cartes prises dans un
 * cycle n'ont pas d'étage et sont rendues à part, triées.
 *
 * `addCardBlock` ne refuse que le cycle direct ; un cycle plus long reste possible, et
 * c'est ici qu'il se voit.
 */
export function layerCards(ids: string[], edges: GraphEdge[]): { layers: Map<string, number>; cycle: string[] } {
  const inside = new Set(ids)
  const internal = edges.filter((edge) => inside.has(edge.sourceId) && inside.has(edge.targetId))
  const pending = new Map<string, number>(ids.map((id) => [id, 0]))
  for (const edge of internal) pending.set(edge.targetId, (pending.get(edge.targetId) ?? 0) + 1)

  const layers = new Map<string, number>()
  let frontier = ids.filter((id) => pending.get(id) === 0)
  for (const id of frontier) layers.set(id, 0)
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      for (const edge of internal) {
        if (edge.sourceId !== id) continue
        const left = (pending.get(edge.targetId) ?? 0) - 1
        pending.set(edge.targetId, left)
        layers.set(edge.targetId, Math.max(layers.get(edge.targetId) ?? 0, (layers.get(id) ?? 0) + 1))
        if (left === 0) next.push(edge.targetId)
      }
    }
    frontier = next
  }
  const cycle = ids.filter((id) => (pending.get(id) ?? 0) > 0)
  for (const id of cycle) layers.delete(id)
  return { layers, cycle }
}

/** Ce qui sert à déduire l'état d'une carte lancée. */
export interface CardFacts {
  column: CardColumn
  toClarify: boolean
  launch: 'queued' | 'launching' | 'launched' | 'failed'
  launchedAt: number | null
  /** Des bloqueurs pas encore terminés, dans le jalon ou ailleurs. */
  blocked: boolean
  /** La session qui porte la carte, la plus récente ; null si elle n'en a pas ou plus. */
  session: { status: ConversationStatus } | null
  /** L'état de la revue de sa PR la plus récente, s'il y en a une. */
  review: string | null
}

export interface DerivedStatus {
  status: MilestoneCardStatus
  blockReason: MilestoneBlockReason | null
}

/**
 * Où en est une carte, d'après ce que disent la carte, sa session et sa revue.
 *
 * Rien de tout ça n'est stocké par le pilotage : une session reprise à la main, une
 * revue relancée ou une carte terminée ailleurs s'y lisent d'elles-mêmes.
 */
export function deriveStatus(facts: CardFacts, now: number): DerivedStatus {
  const ok = (status: MilestoneCardStatus): DerivedStatus => ({ status, blockReason: null })
  const blocked = (blockReason: MilestoneBlockReason): DerivedStatus => ({ status: 'blocked', blockReason })

  if (facts.column === 'done') return ok('done')
  if (facts.column === 'abandoned') return ok('abandoned')
  if (facts.launch === 'failed') return ok('failed')
  if (facts.launch === 'launching') return ok('launching')
  if (facts.launch === 'queued') return ok(facts.blocked ? 'waiting' : 'queued')

  if (facts.toClarify) return blocked('to_clarify')
  const status = facts.session?.status ?? null
  // Une session qui attend une personne ou qui s'est arrêtée bloque, revue ou pas.
  if (status === 'awaiting_input') return blocked('awaiting_input')
  if (status === 'error') return blocked('error')
  if (status === 'interrupted') return blocked('interrupted')

  switch (facts.review) {
    case 'to_merge':
    case 'merging':
    case 'merged':
      return ok('merging')
    case 'reviewing':
    case 'changes':
      return ok('reviewing')
    case 'escalated':
      return blocked('escalated')
    case 'merge_failed':
      return blocked('merge_failed')
    case 'closed':
      return blocked('review_closed')
    case 'approved':
      // Au vert sans fusion prévue : la PR ne visait pas la branche du jalon, une
      // personne doit s'en occuper.
      return blocked('idle')
  }

  if (status === 'running') return ok('working')
  if (facts.launchedAt !== null && now - facts.launchedAt < LAUNCH_GRACE_MS && status !== null) return ok('working')
  return blocked('idle')
}
