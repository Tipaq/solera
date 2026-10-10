import type { Meta, StoryObj } from '@storybook/react-vite'
import { Globe, Lock } from 'lucide-react'
import { Card, CardBody, CardHeader } from './Card'
import { Badge } from './feedback'

const meta = {
  title: 'Primitives/Card',
  component: Card,
  parameters: {
    docs: {
      description: {
        component:
          "Un bloc de contenu titré. Trois pièces qui vont ensemble : la carte, son en-tête, son corps.\n\n`CardHeader` et `CardBody` tiennent le gabarit `px-5 py-4`. Une carte montée à la main s'écarte de toutes les autres cartes de l'application — et il y en a une centaine dans le code (voir §14 du document).",
      },
    },
  },
  // `children` est obligatoire sur `Card`, et toutes les stories rendent elles-mêmes :
  // sans ce défaut, chacune devrait déclarer un `args` qu'elle n'emploie pas.
  args: { children: null },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const Complete: Story = {
  render: () => (
    <Card className="max-w-lg">
      <CardHeader
        title="Secrets du projet"
        description="Injectés dans l'environnement du CLI au lancement."
        icon={<Lock size={16} />}
        actions={
          <Badge tone="accent" icon={<Globe size={11} />}>
            Partagé
          </Badge>
        }
      />
      <CardBody>
        <p className="text-sm text-ink-soft">
          Le corps de la carte. Le dégradé de surface est visible sur les grandes hauteurs.
        </p>
      </CardBody>
    </Card>
  ),
}

/** Sans icône ni action : le cas le plus fréquent dans les réglages. */
export const Nue: Story = {
  render: () => (
    <Card className="max-w-lg">
      <CardHeader title="Titre de carte" />
      <CardBody>
        <p className="text-sm text-ink-soft">Un corps, et rien d'autre.</p>
      </CardBody>
    </Card>
  ),
}

/**
 * Une carte dans une carte : à éviter. Les deux bordures qui se touchent sont une de
 * trop, et le rayon intérieur contredit l'ordre de l'imbrication.
 */
export const AEviter: Story = {
  name: 'À éviter — imbriquée',
  render: () => (
    <Card className="max-w-lg">
      <CardHeader title="Carte extérieure" />
      <CardBody>
        <Card>
          <CardHeader title="Carte intérieure" />
          <CardBody>
            <p className="text-sm text-ink-soft">Deux cadres pour un seul contenu.</p>
          </CardBody>
        </Card>
      </CardBody>
    </Card>
  ),
}
