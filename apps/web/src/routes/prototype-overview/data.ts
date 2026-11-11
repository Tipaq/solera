/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les données des variantes de l'Aperçu, lues une fois : les variantes ne partagent que
 * ça, chacune choisit sa mise en page. Tout vient des requêtes réelles ; les seules
 * déductions sont marquées « HEURISTIQUE ».
 */
import { useMemo } from 'react'
import type {
  CardDto,
  ProjectDto,
  ProjectPullRequestDto,
  ScheduledTaskDto,
  WorktreeStatusDto,
} from '@solera/protocol'
import { useActivityRows, type ActivityRow } from '../../lib/activity-rows'
import { useCards } from '../../lib/cards'
import { pullRequestFor, usePullRequests } from '../../lib/pull-requests'
import { useSchedules } from '../../lib/schedules'
import { milestonesOf, type Milestone } from '../../lib/timeline'
import { useWorktreeStatuses } from '../../lib/worktrees'
import { cardDestination } from '../prototype-milestones/destination'

/** Une chose qui réclame un geste de toi. */
export interface AskItem {
  key: string
  kind: 'awaiting' | 'broken' | 'review-card' | 'review-pr'
  title: string
  detail: string
  to: string
  since: number | null
}

/** Une ligne du « code en cours » : la racine, ou un worktree. */
export interface CodeLine {
  key: string
  root: boolean
  branch: string
  ahead: number
  behind: number
  /** Modifiés + non suivis. */
  dirty: number
  conflicts: boolean
  pr: ProjectPullRequestDto | null
  sessions: ActivityRow[]
  card: CardDto | null
  lastActivityAt: number | null
  /** Le diff de l'arbre, ou le fil de sa session la plus récente. */
  to: string
  /** L'arbre lui-même : `null` pour la racine. */
  treeId: string | null
  path: string | null
}

export interface OverviewData {
  project: ProjectDto
  projectId: string
  asks: AskItem[]
  code: CodeLine[]
  /** Arbres fusionnés ou vides, comptés à part : rien à y faire sinon nettoyer. */
  settledTrees: number
  milestone: Milestone | null
  milestoneCount: number
  nextTask: ScheduledTaskDto | null
  taskCount: number
  openCards: number
  rows: ActivityRow[]
}

