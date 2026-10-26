import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import {
  EMPTY_CONFIG_LAYER,
  resolveAccountDefaults,
  storedUserSettingsSchema,
  type ConfigLayer,
  type McpServerListDto,
  type ProjectDto,
  type UserSettingsDto,
} from '@solera/protocol'
import { ModelDefaultsSettings, PermissionsSettings } from './LayeredSettings'

/** Le compte : les décisions interdites, le rangement de cartes automatique. */
const ACCOUNT: ConfigLayer = {
  ...EMPTY_CONFIG_LAYER,
  shared: { cardFiling: 'auto', decisions: 'deny' },
  claude: { model: 'claude-opus-5-5', permissionMode: 'acceptEdits' },
}

/** Le projet ouvre les décisions et change le mode de Claude : le reste vient du compte. */
const PROJECT_LAYER: ConfigLayer = {
  ...EMPTY_CONFIG_LAYER,
  shared: { decisions: 'ask', decisionMaxHours: 24 },
  claude: { permissionMode: 'plan' },
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

const project = (isOwner: boolean): ProjectDto =>
  ({
    id: '00000000-0000-4000-8000-000000000120',
    name: 'Solera',
    isOwner,
    configLayer: PROJECT_LAYER,
  }) as unknown as ProjectDto

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
          "Les réglages des agents, le même composant au compte et au projet (#120). Chaque niveau ne garde que ce qu'il change.\n\n**Au projet**, chaque ligne dit si elle est héritée du compte ou modifiée ici, avec de quoi revenir à l'héritage. Les demandes à Solera ont trois états — Interdit, Demande mon accord, Automatique — et valent pour tous les CLI.",
      },
    },
  },
  args: { level: { kind: 'account' } },
} satisfies Meta<typeof PermissionsSettings>

export default meta
type Story = StoryObj<typeof meta>

/** Au compte : la base de toutes les conversations. */
export const PermissionsDuCompte: Story = {
  render: (args) => (
    <Seeded>
      <PermissionsSettings {...args} />
    </Seeded>
  ),
}

/** Au projet : les décisions et le mode de Claude modifiés ici, le reste hérité. */
export const PermissionsDuProjet: Story = {
  args: { level: { kind: 'project', project: project(true) } },
  render: (args) => (
    <Seeded>
      <PermissionsSettings {...args} />
    </Seeded>
  ),
}

/** Un membre qui n'est pas propriétaire lit les réglages du projet sans les changer. */
export const ProjetEnLecture: Story = {
  args: { level: { kind: 'project', project: project(false) } },
  render: (args) => (
    <Seeded>
      <PermissionsSettings {...args} />
    </Seeded>
  ),
}

/** Modèles par défaut : modèle, effort et abonnement, et le repli « Avancé ». */
export const ModelesParDefaut: Story = {
  render: (args) => (
    <Seeded>
      <ModelDefaultsSettings {...args} />
    </Seeded>
  ),
}
