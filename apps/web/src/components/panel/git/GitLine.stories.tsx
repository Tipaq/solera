import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { GitStateDto } from '@solera/protocol'
import { projectScope } from '../../../lib/workspace-scope'
import { GitActionsProvider } from './actions'
import { GitLine } from './GitLine'

/** Trois largeurs de panneau : la ligne se replie, elle ne passe jamais à la ligne. */
const inPanels: Decorator = (Story) => (
  <GitActionsProvider scope={projectScope('demo')} lock={null}>
    <div className="flex flex-col gap-4">
      {['w-[20rem]', 'w-[30rem]', 'w-[48rem]'].map((width) => (
        <div key={width} className={`${width} border border-line`}>
          <Story />
        </div>
      ))}
    </div>
  </GitActionsProvider>
)

const state: GitStateDto = {
  branch: 'feat/222-panneau-cadre-git',
  upstream: 'origin/feat/222-panneau-cadre-git',
  ahead: 2,
  behind: 0,
  detached: false,
  staged: [],
  unstaged: [],
  stagedPatch: '',
  unstagedPatch: '',
  truncated: false,
  head: { hash: 'ebb6b5a7', shortHash: 'ebb6b5a', subject: 'Panneau : la ligne d’outils Git' },
  lock: null,
  undo: null,
  redo: null,
  coAuthor: null,
  conflicted: [],
  rebase: null,
}

const meta = {
  title: "Composants d'application/GitLine",
  component: GitLine,
  parameters: {
    docs: {
      description: {
        component:
          "La ligne d'outils de l'onglet Git du panneau, sur le cadre commun (`PanelToolbar`) : « Git » et la branche, **Affichage ▾** (les six destinations, leur aide et leur compte), le repère ambre des conflits, puis les gestes du dépôt qui n'ont pas d'objet à désigner.\n\nElle remplace le rail vertical et la barre au-dessus. Les gestes se replient par paliers de largeur utile — 22, 26, 38 et 46 rem — pour tenir sur une ligne de 20 rem au téléphone comme au panneau large.",
      },
    },
  },
  decorators: [inPanels],
  args: {
    state,
    destination: 'graph',
    counts: { working: 3, branches: 4, stashes: 1 },
    onDestination: () => {},
    onRefresh: () => {},
    refreshing: false,
  },
} satisfies Meta<typeof GitLine>

export default meta
type Story = StoryObj<typeof meta>

/** Deux commits à pousser : Pousser passe à l'accent. */
export const APousser: Story = { name: 'À pousser' }

export const AJour: Story = {
  name: 'À jour',
  args: { state: { ...state, ahead: 0 }, destination: 'working' },
}

/** Pendant un conflit : le repère ambre prend la place des gestes de remise. */
export const EnConflit: Story = {
  name: 'En conflit',
  args: { state: { ...state, conflicted: ['vite.config.ts', 'src/main.ts'] }, destination: 'conflicts' },
}
