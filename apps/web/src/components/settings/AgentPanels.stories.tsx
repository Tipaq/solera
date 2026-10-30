import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import type { AgentAvailabilityDto } from '@solera/protocol'
import { AgentAuthCard, AgentInstallCard } from './AgentPanels'

const installed: AgentAvailabilityDto = {
  agent: 'codex',
  binary: 'codex',
  enabled: true,
  installed: true,
  managed: true,
  path: '/home/alex/.local/share/solera/agents/bin/codex',
  version: '0.162.1',
  reason: null,
  preferredVersion: '0.162.1',
  install: { status: 'idle' },
}

/**
 * Les deux premiers blocs d'un onglet de la section Agents. Montés à part : la section
 * elle-même lit le serveur, et le catalogue n'en a pas.
 */
const meta = {
  title: "Composants d'application/Section Agents",
  component: AgentInstallCard,
  args: { entry: installed },
  parameters: {
    docs: {
      description: {
        component:
          "L'installation d'un CLI (version présente face à la version visée, installation ou mise à jour) et sa connexion propre (état, méthode, forfait, identité, et la commande qui connecte quand il ne l'est pas).",
      },
    },
  },
} satisfies Meta<typeof AgentInstallCard>

export default meta

/** La largeur d'une section des réglages. */
function Frame({ children }: { children: ReactNode }) {
  return <div className="w-[40rem]">{children}</div>
}
type Story = StoryObj<typeof meta>

export const AJour: Story = {
  name: 'Installé, à jour',
  render: () => <Frame><AgentInstallCard entry={installed} /></Frame>,
}

export const Ecart: Story = {
  name: 'Version incompatible',
  render: () => <Frame><AgentInstallCard entry={{ ...installed, managed: false, path: '/usr/local/bin/codex', version: '0.120.0' }} /></Frame>,
}

export const Absent: Story = {
  render: () => <Frame><AgentInstallCard entry={{ ...installed, agent: 'grok', binary: 'grok', installed: false, managed: false, path: null, version: null, reason: 'not_on_path', preferredVersion: '1.0.62' }} /></Frame>,
}

export const Desactive: Story = {
  name: 'Désactivé',
  render: () => <Frame><AgentInstallCard entry={{ ...installed, enabled: false, installed: false, reason: 'disabled' }} /></Frame>,
}

export const EnCours: Story = {
  name: 'Installation en cours',
  render: () => (
    <Frame>
      <AgentInstallCard
        entry={{ ...installed, installed: false, install: { status: 'running', version: '0.162.1', startedAt: Date.now() - 41_000, fetched: 6, current: 'codex-0.162.1.tgz' } }}
      />
    </Frame>
  ),
}

export const Connecte: Story = {
  name: 'Connecté',
  render: () => (
    <Frame>
      <AgentAuthCard
        agent="claude"
        auth={{ agent: 'claude', account: null, status: 'ready', method: 'claude.ai', plan: 'max', identity: 'alex@example.com' }}
        error={false}
        checking={false}
        onCheck={() => {}}
      />
    </Frame>
  ),
}

export const Deconnecte: Story = {
  name: 'Non connecté',
  render: () => (
    <Frame>
      <AgentAuthCard
        agent="grok"
        auth={{ agent: 'grok', account: null, status: 'logged_out', method: null, plan: null, identity: null }}
        error={false}
        checking={false}
        onCheck={() => {}}
      />
    </Frame>
  ),
}

/** Un CLI posé par Solera vit hors du PATH d'un terminal ordinaire : la commande le désigne par son chemin. */
export const DeconnectePoseParSolera: Story = {
  name: 'Non connecté, posé par Solera',
  render: () => (
    <Frame>
      <AgentAuthCard
        agent="codex"
        entry={installed}
        auth={{ agent: 'codex', account: null, status: 'logged_out', method: null, plan: null, identity: null }}
        error={false}
        checking={false}
        onCheck={() => {}}
      />
    </Frame>
  ),
}

export const Lecture: Story = {
  name: 'Lecture en cours',
  render: () => <Frame><AgentAuthCard agent="codex" auth={undefined} error={false} checking onCheck={() => {}} /></Frame>,
}

/** Ce que voit l'administrateur : la connexion guidée d'abord, la commande en secours. */
export const DeconnecteGuide: Story = {
  name: 'Non connecté, connexion guidée',
  render: () => (
    <Frame>
      <AgentAuthCard
        agent="claude"
        entry={{ ...installed, agent: 'claude', binary: 'claude', path: '/home/alex/.local/share/solera/agents/bin/claude' }}
        auth={{ agent: 'claude', account: null, status: 'logged_out', method: null, plan: null, identity: null }}
        error={false}
        checking={false}
        onCheck={() => {}}
        onSignIn={() => {}}
      />
    </Frame>
  ),
}

/** Un utilisateur qui n'administre pas l'instance : la connexion du CLI vaut pour tous. */
export const DeconnecteReserve: Story = {
  name: "Non connecté, réservé à l'administrateur",
  render: () => (
    <Frame>
      <AgentAuthCard
        agent="codex"
        auth={{ agent: 'codex', account: null, status: 'logged_out', method: null, plan: null, identity: null }}
        error={false}
        checking={false}
        onCheck={() => {}}
        signInReserved
      />
    </Frame>
  ),
}
