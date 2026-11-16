import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { ProjectDto } from '@solera/protocol'
import { CapField, ColorSwatches, ProjectImageControl, RemoveProject, SettingInput } from './GeneralControls'

const PROJECT = {
  id: 'p1',
  name: 'Nimbus',
  image: null,
  color: '#5BC98C',
  workspacePath: '/home/alex/nimbus',
  isOwner: true,
} as ProjectDto

/** Les contrôles de Réglages › Général, chacun dans la colonne de droite d'une rangée. */
function Controls() {
  const [name, setName] = useState('Nimbus')
  const [cap, setCap] = useState('Un Solera qui se pilote depuis le téléphone.')
  const [color, setColor] = useState<string | null>('#5BC98C')
  return (
    <div className="flex max-w-[36rem] flex-col gap-6">
      <SettingInput label="Nom" value={name} onChange={setName} />
      <CapField value={cap} onChange={setCap} />
      <ColorSwatches value={color} onChange={setColor} />
      <ProjectImageControl project={PROJECT} color={color} />
      <RemoveProject project={PROJECT} />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Réglages › Général",
  component: Controls,
  parameters: {
    docs: {
      description: {
        component:
          "Les contrôles de Général, sans libellé : la rangée le dit à gauche. Le nom, le cap (une phrase, 280 caractères au plus) et la couleur entrent dans le brouillon de la page ; l'image part au choix du fichier, et « Retirer le projet » demande confirmation avant de retirer pour de bon.\n\nLa pastille « par défaut » est l'accent du thème ; un anneau marque la couleur choisie.",
      },
    },
  },
} satisfies Meta<typeof Controls>

export default meta
type Story = StoryObj<typeof meta>

export const Controles: Story = { name: 'Contrôles' }
