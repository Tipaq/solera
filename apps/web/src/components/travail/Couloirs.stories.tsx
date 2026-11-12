import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { AgentKind, ConversationDto, JournalEntryDto, JournalKind } from '@solera/protocol'
import { DrawerLayer } from '../shell/Drawer'
import type { LiveConversation } from '../../lib/activity'
import type { ActivityRow } from '../../lib/activity-rows'
import { scopeOf, verdictOf, type BranchInfo, type TreeFields, type TreeRow } from '../../lib/code-model'
import type { ServedMark } from '../../lib/served'
import { DEFAULT_DISPLAY, type TravailDisplay } from '../../lib/travail-model'
import { laneLayout, lanesOf } from '../../lib/travail-lanes'
import { CouloirsView } from './CouloirsView'
import type { LaneRail } from './Lane'
import { TravailNoticeHost } from './TravailNotice'
import { TreeDrawer, type DrawerSession } from './TreeDrawer'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const MB = 1024 * 1024
const NOW = Date.now()

const milestone = { id: 'k164', number: 164, title: 'Page projet v2 · 2' }

function tree(key: string, over: Partial<TreeFields>): TreeRow {
  const fields: TreeFields = {
    key, root: false, id: key, name: key, branch: key, path: `/wt/${key}`, external: false, state: 'unmerged', sessions: [],
    anySessionId: null, card: null, pr: null, ahead: 2, behind: 1, uncommitted: 0, conflicts: false, unmergedCommits: true,
    sizeBytes: 640 * MB, lastUsedAt: NOW - 2 * HOUR, ...over,
  }
  return { ...fields, ...verdictOf(fields, NOW) }
}

const TREES: TreeRow[] = [
  tree('root', { root: true, id: null, name: 'main', branch: 'main', path: '/p/nimbus', state: 'root', ahead: 0, behind: 0, sizeBytes: 1480 * MB, lastUsedAt: NOW - DAY }),
  tree('feat/175-travail', {
    sessions: [{ id: 'c-ask', title: 'Travail : la barre', agent: 'claude', tone: 'awaiting' }],
    card: { id: 'k175', number: 175, title: 'Travail : onglet, barre, Par moment', milestone, source: 'session' },
    uncommitted: 3,
  }),
  tree('feat/178-graphe', {
    sessions: [{ id: 'c-run', title: 'Vue Graphe', agent: 'codex', tone: 'running' }],
    card: { id: 'k178', number: 178, title: 'Travail : vue Graphe', milestone, source: 'name' },
    pr: { number: 151, url: 'https://github.com/o/r/pull/151', state: 'checks' },
    behind: 24,
  }),
  tree('spike/terminal', { lastUsedAt: NOW - 30 * DAY, sizeBytes: null }),
  tree('feat/160-coque', { state: 'merged', ahead: 0, unmergedCommits: false, pr: { number: 140, url: null, state: 'merged' }, sizeBytes: 1120 * MB }),
]

const BRANCHES: BranchInfo[] = [
  {
    key: 'branche:feat/181-liste', name: 'feat/181-liste', kind: 'pr', merged: false, remoteOnly: false, lastCommitAt: NOW - 6 * HOUR, ahead: 3, behind: 0,
    commits: [
      { hash: 'a1', shortHash: 'a1b2c3d', title: 'Liste : les colonnes resserrées', at: NOW - 6 * HOUR },
      { hash: 'b2', shortHash: 'b2c3d4e', title: 'Liste : le tri par geste', at: NOW - 9 * HOUR },
    ],
    pr: { number: 152, url: 'https://github.com/o/r/pull/152', state: 'draft', title: 'Liste' },
    card: { id: 'k181', number: 181, title: 'Tableau : vues Liste et Par geste', milestone, source: 'name' },
  },
  { key: 'branche:essai', name: 'essai', kind: 'remote', merged: false, remoteOnly: true, lastCommitAt: NOW - 4 * DAY, ahead: 1, behind: 12, commits: [], pr: null, card: null },
  { key: 'branche:fix/old', name: 'fix/old', kind: 'merged', merged: true, remoteOnly: false, lastCommitAt: NOW - 9 * DAY, ahead: 0, behind: 30, commits: [], pr: null, card: null },
]

function liveRow(id: string, title: string, agent: AgentKind, branch: string, marker: ActivityRow['marker']): ActivityRow {
  const conversation = { id, projectId: 'p1', title, agent, card: null, updatedAt: NOW - 4 * MINUTE, isOwner: true, worktreeId: branch } as unknown as ConversationDto
  const entry = { conversation, status: 'running', running: true, awaiting: false, unread: false, settledAt: NOW, since: NOW - 4 * MINUTE } as unknown as LiveConversation
  return { entry, group: marker === 'awaiting' ? 'asking' : 'running', marker, summary: null, place: { root: false, branch, path: `/wt/${branch}` }, pr: null, request: null }
}

