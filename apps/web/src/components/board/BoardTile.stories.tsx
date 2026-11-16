import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { DndContext } from '@dnd-kit/core'
import { BoardTile, StillTile } from './BoardTile'
import { boardEntry } from './board-fixtures'

const inColumn: Decorator = (Story) => (
  <DndContext>
    <div className="w-72">
      <Story />
    </div>
  </DndContext>
)

const meta = {
  title: "Composants d'application/BoardTile",
  component: BoardTile,
  decorators: [inColumn],
  parameters: {
    docs: {
      description: {
        component:
          "La tuile du Tableau (B-3) : l'étiquette du jalon, le titre sur deux lignes, les drapeaux qui demandent un geste, puis le numéro, les sous-tâches, l'échéance et les agents vivants. Un clic ouvre la fiche ; au pointeur, elle se glisse dans une autre colonne.",
      },
    },
  },
  args: { entry: boardEntry(138) },
} satisfies Meta<typeof BoardTile>

export default meta
type Story = StoryObj<typeof meta>

/** Une session t'attend : bord et filet ambres, anneau ambre autour de son agent. */
export const Waiting: Story = {}

/** Deux agents tournent ; le point accent pulse. */
export const Running: Story = { args: { entry: boardEntry(180) } }

/** Échéance passée : en rouge. */
export const Late: Story = { args: { entry: boardEntry(181) } }

/** À préciser. */
export const ToClarify: Story = { args: { entry: boardEntry(139) } }

/** Venue de l'extérieur, pas encore acceptée ; sans jalon, sans étiquette. */
export const ToAccept: Story = { args: { entry: boardEntry(201) } }

/** Close : atténuée. */
export const Done: Story = { args: { entry: boardEntry(175) } }

/** Dans un couloir, le jalon est dit par l'en-tête. */
export const InLane: Story = { args: { entry: boardEntry(138), showMilestone: false } }

/** Par geste : la même tuile, qui ne se saisit pas (`StillTile`). */
export const Still: Story = { render: (args) => <StillTile entry={args.entry} onOpen={args.onOpen} /> }
