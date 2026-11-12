import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { AgentKind, ConversationDto } from '@solera/protocol'
import type { LiveConversation } from '../../lib/activity'
import type { ActivityGroup } from '../../lib/activity-groups'
import type { ActivityRow } from '../../lib/activity-rows'
import { verdictOf, type TreeFields, type TreeRow } from '../../lib/code-model'
import type { InboxItem } from '../../lib/inbox'
import { stateColumns } from '../../lib/state-board'
import { StateBoard, type StateBoardModel } from './StateBoard'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.now()

function tree(branch: string, over: Partial<TreeFields> = {}): TreeRow {
  const fields: TreeFields = {
    key: `/wt/${branch}`, root: false, id: branch, name: branch, branch, path: `/wt/${branch}`, external: false, state: 'unmerged', sessions: [],
    anySessionId: null, card: null, pr: null, ahead: 2, behind: 0, uncommitted: 0, conflicts: false, unmergedCommits: true,
    sizeBytes: null, lastUsedAt: NOW - HOUR, ...over,
  }
  return { ...fields, ...verdictOf(fields, NOW) }
}

const TREES = {
  travail: tree('feat/179-travail-par-etat', { sessions: [{ id: 'c1', title: 'Par état', agent: 'claude', tone: 'running' }] }),
  graphe: tree('feat/178-travail-graphe', { sessions: [{ id: 'c2', title: 'Graphe', agent: 'codex', tone: 'running' }] }),
  barre: tree('feat/162-barre-outils', { pr: { number: 140, url: null, state: 'ready' } }),
  root: tree('main', { root: true, id: null, state: 'root', key: 'root' }),
}

function row(id: string, title: string, group: ActivityGroup, agent: AgentKind, ago: number, card: number | null): ActivityRow {
  const conversation = {
    id,
    projectId: 'p1',
    title,
    agent,
    card: card ? { id: `card-${card}`, number: card, title: `Carte ${card}`, column: 'in_progress' } : null,
    createdAt: NOW - ago - HOUR,
    updatedAt: NOW - ago,
    archivedAt: null,
    worktreeId: null,
  } as unknown as ConversationDto
  const entry = { conversation, status: group === 'running' ? 'running' : 'idle', running: group === 'running', awaiting: false, unread: false, settledAt: NOW, since: NOW - ago } as unknown as LiveConversation
  return { entry, group, marker: 'working', summary: null, place: { root: false, branch: null, path: null }, pr: null, request: null }
}

const ROWS: ActivityRow[] = [
  row('c1', 'Travail : vues Par état et Frise', 'running', 'claude', 4 * MINUTE, 179),
  row('c2', 'Vue Graphe et tiroir d’un commit', 'running', 'codex', 12 * MINUTE, 178),
  row('c3', 'La barre sur une ligne', 'review', 'claude', 5 * HOUR, 162),
  row('c4', 'Relecture du modèle Code', 'done', 'claude', 2 * HOUR, null),
  row('c5', 'Tiroir commun', 'done', 'opencode', DAY + 3 * HOUR, 161),
  row('c6', 'Trop ancienne pour la colonne', 'done', 'claude', 5 * DAY, null),
]

const TREE_OF: Record<string, TreeRow> = { c1: TREES.travail, c2: TREES.graphe, c3: TREES.barre, c4: TREES.root }

const INBOX: InboxItem[] = [
  {
    kind: 'session', key: 's-a', conversationId: 's-a', title: 'Socle commun de la page projet', project: null, agent: 'claude', tone: 'awaiting',
    since: NOW - 12 * MINUTE, milestone: { number: 157, title: 'Socle commun', to: '/p/p1/timeline/157' }, cardNumber: 163,
    threadPath: '/p/p1/c/s-a', request: null, canDecide: true,
  },
  { kind: 'light', key: 'c-158', tone: 'review-card', title: 'Comptes d’onglet à trois tons', project: null, number: 158, to: '/p/p1/board?carte=158', external: false, since: NOW - 3 * HOUR },
]

function Board({ inbox = INBOX, rows = ROWS }: { inbox?: InboxItem[]; rows?: ActivityRow[] }) {
  const [target, setTarget] = useState<string | null>(null)
  const model: StateBoardModel = {
    projectId: 'p1',
    inbox,
    ...stateColumns(rows, NOW),
    treeOf: (entry) => TREE_OF[entry.entry.conversation.id] ?? null,
    milestoneOf: (entry) => (entry.entry.conversation.card ? { number: 164, title: 'Page projet v2 · 2' } : null),
    targetKey: target,
    onSelectTree: (key) => setTarget((current) => (current === key ? null : key)),
  }
  return (
    <div className="p-6">
      <StateBoard model={model} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Travail par état",
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La vue « Par état » de Travail (T-8) : ce qui t'attend, avec la réponse sur place, puis les sessions qui travaillent, celles à relire et celles finies ces trois derniers jours. La puce d'arbre d'une carte filtre sur l'arbre.",
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Les quatre colonnes remplies ; la session de cinq jours n'est plus « récente ». */
export const ParEtat: Story = { name: 'Par état', render: () => <Board /> }

/** Rien nulle part : chaque colonne dit son vide. */
export const Vide: Story = { name: 'Vide', render: () => <Board inbox={[]} rows={[]} /> }
