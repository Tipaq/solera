/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les données du portefeuille v2 : celles d'un projet, pour tous les projets, chaque
 * élément portant son projet. Les hooks portefeuille existent pour les arbres, les PR,
 * le journal, les actions, les tâches planifiées et les demandes ; les cartes passent par
 * `useAllCards` (une requête par projet, la même clé que le board d'un projet, donc
 * partagée). En `?demo=1`, trois projets fictifs.
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { CardDto, CardLinkDto, JournalEntryDto, ProjectDto, PullRequestBadgeState } from '@solera/protocol'
import { useActions } from '../../lib/actions'
import { useLiveConversations, type LiveConversation } from '../../lib/activity'
import { useAllCards } from '../../lib/cards'
import { useAllConversations } from '../../lib/conversations'
import { useJournal } from '../../lib/journal'
import { useProjects } from '../../lib/projects'
import { pullRequestFor, usePortfolioPullRequests } from '../../lib/pull-requests'
import { useSchedules } from '../../lib/schedules'
import { usePortfolioSessionRequests } from '../../lib/session-requests'
import { usePortfolioWorktreeStatuses } from '../../lib/worktrees'
import type { InboxItem } from '../../components/prototype/AskInbox'
import { demoActions } from '../prototype-actions/data'
import { demoScheduledCommands, fromAction, fromTask, type Automation } from '../prototype-automations/model'
import { simulatedSize, sortTrees, verdictOf, type BranchRow, type TreeRow } from '../prototype-code/data'
import { DAY, demoCards } from '../prototype-milestones/model'

export type PCard = CardDto & { project: ProjectDto }
export type PTree = TreeRow & { project: ProjectDto }
export type PBranch = BranchRow & { project: ProjectDto }
export type PAutomation = Automation & { project: ProjectDto }
export type PEvent = JournalEntryDto & { project: ProjectDto }

export interface PortfolioV2 {
  demo: boolean
  pending: boolean
  projects: ProjectDto[]
  byId: Map<string, ProjectDto>
  cards: PCard[]
  trees: PTree[]
  branches: PBranch[]
  events: PEvent[]
  automations: PAutomation[]
  inbox: (InboxItem & { project: ProjectDto })[]
  /** Sessions vivantes, tous projets. */
  live: LiveConversation[]
}

/* ------------------------------------------------------------------ démo */

function demoProject(id: string, name: string, color: string, index: number): ProjectDto {
  return {
    id,
    name,
    image: null,
    workspacePath: `/home/demo/${id}`,
    ownerId: 'demo',
    ownerName: 'Démo',
    visibility: 'private',
    color,
    isOwner: true,
    position: index,
    archivedAt: null,
    createdAt: Date.now() - 90 * DAY,
    conversationCount: 12 - index * 3,
    configLayer: {} as ProjectDto['configLayer'],
    instructionsMode: 'repo',
    designSystemPath: null,
    turnCheckpoints: false,
    activeTerminals: 0,
    git: { branch: 'main', isDirty: index === 0, changedFiles: index === 0 ? 3 : 0 } as ProjectDto['git'],
  }
}

/** Recopie un jeu de cartes de démo sous un projet, avec des identifiants propres à lui. */
function cardsFor(project: ProjectDto, keep: (card: CardDto) => boolean): PCard[] {
  const source = demoCards(project.id).filter(keep)
  const ids = new Set(source.map((card) => card.id))
  const id = (raw: string) => `${raw}-${project.id}`
  const link = (entry: CardLinkDto): CardLinkDto => ({ ...entry, id: id(entry.id) })
  const links = (list: CardLinkDto[]) => list.filter((entry) => ids.has(entry.id)).map(link)
  return source.map((card) => ({
    ...card,
    id: id(card.id),
    projectId: project.id,
    parent: card.parent && ids.has(card.parent.id) ? link(card.parent) : null,
    children: links(card.children),
    blocks: links(card.blocks),
    blockedBy: links(card.blockedBy),
    conversations: card.conversations.map((entry) => ({ ...entry, id: `${entry.id}-${project.id}` })),
    project,
  }))
}

