import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import {
  EMPTY_CONFIG_LAYER,
  resolveAccountDefaults,
  storedUserSettingsSchema,
  type ConfigLayer,
  type McpServerListDto,
  type UserSettingsDto,
} from '@solera/protocol'
import { AgentModelCard, PermissionsSettings, SharedModelCard } from './LayeredSettings'

/** Le compte : les décisions interdites, le rangement de cartes automatique. */
const ACCOUNT: ConfigLayer = {
  ...EMPTY_CONFIG_LAYER,
  shared: { cardFiling: 'auto', decisions: 'deny' },
  claude: { model: 'claude-opus-5-5', permissionMode: 'acceptEdits' },
}

const SETTINGS: UserSettingsDto = (() => {
  const stored = storedUserSettingsSchema.parse({ agentLayer: ACCOUNT })
  return { ...stored, agentDefaults: resolveAccountDefaults(ACCOUNT) }
})()

const REGISTRY: McpServerListDto = {
  servers: [],
  soleraServer: true,
  agentMemory: true,
  projectFiling: true,
  cardFiling: true,
  decisions: true,
} as McpServerListDto

function Seeded({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(['user-settings'], SETTINGS)
    client.setQueryData(['mcp', 'servers'], REGISTRY)
    client.setQueryData(['skill-library', 'list', null], { enabled: true, skills: [] })
    return null
  })
  return <div className="w-[40rem]">{children}</div>
}

const meta = {
  title: "Composants d'application/Réglages des agents",
  component: PermissionsSettings,
  parameters: {
    docs: {
      description: {
        component:
          "Les réglages des agents au niveau du compte (#120) : Réglages › Agents, Permissions et la visite. Les demandes à Solera ont trois états — Interdit, Demande mon accord, Automatique — et valent pour tous les CLI. Le niveau d'un projet a ses rangées dans le brouillon de sa page de réglages.",
      },
    },
  },
} satisfies Meta<typeof PermissionsSettings>

export default meta
type Story = StoryObj<typeof meta>

/** Au compte : la base de toutes les conversations. */
export const PermissionsDuCompte: Story = {
  render: () => (
    <Seeded>
      <PermissionsSettings />
    </Seeded>
  ),
}

/** Modèles par défaut : modèle, effort et abonnement, et le repli « Avancé ». */
export const ModelesParDefaut: Story = {
  render: () => (
    <Seeded>
      <div className="flex flex-col gap-4">
        <AgentModelCard agent="claude" />
        <SharedModelCard />
      </div>
    </Seeded>
  ),
}
