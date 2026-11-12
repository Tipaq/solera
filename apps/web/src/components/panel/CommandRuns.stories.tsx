import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { ActionsPane } from './ActionsPane'
import { CommandRunDetail, CommandRunsGroup } from './CommandRuns'
import { CONVERSATION_ID, PROJECT_ID, RUNS, SeededCommandRuns, runOf } from './command-run-fixtures'

const framed: Decorator = (Story) => (
  <SeededCommandRuns>
    <div className="surface flex h-[40rem] w-[30rem] flex-col border border-line">
      <Story />
    </div>
  </SeededCommandRuns>
)

const meta = {
  title: "Composants d'application/CommandRuns",
  component: CommandRunsGroup,
  decorators: [framed],
  parameters: {
    docs: {
      description: {
        component:
          "**Les commandes lancées ici**, en tête de l'onglet *Actions* du panneau : ce qui tourne (durée qui avance, dernière ligne, *Arrêter*), puis le verdict de ce qui a fini — « 2 tests en échec », « Arrêtée » pour un code 128 + n. *Écarter* ferme le terminal fini.\n\nLe détail s'ouvre en pile : la phrase d'état, *Relancer*, *Relancer seulement les échecs*, ce qui a échoué et où (lien vers le fichier à la ligne), et la sortie en lecture seule, qui suit le direct.",
      },
    },
  },
  args: { projectId: PROJECT_ID, runs: RUNS, onOpen: () => {}, onError: () => {} },
} satisfies Meta<typeof CommandRunsGroup>

export default meta
type Story = StoryObj<typeof meta>

/** Un lint qui tourne, des tests en échec, un typecheck réussi, une commande arrêtée. */
export const Groupe: Story = {}

/** Des tests en échec : suite › cas, fichier:ligne, attendu / reçu. */
export const DetailTests: Story = {
  render: () => <CommandRunDetail projectId={PROJECT_ID} conversationId={CONVERSATION_ID} run={runOf('t-tests')} onBack={() => {}} onRelaunched={() => {}} />,
}

/** Un lint qui tourne : ses erreurs s'ajoutent à mesure qu'elles sortent. */
export const DetailLintEnCours: Story = {
  render: () => <CommandRunDetail projectId={PROJECT_ID} conversationId={CONVERSATION_ID} run={runOf('t-lint')} onBack={() => {}} onRelaunched={() => {}} />,
}

/** Réussie sans rien à dire. */
export const DetailReussie: Story = {
  render: () => <CommandRunDetail projectId={PROJECT_ID} conversationId={CONVERSATION_ID} run={runOf('t-types')} onBack={() => {}} onRelaunched={() => {}} />,
}

/** Dans l'onglet : le groupe en tête de la liste, le détail en pile au clic. */
export const DansLOnglet: Story = {
  render: () => <ActionsPane projectId={PROJECT_ID} conversationId={CONVERSATION_ID} />,
}
