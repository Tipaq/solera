import type { Meta, StoryObj } from '@storybook/react-vite'
import { ArchiveRequestsDialog } from './ArchiveRequestsDialog'

/**
 * La fenêtre qui prévient avant d'archiver un fil dont des demandes attendent (#119).
 * Elle n'apparaît que s'il y a quelque chose à perdre : un fil sans demande s'archive
 * comme avant, sans rien demander.
 */
const meta = {
  title: "Composants d'application/ArchiveRequestsDialog",
  component: ArchiveRequestsDialog,
  args: {
    pending: [{ id: 'c1', projectId: 'p1', decision: 1, cardChange: 1, cardDraft: 0, move: 0 }],
    onShow: () => {},
    onConfirm: () => {},
    onClose: () => {},
  },
} satisfies Meta<typeof ArchiveRequestsDialog>

export default meta
type Story = StoryObj<typeof meta>

/** Un fil, deux demandes de genres différents. */
export const UnFil: Story = { name: 'Un fil' }

/** Une seule demande : le singulier. */
export const UneDemande: Story = {
  name: 'Une demande',
  args: { pending: [{ id: 'c1', projectId: 'p1', decision: 0, cardChange: 0, cardDraft: 1, move: 0 }] },
}

/** Un archivage en lot : un seul récapitulatif pour tous les fils. */
export const EnLot: Story = {
  name: 'En lot',
  args: {
    pending: [
      { id: 'c1', projectId: 'p1', decision: 2, cardChange: 0, cardDraft: 0, move: 0 },
      { id: 'c2', projectId: 'p1', decision: 0, cardChange: 1, cardDraft: 0, move: 1 },
      { id: 'c3', projectId: null, decision: 1, cardChange: 0, cardDraft: 0, move: 0 },
    ],
  },
}
