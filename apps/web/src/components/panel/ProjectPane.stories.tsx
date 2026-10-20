import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import type { ChatItem } from '../../lib/chat-fold'
import { CURRENT, PROJECT_ID, SeededBoard } from '../board/card-fixtures'
import { ProjectPane, type ProjectPaneSession } from './ProjectPane'

/** Le plan que l'agent tient, tel que `TodoWrite` le publie dans le fil. */
const PLAN: ChatItem = {
  kind: 'tool', id: 't1', ts: 0, name: 'TodoWrite', output: null, outputBytes: null, status: 'done', durationMs: 12, parentToolCallId: null,
  input: { todos: [
    { content: 'Rebaser sur main, régler les catalogues i18n', status: 'completed' },
    { content: 'Écrire la fiche commune', status: 'completed' },
    { content: 'Brancher la vue Projet', status: 'in_progress' },
    { content: 'Stories et suite board-ui', status: 'pending' },
  ] },
}

/** Un fil qui cite trois fois la carte #21 : c'est elle qu'on proposera de rattacher. */
const CITING: ChatItem = {
  kind: 'message', id: 'm1', role: 'user', ts: 0, seq: 1, streamingText: '', streamingThinking: '', parentToolCallId: null,
  blocks: [{ type: 'text', text: 'On reprend #21. Le bouton de #21 doit ouvrir une conversation neuve, comme #21 le décrit.' }],
}

const SESSION: ProjectPaneSession = {
  title: 'Onglet projet du panneau',
  card: { id: CURRENT.id, number: CURRENT.number, title: CURRENT.title, column: CURRENT.column },
  items: [PLAN],
  running: true,
  activity: 'Édition de ProjectPane.tsx',
  model: 'opus-5.5',
  contextRatio: 0.38,
}

const withBoard: Decorator = (Story) => (
  <SeededBoard><div className="surface flex h-[46rem] w-[34rem] flex-col border border-line"><Story /></div></SeededBoard>
)

const meta = {
  title: "Composants d'application/ProjectPane",
  component: ProjectPane,
  decorators: [withBoard],
  parameters: {
    docs: {
      description: {
        component:
          "La vue *Projet* du panneau d'une session, en deux segments.\n\n*Cette session* : l'activité en une bande, puis la fiche de la carte traitée, le plan de l'agent juste après ses cases. Sans carte, une seule proposition — la carte la plus citée dans le fil — et de quoi en choisir ou en créer une.\n\n*Le projet* : ce qui touche la carte, ce qui bouge maintenant (relectures en attente, sessions vivantes), puis le reste replié, avec le board à un clic.",
      },
    },
  },
  args: { projectId: PROJECT_ID, conversationId: 'c-here', session: SESSION },
} satisfies Meta<typeof ProjectPane>

export default meta
type Story = StoryObj<typeof meta>

/** La session et sa carte : le cas pour lequel l'onglet existe. */
export const AvecCarte: Story = { name: 'Avec carte' }

/** Sans carte : la proposition tirée du fil, et le reste à la demande. */
export const SansCarte: Story = {
  name: 'Sans carte',
  args: { session: { ...SESSION, card: null, items: [CITING, PLAN], running: false, activity: null } },
}
