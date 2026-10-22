import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { AgentAvailabilityDto, AgentKind, AgentModelsDto } from '@solera/protocol'
import { HandoffDialog } from './HandoffDialog'

const available = (agent: AgentKind, installed = true): AgentAvailabilityDto => ({
  agent,
  binary: agent,
  enabled: true,
  installed,
  managed: false,
  path: installed ? `/usr/local/bin/${agent}` : null,
  version: installed ? '1.0.0' : null,
  reason: installed ? null : 'not_on_path',
  preferredVersion: '1.0.0',
  install: { status: 'idle' },
})

const models = (...names: string[]): AgentModelsDto => ({
  models: names.map((name, index) => ({
    value: name,
    displayName: name,
    description: '',
    hint: null,
    isDefault: index === 0,
    efforts: [],
    defaultEffort: null,
    supportsFastMode: false,
  })),
  modes: [],
  account: null,
  outputStyles: [],
  fastMode: null,
  agents: [],
  fetchedAt: 0,
})

/**
 * Le dialogue lit la disponibilité des CLI et leurs modèles par le réseau : on les sème
 * dans le client du catalogue, comme `SeededBoard` le fait pour le board.
 */
const seeded = (opencodeInstalled: boolean): Decorator => (Story) => {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(['agents', 'availability'], {
      agents: [available('claude'), available('codex'), available('opencode', opencodeInstalled)],
    })
    client.setQueryData(['agents', 'codex', 'models'], models('gpt-5.5-codex', 'gpt-5.5'))
    client.setQueryData(['agents', 'opencode', 'models'], models('anthropic/claude-sonnet-5-5'))
    client.setQueryData(['projects'], [])
    return null
  })
  return <Story />
}

const meta = {
  title: "Composants d'application/HandoffDialog",
  component: HandoffDialog,
  parameters: {
    docs: {
      description: {
        component:
          "Continuer une conversation dans un autre CLI, depuis le `+` du composer.\n\nLe CLI courant n'est pas proposé : le fork existe pour ça. On choisit le CLI, son modèle, et l'étendue du fil transmis, 16 k jetons par défaut. La suite s'ouvre vide, et la nouvelle demande s'y écrit.",
      },
    },
  },
  args: {
    open: true,
    onOpenChange: () => {},
    source: { id: 'c-source', agent: 'claude', projectId: null },
  },
} satisfies Meta<typeof HandoffDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Depuis Claude : Codex et OpenCode sont proposés, le premier installé est retenu. */
export const DepuisClaude: Story = { name: 'Depuis Claude', decorators: [seeded(true)] }

/** Un CLI absent reste dans la liste, grisé par sa raison, pour qu'on sache l'installer. */
export const CliAbsent: Story = {
  name: 'Un CLI absent',
  decorators: [seeded(false)],
  args: { source: { id: 'c-source', agent: 'codex', projectId: null } },
}
