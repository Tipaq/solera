import { cardMentions, type CardConversationDto, type CardDto } from '@solera/protocol'
import type { ChatItem } from './chat-fold'

/** Une étape du plan que l'agent s'est donné, quelle que soit la forme qu'il lui donne. */
export interface AgentPlanStep {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Le plan lu dans le fil, et s'il date d'un tour déjà clos par un nouveau message. */
export interface AgentPlan {
  steps: AgentPlanStep[]
  /**
   * Vrai quand un message de l'utilisateur l'a suivi : l'agent travaille désormais sur
   * autre chose, et ce plan raconte la demande d'avant, pas celle en cours.
   */
  previousTurn: boolean
}

/**
 * Le dernier plan que l'agent a publié dans ce fil, ou null s'il n'en a jamais tenu.
 *
 * Deux sources pour la même chose : Claude Code et OpenCode écrivent leur liste par
 * l'outil `TodoWrite`, Codex par l'événement `plan.updated`. Seul le dernier compte —
 * chacun réécrit la liste entière, il ne l'amende pas. Un sous-agent tient sa propre
 * liste : elle n'est pas celle de la session, on l'ignore.
 */
export function latestAgentPlan(items: ChatItem[]): AgentPlan | null {
  let previousTurn = false
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]
    if (!item) continue
    if (item.kind === 'message' && item.role === 'user' && item.parentToolCallId === null) {
      previousTurn = true
      continue
    }
    if (item.kind === 'plan_progress') {
      return item.items.length > 0
        ? { steps: item.items.map((step) => ({ text: step.text, status: step.status })), previousTurn }
        : null
    }
    if (item.kind === 'tool' && item.name === 'TodoWrite' && item.parentToolCallId === null) {
      const todos = (item.input as { todos?: unknown } | null)?.todos
      if (!Array.isArray(todos)) continue
      const steps = todos.flatMap((entry): AgentPlanStep[] => {
        if (!entry || typeof entry !== 'object') return []
        const { content, activeForm, status } = entry as Record<string, unknown>
        const text = typeof content === 'string' ? content : typeof activeForm === 'string' ? activeForm : null
        if (!text) return []
        return [{ text, status: status === 'completed' || status === 'in_progress' ? status : 'pending' }]
      })
      return steps.length > 0 ? { steps, previousTurn } : null
    }
  }
  return null
}

/**
 * Le plan qui mérite encore d'être lu à côté de la carte.
 *
 * Celui d'un tour clos et entièrement coché ne dit plus rien : le travail qu'il décrivait
 * est fait, et il se lirait comme le programme de la demande en cours. D'un tour clos mais
 * inachevé, il reste montré — ce qui n'a pas été fait est justement ce qu'on veut voir —
 * avec la mention de son tour.
 */
export function visibleAgentPlan(items: ChatItem[]): AgentPlan | null {
  const plan = latestAgentPlan(items)
  if (!plan) return null
  if (plan.previousTurn && plan.steps.every((step) => step.status === 'completed')) return null
  return plan
}

/**
 * La carte que cette session semble traiter sans l'avoir déclarée.
 *
 * La seule devinette qui se justifie d'une phrase : la carte la plus citée en `#12`
 * dans le fil, parmi celles qui restent à faire. Rien de plus malin — un titre proche
 * ou des fichiers en commun se tromperaient avec aplomb, et une proposition qu'on ne
 * comprend pas est une proposition qu'on finit par ne plus lire.
 */
export function suggestCard(items: ChatItem[], cards: CardDto[]): { card: CardDto; mentions: number } | null {
  const open = new Map(
    cards.filter((card) => card.column !== 'done' && card.column !== 'abandoned').map((card) => [card.number, card]),
  )
  const counts = new Map<number, number>()
  for (const item of items) {
    if (item.kind !== 'message' || item.parentToolCallId !== null) continue
    for (const block of item.blocks) {
      if (block.type !== 'text') continue
      // Chaque occurrence compte, et non chaque message : c'est le nombre de fois où
      // la carte revient qui dit qu'on travaille dessus.
      for (const number of cardMentions(block.text)) {
        if (open.has(number)) counts.set(number, (counts.get(number) ?? 0) + 1)
      }
    }
  }
  let best: { card: CardDto; mentions: number } | null = null
  for (const [number, mentions] of counts) {
    if (!best || mentions > best.mentions) best = { card: open.get(number)!, mentions }
  }
  return best
}

const WEEK = 7 * 24 * 60 * 60 * 1000

/**
 * Une session qui tourne ou attend quelqu'un, et n'est pas archivée.
 *
 * `interrupted` et `error` n'en sont pas : un redémarrage du daemon laisse `interrupted`
 * à toute session alors en cours, jusqu'au message suivant — sa carte pulserait sinon
 * dans « maintenant » sans que rien ne tourne.
 */
export function isLiveSession(session: CardConversationDto): boolean {
  return !session.archivedAt && (session.status === 'running' || session.status === 'awaiting_input')
}

/** Ce que compte la pastille de *Projet* : les cartes qui attendent une relecture. */
export function toReviewCount(cards: CardDto[] | undefined): number {
  return cards?.filter((card) => card.column === 'review').length ?? 0
}

/**
 * Le projet vu depuis une session : ce qui touche sa carte, ce qui bouge, le reste.
 *
 * Une carte n'apparaît qu'une fois, au plus près : citée autour de la carte, elle ne
 * se répète pas dans « maintenant », et ce qui est dans « maintenant » n'est pas
 * recompté dans le reste. Sans quoi la même ligne revient trois fois dans un panneau
 * de quarante lignes.
 */
export function projectOverview(cards: CardDto[], current: CardDto | null, now = Date.now()) {
  const shown = new Set<string>(current ? [current.id] : [])
  const around: { relation: 'parent' | 'children' | 'blockedBy' | 'blocks' | 'references' | 'referencedBy'; card: CardDto }[] = []
  if (current) {
    const byId = new Map(cards.map((card) => [card.id, card]))
    const add = (relation: (typeof around)[number]['relation'], id: string) => {
      const card = byId.get(id)
      if (!card || shown.has(id)) return
      shown.add(id)
      around.push({ relation, card })
    }
    if (current.parent) add('parent', current.parent.id)
    for (const link of current.children) add('children', link.id)
    for (const link of current.blockedBy) add('blockedBy', link.id)
    for (const link of current.blocks) add('blocks', link.id)
    for (const link of current.references) add('references', link.id)
    for (const link of current.referencedBy) add('referencedBy', link.id)
  }

  const review = cards.filter((card) => card.column === 'review' && !shown.has(card.id))
  // Une session vivante suffit, quelle que soit la colonne : une carte encore « à
  // faire » sur laquelle un agent travaille bouge bel et bien maintenant.
  const active = cards.filter((card) =>
    (card.column === 'todo' || card.column === 'in_progress')
    && card.conversations.some(isLiveSession) && !shown.has(card.id))
  for (const card of [...review, ...active]) shown.add(card.id)

  const rest = (column: CardDto['column']) => cards.filter((card) => card.column === column && !shown.has(card.id))
  return {
    around,
    review,
    active,
    todo: rest('todo'),
    inProgress: rest('in_progress'),
    doneThisWeek: rest('done').filter((card) => now - card.columnSince < WEEK),
  }
}
