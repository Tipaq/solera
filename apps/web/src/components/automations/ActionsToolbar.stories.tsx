import type { Meta, StoryObj } from '@storybook/react-vite'
import { ActionsStatusMeta } from './ActionsStatusMeta'
import { NewActionMenu } from './NewActionMenu'

const ignore = () => {}

const meta = {
  title: "Composants d'application/Actions/Barre de l'onglet",
  component: ActionsStatusMeta,
  args: { status: { running: 3, toReview: 1 }, onRunning: ignore, onReview: ignore },
  parameters: {
    docs: {
      description: {
        component:
          "Ce que la barre de l'onglet Actions ajoute à la barre commune : la méta « ● N en marche · ● N à relire », qui filtre sur ce qu'elle compte, et « + Action ▾ », la nature d'abord ou planifier une action existante.",
      },
    },
  },
} satisfies Meta<typeof ActionsStatusMeta>

export default meta
type Story = StoryObj<typeof meta>

/** Ce qui tourne et ce qui attend. */
export const Meta_: Story = { name: 'Méta' }

/** Rien à relire : le vert seul. */
export const EnMarche: Story = { name: 'En marche seulement', args: { status: { running: 2, toReview: 0 } } }

/** « + Action ▾ » : le menu ouvert. */
export const NouvelleAction: Story = {
  name: '+ Action ▾',
  render: () => (
    <div className="flex h-96 justify-end">
      <NewActionMenu onPick={ignore} />
    </div>
  ),
}
