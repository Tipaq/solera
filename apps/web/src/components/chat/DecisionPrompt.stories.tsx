import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { DecisionPrompt } from './DecisionPrompt'

const HOUR = 3_600_000

const narrow: Decorator = (Story) => <div className="max-w-2xl"><Story /></div>

const meta = {
  title: "Composants d'application/DecisionPrompt",
  component: DecisionPrompt,
  decorators: [narrow],
  parameters: {
    docs: {
      description: {
        component:
          "Une décision que la session a demandée (`request_decision`), dans son fil.\n\nMême forme que les deux rangements, avec un écart : **rien ne se tranche dans la carte elle-même**. Le bouton ouvre le dialogue de réponse, le même que celui de la colonne et des toasts — choisir parmi les options demande de lire le contexte, que le fil n'a pas la place de montrer.\n\nEn attente, elle dit son échéance et ce qui arrivera sans réponse ; close, son issue en une ligne et un badge. Seul le propriétaire de la conversation tranche ; les autres lisent la question et son issue.",
      },
    },
  },
  args: {
    canDecide: true,
    item: {
      kind: 'decision',
      id: 'd1',
      question: 'Monter vite en 7.0 maintenant, ou attendre la 7.0.1 ?',
      options: ['Monter maintenant', 'Attendre la 7.0.1', 'Abandonner la montée'],
      defaultOption: 'Attendre la 7.0.1',
      expiresAt: Date.now() + 11 * HOUR,
      status: 'pending',
      option: null,
      text: null,
    },
  },
} satisfies Meta<typeof DecisionPrompt>

export default meta
type Story = StoryObj<typeof meta>

/** En attente, avec un choix par défaut à l'échéance. */
export const Attente: Story = {}

/** Sans défaut : la session apprendra que personne n'a répondu. */
export const SansDefaut: Story = {
  name: 'Sans défaut',
  args: { item: { ...meta.args.item, options: [], defaultOption: null, expiresAt: Date.now() + 40 * 60_000 } },
}

/** Tranchée : le choix et la précision, en une ligne. */
export const Tranchee: Story = {
  name: 'Tranchée',
  args: {
    item: {
      ...meta.args.item,
      status: 'user',
      option: 'Monter maintenant',
      text: 'Vérifie les avertissements des plugins avant de pousser.',
    },
  },
}

export const ParDefaut: Story = {
  name: 'Défaut appliqué',
  args: { item: { ...meta.args.item, status: 'default', option: 'Attendre la 7.0.1' } },
}

export const Echue: Story = {
  name: 'Échue',
  args: { item: { ...meta.args.item, defaultOption: null, status: 'expired' } },
}

/** La session archivée avant qu'on tranche. */
export const Retiree: Story = {
  name: 'Retirée',
  args: { item: { ...meta.args.item, status: 'withdrawn' } },
}

/** Un fil partagé en lecture : la question se voit, elle ne se tranche pas. */
export const SansDroit: Story = {
  name: 'Sans droit de décider',
  args: { canDecide: false },
}
