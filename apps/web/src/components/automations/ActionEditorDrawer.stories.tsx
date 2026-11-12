import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '@solera/ui'
import type { EditorSeed } from '../../lib/action-editor'
import { useTranslate } from '../../lib/i18n'
import { ActionEditorDrawer } from './ActionEditorDrawer'
import { PROJECT_ID, SERVICE_ON, SeededWorktrees } from './automation-fixtures'

/** Le tiroir et le bouton qui l'ouvre : une graine neuve remonte l'éditeur à neuf. */
function Harness({ seed }: { seed: EditorSeed }) {
  const t = useTranslate()
  const [open, setOpen] = useState<EditorSeed | null>(seed)
  return (
    <SeededWorktrees>
      <Button size="sm" onClick={() => setOpen(seed)}>
        {t('actionEditor.label')}
      </Button>
      <ActionEditorDrawer projectId={PROJECT_ID} seed={open} onClose={() => setOpen(null)} />
    </SeededWorktrees>
  )
}

const meta = {
  title: "Composants d'application/Actions/Tiroir de l'éditeur",
  component: Harness,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "L'éditeur unifié dans le **tiroir large**, chargé à son ouverture. Il reste monté le temps de sortir de l'écran ; rouvert, même sur la même graine, il repart d'elle et non de la saisie abandonnée.",
      },
    },
  },
  args: { seed: { preset: { what: 'command' } } },
} satisfies Meta<typeof Harness>

export default meta
type Story = StoryObj<typeof meta>

export const NouvelleCommande: Story = { name: 'Nouvelle commande' }

export const Planifier: Story = { name: '« + Tâche » : un agent planifié', args: { seed: { preset: { what: 'agent' }, schedule: true } } }

export const Modifier: Story = { name: 'Modifier un service', args: { seed: { from: SERVICE_ON } } }
