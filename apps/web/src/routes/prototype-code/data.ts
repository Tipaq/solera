/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type {
  AgentKind,
  ConversationStatus,
  ProjectDto,
  PullRequestBadgeState,
  WorktreeState,
} from '@solera/protocol'
import { useLiveConversations } from '../../lib/activity'
import { useCards } from '../../lib/cards'
import { useAllConversations } from '../../lib/conversations'
import { pullRequestFor, usePullRequests } from '../../lib/pull-requests'
import { useWorktreeStatuses } from '../../lib/worktrees'

const DAY = 86_400_000

/** Au-delà, un arbre sans session ni activité est soupçonné d'abandon. */
export const STALE_DAYS = 14

/** Au-delà, un arbre est « lourd » (filtre). */
export const HEAVY_BYTES = 400 * 1024 * 1024

/**
 * Le verdict d'un arbre, ce qu'on vient lire ici : faut-il y toucher, et que perdrait-on.
 * Dans l'ordre de l'urgence, qui est aussi l'ordre du tableau.
 */
export type TreeVerdict =
  | 'root'
  | 'waiting'
  | 'active'
  | 'review'
  | 'merged-dirty'
  | 'stale'
  | 'wip'
  | 'empty'
  | 'clean'
  | 'missing'

export const VERDICT_ORDER: TreeVerdict[] = ['root', 'waiting', 'active', 'review', 'merged-dirty', 'stale', 'wip', 'empty', 'clean', 'missing']

export interface TreeSession {
  id: string
  title: string
  agent: AgentKind
  status: ConversationStatus
}

export interface TreeRow {
  key: string
  root: boolean
  /** Null pour la racine et les arbres créés au shell : rien à nettoyer par Solera. */
  id: string | null
  name: string
  branch: string | null
  path: string
  external: boolean
  state: WorktreeState | 'root'
  sessions: TreeSession[]
  /** Toutes les sessions qui y tiennent, vivantes ou non : la plus récente sert au diff. */
  anySessionId: string | null
  card: { id: string; number: number; title: string; milestone: { number: number; title: string } | null } | null
  pr: { number: number; url: string; state: PullRequestBadgeState } | null
  ahead: number
  behind: number
  uncommitted: number
  conflicts: boolean
  unmergedCommits: boolean
  /** SIMULÉ : l'API ne mesure pas la taille d'un arbre (voir le compte rendu). */
  sizeBytes: number
  lastUsedAt: number | null
  verdict: TreeVerdict
  /** La phrase du verdict, qui dit pourquoi l'arbre est encore là. */
  reason: string
}

export interface BranchRow {
  name: string
  merged: boolean
  /** SIMULÉ en démo ; l'API ne donne pas la date du dernier commit d'une branche sans arbre. */
  lastCommitAt: number | null
  /** SIMULÉ, démo seulement : une branche qui n'existe que sur le remote (`origin/…`). L'API ne liste pas les distantes. */
  remoteOnly?: boolean
}

export interface CodeData {
  demo: boolean
  pending: boolean
  base: string | null
  trees: TreeRow[]
  branches: BranchRow[]
  /** Faux : la forge n'a pas répondu, les PR ne sont pas affichées. */
  forge: boolean
}

/* ------------------------------------------------------------------ verdict */

function days(ms: number): number {
  return Math.max(1, Math.round(ms / DAY))
}

