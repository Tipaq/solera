import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { LauncherView } from './LauncherView'
import type { ActionHandlers } from './useActionGestures'
import { SeededWorktrees, STATES } from './automation-fixtures'

const ignore = () => {}
const HANDLERS: ActionHandlers = {
  onOpen: ignore,
  onEdit: ignore,
  onLaunch: ignore,
  onLaunchUnchecked: ignore,
  onToggle: ignore,
  onService: ignore,
  onTerminal: ignore,
  onDuplicate: ignore,
  onDelete: ignore,
}
const withWorktrees: Decorator = (Story) => (
  <SeededWorktrees>
    <div className="flex w-[60rem] max-w-full flex-col gap-7">
      <Story />
    </div>
  </SeededWorktrees>
)

const meta = {
  title: "Composants d'application/Actions/Lanceur",
  component: LauncherView,
  decorators: [withWorktrees],
  args: { items: STATES, handlers: HANDLERS, servedOf: () => null, serving: () => null, onNew: ignore },
  parameters: {
    docs: {
      description: {
        component:
          "Le **Lanceur** de l'onglet Actions : Services, Commandes, Agents, chacun avec sa tuile d'ajout, même vide. Celui d'un projet, et celui de chaque projet au portefeuille, sous l'en-tête de son groupe. Les gestes viennent de `useActionGestures` ; ce qu'ouvrent les tuiles est l'affaire de la page.",
      },
    },
  },
} satisfies Meta<typeof LauncherView>

export default meta
type Story = StoryObj<typeof meta>

export const Lanceur: Story = {}

/** Sans action : les trois groupes restent, avec leur tuile d'ajout. */
export const Vide: Story = { args: { items: [] } }
