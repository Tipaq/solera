import type { Meta, StoryObj } from '@storybook/react-vite'
import { DEFAULT_CLAUDE_CONFIG, type UsagePeekDto } from '@solera/protocol'
import { DraftAccount } from './DraftAccount'

const HOUR = 3_600_000

/** Une sonde récente : c'est elle qui donne un pourcentage, Claude n'en dit rien en tour. */
const probed: UsagePeekDto[] = [
  {
    agent: 'claude',
    account: null,
    probed: {
      agent: 'claude',
      plan: 'max',
      limitsAvailable: true,
      windows: [{ id: 'five_hour', label: '5 heures', utilization: 0.42, resetsAt: Date.now() + 3 * HOUR }],
      credits: null,
      fetchedAt: Date.now() - 5 * 60_000,
    },
    live: [],
  },
]

/**
 * Le compte d'une conversation pas encore créée. Hors serveur, le catalogue n'a pas de
 * compte supplémentaire : il montre la ligne seule, celle de la connexion du CLI.
 */
const meta = {
  title: "Composants d'application/Brouillon · compte",
  component: DraftAccount,
  args: {
    config: DEFAULT_CLAUDE_CONFIG,
    onChange: () => {},
    disabled: false,
    auth: { agent: 'claude', account: null, status: 'ready', method: 'claude.ai', plan: 'max', identity: 'alex@example.com' },
    peek: probed,
  },
  render: (args) => <div className="w-[36rem]"><DraftAccount {...args} /></div>,
} satisfies Meta<typeof DraftAccount>

export default meta
type Story = StoryObj<typeof meta>

export const Connexion: Story = { name: 'Connexion du CLI, sonde récente' }

export const EnTour: Story = {
  name: 'Sans sonde, signal de tour',
  args: {
    peek: [{ agent: 'claude', account: null, probed: null, live: [{ type: 'five_hour', status: 'allowed', utilization: null, resetsAt: Date.now() + 2 * HOUR, at: Date.now() }] }],
  },
}

export const NonConnecte: Story = {
  name: 'Non connecté',
  args: { auth: { agent: 'claude', account: null, status: 'logged_out', method: null, plan: null, identity: null }, peek: [] },
}
