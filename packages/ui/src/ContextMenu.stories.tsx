import type { Meta, StoryObj } from '@storybook/react-vite'
import { Pencil, Trash2 } from 'lucide-react'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from './ContextMenu'

const meta = {
  title: 'Primitives/ContextMenu',
  parameters: {
    docs: {
      description: {
        component:
          "Le clic droit, et l'appui long au doigt.\n\nPrimitive distincte du menu déroulant plutôt qu'un `Menu` ouvert à la main : le clic droit doit se positionner **au curseur**, pas sous un déclencheur, et il faut aussi l'appui long, que Radix gère ici et pas là-bas.\n\nIl ne doit jamais être le seul accès à une action : le clic droit ne se devine pas. Chaque entrée doit avoir un chemin visible ailleurs.",
      },
    },
  },
} satisfies Meta<typeof ContextMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Defaut: Story = {
  name: 'Par défaut',
  render: () => (
    <ContextMenu
      trigger={
        <div className="flex h-11 w-64 items-center rounded-md border border-dashed border-line-strong px-3 text-sm text-ink-soft">
          Clic droit ici · appui long au doigt
        </div>
      }
    >
      <ContextMenuItem icon={<Pencil size={14} />} onSelect={() => undefined}>
        Renommer
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon={<Trash2 size={14} />} tone="critical" onSelect={() => undefined}>
        Supprimer
      </ContextMenuItem>
    </ContextMenu>
  ),
}
