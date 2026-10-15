import type { Meta, StoryObj } from '@storybook/react-vite'
import { CalendarClock, Plus, SquareKanban, Target } from 'lucide-react'
import { Button } from '@solera/ui'
import { ProjectTabs } from './ProjectTabs'

const meta = {
  title: "Composants d'application/La rangée de vues",
  component: ProjectTabs,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La rangée des vues d'un projet, **dans le contenu** et sous la bande.\n\nElle n'est pas dans la bande, et c'est la première décision de l'audit du 2026-10-14 : la rangée y entrait en concurrence avec le nom du projet et deux boutons, et plafonnait à quatre vues — or c'est la cinquième qui portait la gestion de projet. Dans le contenu elle en tient cinq, collée aux bords, sans couloir centré : son bord gauche ne saute donc pas d'une vue à l'autre.\n\n**Même apparence que `Tabs`, autre sémantique.** Le soulignement, la hauteur et le compteur viennent de `tabItemClass` et `TabCount`, exportés par la primitive — une seule source pour le look. Mais ici ce sont des **liens** : chaque vue a son adresse, et un lecteur d'écran doit annoncer « lien » et non « onglet 2 sur 4 » devant quelque chose qui change l'URL. Les deux composants ne peuvent donc pas se remplacer l'un l'autre.\n\nLe bout de la rangée porte **l'action de la vue** — *+ Carte*, *+ Tâche*. L'Aperçu n'en a pas : c'est la vue d'arrivée, elle ne crée rien, elle envoie. Au doigt, la rangée déborde et défile, et l'action défile avec elle : collée à droite, jamais flottante, parce qu'un bouton flottant au-dessus d'un board recouvre une carte.",
      },
    },
  },
} satisfies Meta<typeof ProjectTabs>

export default meta
type Story = StoryObj<typeof meta>

const TABS = [
  { to: '/', end: true, label: 'Aperçu', icon: <Target size={15} /> },
  { to: '/board', label: 'Board', icon: <SquareKanban size={15} />, count: 9 },
  { to: '/schedules', label: 'Planifiées', icon: <CalendarClock size={15} />, count: 2 },
]

/** La vue d'arrivée : le premier onglet est actif, et la rangée ne porte aucune action. */
export const Apercu: Story = {
  args: { label: 'Vues du projet', tabs: TABS },
}

/** Une vue qui crée : son action est au bout de la rangée. */
export const AvecAction: Story = {
  args: {
    label: 'Vues du projet',
    tabs: TABS,
    action: <Button size="sm" icon={<Plus size={15} />}>Carte</Button>,
  },
}
