import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { DEFAULT_DISPLAY } from '../../lib/board-model'
import { KanbanView } from './KanbanView'
import { BOARD, PROJECT_ID } from './board-fixtures'

const inPlace: Decorator = (Story) => (
  <div className="h-[40rem] border border-line">
    <Story />
  </div>
)

const meta = {
  title: "Composants d'application/KanbanView",
  component: KanbanView,
  decorators: [inPlace],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "Le Kanban du Tableau (B-4) : colonnes de largeur fixe triées selon l'affichage, Fait et Abandonné étroites et repliables, « Vide » discret, et au choix des couloirs par jalon. Glisser une tuile la range dans la colonne visée.",
      },
    },
  },
  args: {
    entries: BOARD.cards,
    milestones: BOARD.milestones,
    display: DEFAULT_DISPLAY,
    projectId: PROJECT_ID,
    onOpen: () => {},
    onMove: () => {},
    onSeeAllDone: () => {},
  },
} satisfies Meta<typeof KanbanView>

export default meta
type Story = StoryObj<typeof meta>

/** Fait limitée aux 5 plus récentes, « Tout voir » au pied. */
export const Columns: Story = {}

/** Une rangée par jalon qui a des feuilles ouvertes, puis « Sans jalon ». */
export const Lanes: Story = { args: { display: { ...DEFAULT_DISPLAY, lanes: true } } }

/** Fait masquée, les abandonnées montrées. */
export const Abandoned: Story = { args: { display: { ...DEFAULT_DISPLAY, done: 'hidden', abandoned: true } } }

/** Rien ne passe les filtres : chaque colonne dit « Vide ». */
export const Empty: Story = { args: { entries: [] } }
