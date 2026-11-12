import type { Meta, StoryObj } from '@storybook/react-vite'
import { Server } from 'lucide-react'
import { cx } from '@solera/ui'
import { LauncherGroup, TILE_BOX } from './LauncherGroup'

const meta = {
  title: "Composants d'application/LauncherGroup",
  component: LauncherGroup,
  parameters: {
    docs: {
      description: {
        component:
          "Un groupe du **Lanceur** de l'onglet Actions : en-tête sobre (icône, titre, compte), puis une grille de tuiles de taille égale (`TILE_GRID`, `TILE_BOX` : 9,5 rem, rien ne déborde) et, au besoin, la tuile d'ajout en pointillés.",
      },
    },
  },
  args: {
    icon: <Server size={14} />,
    title: 'Services',
    count: 2,
    add: { label: 'Nouveau service', onClick: () => {} },
    children: ['Serveur de dev', 'Storybook'].map((label) => (
      <article key={label} className={cx(TILE_BOX, 'border-line')}>
        <span className="truncate text-sm font-medium text-ink">{label}</span>
      </article>
    )),
  },
} satisfies Meta<typeof LauncherGroup>

export default meta
type Story = StoryObj<typeof meta>

/** Deux tuiles et la tuile d'ajout. */
export const AvecAjout: Story = {}

/** Sans tuile d'ajout : « Lancés par les sessions ». */
export const SansAjout: Story = { args: { add: undefined } }