export function verdictOf(row: Omit<TreeRow, 'verdict' | 'reason'>, now: number): { verdict: TreeVerdict; reason: string } {
  if (row.root) {
    return {
      verdict: 'root',
      reason: row.uncommitted > 0 ? `${row.uncommitted} fichier${row.uncommitted > 1 ? 's' : ''} non commité${row.uncommitted > 1 ? 's' : ''} sur la branche par défaut` : 'La branche par défaut, propre',
    }
  }
  if (row.state === 'missing' || row.state === 'unreadable') {
    return { verdict: 'missing', reason: row.state === 'missing' ? 'Le dossier a disparu du disque' : 'git n’a pas pu lire cet arbre' }
  }
  if (row.sessions.some((session) => session.status === 'awaiting_input' || session.status === 'error')) {
    return { verdict: 'waiting', reason: 'Une session t’attend ici' }
  }
  if (row.sessions.some((session) => session.status === 'running')) {
    return { verdict: 'active', reason: 'En cours : une session y travaille' }
  }
  const merged = row.state === 'merged' || row.pr?.state === 'merged'
  if (merged && row.uncommitted > 0) {
    return {
      verdict: 'merged-dirty',
      reason: `Fusionné, mais ${row.uncommitted} fichier${row.uncommitted > 1 ? 's' : ''} non commité${row.uncommitted > 1 ? 's' : ''} : les nettoyer les perdrait`,
    }
  }
  if (merged) return { verdict: 'clean', reason: 'Fusionné : rien à perdre, à nettoyer' }
  if (row.pr && row.pr.state !== 'merged') {
    return { verdict: 'review', reason: row.pr.state === 'draft' ? 'PR en brouillon' : 'PR ouverte : à relire' }
  }
  const idle = row.lastUsedAt === null ? null : now - row.lastUsedAt
  if (idle !== null && idle > STALE_DAYS * DAY) {
    return { verdict: 'stale', reason: `Abandonné ? Aucune activité depuis ${days(idle)} jours` }
  }
  if (row.state === 'empty') return { verdict: 'empty', reason: 'Jamais commité : la branche ne porte encore rien' }
  return { verdict: 'wip', reason: 'Du travail non fusionné, sans session ouverte' }
}

/** Ce que « Nettoyer les fusionnés » emporterait : rien qui se perde. */
export function isCleanable(row: TreeRow): boolean {
  return row.verdict === 'clean' && !row.root
}

/* ------------------------------------------------------------------ taille simulée */

/**
 * SIMULÉ : une taille déterministe par chemin, pour que le tri et le bilan aient une
 * forme. Un arbre JS pèse surtout ses `node_modules` : entre 40 Mo et 1,2 Go.
 */
