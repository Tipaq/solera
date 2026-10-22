import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { turnCheckpoint } from '../../chat/checkpoint-fixtures'
import { TurnChangesView } from './TurnChangesView'

/** La largeur d'un panneau ordinaire : la vue y vit, pas dans une page entière. */
const inPanel: Decorator = (Story) => (
  <div className="flex h-[28rem] w-[26rem] border border-line">
    <Story />
  </div>
)

const meta = {
  title: "Composants d'application/TurnChangesView",
  component: TurnChangesView,
  parameters: {
    docs: {
      description: {
        component:
          "Les changements d'un seul tour, dans la vue Git : le pendant de `CommitDetail`, posé entre les deux captures du tour plutôt qu'entre un commit et son parent.\n\nIl prend la colonne de la vue Git le temps qu'on le lit, comme le rebase ; le rail ou la croix ramènent au dépôt. Chaque diff se lit au dépliage, depuis les captures et non depuis le disque, que le tour suivant a pu réécrire.\n\nLes fichiers qu'un pull, une fusion ou un rebase ont apportés pendant le tour sont écartés et comptés à part : ce n'est pas le travail du tour.",
      },
    },
  },
  decorators: [inPanel],
  args: {
    conversationId: 'c1',
    checkpoint: turnCheckpoint,
    canRestore: true,
    onRestore: () => {},
    onClose: () => {},
    onOpenFile: () => {},
  },
} satisfies Meta<typeof TurnChangesView>

export default meta
type Story = StoryObj<typeof meta>

export const Pret: Story = { name: 'Prêt' }

/** Un pull pendant le tour : ses fichiers ne sont pas listés, seulement comptés. */
export const AvecExclus: Story = {
  name: 'Fichiers apportés par git',
  args: { checkpoint: { ...turnCheckpoint, excluded: 12 } },
}

export const SansRetour: Story = {
  name: 'Sans retour en arrière',
  args: { canRestore: false },
}

export const Vide: Story = {
  args: { checkpoint: { ...turnCheckpoint, files: [] } },
}
