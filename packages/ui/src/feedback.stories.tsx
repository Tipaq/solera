import type { Meta, StoryObj } from '@storybook/react-vite'
import { Globe, Search } from 'lucide-react'
import { Button } from './Button'
import { Card } from './Card'
import { Badge, Banner, EmptyState } from './feedback'

const meta = {
  title: 'Primitives/Badge, Banner, EmptyState',
  parameters: {
    docs: {
      description: {
        component:
          "Les trois formes de retour d'information, dans un seul fichier comme dans le code.\n\n**Badge** : un état en un mot, deux au plus. Au-delà, c'est une `Banner`.\n\n**Banner** : le ton décide aussi du rôle ARIA — `alert` pour `critical`, `status` pour les trois autres. Un lecteur d'écran doit interrompre pour l'un et pas pour les autres, donc `critical` pour un simple avertissement est un vrai défaut, pas une nuance.\n\n**EmptyState** : la description dit **quoi faire**. « Aucun élément » ne dit rien.",
      },
    },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Badges: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {(['neutral', 'accent', 'positive', 'caution', 'critical'] as const).map((tone) => (
        <Badge key={tone} tone={tone}>
          {tone}
        </Badge>
      ))}
      <Badge icon={<Globe size={11} />}>Partagé</Badge>
    </div>
  ),
}

export const Banners: Story = {
  render: () => (
    <div className="flex max-w-xl flex-col gap-2">
      <Banner tone="critical">Identifiants incorrects.</Banner>
      <Banner tone="caution">Modifications non commitées dans ce worktree.</Banner>
      <Banner tone="info">Le runner a été relancé en reprise de session.</Banner>
      <Banner tone="positive">Réglages enregistrés.</Banner>
    </div>
  ),
}

export const Vide: Story = {
  name: 'EmptyState',
  render: () => (
    <Card className="max-w-xl">
      <EmptyState
        icon={<Search size={22} />}
        title="Aucun résultat"
        description="Essaie un autre terme de recherche."
        action={<Button variant="secondary">Réinitialiser</Button>}
      />
    </Card>
  ),
}
