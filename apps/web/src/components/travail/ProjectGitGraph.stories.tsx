import type { Meta, StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { CommitDetailDto, CommitTurnDto, ConversationDto, GraphDto, GraphNodeDto } from '@solera/protocol'
import type { LiveConversation } from '../../lib/activity'
import { verdictOf, type BranchInfo, type TreeFields, type TreeRow, type TreeScope } from '../../lib/code-model'
import { knownBranches } from '../../lib/graph-model'
import type { ServedMark } from '../../lib/served'
import { graphSearch, GRAPH_PAGE } from '../panel/git/queries'
import { DrawerLayer } from '../shell/Drawer'
import { projectScope } from '../../lib/workspace-scope'
import { CommitSessions, type CommitSessionSources } from './CommitSessions'
import { ProjectGitGraph } from './ProjectGitGraph'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = Date.now()
const PROJECT = 'p1'
const SCOPE = projectScope(PROJECT)

function tree(key: string, over: Partial<TreeFields>): TreeRow {
  const fields: TreeFields = {
    key, root: false, id: key, name: key, branch: key, path: `.worktrees/${key}`, external: false, state: 'unmerged', sessions: [],
    anySessionId: null, card: null, pr: null, ahead: 2, behind: 0, uncommitted: 0, conflicts: false, unmergedCommits: true,
    sizeBytes: null, lastUsedAt: NOW - HOUR, ...over,
  }
  return { ...fields, ...verdictOf(fields, NOW) }
}

const MILESTONE = { id: 'k164', number: 164, title: 'Page projet v2 · 2' }
const TREES: TreeRow[] = [
  tree('root', { root: true, id: null, name: 'main', branch: 'main', state: 'root', ahead: 0 }),
  tree('feat/178-travail-graphe', {
    sessions: [{ id: 's1', title: 'Travail : Graphe', agent: 'claude', tone: 'awaiting' }],
    card: { id: 'k178', number: 178, title: 'Travail : vue « Graphe »', milestone: MILESTONE, source: 'session' },
  }),
  tree('feat/160-coque', { state: 'merged', ahead: 0, unmergedCommits: false, lastUsedAt: NOW - 3 * DAY }),
]
const BRANCHES: BranchInfo[] = [
  {
    key: 'branche:fix/9-liens', name: 'fix/9-liens', kind: 'pr', merged: false, remoteOnly: false, lastCommitAt: NOW - 5 * HOUR, ahead: 1, behind: 0,
    commits: [], pr: { number: 151, url: 'https://github.com/o/r/pull/151', state: 'checks', title: 'Liens' },
    card: { id: 'k9', number: 9, title: 'Les liens morts', milestone: null, source: 'name' },
  },
]

const node = (over: Partial<GraphNodeDto> & Pick<GraphNodeDto, 'hash' | 'subject'>): GraphNodeDto => ({
  kind: 'commit', shortHash: over.hash.slice(0, 7), author: 'Tim', agent: 'Claude Opus 5', ts: NOW, parents: [], refs: [], thread: null,
  lane: 0, through: [], joins: [], collapses: [], tip: false, root: false, run: 0, aboveRun: 0, throughRuns: [], joinRuns: [],
  collapseRuns: [], working: null, ...over,
})

/** Un dépôt de poche : la base, l'arbre de la carte, une branche en PR, une fusionnée rentrée. */
const GRAPH: GraphDto = {
  lanes: 3,
  runs: ['main', 'feat/178-travail-graphe', 'fix/9-liens', 'feat/160-coque'],
  hasMore: true,
  branch: 'main',
  filtered: false,
  nodes: [
    node({ kind: 'working', hash: '', subject: '', tip: true, parents: ['a1'], working: { files: 3, added: 42, removed: 7 } }),
    node({
      hash: 'c178aaa1', subject: 'Graphe : la colonne « Dans Solera »', ts: NOW - 20 * MINUTE, lane: 1, run: 1, aboveRun: 1, tip: true,
      parents: ['a2'], through: [0], throughRuns: [0],
      refs: [{ name: 'feat/178-travail-graphe', kind: 'worktree' }, { name: 'origin/feat/178-travail-graphe', kind: 'remote' }],
      thread: { id: 's1', title: 'Travail : Graphe', sure: true },
    }),
    node({ hash: 'a1bbbbb2', subject: 'Web : l’Agenda des actions', ts: NOW - 2 * HOUR, parents: ['a2'], through: [1], throughRuns: [1], refs: [{ name: 'main', kind: 'local' }, { name: 'origin/main', kind: 'remote' }] }),
    node({
      hash: 'f9ccccc3', subject: 'Liens : un 404 ne casse plus la page', ts: NOW - 5 * HOUR, lane: 2, run: 2, aboveRun: 2, tip: true, parents: ['a2'],
      through: [0, 1], throughRuns: [0, 1], refs: [{ name: 'origin/fix/9-liens', kind: 'remote' }], agent: null,
    }),
    node({ hash: 'a2ddddd4', subject: 'Travail : l’onglet et la vue « Par moment »', ts: NOW - 8 * HOUR, parents: ['a3'], collapses: [1, 2], collapseRuns: [1, 2] }),
    node({ kind: 'merge', hash: 'a3eeeee5', subject: 'Merge pull request #140 from Tipaq/feat/160-coque', ts: NOW - DAY, parents: ['a4', 'b160ff6'], joins: [1], joinRuns: [3] }),
    node({ hash: 'b160ff6', subject: 'Coque : la rangée commune', ts: NOW - 2 * DAY, lane: 1, run: 3, aboveRun: 3, parents: ['a4'], through: [0], throughRuns: [0], refs: [{ name: 'feat/160-coque', kind: 'worktree' }] }),
    node({ hash: 'a4ggggg7', subject: 'Tests des suggestions : les shells sortent', ts: NOW - 3 * DAY, parents: [], root: true, collapses: [1], collapseRuns: [3] }),
  ],
}

const DETAIL: CommitDetailDto = {
  hash: 'c178aaa1', shortHash: 'c178aaa', subject: 'Graphe : la colonne « Dans Solera »', body: '', author: 'Tim', authorEmail: 'tim@example.com',
  agent: 'Claude Opus 5', ts: NOW - 20 * MINUTE, parents: [{ hash: 'a2ddddd4', shortHash: 'a2ddddd' }],
  refs: GRAPH.nodes![1]!.refs, containedIn: ['feat/178-travail-graphe', 'origin/feat/178-travail-graphe'],
  thread: { id: 's1', title: 'Travail : Graphe', sure: true }, threadCandidates: [],
  files: [{ path: 'apps/web/src/components/travail/ProjectGitGraph.tsx', added: 12, removed: 2 }],
  patch: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n-avant\n+après\n+encore\n', truncated: false,
}
const TURN: CommitTurnDto = { conversationId: 's1', title: 'Travail : Graphe', turn: 7, message: 'Ajoute la colonne « Dans Solera »', key: 'k' }

function conversation(id: string, title: string, agent: ConversationDto['agent'], ago: number): ConversationDto {
  return { id, projectId: PROJECT, title, agent, status: 'idle', archivedAt: null, isOwner: true, updatedAt: NOW - ago, worktreeId: null, card: null } as unknown as ConversationDto
}
const CONVERSATIONS = [
  conversation('s1', 'Travail : Graphe', 'claude', 5 * MINUTE),
  conversation('s2', 'Revue de la colonne', 'codex', 3 * HOUR),
  conversation('s3', 'Découper le jalon', 'claude', 2 * DAY),
]
const live = (entry: ConversationDto, status: LiveConversation['status']): LiveConversation => ({
  conversation: entry, status, running: status === 'running', awaiting: status === 'awaiting_input', unread: false,
  settledAt: entry.updatedAt, since: entry.updatedAt, seq: 0,
})
const SCOPES = new Map<string, TreeScope>([['feat/178-travail-graphe', { sessionIds: new Set(['s1', 's2']), cardNumbers: new Set([178]) }]])

/** Un serveur de dev sert l'arbre de la carte : « ⚡ :5173 ». */
const SERVED = new Map<string, ServedMark[]>([['feat/178-travail-graphe', [{ automationId: 'a-dev', label: 'Serveur de dev', port: 5173 }]]])

const SOURCES: CommitSessionSources = {
  conversations: CONVERSATIONS,
  live: [live(CONVERSATIONS[0]!, 'awaiting_input'), live(CONVERSATIONS[1]!, 'idle')],
  scopes: SCOPES,
  cards: [],
  inbox: [],
}

function Seeded({ detail = DETAIL, turn = TURN, children }: { detail?: CommitDetailDto; turn?: CommitTurnDto | null; children: ReactNode }) {
  const [client] = useState(() => {
    const seeded = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    seeded.setQueryData(['git-graph', SCOPE, graphSearch({}, GRAPH_PAGE)], GRAPH)
    seeded.setQueryData(['git-commit', SCOPE, detail.hash], detail)
    seeded.setQueryData(['git-commit-turn', SCOPE, detail.hash], turn)
    return seeded
  })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Le contenu d'un onglet de projet, qui porte le calque des tiroirs. */
function Place({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-[40rem] min-h-0 flex-col overflow-clip border border-line">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10 md:px-6">{children}</div>
      <DrawerLayer />
    </div>
  )
}

function Graph({ targetKey = null, showMerged = false }: { targetKey?: string | null; showMerged?: boolean }) {
  const [target, setTarget] = useState(targetKey)
  return (
    <Seeded>
      <Place>
        <ProjectGitGraph
          projectId={PROJECT}
          trees={TREES}
          branches={BRANCHES}
          targetKey={target}
          from={null}
          showMerged={showMerged}
          served={SERVED}
          onSelect={setTarget}
          onOpenTree={setTarget}
          sources={SOURCES}
        />
      </Place>
    </Seeded>
  )
}

const meta = {
  title: "Composants d'application/Travail/ProjectGitGraph",
  component: Graph,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La vue **Graphe** de Travail (T-7) : le graphe du panneau git sur tout le dépôt du projet, et la colonne « Dans Solera » en face de la tête de chaque branche connue — l'arbre et son verdict (ambre s'il t'attend), ses sessions vivantes, la carte et le jalon, la PR ; une branche sans arbre en pointillé, qui se choisit comme filtre.\n\nL'arbre ou la branche choisi reste net, le reste s'estompe. Les fusionnées perdent leurs étiquettes, pas leurs commits. Les menus qui écrivent sont éteints. Un clic sur un commit ouvre le tiroir large : ses sessions, puis le détail du panneau.",
      },
    },
  },
} satisfies Meta<typeof Graph>

