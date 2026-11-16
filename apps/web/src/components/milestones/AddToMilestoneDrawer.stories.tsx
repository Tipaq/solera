import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '@solera/ui'
import { CARDS, fixtureCard, PROJECT_ID } from '../board/card-fixtures'
import { DrawerLayer } from '../shell/Drawer'
import { AddToMilestoneDrawer } from './AddToMilestoneDrawer'

const MILESTONE = fixtureCard(182, 'Page projet v2 · Jalons', 'todo', { milestone: true })

function Place() {
  const [open, setOpen] = useState(true)
  return (
    <div className="flex h-[40rem] flex-col border border-line">
      <div className="h-11 shrink-0 border-b border-line" />
      <div className="relative flex min-h-0 flex-1 overflow-clip">
        <div className="min-w-0 flex-1 p-4 md:p-6">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Ajouter au jalon
          </Button>
        </div>
        <AddToMilestoneDrawer open={open} onClose={() => setOpen(false)} projectId={PROJECT_ID} milestone={MILESTONE} cards={CARDS} />
        <DrawerLayer />
      </div>
    </div>
  )
}

const meta = {
  title: "Composants d'application/Ajouter au jalon",
  component: Place,
  parameters: {
    docs: {
      description: {
        component:
          "Le tiroir « Ajouter au jalon » (#196, spec jalons ADD-1..4) : le champ du composer (`BriefField`), plus court et sans Réf./Inclure. Le texte part à la session d'affinage du jalon, qui le range en sous-tâches d'une carte ou en nouvelles cartes ; sa proposition attend le clic dans le résumé d'affinage. Sans session, l'envoi ouvre un brouillon de découpage pré-rempli.",
      },
    },
  },
} satisfies Meta<typeof Place>

export default meta
type Story = StoryObj<typeof meta>

/** Ouvert, vide : la phrase d'aide et « Proposer à l'agent » grisé. */
export const Vide: Story = {}
