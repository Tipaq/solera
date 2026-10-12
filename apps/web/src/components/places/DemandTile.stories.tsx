import type { Meta, StoryObj } from '@storybook/react-vite'
import { GitBranch, MessageCircleQuestion, Pencil } from 'lucide-react'
import { DemandTile } from './DemandTile'

const meta = {
  title: "Composants d'application/DemandTile",
  component: DemandTile,
  parameters: {
    docs: {
      description: {
        component:
          "Une tuile du bandeau d'un lieu — le tableau de bord d'un projet, la page Projets.\n\n**Elle ne dit jamais l'inventaire.** « 7 cartes » décrit ce qui existe ; « 1 attend ta réponse depuis 1 h » décrit ce qu'on a à faire. Un bandeau n'est utile qu'au second, et c'est pourquoi une tuile à zéro **disparaît** : c'est l'appelant qui l'omet, la tuile n'ayant pas de rendu vide.\n\nL'intitulé est au-dessus, le chiffre dessous en grand : on lit d'abord *quoi*, puis *combien*, et les intitulés restent alignés quelle que soit la largeur du nombre.\n\nTrois teintes, et elles ne sont pas décoratives : **caution** pour ce qui attend un humain, **accent** pour ce qui tourne tout seul, **neutral** pour un état qu'on constate sans qu'il presse.",
      },
    },
  },
  args: {
    to: '#',
    tone: 'caution',
    icon: <MessageCircleQuestion size={14} />,
    label: 'attend ta réponse',
    count: 1,
    detail: 'depuis 1 h',
  },
} satisfies Meta<typeof DemandTile>

export default meta
type Story = StoryObj<typeof meta>

export const Attente: Story = {}

/** Ce qui tourne sans personne : l'accent, parce que ce n'est pas une alerte. */
export const EnCours: Story = {
  name: 'En cours',
  args: { tone: 'accent', icon: <span className="block size-1.5 rounded-full bg-accent" />, label: 'tournent', count: 2, detail: 'depuis 4 min' },
}

/** Un état du dépôt : à constater, pas à traiter — donc neutre. */
export const Constat: Story = {
  args: { tone: 'neutral', icon: <GitBranch size={14} />, label: 'non commités', count: 4, detail: 'sur main' },
}

/** Le bandeau entier, qui est le seul endroit où ces tuiles vivent. */
export const Bandeau: Story = {
  render: (args) => (
    <div className="grid w-[56rem] grid-cols-4 gap-3">
      <DemandTile {...args} />
      <DemandTile to="#" tone="caution" icon={<Pencil size={14} />} label="à relire" count={1} detail="carte #5" />
      <DemandTile to="#" tone="neutral" icon={<GitBranch size={14} />} label="non commités" count={4} detail="sur main" />
      <DemandTile to="#" tone="accent" icon={<span className="block size-1.5 rounded-full bg-accent" />} label="tournent" count={2} detail="depuis 4 min" />
    </div>
  ),
}
