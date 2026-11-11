/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Toutes les sessions, de tous les projets et sans projet, avec ce que la page
 * « Sessions » en montre : état vivant, branche, carte, épinglage, archivage. Les données
 * réelles viennent des mêmes sources que le portefeuille (`useAllConversations`, les
 * statuts vivants, les demandes, l'état des worktrees) ; `?demo=1` donne un jeu fictif.
 */
import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { AgentKind, ProjectDto } from '@solera/protocol'
import { useLiveConversations } from '../../lib/activity'
import { useAllConversations } from '../../lib/conversations'
import { useProjects } from '../../lib/projects'
import { usePortfolioSessionRequests } from '../../lib/session-requests'
import { usePortfolioWorktreeStatuses } from '../../lib/worktrees'
import type { InboxItem } from '../../components/prototype/AskInbox'

/** L'état qu'on lit d'un coup d'œil, dans l'ordre où il réclame Tim. */
export type SessionState = 'awaiting' | 'error' | 'review' | 'running' | 'done'

export const STATE_WORD: Record<SessionState, string> = {
  awaiting: "t'attend",
  error: 'en erreur',
  review: 'à relire',
  running: 'travaille',
  done: 'terminée',
}

export const STATE_DOT: Record<SessionState, string> = {
  awaiting: 'bg-caution',
  error: 'bg-critical',
  review: 'bg-accent/60',
  running: 'bg-accent animate-pulse',
  done: 'bg-line-strong',
}

export const STATE_RANK: Record<SessionState, number> = { awaiting: 0, error: 1, review: 2, running: 3, done: 4 }

export interface SessionRow {
  id: string
  title: string
  agent: AgentKind
  project: ProjectDto | null
  state: SessionState
  branch: string | null
  card: { number: number; title: string } | null
  pinned: boolean
  archived: boolean
  at: number
  /** L'adresse du fil, `null` pour une session de démo. */
  to: string | null
}

export interface SessionsData {
  demo: boolean
  pending: boolean
  rows: SessionRow[]
  projects: ProjectDto[]
  inbox: InboxItem[]
}

export function useSessionsData(): SessionsData {
  const [params] = useSearchParams()
  const demo = params.get('demo') === '1'
  const { data: projectList } = useProjects()
  const { data: conversations, isPending } = useAllConversations()
  const projects = useMemo(() => (projectList ?? []).filter((project) => !project.archivedAt), [projectList])
  const active = useMemo(() => (conversations ?? []).filter((entry) => entry.archivedAt === null), [conversations])
  const live = useLiveConversations(active)
  const requests = usePortfolioSessionRequests(live)
  const { data: statuses } = usePortfolioWorktreeStatuses()

  return useMemo<SessionsData>(() => {
    if (demo) return demoSessions()
    const byId = new Map((projectList ?? []).map((project) => [project.id, project]))
    const liveById = new Map(live.map((entry) => [entry.conversation.id, entry]))
    // La branche d'une session : celle de son worktree, sinon celle de la racine du projet.
    const branchOf = new Map<string, string>()
    for (const [, status] of Object.entries(statuses?.projects ?? {})) {
      for (const tree of status.worktrees) for (const link of tree.conversations) if (tree.branch) branchOf.set(link.id, tree.branch)
    }

    const rows: SessionRow[] = (conversations ?? [])
      .filter((entry) => !entry.scheduleId)
      .map((entry) => {
        const project = entry.projectId ? (byId.get(entry.projectId) ?? null) : null
        const state = liveById.get(entry.id)
        const value: SessionState = state?.awaiting
          ? 'awaiting'
          : state?.status === 'error'
            ? 'error'
            : state?.running
              ? 'running'
              : entry.card?.column === 'review'
                ? 'review'
                : 'done'
        return {
          id: entry.id,
          title: entry.title,
          agent: entry.agent,
          project,
          state: value,
          branch: branchOf.get(entry.id) ?? (entry.worktreeId === null ? (project?.git?.branch ?? null) : null),
          card: entry.card ? { number: entry.card.number, title: entry.card.title } : null,
          pinned: entry.pinned,
          archived: entry.archivedAt !== null,
          at: state?.since ?? entry.updatedAt,
          to: project ? `/p/${project.id}/c/${entry.id}` : `/c/${entry.id}`,
        }
      })

    const inbox: InboxItem[] = live
      .filter((entry) => entry.awaiting || entry.status === 'error')
      .map((entry) => {
        const project = entry.conversation.projectId ? byId.get(entry.conversation.projectId) : undefined
        return {
          kind: 'session' as const,
          key: `s-${entry.conversation.id}`,
          title: project ? `${project.name} · ${entry.conversation.title}` : entry.conversation.title,
          agent: entry.conversation.agent,
          tone: entry.status === 'error' ? ('broken' as const) : ('awaiting' as const),
          since: entry.since,
          milestone: null,
          cardNumber: entry.conversation.card?.number ?? null,
          open: project ? `/p/${project.id}/c/${entry.conversation.id}` : `/c/${entry.conversation.id}`,
          reply: { type: 'real' as const, conversationId: entry.conversation.id, request: requests.get(entry.conversation.id) ?? null, canDecide: entry.conversation.isOwner },
        }
      })

    return { demo: false, pending: isPending, rows, projects, inbox }
  }, [demo, projectList, projects, conversations, live, requests, statuses, isPending])
}

/* ------------------------------------------------------------------ démo */

const HOUR = 3_600_000
const DAY = 24 * HOUR

function demoProject(id: string, name: string, color: string | null): ProjectDto {
  return { id, name, color, archivedAt: null, git: { branch: 'main', isDirty: false, changedFiles: 0 } } as unknown as ProjectDto
}

function demoSessions(): SessionsData {
  const now = Date.now()
  const solera = demoProject('demo-solera', 'Solera', '#22d3ee')
  const atelier = demoProject('demo-atelier', 'Atelier', '#a78bfa')
  const vitrine = demoProject('demo-vitrine', 'Site vitrine', '#f59e0b')
  const projects = [solera, atelier, vitrine]
  const spec: [string, AgentKind, ProjectDto | null, SessionState, string | null, number | null, number, boolean?, boolean?][] = [
    ['Repenser la page projet', 'claude', solera, 'running', 'proto/page-projet', 901, 0.2],
    ['Expiration de session et refresh token', 'claude', solera, 'awaiting', 'feat/158-refresh-token', 158, 1.5],
    ['Graphe en vagues au téléphone', 'codex', solera, 'review', 'feat/911-vagues-mobile', 911, 3],
    ['Revue de la PR #117', 'claude', solera, 'done', 'feat/152-chemins-windows', 152, 20],
    ['Formulaire de devis', 'claude', vitrine, 'running', 'feat/12-devis', 12, 0.6],
    ['Corriger le build CSS', 'grok', vitrine, 'error', 'fix/14-build-css', 14, 2],
    ['Idées de nom pour la newsletter', 'claude', null, 'done', null, null, 5],
    ['Importer les fiches matières', 'codex', atelier, 'awaiting', 'feat/7-import-fiches', 7, 4],
    ['Atlas de textures', 'claude', atelier, 'done', 'jalon3/atlas', 31, 26],
    ['Performances WSL', 'claude', null, 'done', null, null, 30, true],
    ['Dev container sous Windows natif', 'claude', solera, 'done', 'feat/153-dev-container', 153, 52],
    ['Rapport hebdo', 'claude', solera, 'done', null, null, 70],
    ['Migration Tailwind 4', 'opencode', vitrine, 'done', 'chore/tailwind-4', null, 100],
    ['Accès distant Tailscale', 'claude', null, 'done', null, null, 160, true],
    ['Ancienne expérience de rendu', 'codex', atelier, 'done', 'exp/rendu', null, 300, false, true],
    ['Brouillon de README', 'claude', vitrine, 'done', null, null, 400, false, true],
  ]
  const rows: SessionRow[] = spec.map(([title, agent, project, state, branch, card, hoursAgo, pinned, archived], index) => ({
    id: `demo-session-${index}`,
    title,
    agent,
    project,
    state,
    branch,
    card: card ? { number: card, title } : null,
    pinned: pinned ?? false,
    archived: archived ?? false,
    at: now - hoursAgo * HOUR,
    to: null,
  }))
  const inbox: InboxItem[] = rows
    .filter((row) => row.state === 'awaiting' || row.state === 'error')
    .map((row) => ({
      kind: 'session',
      key: `s-${row.id}`,
      title: row.project ? `${row.project.name} · ${row.title}` : row.title,
      agent: row.agent,
      tone: row.state === 'error' ? 'broken' : 'awaiting',
      since: row.at,
      milestone: null,
      cardNumber: row.card?.number ?? null,
      open: '#',
      reply: {
        type: 'demo',
        question: row.state === 'error' ? 'La session s’est arrêtée sur une erreur de build. Relancer ?' : 'Je garde la compatibilité avec l’ancien format, ou on peut le casser ?',
        onAnswer: () => undefined,
      },
    }))
  return { demo: true, pending: false, rows, projects, inbox }
}

export { DAY }
