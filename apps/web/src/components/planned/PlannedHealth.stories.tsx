import type { Meta, StoryObj } from '@storybook/react-vite'
import { PLANNED, costOf } from './planned-fixtures'
import { PlannedHealth } from './PlannedHealth'

const meta = {
  title: "Composants d'application/Planifiées/Liste",
  component: PlannedHealth,
  args: { items: PLANNED, group: 'due', costOf, onOpen: () => {} },
  parameters: {
    docs: {
      description: {
        component:
          "**La Liste des Planifiées** (PLF-7), l'ancienne vue Santé : quatre chiffres (réussite et coût sur 30 jours, en échec, prochain passage), puis À regarder, En bonne santé, En pause — ou par portée, les plus en échec en tête. Les chiffres viennent de `healthSummary`, le motif sous un nom de `healthMotive`.",
      },
    },
  },
} satisfies Meta<typeof PlannedHealth>

export default meta
type Story = StoryObj<typeof meta>

export const ParEtat: Story = { name: 'Par état' }

export const ParPortee: Story = { name: 'Par portée', args: { group: 'scope' } }
