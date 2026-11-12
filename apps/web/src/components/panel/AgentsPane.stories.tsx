import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import type { BackgroundWork } from '../../lib/background'
import type { ChatItem, EditTurn } from '../../lib/chat-fold'
import type { SubAgent } from '../../lib/subagents'
import { AgentsPane } from './AgentsPane'

const ROOT = '/srv/solera/apps/web/src'
const now = Date.now()
const MIN = 60_000

const tool = (id: string, name: string, input: unknown, parent: string): ChatItem => ({
  kind: 'tool', id, ts: now - 2 * MIN, name, input, output: null, outputBytes: null, status: 'done', durationMs: 40, parentToolCallId: parent,
})
const said = (id: string, parent: string, text: string): ChatItem => ({
  kind: 'message', id, role: 'assistant', ts: now - MIN, seq: 0, blocks: [{ type: 'text', text }], streamingText: '', streamingThinking: '', parentToolCallId: parent,
})
const subAgent = (id: string, description: string, status: SubAgent['status'], items: ChatItem[], extra: Partial<SubAgent> = {}): SubAgent => ({
  id, type: 'Explore', description, status, startedAt: now - 2 * MIN, durationMs: null, activity: null, items,
  toolCount: items.filter((item) => item.kind === 'tool').length, totalTokens: 0, parentId: null, ...extra,
})

const EXPLORER = subAgent('a1', 'Explorer le panneau', 'running', [
  tool('r1', 'Read', { file_path: `${ROOT}/components/panel/SidePanel.tsx` }, 'a1'),
  tool('e1', 'Edit', { file_path: `${ROOT}/components/panel/AgentsPane.tsx`, old_string: 'a\nb', new_string: 'a\nb\nc\nd' }, 'a1'),
  said('m1', 'a1', 'Le panneau Agent lit trois sources : les sous-agents, les travaux de fond et les tours qui ont écrit.\nLes sous-agents viennent des appels de spawn.\nLes travaux de fond viennent de la liste de niveau du CLI.\nRien d’autre à signaler.'),
], { startedAt: now - 3 * MIN, totalTokens: 18_400 })
const AGENTS: SubAgent[] = [
  subAgent('a2', 'Relire les specs', 'done', [tool('w1', 'Write', { file_path: `${ROOT}/lib/agent-files.ts`, content: 'un\ndeux\ntrois' }, 'a2')], { startedAt: now - 10 * MIN, durationMs: 90_000 }),
  EXPLORER,
  subAgent('a3', 'Chercher les clés i18n', 'interrupted', [], { startedAt: now - 8 * MIN }),
  subAgent('a4', 'Mesurer la hauteur des lignes', 'running', [], { startedAt: now - MIN }),
]
const BACKGROUND: BackgroundWork[] = [
  { id: 'k1', kind: 'local_bash', description: 'Serveur de dev', command: 'pnpm exec vite --port 5418', activity: null, lastTool: null, toolUses: 0, totalTokens: 0 },
  { id: 'k2', kind: 'workflow', description: 'Revue des PR', command: null, activity: 'lit la PR #211', lastTool: 'Read', toolUses: 4, totalTokens: 12_000 },
]
const TURNS: EditTurn[] = [
  { id: 't1', ts: now - 9 * MIN, label: 'Réécrire le panneau', files: [
    { path: `${ROOT}/lib/panel.ts`, action: 'modified', toolCallIds: ['p1', 'p2'] },
    { path: `${ROOT}/components/panel/AgentsPane.tsx`, action: 'modified', toolCallIds: ['e1'] },
  ] },
  { id: 't2', ts: now - 4 * MIN, label: 'Les tests', files: [{ path: `${ROOT}/lib/agent-files.ts`, action: 'created', toolCallIds: ['w1'] }] },
]

function Frame({ width = 'w-[26rem]', children }: { width?: string; children: ReactNode }) {
  return <div className={`surface flex h-[40rem] flex-col border border-line ${width}`}>{children}</div>
}

const meta = {
  title: "Composants d'application/AgentsPane",
  component: AgentsPane,
  parameters: {
    docs: {
      description: {
        component:
          "L'onglet *Agent* du panneau d'une conversation : qu'est-ce qui tourne sous ce fil ? Pas de ligne d'outils : **En cours** mêle les sous-agents qui travaillent et les travaux de fond ; les terminés se replient en « N terminés ▸ » ; le pied « **Modifié par la session** » nomme chaque fichier écrit et qui l'a écrit. Un clic ouvre le détail **en pile** (« ‹ Agent ») : fichiers, résultat et fil d'un sous-agent, ou ce qu'on sait d'un travail de fond, avec « Arrêter » et « En faire une action ».",
      },
    },
  },
  args: {
    conversationId: 'c1',
    title: 'Onglet Agent',
    agent: 'claude',
    agents: AGENTS,
    background: BACKGROUND,
    editTurns: TURNS,
    selectedId: null,
    onOpenFile: () => {},
  },
  render: (args) => (
    <Frame>
      <AgentsPane {...args} />
    </Frame>
  ),
} satisfies Meta<typeof AgentsPane>

export default meta
type Story = StoryObj<typeof meta>

/** Deux sous-agents qui travaillent, deux travaux de fond, deux terminés repliés, trois fichiers écrits. */
export const Liste: Story = {}

/** Rien ne tourne, rien d'écrit : une ligne, sans illustration. */
export const Vide: Story = { args: { agents: [], background: [], editTurns: [] } }

/** Le détail d'un sous-agent qui travaille : ses fichiers, son résultat, son fil, « Interrompre la session ». */
export const SousAgent: Story = { args: { selectedId: EXPLORER.id } }

/** À 22 rem : les métas cèdent avant les libellés. */
export const Etroit: Story = {
  render: (args) => (
    <Frame width="w-[22rem]">
      <AgentsPane {...args} />
    </Frame>
  ),
}
