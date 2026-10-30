import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ClaudeLoginStatusDto } from '@solera/protocol'
import { ClaudeCodeSteps, DeviceCodeSteps } from './LoginSteps'

const waiting: ClaudeLoginStatusDto = {
  loginId: 'catalogue',
  purpose: 'cli',
  state: 'waiting_code',
  authUrl: 'https://claude.com/cai/oauth/authorize?code=true&state=catalogue',
  error: null,
  account: null,
}

/**
 * Les étapes d'une connexion menée par un CLI côté serveur : coller le code de la page
 * d'autorisation (Claude), ou saisir un code d'appareil sur la page du fournisseur
 * (Codex, Grok). Les mêmes pour un compte supplémentaire et pour le CLI lui-même.
 */
const meta = {
  title: "Composants d'application/Connexion guidée · étapes",
  component: ClaudeCodeSteps,
  args: { status: waiting, onCancel: () => {} },
  render: (args) => <div className="w-[34rem]"><ClaudeCodeSteps {...args} /></div>,
} satisfies Meta<typeof ClaudeCodeSteps>

export default meta
type Story = StoryObj<typeof meta>

export const CodeAttendu: Story = { name: 'Claude · code attendu' }

export const Preparation: Story = {
  name: 'Claude · le CLI prépare la page',
  args: { status: { ...waiting, state: 'starting', authUrl: null } },
}

export const Verification: Story = {
  name: 'Claude · vérification du code',
  args: { status: { ...waiting, state: 'checking' } },
}

export const Refuse: Story = {
  name: 'Claude · code refusé',
  args: {
    status: {
      ...waiting,
      state: 'failed',
      error: "Code refusé (Invalid code). Une nouvelle page d'autorisation est prête : rouvre le lien ci-dessus et colle son code.",
    },
  },
}

export const CodeAppareil: Story = {
  name: "Codex · code d'appareil",
  render: () => (
    <div className="w-[34rem]">
      <DeviceCodeSteps agent="codex" userCode="ABCD-1234" verificationUrl="https://auth.openai.com/codex/device" onCancel={() => {}} />
    </div>
  ),
}
