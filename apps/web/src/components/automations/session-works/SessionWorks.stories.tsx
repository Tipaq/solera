import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { ActionsPane } from '../../panel/ActionsPane'
import { SessionWorksSection } from './SessionWorksSection'
import { CONVERSATION_ID, PROJECT_ID, SeededSessionWorks, WORKS, WORKS_HERE } from './session-work-fixtures'

const seeded: Decorator = (Story) => (
  <SeededSessionWorks>
    <Story />
  </SeededSessionWorks>
)

const meta = {
  title: "Composants d'application/SessionWorks",
  component: SessionWorksSection,
  decorators: [seeded],
  parameters: {
    docs: {
      description: {
        component:
          "**Lancés par les sessions** : ce qu'une session a laissé tourner en fond — un serveur, des tests en surveillance, une surveillance de CI. Processus de la page *Services* et travaux de fond du journal, fusionnés sans doublon (`mergeWorks`). Le libellé dit ce que le processus **est** (« Serveur vite », « Tests (server) en surveillance ») ; la commande courte, la charge et la mémoire passent en infobulle.\n\nTrois rendus : `tiles` dans le Lanceur (le gabarit exact d'une tuile d'action), `rows` dans la Liste, `compact` dans le panneau d'une conversation (36 px, la pastille de session seulement quand ce n'est pas celle-ci).",
      },
    },
  },
  args: { projectId: PROJECT_ID, works: WORKS, variant: 'tiles', onMakeAction: () => {} },
} satisfies Meta<typeof SessionWorksSection>

export default meta
type Story = StoryObj<typeof meta>

/** Le Lanceur : une tuile par processus, de hauteur fixe ; un titre trop long se tronque. */
export const Tuiles: Story = {}

/** La Liste de l'onglet Actions. */
export const Lignes: Story = { args: { variant: 'rows' } }

/** Le panneau d'une conversation : les siens d'abord, sans pastille. Un clic déplie. */
export const Panneau: Story = {
  args: { variant: 'compact', works: WORKS_HERE, currentConversationId: CONVERSATION_ID },
  render: (args) => (
    <div className="surface flex w-full max-w-[30rem] flex-col border border-line">
      <SessionWorksSection {...args} />
    </div>
  ),
}

/** Dans l'onglet Actions du panneau, sous les commandes lancées ici. */
export const DansLOnglet: Story = {
  render: () => (
    <div className="surface flex h-[40rem] w-full max-w-[30rem] flex-col border border-line">
      <ActionsPane projectId={PROJECT_ID} conversationId={CONVERSATION_ID} />
    </div>
  ),
}