let next = 0
function event(kind: JournalKind, ago: number, title: string, extra: Partial<JournalEntryDto> = {}): JournalEntryDto {
  next += 1
  return { id: `e${next}`, kind, at: NOW - ago, title, projectId: 'p1', cardNumber: null, source: null, count: null, status: null, conversationId: null, ...extra }
}

const LIVE = [liveRow('c-ask', 'Travail : la barre', 'claude', 'feat/175-travail', 'awaiting'), liveRow('c-run', 'Vue Graphe', 'codex', 'feat/178-graphe', 'working')]
const ENTRIES: JournalEntryDto[] = [
  event('branch', 20 * MINUTE, 'feat/178-graphe : 2 commits poussés', { count: 2 }),
  event('session', 40 * MINUTE, 'Session lancée dans feat/175-travail', { conversationId: 'c-old', cardNumber: 175, source: 'Claude' }),
  event('note', 70 * MINUTE, 'Décision : la barre tient sur une ligne', { cardNumber: 175 }),
  event('branch', 2 * HOUR, 'feat/175-travail : 4 commits poussés', { count: 4 }),
  event('run', 3 * HOUR, 'Tests de feat/175-travail', { status: 'failed' }),
  event('cardClosed', 5 * HOUR, 'Page projet v2 · 1 — Socle commun', { cardNumber: 157 }),
  event('audit', DAY, 'Audit de la page projet versé dans docs/audits'),
]
const CONVERSATIONS = [
  { id: 'c-ask', worktreeId: 'feat/175-travail', card: { number: 175 } },
  { id: 'c-old', worktreeId: 'feat/175-travail', card: { number: 175 } },
  { id: 'c-run', worktreeId: 'feat/178-graphe', card: null },
]
const SCOPES = new Map(TREES.map((entry) => [entry.key, scopeOf(entry, CONVERSATIONS)]))

const SESSIONS: DrawerSession[] = [
  { id: 'c-ask', title: 'Travail : la barre', agent: 'claude', updatedAt: NOW - 4 * MINUTE },
  { id: 'c-old', title: 'Travail : le premier jet', agent: 'claude', updatedAt: NOW - 2 * DAY },
]

const RAIL: LaneRail = {
  isMilestone: (number) => number === 157,
  agentOf: (entry) => (entry.conversationId ? 'claude' : null),
  entryHref: (entry) => (entry.conversationId ? `/p/p1/c/${entry.conversationId}` : null),
}
const SERVED = new Map<string, ServedMark[]>([['feat/178-graphe', [{ automationId: 'a-dev', label: 'Serveur de dev', port: 5173 }]]])

function View({ display = DEFAULT_DISPLAY, forced = false }: { display?: TravailDisplay; forced?: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  const layout = laneLayout({ lanes: lanesOf({ trees: TREES, live: LIVE, entries: ENTRIES, scopes: SCOPES, now: NOW }), branches: BRANCHES, display, forced, targeted: false, now: NOW })
  const tree = TREES.find((entry) => entry.key === open) ?? null
  return (
    <TravailNoticeHost>
      <div className="relative flex h-[46rem] overflow-clip border border-line">
        <div className="min-w-0 flex-1 overflow-y-auto px-4 pt-4 pb-10 md:px-6">
          <CouloirsView projectId="p1" layout={layout} rail={RAIL} served={SERVED} flash={null} onOpen={setOpen} onCleanTree={() => {}} onCleanTrees={() => {}} />
        </div>
        <DrawerLayer />
      </div>
      <TreeDrawer
        projectId="p1"
        tree={tree}
        sessions={tree?.key === 'feat/175-travail' ? SESSIONS : []}
        entries={tree ? ENTRIES.filter((entry) => entry.title.includes(tree.branch ?? '') || entry.cardNumber === tree.card?.number) : []}
        journalDays={14}
        rail={RAIL}
        served={tree ? SERVED.get(tree.key) : undefined}
        onClose={() => setOpen(null)}
        onClean={() => {}}
      />
    </TravailNoticeHost>
  )
}

const meta = {
  title: "Composants d'application/Travail par arbre",
  parameters: {
    docs: {
      description: {
        component:
          "La vue « Par arbre » de Travail (T-4) : un couloir par arbre (son fil : sessions vivantes, trois derniers événements), un par branche sans worktree, le couloir « Projet », puis « À nettoyer » et les branches fusionnées, repliés. L'en-tête d'un couloir ouvre le tiroir de l'arbre (T-11).",
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** Sans regroupement : les arbres, puis les branches sans worktree. Un clic sur un en-tête ouvre le tiroir. */
export const ParArbre: Story = { name: 'Par arbre', render: () => <View /> }

/** Regroupés par jalon, « Sans jalon » en dernier. */
export const ParJalon: Story = { name: 'Regroupés par jalon', render: () => <View display={{ ...DEFAULT_DISPLAY, group: 'milestone' }} /> }

/** Un filtre « À nettoyer » : les sections repliées s'ouvrent d'office. */
export const ANettoyer: Story = { name: 'À nettoyer déplié', render: () => <View forced /> }
