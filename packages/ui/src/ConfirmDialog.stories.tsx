import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from './Button'
import { ConfirmDialog } from './ConfirmDialog'

const meta = {
  title: 'Primitives/ConfirmDialog',
  parameters: {
    docs: {
      description: {
        component:
          "La confirmation d'une action **qu'on ne devine pas**.\n\nLe corps explique ce qui va se passer, pas seulement ce qu'on s'apprête à cliquer : une action dont le nom suffit (« Fermer ») n'a rien à faire ici, et une action dont le nom ne suffit pas mérite mieux qu'un « Êtes-vous sûr ? ».\n\n`tone=\"critical\"` pour ce qui détruit : la couleur doit dire ce que le libellé annonce. `busy` désactive la confirmation pendant l'action sans fermer le dialogue.\n\nNoter le gabarit : `rounded-lg` et centré même au doigt, là où le reste des dialogues de l'application part du bas en feuille. C'est une dérogation assumée — un dialogue de 26 rem n'a pas besoin d'une feuille.",
      },
    },
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

function Demo() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Supprimer le worktree
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Supprimer ce worktree ?"
        confirmLabel="Supprimer"
        tone="critical"
        onConfirm={() => setOpen(false)}
      >
        <p>Les modifications non commitées seront perdues. La branche, elle, reste.</p>
      </ConfirmDialog>
    </>
  )
}

export const Destructif: Story = {
  render: () => <Demo />,
}
