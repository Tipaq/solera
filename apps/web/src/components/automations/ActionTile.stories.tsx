import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { Server, SquareTerminal } from 'lucide-react'
import { servedIndex } from '../../lib/served'
import { ActionTile, type TileHandlers } from './ActionTile'
import { LauncherGroup } from './LauncherGroup'
import { AGENT, AGENT_RUNNING, FAILED, FAIL_STREAK, IN_TERMINAL, NEVER, PROPOSED, SERVICE_OFF, SERVICE_ON, SERVICE_SCHEDULED, SUCCEEDED, SeededWorktrees } from './automation-fixtures'

const ignore = () => {}
const HANDLERS: TileHandlers = {
  onOpen: ignore,
  onEdit: ignore,
  onLaunch: ignore,
  onToggle: ignore,
  onService: ignore,
  onTerminal: ignore,
  onDuplicate: ignore,
  onDelete: ignore,
}
const withWorktrees: Decorator = (Story) => <SeededWorktrees><Story /></SeededWorktrees>

const ROOT = { key: 'root', root: true, id: null, path: '/srv/nimbus', name: 'nimbus', branch: 'main', state: 'root' as const, ahead: 0, behind: 0, uncommitted: 0 }
const INDEX = servedIndex([SERVICE_ON], [ROOT])

function Grid() {
  const tile = (item: typeof SERVICE_ON) => (
    <ActionTile key={item.id} item={item} served={INDEX.byAutomation.get(item.id) ?? null} serving={null} handlers={HANDLERS} />
  )
  return (
    <div className="flex flex-col gap-7">
      <LauncherGroup icon={<Server size={14} />} title="Services" count={3} add={{ label: 'Nouveau service', onClick: ignore }}>
        {[SERVICE_ON, SERVICE_OFF, SERVICE_SCHEDULED].map(tile)}
      </LauncherGroup>
      <LauncherGroup icon={<SquareTerminal size={14} />} title="Commandes" count={6} add={{ label: 'Nouvelle commande', onClick: ignore }}>
        {[SUCCEEDED, FAILED, FAIL_STREAK, NEVER, IN_TERMINAL, PROPOSED].map(tile)}
      </LauncherGroup>
    </div>
  )
}

const meta = {
  title: "Composants d'application/Actions/Tuile du Lanceur",
  component: ActionTile,
  decorators: [withWorktrees],
  args: { item: NEVER, served: null, serving: null, handlers: HANDLERS },
  parameters: {
    docs: {
      description: {
        component:
          "La tuile d'une action dans le **Lanceur** de l'onglet Actions : toutes de la même taille. En-tête (icône de nature et point d'état, libellé qui ouvre le détail, phrase d'état, ⋯), le contexte (ce qu'un service sert, la commande ou le prompt, la cadence), et un seul geste principal en bas à gauche. Une tuile qui tourne prend un liseré d'accent, une action à relire une bordure ambre. Le ⋯ porte les gestes rares : détail, modifier, planifier, redémarrer et journal d'un service en marche, dupliquer, supprimer.",
      },
    },
  },
  render: (args) => (
    <div className="w-[17rem]">
      <ActionTile {...args} />
    </div>
  ),
} satisfies Meta<typeof ActionTile>

export default meta
type Story = StoryObj<typeof meta>

/** Chaque état, en grille : services, puis commandes. */
export const Lanceur: Story = { name: 'Lanceur', render: () => <Grid /> }

/** Jamais lancée : « Lancer ▾ ». */
export const JamaisLancee: Story = { name: 'Jamais lancée' }

/** À relire : bordure ambre, « Relire ». */
export const ARelire: Story = { name: 'À relire', args: { item: PROPOSED } }

/** Un agent planifié, puis un agent dont un passage tourne. */
export const Agent: Story = { name: 'Agent planifié', args: { item: AGENT } }
export const AgentEnCours: Story = { name: 'Agent en cours', args: { item: AGENT_RUNNING } }

/** Au téléphone : une colonne, la tuile garde sa hauteur. */
export const Telephone: Story = {
  name: 'Téléphone',
  render: () => (
    <div className="w-[22rem]">
      <Grid />
    </div>
  ),
}
