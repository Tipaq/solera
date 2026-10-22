import type { Meta, StoryObj } from '@storybook/react-vite'
import { AWAITING, AWAITING_MANY, SeededDecisions } from '../decisions/decision-fixtures'
import { SidebarAwaiting } from './SidebarAwaiting'

const meta = {
  title: "Composants d'application/SidebarAwaiting",
  component: SidebarAwaiting,
  parameters: {
    docs: {
      description: {
        component:
          "« À décider », dans la colonne : les demandes d'agent qui attendent une personne — les décisions (`request_decision`) et les deux rangements qu'un clic accorde.\n\n**La section n'existe que s'il y a quelque chose**, la règle du bandeau d'un lieu : elle dit une demande, jamais un inventaire, et c'est son apparition qui la rend visible. Posée entre les lieux et l'activité.\n\nUne décision se tranche d'ici, dans son dialogue, et montre le temps qu'il lui reste — c'est le seul des trois genres qui expire. Un rangement mène à la conversation où se trouve déjà son bouton d'accord. Au-delà de cinq lignes (deux au doigt), le reste est compté et mène à l'historique, comme l'en-tête.",
      },
    },
  },
  args: { onNavigate: () => undefined },
} satisfies Meta<typeof SidebarAwaiting>

export default meta
type Story = StoryObj<typeof meta>

/** Deux décisions, un rangement de cartes, un rangement de conversation. */
export const Melange: Story = {
  name: 'Décisions et rangements',
  render: (args) => (
    <SeededDecisions awaiting={AWAITING}>
      <div className="surface w-72 border border-line"><SidebarAwaiting {...args} /></div>
    </SeededDecisions>
  ),
}

/** Sept demandes : cinq lignes, et le reste compté. */
export const Debordement: Story = {
  name: 'Débordement',
  render: (args) => (
    <SeededDecisions awaiting={AWAITING_MANY}>
      <div className="surface w-72 border border-line"><SidebarAwaiting {...args} /></div>
    </SeededDecisions>
  ),
}

/** Au doigt : deux lignes de 44 px, le reste compté. */
export const AuDoigt: Story = {
  name: 'Au doigt',
  args: { coarse: true },
  render: (args) => (
    <SeededDecisions awaiting={AWAITING}>
      <div className="surface w-80 border border-line"><SidebarAwaiting {...args} /></div>
    </SeededDecisions>
  ),
}
