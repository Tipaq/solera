import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AgentAvailabilityDto, AgentKind } from '@solera/protocol'
import { DraftAgentPicker, type AgentState } from './DraftAgentPicker'

const base = (agent: AgentKind, installed: boolean): AgentAvailabilityDto => ({
  agent,
  binary: agent,
  enabled: true,
  installed,
  managed: true,
  path: installed ? `/home/alex/.local/share/solera/agents/bin/${agent}` : null,
  version: installed ? '1.0.0' : null,
  reason: installed ? null : 'not_on_path',
  preferredVersion: '1.0.0',
  install: { status: 'idle' },
})

const availability = [base('claude', true), base('codex', true), base('opencode', false), base('grok', false)]
const STATES: Record<AgentKind, AgentState> = { claude: 'ready', codex: 'loggedOut', opencode: 'missing', grok: 'missing' }

/**
 * Les trois états d'une carte côte à côte : prêt avec son aperçu de consommation, sans
 * connexion, absent. L'aperçu vient d'un signal de tour, comme le plus souvent chez Claude.
 */
const meta = {
  title: "Composants d'application/Brouillon · choix du CLI",
  component: DraftAgentPicker,
  args: {
    value: 'claude',
    onChange: () => {},
    availability,
    stateOf: (agent) => STATES[agent],
    accountOf: () => null,
    peek: [{ agent: 'claude', account: null, probed: null, live: [{ type: 'five_hour', status: 'allowed', utilization: null, resetsAt: Date.now() + 2 * 3_600_000, at: Date.now() }] }],
    hidden: [],
    onHide: () => {},
  },
  render: (args) => <div className="w-[40rem]"><DraftAgentPicker {...args} /></div>,
} satisfies Meta<typeof DraftAgentPicker>

export default meta
type Story = StoryObj<typeof meta>

export const Etats: Story = { name: 'Prêt, sans connexion, absent' }

export const Installation: Story = {
  name: 'Installation en cours',
  args: {
    availability: [base('claude', true), base('codex', true), { ...base('opencode', false), install: { status: 'running', version: '1.0.0', startedAt: Date.now() - 20_000, fetched: 12, current: null } }, base('grok', false)],
  },
}