function demoTree(project: ProjectDto, branch: string, partial: Partial<TreeRow>, now: number): PTree {
  const base: Omit<TreeRow, 'verdict' | 'reason'> = {
    key: `${project.id}:${branch}`,
    root: false,
    id: `${project.id}:${branch}`,
    name: branch.split('/').pop() ?? branch,
    branch,
    path: `${project.workspacePath}/.worktrees/${branch.replace('/', '__')}`,
    external: false,
    state: 'unmerged',
    sessions: [],
    anySessionId: null,
    card: null,
    pr: null,
    ahead: 3,
    behind: 0,
    uncommitted: 0,
    conflicts: false,
    unmergedCommits: true,
    sizeBytes: simulatedSize(`${project.id}/${branch}`),
    lastUsedAt: now - 2 * 3_600_000,
    ...partial,
  }
  return { ...base, ...verdictOf(base, now), project }
}

function demoData(): Omit<PortfolioV2, 'pending' | 'live'> {
  const now = Date.now()
  const projects = [
    demoProject('demo-solera', 'Solera (démo)', '#22d3ee', 0),
    demoProject('demo-atelier', 'Atelier', '#a78bfa', 1),
    demoProject('demo-vitrine', 'Site vitrine', '#f59e0b', 2),
  ]
  const [solera, atelier, vitrine] = projects as [ProjectDto, ProjectDto, ProjectDto]
  const cards = [
    ...cardsFor(solera, () => true),
    ...cardsFor(atelier, (card) => card.number % 3 !== 0),
    ...cardsFor(vitrine, (card) => card.number % 2 === 0),
  ]
  const root = (project: ProjectDto, uncommitted: number): PTree => {
    const base: Omit<TreeRow, 'verdict' | 'reason'> = {
      key: `${project.id}:root`, root: true, id: null, name: 'main', branch: 'main', path: project.workspacePath, external: false,
      state: 'root', sessions: [], anySessionId: null, card: null, pr: null, ahead: 0, behind: 0, uncommitted, conflicts: false,
      unmergedCommits: false, sizeBytes: simulatedSize(project.workspacePath), lastUsedAt: now - 3_600_000,
    }
    return { ...base, ...verdictOf(base, now), project }
  }
  const pr = (number: number, state: PullRequestBadgeState) => ({ number, url: `https://github.com/demo/pr/${number}`, state })
  const trees: PTree[] = [
    root(solera, 3),
    demoTree(solera, 'feat/903-schema-des-jalons', { sessions: [{ id: 's1', title: 'Schéma des jalons', agent: 'claude', status: 'running' }], card: { id: 'c903', number: 903, title: 'Bloc « Le code en cours »', milestone: { number: 901, title: 'Page projet v2' } }, pr: pr(212, 'checks') }, now),
    demoTree(solera, 'feat/905-vue-horizon', { sessions: [{ id: 's2', title: 'Vue horizon', agent: 'codex', status: 'awaiting_input' }], card: { id: 'c905', number: 905, title: 'Graphe de dépendances', milestone: { number: 901, title: 'Page projet v2' } }, uncommitted: 6 }, now),
    demoTree(solera, 'fix/911-gantt-largeur', { pr: pr(209, 'ready'), unmergedCommits: true }, now),
    demoTree(solera, 'feat/880-ancien-portail', { state: 'merged', unmergedCommits: false, ahead: 0, lastUsedAt: now - 9 * DAY, pr: pr(180, 'merged') }, now),
    root(atelier, 0),
    demoTree(atelier, 'feat/12-export-pdf', { sessions: [{ id: 's3', title: 'Export PDF', agent: 'grok', status: 'running' }], pr: pr(41, 'draft') }, now),
    demoTree(atelier, 'feat/9-import-csv', { lastUsedAt: now - 21 * DAY }, now),
    demoTree(atelier, 'chore/maj-deps', { state: 'merged', unmergedCommits: false, ahead: 0, lastUsedAt: now - 5 * DAY }, now),
    root(vitrine, 0),
    demoTree(vitrine, 'feat/4-page-tarifs', { sessions: [{ id: 's4', title: 'Page tarifs', agent: 'claude', status: 'error' }], conflicts: true, behind: 4 }, now),
  ]
  const branches: PBranch[] = [
    { name: 'feat/870-vieux-board', merged: true, lastCommitAt: now - 30 * DAY, project: solera },
    { name: 'spike/websocket', merged: false, lastCommitAt: now - 12 * DAY, project: solera },
    { name: 'feat/7-galerie', merged: true, lastCommitAt: now - 40 * DAY, project: vitrine },
  ]
  const event = (project: ProjectDto, kind: JournalEntryDto['kind'], title: string, hoursAgo: number, cardNumber: number | null = null): PEvent =>
    ({ id: `${project.id}-${title}`, kind, at: now - hoursAgo * 3_600_000, title, projectId: project.id, cardNumber, source: null, project }) as PEvent
  const events: PEvent[] = [
    event(solera, 'cardClosed', 'Axe à deux étages du Gantt', 0.4, 908),
    event(atelier, 'session', 'Export PDF lancé dans Grok', 1.2),
    event(solera, 'branch', 'feat/902-maturite fusionnée dans jalon/901', 2),
    event(vitrine, 'note', 'Les tarifs restent HT sur la page', 5),
    event(atelier, 'cardOpened', 'Import CSV : séparateur point-virgule', 9),
    event(solera, 'run', 'Revue nocturne des dépendances', 11),
    event(vitrine, 'cardClosed', 'Formulaire de contact', 26),
    event(solera, 'note', 'Le cap reste facultatif, une phrase au plus', 30),
  ].sort((a, b) => b.at - a.at)
  const automations: PAutomation[] = projects.flatMap((project, index) => {
    const own = demoActions(project.id)
      .filter((_, position) => (index === 0 ? true : position % (index + 1) === 0))
      .map((action) => ({ ...fromAction({ ...action, id: `${action.id}-${project.id}` }), project }))
    const commands = index === 0 ? demoScheduledCommands().map((item) => ({ ...item, project })) : []
    return [...own, ...commands]
  })
  const inbox: (InboxItem & { project: ProjectDto })[] = [
    {
      kind: 'session', key: 'demo-ask-1', project: solera, title: `${solera.name} · Vue horizon`, agent: 'codex', tone: 'awaiting', since: now - 2 * 3_600_000,
      milestone: { number: 901, title: 'Page projet v2', to: '#' }, cardNumber: 905, open: '#',
      reply: { type: 'demo', question: 'Faut-il garder la compatibilité avec l’ancien format, ou peut-on le casser ?', onAnswer: () => undefined },
    },
    {
      kind: 'session', key: 'demo-ask-2', project: vitrine, title: `${vitrine.name} · Page tarifs`, agent: 'claude', tone: 'broken', since: now - 40 * 60_000,
      milestone: null, cardNumber: 4, open: '#',
      reply: { type: 'demo', question: 'La session s’est arrêtée sur un conflit.', onAnswer: () => undefined },
    },
    { kind: 'light', key: 'demo-pr', project: solera, tone: 'review-pr', title: `${solera.name} · fix/911-gantt-largeur`, detail: 'PR #209 prête à fusionner', to: '#', external: false, since: now - 3 * 3_600_000 },
  ]
  return { demo: true, projects, byId: new Map(projects.map((project) => [project.id, project])), cards, trees, branches, events, automations, inbox }
}

