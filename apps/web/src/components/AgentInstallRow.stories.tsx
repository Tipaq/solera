import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AgentAvailabilityDto } from '@solera/protocol'
import { AgentInstallRow } from './AgentInstallRow'

const missing: AgentAvailabilityDto = {
  agent: 'grok',
  binary: 'grok',
  enabled: true,
  installed: false,
  managed: false,
  path: null,
  version: null,
  reason: 'not_on_path',
  preferredVersion: '0.4.2',
  install: { status: 'idle' },
}

const meta = {
  title: "Composants d'application/AgentInstallRow",
  component: AgentInstallRow,
  args: { entry: missing },
  parameters: {
    docs: {
      description: {
        component:
          "Un CLI manquant et l'installation de la version que Solera vise, partagés par l'écran d'une conversation neuve et par la visite de première ouverture. Rien pour un CLI installé ou désactivé.",
      },
    },
  },
} satisfies Meta<typeof AgentInstallRow>

export default meta
type Story = StoryObj<typeof meta>

export const Manquant: Story = {}

export const EnCours: Story = {
  name: 'Installation en cours',
  args: { entry: { ...missing, install: { status: 'running', version: '0.4.2' } } },
}

export const Echec: Story = {
  name: 'Échec',
  args: { entry: { ...missing, install: { status: 'failed', version: '0.4.2', error: 'npm a quitté avec le code 1.' } } },
}
