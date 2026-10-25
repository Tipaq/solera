import type { Decorator, Meta, StoryObj } from '@storybook/react-vite'
import { ArrowLeft } from 'lucide-react'
import { IconButton } from '@solera/ui'
import { CardDetail } from './CardDetail'
import { CARDS, CURRENT, DUPLICATE, FROM_ISSUE, PROJECT_ID, SeededBoard } from './card-fixtures'

const withBoard: Decorator = (Story) => <SeededBoard><Story /></SeededBoard>

const meta = {
  title: "Composants d'application/CardDetail",
  component: CardDetail,
  decorators: [withBoard],
  parameters: {
    docs: {
      description: {
        component:
          "La fiche d'une carte, la même dans le tiroir du board et dans la vue *Projet* du panneau d'une session.\n\n**D'un seul tenant, sans onglets** : propriétés, énoncé, puis un fil où les sessions et les notes se suivent dans l'ordre du temps. Les notes et les sessions cachées derrière un onglet étaient ce qu'on venait chercher.\n\n**Sa mise en page suit sa propre largeur** : au-delà de 42 rem les propriétés passent dans une colonne à droite, en deçà elles s'intercalent entre le titre et l'énoncé.",
      },
    },
  },
  args: {
    card: CURRENT,
    projectId: PROJECT_ID,
    onSelectCard: () => undefined,
    onDeleted: () => undefined,
  },
} satisfies Meta<typeof CardDetail>

export default meta
type Story = StoryObj<typeof meta>

/** Le tiroir du board : 44 rem, les propriétés à droite. */
export const Tiroir: Story = {
  render: (args) => <div className="surface flex h-[44rem] w-[44rem] flex-col border border-line"><CardDetail {...args} /></div>,
}

/** Le panneau accolé : la fiche se replie, les propriétés passent sous le titre. */
export const Panneau: Story = {
  args: {
    currentConversationId: 'c-here',
    lead: <IconButton label="Retour au projet" size="sm"><ArrowLeft size={15} /></IconButton>,
  },
  render: (args) => <div className="surface flex h-[44rem] w-[26rem] flex-col border border-line"><CardDetail {...args} /></div>,
}

/** Une carte nue : ni énoncé, ni propriété, ni fil. */
export const Vide: Story = {
  args: { card: CARDS.find((entry) => entry.number === 40)! },
  render: (args) => <div className="surface flex h-[30rem] w-[44rem] flex-col border border-line"><CardDetail {...args} /></div>,
}

/** Un doublon encore ouvert : le lien a pu être posé par un agent, l'abandon reste un clic. */
export const Doublon: Story = {
  args: { card: DUPLICATE },
  render: (args) => <div className="surface flex h-[30rem] w-[44rem] flex-col border border-line"><CardDetail {...args} /></div>,
}

/**
 * Venue d'une issue GitHub (#84) et pas encore triée : la pastille « nouvelle », les trois
 * gestes, le lien vers l'issue dans les propriétés, et sa discussion lue en direct.
 */
export const VenueDUneIssue: Story = {
  args: { card: FROM_ISSUE },
  render: (args) => <div className="surface flex h-[40rem] w-[44rem] flex-col border border-line"><CardDetail {...args} /></div>,
}
