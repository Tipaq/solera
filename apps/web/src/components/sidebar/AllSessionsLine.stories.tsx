import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { AllSessionsLine } from './AllSessionsLine'

/** La largeur de la colonne, où la ligne vit. */
const inColumn: Decorator = (Story) => <div className="w-64"><Story /></div>

const meta = {
  title: "Composants d'application/AllSessionsLine",
  component: AllSessionsLine,
  parameters: {
    docs: {
      description: {
        component:
          "La ligne de fin d'une liste de sessions de la colonne : elle mène à la page `/sessions`, filtrée sur le groupe.\n\nLe compte est le total du groupe, **archivées comprises** — c'est ce que montre la page. L'icône tombe sur la colonne d'icônes de la sidebar (créneau de 16 px).",
      },
    },
  },
  args: { to: '/sessions?projet=p1', label: 'Toutes les sessions du projet', count: 47, onNavigate: () => {} },
  decorators: [inColumn],
} satisfies Meta<typeof AllSessionsLine>

export default meta
type Story = StoryObj<typeof meta>

export const Projet: Story = {}

export const SansProjet: Story = {
  name: 'Sans projet',
  args: { to: '/sessions?projet=none', label: 'Toutes les sessions sans projet', count: 12 },
}

/** Sous *Fils*, le total ne se dit que s'il y a une coupe, dans le libellé. */
export const Fils: Story = {
  args: { to: '/sessions', label: 'Toutes les sessions · 214', count: undefined },
}