export function simulatedSize(path: string): number {
  let hash = 2166136261
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  const unit = (hash >>> 0) / 0xffffffff
  return Math.round((40 + unit * unit * 1160) * 1024 * 1024)
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2).toLocaleString('fr-FR')} Mo`
  return `${Math.max(1, Math.round(bytes / 1024))} Ko`
}

/* ------------------------------------------------------------------ données réelles */

export function useCodeData(projectId: string | undefined, project: ProjectDto | undefined): CodeData {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const git = Boolean(project?.git)
  const { data: statuses, isPending } = useWorktreeStatuses(git && !demo ? projectId : undefined)
  const { data: pullRequests } = usePullRequests(git && !demo ? projectId : undefined)
  const { data: cards } = useCards(demo ? undefined : projectId)
  const { data: conversations } = useAllConversations()
  const mine = useMemo(
    () => (conversations ?? []).filter((entry) => entry.projectId === projectId && entry.archivedAt === null),
    [conversations, projectId],
  )
  const live = useLiveConversations(mine)

  return useMemo<CodeData>(() => {
    if (demo) return demoData()
    const now = Date.now()
    const byId = new Map(live.map((entry) => [entry.conversation.id, entry]))
    const cardById = new Map((cards ?? []).map((card) => [card.id, card]))

    const sessionsOf = (ids: string[]) => {
      const entries = ids.map((id) => byId.get(id)).filter((entry) => entry !== undefined)
      return {
        live: entries
          .filter((entry) => entry.running || entry.awaiting || entry.status === 'error')
          .map((entry) => ({ id: entry.conversation.id, title: entry.conversation.title, agent: entry.conversation.agent, status: entry.status })),
        latest: [...entries].sort((a, b) => b.since - a.since)[0]?.conversation ?? null,
        lastAt: entries.reduce<number | null>((max, entry) => (max === null || entry.since > max ? entry.since : max), null),
      }
    }

    const cardOf = (conversationCard: { id: string } | null | undefined) => {
      if (!conversationCard) return null
      const card = cardById.get(conversationCard.id)
      if (!card) return null
      const parent = card.parent ? cardById.get(card.parent.id) : undefined
      return { id: card.id, number: card.number, title: card.title, milestone: parent ? { number: parent.number, title: parent.title } : null }
    }

    const trees: TreeRow[] = []
    if (project?.git) {
      // La racine : la branche par défaut, ses fichiers non commités, ses sessions sans arbre.
      const rootIds = mine.filter((entry) => entry.worktreeId === null).map((entry) => entry.id)
      const rootSessions = sessionsOf(rootIds)
      const base = {
        key: 'root',
        root: true,
        id: null,
        name: statuses?.base ?? project.git.branch,
        branch: statuses?.base ?? project.git.branch,
        path: project.workspacePath,
        external: false,
        state: 'root' as const,
        sessions: rootSessions.live,
        anySessionId: rootSessions.latest?.id ?? null,
        card: null,
        pr: null,
        ahead: 0,
        behind: 0,
        uncommitted: project.git.changedFiles,
        conflicts: false,
        unmergedCommits: false,
        sizeBytes: simulatedSize(project.workspacePath),
        lastUsedAt: rootSessions.lastAt,
      }
      trees.push({ ...base, ...verdictOf(base, now) })
    }

    for (const tree of statuses?.worktrees ?? []) {
      const sessions = sessionsOf(tree.conversations.map((entry) => entry.id))
      const pr = pullRequestFor(pullRequests, tree.branch)
      const lastUsedAt = [sessions.lastAt, tree.lastCommitAt, tree.lastEditAt].reduce<number | null>(
        (max, at) => (at !== null && (max === null || at > max) ? at : max),
        null,
      )
      const base = {
        key: tree.path,
        root: false,
        id: tree.id,
        name: tree.name,
        branch: tree.branch,
        path: tree.path,
        external: tree.external,
        state: tree.state,
        sessions: sessions.live,
        anySessionId: sessions.latest?.id ?? null,
        card: cardOf(sessions.latest?.card),
        pr: pr ? { number: pr.number, url: pr.url, state: pr.state } : tree.mergedPullRequest ? { number: tree.mergedPullRequest, url: '', state: 'merged' as const } : null,
        ahead: tree.ahead,
        behind: tree.behind,
        uncommitted: tree.modified + tree.untracked,
        conflicts: tree.conflicts,
        unmergedCommits: tree.unmergedCommits,
        sizeBytes: simulatedSize(tree.path),
        lastUsedAt,
      }
      trees.push({ ...base, ...verdictOf(base, now) })
    }

    return {
      demo: false,
      pending: git && isPending,
      base: statuses?.base ?? project?.git?.branch ?? null,
      trees: sortTrees(trees),
      branches: (statuses?.branches ?? []).map((branch) => ({ ...branch, lastCommitAt: null })),
      forge: pullRequests?.available ?? false,
    }
  }, [demo, live, cards, mine, project, statuses, pullRequests, git, isPending])
}

export function sortTrees(trees: TreeRow[]): TreeRow[] {
  return [...trees].sort(
    (a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
  )
}

/* ------------------------------------------------------------------ jeu de démo */

/**
 * Une dizaine d'arbres qui couvrent tous les verdicts, avec des tailles qui font un
 * bilan crédible. Rien ne vient du serveur.
 */
function demoData(): CodeData {
  const now = Date.now()
  const hour = 3_600_000
  const milestone = { number: 901, title: 'Page projet v2' }
  const session = (id: string, title: string, status: ConversationStatus, agent: AgentKind = 'claude'): TreeSession => ({ id, title, agent, status })
  const mb = (value: number) => value * 1024 * 1024

  const raw: Omit<TreeRow, 'verdict' | 'reason'>[] = [
    { key: 'root', root: true, id: null, name: 'main', branch: 'main', path: '~/projects/solera', external: false, state: 'root', sessions: [session('demo-s-root', 'Revue du proto', 'running')], anySessionId: 'demo-s-root', card: null, pr: null, ahead: 0, behind: 0, uncommitted: 3, conflicts: false, unmergedCommits: false, sizeBytes: mb(1480), lastUsedAt: now - 0.2 * hour },
    { key: 'w1', root: false, id: 'demo-w1', name: 'feat/906-compat-format', branch: 'feat/906-compat-format', path: '.worktrees/feat__906', external: false, state: 'dirty', sessions: [session('demo-s-906', 'Compatibilité de l’ancien format', 'awaiting_input')], anySessionId: 'demo-s-906', card: { id: 'demo-906', number: 906, title: 'Compatibilité de l’ancien format', milestone }, pr: null, ahead: 4, behind: 1, uncommitted: 6, conflicts: false, unmergedCommits: true, sizeBytes: mb(820), lastUsedAt: now - 0.5 * hour },
    // Servi par le « Serveur de dev » de démo (voir `prototype-automations/served.tsx`).
    { key: 'w905', root: false, id: 'demo-w905', name: 'feat/905-vue-horizon', branch: 'feat/905-vue-horizon', path: '.worktrees/feat__905', external: false, state: 'dirty', sessions: [session('demo-s-905', 'Vue horizon des jalons', 'running')], anySessionId: 'demo-s-905', card: { id: 'demo-905', number: 905, title: 'Vue horizon des jalons', milestone }, pr: null, ahead: 2, behind: 3, uncommitted: 2, conflicts: false, unmergedCommits: true, sizeBytes: mb(740), lastUsedAt: now - 0.3 * hour },
    { key: 'w2', root: false, id: 'demo-w2', name: 'feat/907-vagues', branch: 'feat/907-vagues', path: '.worktrees/feat__907', external: false, state: 'unmerged', sessions: [session('demo-s-907', 'Graphe en vagues', 'running', 'codex')], anySessionId: 'demo-s-907', card: { id: 'demo-907', number: 907, title: 'Graphe en vagues', milestone }, pr: { number: 131, url: 'https://github.com/Tipaq/solera/pull/131', state: 'checks' }, ahead: 7, behind: 0, uncommitted: 2, conflicts: false, unmergedCommits: true, sizeBytes: mb(760), lastUsedAt: now - 0.1 * hour },
    { key: 'w3', root: false, id: 'demo-w3', name: 'feat/904-tiroir', branch: 'feat/904-tiroir', path: '.worktrees/feat__904', external: false, state: 'unmerged', sessions: [], anySessionId: 'demo-s-904', card: { id: 'demo-904', number: 904, title: 'Tiroir de carte', milestone }, pr: { number: 128, url: 'https://github.com/Tipaq/solera/pull/128', state: 'ready' }, ahead: 5, behind: 2, uncommitted: 0, conflicts: false, unmergedCommits: true, sizeBytes: mb(690), lastUsedAt: now - 5 * hour },
    { key: 'w4', root: false, id: 'demo-w4', name: 'feat/912-reglages', branch: 'feat/912-reglages', path: '.worktrees/feat__912', external: false, state: 'unmerged', sessions: [], anySessionId: 'demo-s-912', card: { id: 'demo-912', number: 912, title: 'Réglages par sections', milestone: null }, pr: { number: 126, url: 'https://github.com/Tipaq/solera/pull/126', state: 'failing' }, ahead: 9, behind: 6, uncommitted: 0, conflicts: true, unmergedCommits: true, sizeBytes: mb(910), lastUsedAt: now - 26 * hour },
    { key: 'w5', root: false, id: 'demo-w5', name: 'feat/880-acces-distant', branch: 'feat/880-acces-distant', path: '.worktrees/feat__880', external: false, state: 'merged', sessions: [], anySessionId: 'demo-s-880', card: { id: 'demo-880', number: 880, title: 'Accès distant fiable', milestone: null }, pr: { number: 119, url: 'https://github.com/Tipaq/solera/pull/119', state: 'merged' }, ahead: 0, behind: 14, uncommitted: 0, conflicts: false, unmergedCommits: false, sizeBytes: mb(1120), lastUsedAt: now - 3 * DAY },
    { key: 'w6', root: false, id: 'demo-w6', name: 'feat/871-skills', branch: 'feat/871-skills', path: '.worktrees/feat__871', external: false, state: 'merged', sessions: [], anySessionId: 'demo-s-871', card: { id: 'demo-871', number: 871, title: 'Bibliothèque de skills', milestone: null }, pr: { number: 112, url: 'https://github.com/Tipaq/solera/pull/112', state: 'merged' }, ahead: 0, behind: 31, uncommitted: 0, conflicts: false, unmergedCommits: false, sizeBytes: mb(640), lastUsedAt: now - 9 * DAY },
    { key: 'w7', root: false, id: 'demo-w7', name: 'fix/865-titre-tronque', branch: 'fix/865-titre-tronque', path: '.worktrees/fix__865', external: false, state: 'dirty', sessions: [], anySessionId: 'demo-s-865', card: { id: 'demo-865', number: 865, title: 'Titre tronqué', milestone: null }, pr: { number: 108, url: 'https://github.com/Tipaq/solera/pull/108', state: 'merged' }, ahead: 0, behind: 40, uncommitted: 4, conflicts: false, unmergedCommits: false, sizeBytes: mb(580), lastUsedAt: now - 12 * DAY },
    { key: 'w8', root: false, id: 'demo-w8', name: 'spike/terminal-wasm', branch: 'spike/terminal-wasm', path: '.worktrees/spike__terminal', external: false, state: 'unmerged', sessions: [], anySessionId: 'demo-s-spike', card: null, pr: null, ahead: 3, behind: 58, uncommitted: 1, conflicts: true, unmergedCommits: true, sizeBytes: mb(1340), lastUsedAt: now - 37 * DAY },
    { key: 'w9', root: false, id: 'demo-w9', name: 'feat/923-cycle', branch: 'feat/923-cycle', path: '.worktrees/feat__923', external: false, state: 'empty', sessions: [], anySessionId: null, card: { id: 'demo-923', number: 923, title: 'Défaire un cycle', milestone: null }, pr: null, ahead: 0, behind: 0, uncommitted: 0, conflicts: false, unmergedCommits: false, sizeBytes: mb(45), lastUsedAt: now - 2 * hour },
    { key: 'w10', root: false, id: null, name: 'essai-vite', branch: 'essai-vite', path: '/tmp/essai-vite', external: true, state: 'unmerged', sessions: [], anySessionId: null, card: null, pr: null, ahead: 1, behind: 3, uncommitted: 0, conflicts: false, unmergedCommits: true, sizeBytes: mb(380), lastUsedAt: now - 4 * DAY },
    { key: 'w11', root: false, id: 'demo-w11', name: 'feat/850-ancienne', branch: 'feat/850-ancienne', path: '.worktrees/feat__850', external: false, state: 'missing', sessions: [], anySessionId: null, card: null, pr: null, ahead: 0, behind: 0, uncommitted: 0, conflicts: false, unmergedCommits: false, sizeBytes: 0, lastUsedAt: now - 20 * DAY },
  ]

  return {
    demo: true,
    pending: false,
    base: 'main',
    trees: sortTrees(raw.map((row) => ({ ...row, ...verdictOf(row, now) }))),
    branches: [
      { name: 'feat/908-actions-hub', merged: false, lastCommitAt: now - 3 * hour },
      { name: 'feat/909-acces-distant', merged: false, lastCommitAt: now - 2 * DAY },
      { name: 'feat/815-export-skills', merged: false, lastCommitAt: now - 6 * DAY },
      { name: 'spike/sqlite-wal', merged: false, lastCommitAt: now - 44 * DAY },
      { name: 'sillage/import-ancien', merged: false, lastCommitAt: now - 90 * DAY },
      { name: 'feat/920-mobile', merged: false, lastCommitAt: now - 1 * DAY, remoteOnly: true },
      { name: 'fix/931-badge-pr', merged: false, lastCommitAt: now - 7 * hour, remoteOnly: true },
      { name: 'feat/842-palette', merged: true, lastCommitAt: now - 18 * DAY },
      { name: 'feat/833-notifications', merged: true, lastCommitAt: now - 25 * DAY },
      { name: 'fix/829-cache-vite', merged: true, lastCommitAt: now - 27 * DAY },
      { name: 'feat/826-sidebar-repliable', merged: true, lastCommitAt: now - 29 * DAY },
      { name: 'fix/818-notif-double', merged: true, lastCommitAt: now - 33 * DAY },
    ],
    forge: true,
  }
}
