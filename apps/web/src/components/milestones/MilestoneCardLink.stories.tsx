import type { Meta, StoryObj } from '@storybook/react-vite'
import { loadedStatus } from '../../lib/card-state'
import { PROJECT_ID, SeededBoard, fixtureCard } from '../board/card-fixtures'
import { MilestoneCardLink } from './MilestoneCardLink'

const meta = {
  title: "Composants d'application/MilestoneCardLink",
  component: MilestoneCardLink,
  parameters: {
    docs: {
      description: {
        component:
          "Une carte d'un jalon dans les listes de **Lancer** et du **suivi** : `#N titre`, qui mène à sa session (la fiche s'ouvre par le `ℹ` posé à côté). Le titre trop long se coupe.",
      },
    },
  },
  args: { projectId: PROJECT_ID, card: fixtureCard(931, 'Adresse de secours par IP', 'todo'), statusOf: loadedStatus },
  render: (args) => (
    <SeededBoard>
      <div className="flex w-[240px] rounded-lg border border-line px-2.5 py-1.5 text-sm">
        <MilestoneCardLink {...args} />
      </div>
    </SeededBoard>
  ),
} satisfies Meta<typeof MilestoneCardLink>

export default meta
type Story = StoryObj<typeof meta>

export const Courte: Story = {}

/** Un titre plus long que la ligne. */
export const Longue: Story = {
  args: { card: fixtureCard(937, 'Test de bout en bout au téléphone, coupure réseau comprise', 'todo') },
}
