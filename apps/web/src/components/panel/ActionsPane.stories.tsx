import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { ACTIONS, PROJECT_ID, SeededActions } from '../actions/action-fixtures'
import { ActionsPane } from './ActionsPane'

const framed: Decorator = (Story) => (
  <div className="surface flex h-[34rem] w-[30rem] flex-col border border-line"><Story /></div>
)

const meta = {
  title: "Composants d'application/ActionsPane",
  component: ActionsPane,
  decorators: [framed],
  parameters: {
    docs: {
      description: {
        component:
          "La vue *Actions* du panneau : les boutons du projet, qui lancent une commande d'un clic. Une **tâche** se joue dans un terminal du panneau et garde son code de sortie ; un **service** tourne en unité systemd, visible dans Services.\n\nUne action écrite par un agent attend d'être relue : son seul geste est *Relire*, qui montre la commande avant de la lancer.",
      },
    },
  },
  args: { projectId: PROJECT_ID, conversationId: 'c-here' },
} satisfies Meta<typeof ActionsPane>

export default meta
type Story = StoryObj<typeof meta>

/** Un état par ligne : service en marche, tâche en échec, action à relire, service tombé. */
export const Actions: Story = {
  render: (args) => <SeededActions actions={ACTIONS}><ActionsPane {...args} /></SeededActions>,
}

/** Aucun bouton encore : l'invitation à en créer un. */
export const Vide: Story = {
  render: (args) => <SeededActions actions={[]}><ActionsPane {...args} /></SeededActions>,
}
