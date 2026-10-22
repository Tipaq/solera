import type { Meta, StoryObj } from '@storybook/react-vite'
import { RestoreCheckpointDialog } from './RestoreCheckpointDialog'
import { turnCheckpoint } from './checkpoint-fixtures'

const meta = {
  title: "Composants d'application/RestoreCheckpointDialog",
  component: RestoreCheckpointDialog,
  parameters: {
    docs: {
      description: {
        component:
          "La confirmation avant de ramener le workspace à l'état d'avant un tour.\n\nLe geste réécrit des fichiers sans que l'agent le sache : il garde le souvenir de ce qu'il a écrit. D'où la case qui propose de brancher la conversation juste avant le message du tour — le pendant conversationnel du retour en arrière : la branche repart d'un agent qui n'a jamais vu ces fichiers, avec le message du tour revenu dans sa barre de saisie.\n\nLes commits restent : ce qui a été commité pendant le tour revient en modifications non commitées.",
      },
    },
  },
  args: {
    conversationId: 'c1',
    checkpoint: turnCheckpoint,
    openerText: turnCheckpoint.openerText,
    onClose: () => {},
  },
} satisfies Meta<typeof RestoreCheckpointDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Plusieurs: Story = { name: 'Plusieurs fichiers' }

export const UnSeul: Story = {
  name: 'Un seul fichier',
  args: { checkpoint: { ...turnCheckpoint, files: turnCheckpoint.files.slice(0, 1) } },
}
