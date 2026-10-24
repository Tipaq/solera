import type { Meta, StoryObj } from '@storybook/react-vite'
import { ACTIONS, PROJECT_ID, SeededActions } from './action-fixtures'
import { ActionsLauncher } from './ActionsLauncher'

const meta = {
  title: "Composants d'application/ActionsLauncher",
  component: ActionsLauncher,
  parameters: {
    docs: {
      description: {
        component:
          "Le lanceur des actions, dans la bande d'une conversation et la ligne de filtres du board : la même liste que la vue *Actions*, sans ouvrir le panneau. L'éclair compte les services en marche ; une pastille signale une action à relire.",
      },
    },
  },
  args: { projectId: PROJECT_ID },
} satisfies Meta<typeof ActionsLauncher>

export default meta
type Story = StoryObj<typeof meta>

/** Un service en marche et une action à relire. */
export const EnMarche: Story = {
  name: 'En marche',
  render: (args) => <SeededActions actions={ACTIONS}><ActionsLauncher {...args} /></SeededActions>,
}

/** Rien ne tourne, rien n'attend : l'éclair seul. */
export const AuRepos: Story = {
  name: 'Au repos',
  render: (args) => <SeededActions actions={ACTIONS.slice(1, 2)}><ActionsLauncher {...args} /></SeededActions>,
}