export default meta
type Story = StoryObj<typeof meta>

export const Tout: Story = {}

/** Une branche choisie dans les filtres : le reste du graphe à 35 %. */
export const BrancheChoisie: Story = { name: 'Branche choisie', args: { targetKey: 'feat/178-travail-graphe' } }

/** Le filtre « Fusionné » : les étiquettes des fusionnées reviennent. */
export const AvecFusionnees: Story = { name: 'Avec les fusionnées', args: { showMerged: true } }

/** Le haut du tiroir d'un commit, seul : celle qui l'a écrit au tour près, puis l'arbre. */
function Sessions({ detail, turn, runName = 'feat/178-travail-graphe' }: { detail?: CommitDetailDto; turn?: CommitTurnDto | null; runName?: string | null }) {
  return (
    <Seeded detail={detail} turn={turn}>
      <div className="w-[48rem] max-w-full border border-line">
        <CommitSessions
          projectId={PROJECT}
          scope={SCOPE}
          hash={(detail ?? DETAIL).hash}
          runName={runName}
          known={knownBranches(TREES, BRANCHES)}
          sources={SOURCES}
          onOpenTree={() => {}}
        />
      </div>
    </Seeded>
  )
}

export const TiroirSessions: StoryObj<typeof Sessions> = { name: 'Tiroir : sessions', render: () => <Sessions /> }

/** Sans tour connu, plusieurs fils se recoupaient : tous « déduits des dates ». */
export const TiroirCandidats: StoryObj<typeof Sessions> = {
  name: 'Tiroir : candidats',
  render: () => (
    <Sessions
      turn={null}
      runName="fix/9-liens"
      detail={{
        ...DETAIL,
        hash: 'f9ccccc3',
        containedIn: ['origin/fix/9-liens'],
        thread: null,
        threadCandidates: [{ id: 's2', title: 'Revue de la colonne', sure: false }, { id: 's3', title: 'Découper le jalon', sure: false }],
      }}
    />
  ),
}

export const TiroirVide: StoryObj<typeof Sessions> = {
  name: 'Tiroir : aucune session',
  render: () => <Sessions turn={null} runName="main" detail={{ ...DETAIL, hash: 'a4ggggg7', containedIn: ['main'], thread: null, threadCandidates: [] }} />,
}
