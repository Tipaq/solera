import type { Meta, StoryObj } from '@storybook/react-vite'
import { AgentLoginDialog } from './AgentLoginDialog'

/**
 * La connexion propre d'un CLI, menée depuis l'interface. Montée sur une connexion déjà
 * lancée (`started`) : sans serveur, le catalogue ne peut pas en lancer une.
 */
const meta = {
  title: "Composants d'application/Connexion guidée · dialogue",
  component: AgentLoginDialog,
  args: {
    agent: 'claude',
    open: true,
    onClose: () => {},
    started: {
      agent: 'claude',
      status: {
        loginId: 'catalogue',
        purpose: 'cli',
        state: 'waiting_code',
        authUrl: 'https://claude.com/cai/oauth/authorize?code=true&state=catalogue',
        error: null,
        account: null,
      },
    },
  },
} satisfies Meta<typeof AgentLoginDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Claude: Story = { name: 'Claude Code · code à coller' }

export const Codex: Story = {
  name: "Codex · code d'appareil",
  args: {
    agent: 'codex',
    started: {
      agent: 'codex',
      status: { state: 'pending', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234', error: null },
    },
  },
}

export const Echec: Story = {
  name: 'Grok · échec',
  args: {
    agent: 'grok',
    started: { agent: 'grok', status: { state: 'failed', verificationUrl: null, userCode: null, error: 'Error: authorization denied' } },
  },
}

export const Connecte: Story = {
  name: 'Connecté',
  args: {
    agent: 'codex',
    started: { agent: 'codex', status: { state: 'done', verificationUrl: null, userCode: null, error: null } },
  },
}