export function useOverviewData(projectId: string, project: ProjectDto): OverviewData {
  const rows = useActivityRows(projectId, project)
  const { data: cards } = useCards(projectId)
  const { data: trees } = useWorktreeStatuses(project.git ? projectId : undefined)
  const { data: pullRequests } = usePullRequests(project.git ? projectId : undefined)
  const { data: schedules } = useSchedules()

  return useMemo(() => {
    const allCards = cards ?? []
    const byNumber = new Map(allCards.map((card) => [card.number, card]))

    /* À toi : les sessions qui demandent (question, permission, erreur), les cartes à
       relire, les PR prêtes. Pas les sessions qui travaillent : elles ne demandent rien. */
    const asks: AskItem[] = []
    for (const row of rows) {
      if (row.group !== 'asking') continue
      asks.push({
        key: `s-${row.entry.conversation.id}`,
        kind: row.marker === 'broken' ? 'broken' : 'awaiting',
        title: row.entry.conversation.title,
        detail: row.summary?.text ?? (row.marker === 'broken' ? 'Session tombée' : 'Attend ta réponse'),
        to: `/p/${projectId}/c/${row.entry.conversation.id}`,
        since: row.entry.since,
      })
    }
    for (const card of allCards) {
      if (card.column !== 'review' || card.children.length > 0) continue
      asks.push({
        key: `c-${card.id}`,
        kind: 'review-card',
        title: card.title,
        detail: `Carte #${card.number} à relire`,
        to: cardDestination(projectId, card),
        since: card.columnSince,
      })
    }
    for (const pr of pullRequests?.available ? pullRequests.pullRequests : []) {
      if (pr.state !== 'ready') continue
      asks.push({
        key: `p-${pr.number}`,
        kind: 'review-pr',
        title: pr.title,
        detail: `PR #${pr.number} prête à fusionner`,
        to: pr.url,
        since: pr.updatedAt,
      })
    }
    asks.sort((a, b) => (a.since ?? Infinity) - (b.since ?? Infinity))

    /* Le code en cours : la racine d'abord, puis les arbres qui portent encore quelque
       chose (modifs, commits non fusionnés, ou une session). */
    const sessionsAt = (path: string | null, root: boolean) =>
      rows.filter((row) => row.group !== 'done' && (root ? row.place.root : row.place.path === path))

    const cardOf = (sessions: ActivityRow[], branch: string | null) => {
      const linked = sessions.find((row) => row.entry.conversation.card)?.entry.conversation.card
      if (linked) return byNumber.get(linked.number) ?? null
      // HEURISTIQUE : les branches de Solera s'écrivent `feat/153-titre` ; le numéro
      // en tête désigne la carte. Rien de tel n'est stocké.
      const match = branch?.match(/\/(\d+)-/)
      const card = match ? byNumber.get(Number(match[1])) : undefined
      return card ?? null
    }

    const code: CodeLine[] = []
    const rootSessions = sessionsAt(null, true)
    if (project.git) {
      code.push({
        key: 'root',
        root: true,
        branch: project.git.branch,
        ahead: 0,
        behind: 0,
        dirty: project.git.changedFiles,
        conflicts: false,
        pr: null,
        sessions: rootSessions,
        card: null,
        lastActivityAt: rootSessions[0]?.entry.conversation.updatedAt ?? null,
        to: `/p/${projectId}/board`,
        treeId: null,
        path: null,
      })
    }
    let settledTrees = 0
    const live = (trees?.worktrees ?? []).filter((tree: WorktreeStatusDto) => {
      const busy = sessionsAt(tree.path, false).length > 0
      const settled = (tree.state === 'merged' || tree.state === 'empty' || tree.state === 'missing') && !busy
      if (settled) settledTrees += 1
      return !settled
    })
    for (const tree of live) {
      const sessions = sessionsAt(tree.path, false)
      const pr = pullRequestFor(pullRequests, tree.branch)
      code.push({
        key: tree.path,
        root: false,
        branch: tree.branch ?? tree.name,
        ahead: tree.ahead,
        behind: tree.behind,
        dirty: tree.modified + tree.untracked,
        conflicts: tree.conflicts,
        pr,
        sessions,
        card: cardOf(sessions, tree.branch),
        lastActivityAt: Math.max(tree.lastCommitAt ?? 0, tree.lastEditAt ?? 0) || null,
        to: sessions[0] ? `/p/${projectId}/c/${sessions[0].entry.conversation.id}` : `/p/${projectId}/activity?groupe=worktree`,
        treeId: tree.id,
        path: tree.path,
      })
    }
    // Les arbres où ça bouge d'abord, la racine restant en tête.
    code.sort((a, b) => {
      if (a.root !== b.root) return a.root ? -1 : 1
      if ((a.sessions.length > 0) !== (b.sessions.length > 0)) return a.sessions.length > 0 ? -1 : 1
      return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
    })

    const milestones = milestonesOf(allCards)
    const milestone = milestones.find((entry) => entry.done < entry.cards.length) ?? milestones[0] ?? null

    const tasks = (schedules ?? []).filter((task) => task.projectId === projectId)
    const nextTask =
      tasks
        .filter((task) => task.enabled && task.nextRunAt !== null)
        .sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0] ?? null

    return {
      project,
      projectId,
      asks,
      code,
      settledTrees,
      milestone,
      milestoneCount: milestones.length,
      nextTask,
      taskCount: tasks.length,
      openCards: allCards.filter((card) => card.children.length === 0 && card.column !== 'done' && card.column !== 'abandoned').length,
      rows,
    }
  }, [rows, cards, trees, pullRequests, schedules, project, projectId])
}
