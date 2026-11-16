import {
  cardMentions,
  type AgentKind,
  type CardDto,
  type ConversationDto,
  type ConversationStatus,
  type ProjectPullRequestDto,
  type WorktreeStatusDto,
  type WorktreeStatusListDto,
} from '@solera/protocol'
import { isOpen, liveSessions, loadedStatus, type StatusOf } from './card-state'
import type { ChatItem } from './chat-fold'
import type { MilestoneEntry } from './milestone-model'

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

/** Ce que compte la pastille de *Projet* : les cartes qui attendent une relecture. */
export function toReviewCount(cards: CardDto[] | undefined): number {
  return cards?.filter((card) => card.column === 'review').length ?? 0
}

/**
 * Les cartes prêtes à partir (PPR-3) : à faire, acceptées, rien à préciser, aucun
 * bloqueur ouvert, aucune session vivante — dans l'ordre du tableau. Un regroupement
 * n'en est pas une : ce sont ses enfants qui partent.
 */
export function readyCards(cards: readonly CardDto[], statusOf: StatusOf = loadedStatus): CardDto[] {
  return cards
    .filter(
      (card) =>
        card.children.length === 0 &&
        card.column === 'todo' &&
        card.acceptedAt !== null &&
        card.toClarifySince === null &&
        !card.blockedBy.some(isOpen) &&
        liveSessions(card, statusOf).length === 0,
    )
    .sort((a, b) => a.position - b.position)
}

/** Une autre session du projet qui tourne ou attend, en une ligne. */
export interface ActiveSessionRow {
  id: string
  title: string
  agent: AgentKind
  awaiting: boolean
  /** Le numéro de sa carte, quand elle en traite une. */
  card: number | null
}

/**
 * Les autres sessions actives du projet (PPR-3) : celles qui attendent quelqu'un d'abord,
 * puis celles qui travaillent, sans la session du panneau ni les rangées.
 */
export function otherActiveSessions(
  live: readonly { conversation: Pick<ConversationDto, 'id' | 'title' | 'agent' | 'archivedAt' | 'card'>; status: ConversationStatus }[],
  conversationId: string,
): ActiveSessionRow[] {
  const rows = live.flatMap(({ conversation, status }): ActiveSessionRow[] =>
    conversation.id !== conversationId &&
    conversation.archivedAt === null &&
    (status === 'running' || status === 'awaiting_input')
      ? [{
          id: conversation.id,
          title: conversation.title,
          agent: conversation.agent,
          awaiting: status === 'awaiting_input',
          card: conversation.card?.number ?? null,
        }]
      : [],
  )
  return rows.sort((a, b) => Number(b.awaiting) - Number(a.awaiting))
}

/** L'arbre où travaille la session ; null à la racine du projet, ou avant la lecture. */
export function sessionWorktree(list: Pick<WorktreeStatusListDto, 'worktrees'> | undefined, conversationId: string): WorktreeStatusDto | null {
  return list?.worktrees.find((tree) => tree.conversations.some((entry) => entry.id === conversationId)) ?? null
}

/** Les checks d'une PR, « réussis / total » ; null quand la forge n'en dit rien. */
export function pullRequestChecks(pr: Pick<ProjectPullRequestDto, 'checks'>): { passed: number; total: number } | null {
  const total = pr.checks.passed + pr.checks.pending + pr.checks.failed.length
  return total === 0 ? null : { passed: pr.checks.passed, total }
}

/**
 * La carte de la session est-elle dans ce jalon ? La carte-jalon elle-même en fait
 * partie. Null sans carte : la ligne du jalon n'a alors rien à en dire.
 */
export function sessionInMilestone(entry: Pick<MilestoneEntry, 'card' | 'children'>, card: Pick<CardDto, 'id'> | null): boolean | null {
  if (!card) return null
  return entry.card.id === card.id || entry.children.some((child) => child.id === card.id)
}