/* ------------------------------------------------------------------ vraies données */

export function usePortfolioV2(): PortfolioV2 {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data: projectList, isPending } = useProjects()
  const projects = useMemo(() => (projectList ?? []).filter((project) => !project.archivedAt), [projectList])
  const { cards } = useAllCards(demo ? [] : projects)
  const { data: conversations } = useAllConversations()
  const mine = useMemo(() => {
    const ids = new Set(projects.map((project) => project.id))
    return (conversations ?? []).filter((entry) => entry.projectId !== null && ids.has(entry.projectId) && entry.archivedAt === null)
  }, [conversations, projects])
  const live = useLiveConversations(mine)
  const requests = usePortfolioSessionRequests(live)
  const { data: statuses } = usePortfolioWorktreeStatuses()
  const { data: pulls } = usePortfolioPullRequests()
  const { data: journal } = useJournal(undefined)
  const { data: actions } = useActions()
  const { data: schedules } = useSchedules()

  return useMemo<PortfolioV2>(() => {
    if (demo) return { ...demoData(), pending: false, live: [] }
    const now = Date.now()
    const byId = new Map(projects.map((project) => [project.id, project]))
    const liveById = new Map(live.map((entry) => [entry.conversation.id, entry]))
    const cardById = new Map(cards.map((card) => [card.id, card]))

    const sessionsOf = (ids: string[]) => {
      const entries = ids.map((id) => liveById.get(id)).filter((entry) => entry !== undefined)
      return {
        live: entries
          .filter((entry) => entry.running || entry.awaiting || entry.status === 'error')
          .map((entry) => ({ id: entry.conversation.id, title: entry.conversation.title, agent: entry.conversation.agent, status: entry.status })),
        latest: [...entries].sort((a, b) => b.since - a.since)[0]?.conversation ?? null,
        lastAt: entries.reduce<number | null>((max, entry) => (max === null || entry.since > max ? entry.since : max), null),
      }
    }
    const cardOf = (link: { id: string } | null | undefined) => {
      const card = link ? cardById.get(link.id) : undefined
      if (!card) return null
      const parent = card.parent ? cardById.get(card.parent.id) : undefined
      return { id: card.id, number: card.number, title: card.title, milestone: parent ? { number: parent.number, title: parent.title } : null }
    }

    const trees: PTree[] = []
    const branches: PBranch[] = []
    for (const project of projects) {
      if (!project.git) continue
      const status = statuses?.projects[project.id]
      const prs = pulls?.projects[project.id]
      const rootSessions = sessionsOf(mine.filter((entry) => entry.projectId === project.id && entry.worktreeId === null).map((entry) => entry.id))
      const rootBase: Omit<TreeRow, 'verdict' | 'reason'> = {
        key: `${project.id}:root`, root: true, id: null, name: status?.base ?? project.git.branch, branch: status?.base ?? project.git.branch,
        path: project.workspacePath, external: false, state: 'root', sessions: rootSessions.live, anySessionId: rootSessions.latest?.id ?? null,
        card: null, pr: null, ahead: 0, behind: 0, uncommitted: project.git.changedFiles, conflicts: false, unmergedCommits: false,
        sizeBytes: simulatedSize(project.workspacePath), lastUsedAt: rootSessions.lastAt,
      }
      trees.push({ ...rootBase, ...verdictOf(rootBase, now), project })
      for (const tree of status?.worktrees ?? []) {
        const sessions = sessionsOf(tree.conversations.map((entry) => entry.id))
        const pr = pullRequestFor(prs, tree.branch)
        const lastUsedAt = [sessions.lastAt, tree.lastCommitAt, tree.lastEditAt].reduce<number | null>(
          (max, at) => (at !== null && (max === null || at > max) ? at : max),
          null,
        )
        const base: Omit<TreeRow, 'verdict' | 'reason'> = {
          key: tree.path, root: false, id: tree.id, name: tree.name, branch: tree.branch, path: tree.path, external: tree.external,
          state: tree.state, sessions: sessions.live, anySessionId: sessions.latest?.id ?? null, card: cardOf(sessions.latest?.card),
          pr: pr ? { number: pr.number, url: pr.url, state: pr.state } : tree.mergedPullRequest ? { number: tree.mergedPullRequest, url: '', state: 'merged' } : null,
          ahead: tree.ahead, behind: tree.behind, uncommitted: tree.modified + tree.untracked, conflicts: tree.conflicts,
          unmergedCommits: tree.unmergedCommits, sizeBytes: simulatedSize(tree.path), lastUsedAt,
        }
        trees.push({ ...base, ...verdictOf(base, now), project })
      }
      for (const branch of status?.branches ?? []) branches.push({ ...branch, lastCommitAt: null, project })
    }

    const events: PEvent[] = (journal?.entries ?? []).flatMap((entry) => {
      const project = byId.get(entry.projectId)
      return project ? [{ ...entry, project }] : []
    })

    const automations: PAutomation[] = [
      ...(actions ?? []).flatMap((action) => {
        const project = byId.get(action.projectId)
        return project ? [{ ...fromAction(action), project }] : []
      }),
      ...(schedules ?? []).flatMap((task) => {
        const project = task.projectId ? byId.get(task.projectId) : undefined
        return project ? [{ ...fromTask(task), project }] : []
      }),
    ]

    const inbox: (InboxItem & { project: ProjectDto })[] = []
    for (const entry of live) {
      if (!(entry.awaiting || entry.status === 'error')) continue
      const project = entry.conversation.projectId ? byId.get(entry.conversation.projectId) : undefined
      if (!project) continue
      const card = entry.conversation.card ? cardById.get(entry.conversation.card.id) : undefined
      const parent = card?.parent ? cardById.get(card.parent.id) : undefined
      inbox.push({
        kind: 'session',
        key: `s-${entry.conversation.id}`,
        project,
        title: `${project.name} · ${entry.conversation.title}`,
        agent: entry.conversation.agent,
        tone: entry.status === 'error' ? 'broken' : 'awaiting',
        since: entry.since,
        milestone: parent ? { number: parent.number, title: parent.title, to: `/p/${project.id}/timeline/${parent.number}` } : null,
        cardNumber: card?.number ?? null,
        open: `/p/${project.id}/c/${entry.conversation.id}`,
        reply: { type: 'real', conversationId: entry.conversation.id, request: requests.get(entry.conversation.id) ?? null, canDecide: entry.conversation.isOwner },
      })
    }
    for (const card of cards) {
      if (card.column !== 'review' || card.children.length > 0) continue
      inbox.push({
        kind: 'light', key: `r-${card.id}`, project: card.project, tone: 'review-card', title: `${card.project.name} · ${card.title}`,
        detail: `Carte #${card.number} à relire`, to: `/p/${card.project.id}/board`, external: false, since: card.columnSince,
      })
    }
    for (const tree of trees) {
      if (tree.pr?.state !== 'ready') continue
      inbox.push({
        kind: 'light', key: `pr-${tree.key}`, project: tree.project, tone: 'review-pr', title: `${tree.project.name} · ${tree.branch}`,
        detail: `PR #${tree.pr.number} prête à fusionner`, to: tree.pr.url, external: true, since: tree.lastUsedAt,
      })
    }

    return {
      demo: false,
      pending: isPending,
      projects,
      byId,
      cards,
      trees: sortTrees(trees) as PTree[],
      branches,
      events,
      automations,
      inbox,
      live,
    }
  }, [demo, projects, cards, live, requests, mine, statuses, pulls, journal, actions, schedules, isPending])
}

/* ------------------------------------------------------------------ filtres */

/** Les projets choisis dans Filtrer ▾ ; vide = tous. */
export function inProjects(selected: ReadonlySet<string>, projectId: string): boolean {
  return selected.size === 0 || selected.has(projectId)
}
