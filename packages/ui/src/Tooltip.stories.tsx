import type { Meta, StoryObj } from '@storybook/react-vite'
import { Repeat } from 'lucide-react'
import { Button, IconButton } from './Button'
import { Tooltip } from './Tooltip'

const meta = {
  title: 'Primitives/Tooltip',
  parameters: {
    docs: {
      description: {
        component:
          "Une précision au survol, **à la souris seulement** : `TooltipProvider` la désactive d'office quand le pointeur est grossier, sinon le focus automatique des panneaux produirait une aide collante au doigt.\n\nElle ne peut donc jamais être le seul porteur d'une information. Elle précise, elle n'intitule pas.\n\n`TooltipButton` est la variante qui conserve le style et la `ref` du bouton — nécessaire quand celui-ci ouvre un menu Radix. C'est elle que `IconButton` emploie en interne, et c'est pour ça qu'un `IconButton` a déjà son infobulle sans qu'on la demande.\n\nSeule primitive absente du baril `components/ui/index.ts` : une trentaine de fichiers l'importent depuis `ui/Tooltip` (voir §14).",
      },
    },
  },
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Defaut: Story = {
  name: 'Par défaut',
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Tooltip label="Relancer en reprise de session">
        <Button variant="secondary">Survoler</Button>
      </Tooltip>
      <IconButton label="Relancer">
        <Repeat size={16} />
      </IconButton>
      <span className="text-xs text-ink-faint">
        L'`IconButton` porte la sienne par son `label`.
      </span>
    </div>
  ),
}
