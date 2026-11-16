import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { fromAction } from '../../lib/automations'
import { ACTIONS, PROJECT_ID } from '../actions/action-fixtures'
import { OverviewActionsView } from './OverviewActions'

const NOW = Date.UTC(2026, 9, 24, 10, 0)

/** Les actions du projet de démonstration, plus une commande qui tourne dans un terminal. */
const ITEMS = [
  ...ACTIONS,
  { ...ACTIONS[1]!, id: 'a-lint', label: 'Lint', lastRun: { terminalId: 't-2', alive: true, exitCode: null, startedAt: NOW - 120_000 } },
].map((action) => fromAction(action))

/** La largeur de la colonne de droite de l'Aperçu, 24 rem. */
const column: Decorator = (Story) => <div className="w-96"><Story /></div>

const meta = {
  title: "Composants d'application/Aperçu · Actions",
  component: OverviewActionsView,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Le bloc *Actions* de l'Aperçu (`projet.md` A-5) : ce qui **tourne** ou **attend** seulement — un service en marche avec son port et « Ouvrir », une commande dans un terminal (« Panneau »), une action proposée par un agent (« Relire »). Le reste est compté au repos. Tous les renvois mènent à l'onglet Actions, « Relire » au détail de l'action (`?action=`).",
      },
    },
  },
  args: { projectId: PROJECT_ID, items: ITEMS, now: NOW },
  decorators: [column],
} satisfies Meta<typeof OverviewActionsView>

export default meta
type Story = StoryObj<typeof meta>

/** Un service en marche, une commande dans un terminal, une action à relire. */
export const EnMarche: Story = { name: 'En marche' }

/** Des actions, mais rien ne tourne. */
export const AuRepos: Story = { name: 'Au repos', args: { items: ITEMS.filter((item) => !item.live && !item.review) } }

/** Un projet sans action. */
export const Vide: Story = { args: { items: [] } }
