import type { Meta, StoryObj } from '@storybook/react-vite'
import { Search, Send, Trash2 } from 'lucide-react'
import { Button, IconButton } from './Button'

/**
 * Les variantes sont montrées **ensemble** et non une par une : un bouton danger seul
 * paraît toujours juste, c'est posé à côté du primaire qu'on voit s'ils pèsent le même
 * poids.
 */
const meta = {
  title: 'Primitives/Button',
  component: Button,
  parameters: {
    docs: {
      description: {
        component:
          "Une action à libellé. Quatre variantes, deux tailles, et **une seule action primaire par écran**.\n\nUn `<button>` nu perd le focus visible, la cible tactile de 44 px et l'état désactivé que la primitive apporte.",
      },
    },
  },
  args: { children: 'Envoyer' },
  argTypes: {
    variant: { control: 'inline-radio', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    icon: { table: { disable: true } },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

/** Le bac à sable : les contrôles pilotent chaque prop. */
export const Bac: Story = {
  args: { variant: 'primary', size: 'md', icon: <Send size={16} /> },
}

export const Variantes: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<Send size={16} />}>Envoyer</Button>
        <Button variant="secondary">Annuler</Button>
        <Button variant="ghost">Plus tard</Button>
        <Button variant="danger" icon={<Trash2 size={16} />}>
          Supprimer
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled>Envoyer</Button>
        <Button variant="secondary" disabled>
          Annuler
        </Button>
        <Button variant="ghost" disabled>
          Plus tard
        </Button>
        <Button variant="danger" disabled>
          Supprimer
        </Button>
      </div>
    </div>
  ),
}

/**
 * `sm` reste à 44 px au doigt, même sur un grand écran tactile : `md:` parle de la
 * largeur de l'écran, `pointer-coarse:` parle du doigt.
 */
export const Tailles: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-4">
      <Button>md · tap-target 44px</Button>
      <Button size="sm">sm · h-11 md:h-9</Button>
      <IconButton label="Rechercher">
        <Search size={16} />
      </IconButton>
      <IconButton label="Rechercher" size="sm">
        <Search size={14} />
      </IconButton>
    </div>
  ),
}
