import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { CardIssueComments, CardIssueLink } from './CardIssue'
import { FROM_ISSUE, SeededBoard } from './card-fixtures'

const withBoard: Decorator = (Story) => <SeededBoard><Story /></SeededBoard>
const issue = FROM_ISSUE.issue!

const meta = {
  title: "Composants d'application/CardIssue",
  component: CardIssueLink,
  decorators: [withBoard],
  parameters: {
    docs: {
      description: {
        component:
          "L'issue dont une carte vient (#84). **Solera fait foi** : seul l'état de la carte repart vers l'outil — terminée ferme l'issue, abandonnée la ferme comme non prévue, refusée la ferme avec un mot. La discussion se lit en direct, sans stockage.",
      },
    },
  },
  args: { issue },
} satisfies Meta<typeof CardIssueLink>

export default meta
type Story = StoryObj<typeof meta>

export const Ouverte: Story = {
  render: (args) => <div className="surface w-72 p-4"><CardIssueLink {...args} /></div>,
}

/** Fermée par Solera après la clôture de la carte. */
export const Fermee: Story = {
  args: { issue: { ...issue, state: 'closed' } },
  render: (args) => <div className="surface w-72 p-4"><CardIssueLink {...args} /></div>,
}

/** GitHub a refusé la fermeture : l'erreur est dite, et l'écriture sera retentée. */
export const EcritureRefusee: Story = {
  args: { issue: { ...issue, pending: 'completed', pushError: 'Resource not accessible by personal access token (HTTP 403)' } },
  render: (args) => <div className="surface w-72 p-4"><CardIssueLink {...args} /></div>,
}

/** La discussion de l'issue, sous l'énoncé de la carte. */
export const Discussion: Story = {
  render: () => <div className="surface w-[32rem] p-4"><CardIssueComments card={FROM_ISSUE} /></div>,
}
