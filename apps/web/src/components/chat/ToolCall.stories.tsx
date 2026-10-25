import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { ToolItem } from '../../lib/chat-fold'
import { ToolCallGroup } from './ToolCall'

const call = (id: string, name: string, input: unknown, extra: Partial<ToolItem> = {}): ToolItem => ({
  kind: 'tool', id, ts: 0, name, input, output: 'ok', outputBytes: null, status: 'done', durationMs: 240, parentToolCallId: null, ...extra,
})

/** Une suite ordinaire : lire, chercher, modifier, vérifier, avec une origine de chaque sorte. */
const tools: ToolItem[] = [
  call('read-card', 'mcp__solera__read_card', { card_number: 104 }, { output: 'Lot 6 du second tri…' }),
  call('read', 'Read', { file_path: 'apps/web/src/components/chat/ToolCall.tsx' }, { output: 'export const ToolCall = memo(…)' }),
  call('grep', 'Grep', { pattern: 'toolSummary', path: 'apps/web/src' }, { output: 'apps/web/src/lib/tool-summary.ts\napps/web/src/components/chat/ToolCall.tsx' }),
  call('issue', 'github/issue_read', { number: 58 }, { presentation: { origin: 'mcp', label: 'Lire le ticket' }, output: '#58 Le fil saute' }),
  call('edit', 'Edit', { file_path: 'apps/web/src/lib/tool-rows.ts', old_string: 'flush()', new_string: 'flush(speaks(item))\nrows.push(row)' }),
  call('test', 'Bash', { command: 'pnpm test', description: 'Lancer les tests' }, { status: 'failed', output: '1 échec' }),
  call('write', 'Write', { file_path: 'docs/CODEX.md', content: 'un\ndeux\ntrois\n' }, { status: 'running', durationMs: null, output: null }),
]

/** La largeur d'une colonne de conversation : au-delà, une ligne d'outil n'a rien à remplir. */
const inColumn: Decorator = (Story) => <div className="max-w-2xl"><Story /></div>

const meta = {
  title: "Composants d'application/ToolCallGroup",
  component: ToolCallGroup,
  parameters: {
    docs: {
      description: {
        component:
          "Une suite d'appels d'outils dans le fil, dans la présentation choisie dans Apparence.\n\nUne ligne par appel, à la même hauteur dans toutes les présentations : le symbole de Solera ou une marque MCP disent l'origine, les compteurs `+N / −N` ce qu'une édition change, et un échec se dit en toutes lettres. Close (l'agent a repris la parole), la suite se replie derrière une ligne qui compte les appels, les échecs et les interruptions.",
      },
    },
  },
  args: { tools, conversationId: 'story', complete: false },
  decorators: [inColumn],
} satisfies Meta<typeof ToolCallGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Discret: Story = { name: 'Lignes discrètes', args: { variant: 'inline' } }
export const Chronologie: Story = { args: { variant: 'timeline' } }
export const ParIntention: Story = { name: 'Par intention', args: { variant: 'intent' } }
export const Apercus: Story = { name: 'Aperçus', args: { variant: 'cards' } }
export const Console: Story = { args: { variant: 'console' } }
export const Classique: Story = { args: { variant: 'classic' } }

/** Close : la suite se replie derrière une ligne, qui garde l'échec en vue. */
export const Repliee: Story = {
  name: 'Repliée',
  args: { variant: 'inline', complete: true, tools: tools.map((tool) => tool.status === 'running' ? { ...tool, status: 'done', durationMs: 80 } : tool) },
}
