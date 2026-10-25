import type { Meta, StoryObj } from '@storybook/react-vite'
import { useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import type { CardDto, MilestoneRunCardDto, MilestoneRunDto } from '@solera/protocol'
import { CardMilestone } from './CardMilestone'
import { CURRENT, PROJECT_ID, SeededBoard } from './card-fixtures'

const PARENT: CardDto = { ...CURRENT, id: '00000000-0000-4000-8000-000000000075', number: 75, title: 'Orchestrer le travail par cartes' }

const row = (number: number, title: string, layer: number, extra: Partial<MilestoneRunCardDto>): MilestoneRunCardDto => ({
  cardId: `card-${number}`, number, title, layer, status: 'queued', blockReason: null, blockedBy: [],
  conversationId: null, conversationTitle: null, conversationStatus: null, worktreeName: null,
  agent: null, model: null, error: null, ...extra,
})

const RUN: MilestoneRunDto = {
  id: 'run', cardId: PARENT.id, state: 'running', concurrency: 3, agent: 'claude', model: 'claude-opus-5-5',
  branch: 'jalon/75-orchestrer-le-travail-par-cartes', busy: 2, createdAt: Date.now() - 3_600_000, endedAt: null,
  cards: [
    row(66, 'Ce qu’un agent fait avec les cartes', 0, { status: 'done', conversationId: 'c66', worktreeName: 'feat/66-agent-cartes' }),
    row(68, 'Flux de livraison : PR, revue, fusion', 0, { status: 'reviewing', conversationId: 'c68', worktreeName: 'feat/68-flux-de-livraison' }),
    row(67, 'Colonne « à préciser »', 1, { status: 'blocked', blockReason: 'to_clarify', conversationId: 'c67' }),
    row(70, 'Découper en cartes depuis une dictée', 1, { status: 'working', conversationId: 'c70', worktreeName: 'feat/70-decouper' }),
    row(71, 'Promouvoir une sous-tâche', 1, { status: 'queued' }),
    row(72, 'Lancer un jalon', 2, { status: 'waiting', blockedBy: [{ number: 67, title: 'Colonne « à préciser »', outside: false, abandoned: false }, { number: 68, title: 'Flux de livraison', outside: false, abandoned: false }] }),
  ],
}

function Seeded({ run, children }: { run: MilestoneRunDto | null; children: ReactNode }) {
  const client = useQueryClient()
  useState(() => {
    client.setQueryData(['milestone-run', PARENT.id], run)
    return null
  })
  return <SeededBoard>{children}</SeededBoard>
}

const meta = {
  title: "Composants d'application/CardMilestone",
  component: CardMilestone,
  parameters: {
    docs: {
      description: {
        component:
          "Le jalon d'une carte parente (#72), dans sa fiche : le lancer, puis voir qui travaille où.\n\n**C'est le serveur qui pilote** : les cartes partent dans l'ordre de leurs liens « bloque », dans la limite de la concurrence. La liste suit les étages du graphe ; une carte bloquée dit pourquoi et n'arrête que celles qui en dépendent.",
      },
    },
  },
  args: { card: PARENT, projectId: PROJECT_ID, onSelectCard: () => undefined },
} satisfies Meta<typeof CardMilestone>

export default meta
type Story = StoryObj<typeof meta>

/** Jamais lancé : l'explication et le bouton qui ouvre l'aperçu. */
export const JamaisLance: Story = {
  render: (args) => <Seeded run={null}><div className="w-[36rem]"><CardMilestone {...args} /></div></Seeded>,
}

/** En marche : deux sessions au travail sur trois, une carte bloquée, une qui attend. */
export const EnMarche: Story = {
  render: (args) => <Seeded run={RUN}><div className="w-[36rem]"><CardMilestone {...args} /></div></Seeded>,
}

/** En pause : plus aucun lancement, les sessions en cours continuent. */
export const EnPause: Story = {
  render: (args) => <Seeded run={{ ...RUN, state: 'paused' }}><div className="w-[36rem]"><CardMilestone {...args} /></div></Seeded>,
}
