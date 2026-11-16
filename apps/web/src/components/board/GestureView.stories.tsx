import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { GestureView } from './GestureView'
import { BOARD, PROJECT_ID } from './board-fixtures'

const inPlace: Decorator = (Story) => (
  <div className="h-[40rem] border border-line">
    <Story />
  </div>
)

const meta = {
  title: "Composants d'application/GestureView",
  component: GestureView,
  decorators: [inPlace],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Par geste (B-6) : les cartes rangées par ce qu'elles attendent de quelqu'un. À toi, Les agents travaillent, Prêtes à partir (« Lancer » mène à la destination de la carte), Attendent une autre carte, Fait cette semaine repliée. Une carte n'y paraît qu'une fois.",
      },
    },
  },
  args: { entries: BOARD.cards, projectId: PROJECT_ID, onOpen: () => {} },
} satisfies Meta<typeof GestureView>

export default meta
type Story = StoryObj<typeof meta>

export const Sections: Story = {}

/** Rien ne passe les filtres : chaque section dit « Rien ici. ». */
export const Empty: Story = { args: { entries: [] } }
