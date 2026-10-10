import type { Meta, StoryObj } from '@storybook/react-vite'
import { Copy, Lock, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from './Button'
import { Menu, MenuCheckboxItem, MenuItem, MenuLabel, MenuSeparator } from './Menu'

const meta = {
  title: 'Primitives/Menu',
  parameters: {
    docs: {
      description: {
        component:
          "Un menu déroulant, `role=\"menu\"`, dont la navigation clavier est un *roving tabindex* **réservé aux entrées de menu**.\n\nC'est ce qui le distingue de `Popover` : un bouton ordinaire posé dedans n'entre ni dans ce parcours ni dans celui de `Tab`, que Radix traite comme une fermeture, et devient cliquable à la souris seulement. Un panneau qui contient des champs a donc besoin de `Popover`.\n\n`MenuCheckboxItem` garde le menu ouvert à la sélection : cocher trois serveurs demanderait sinon de le rouvrir trois fois.\n\nUne action momentanément impossible reste affichée et désactivée : la voir grisée dit qu'elle existe et qu'elle reviendra, alors que sa disparition laisse croire qu'elle n'existe pas.",
      },
    },
  },
} satisfies Meta<typeof Menu>

export default meta
type Story = StoryObj<typeof meta>

function Demo() {
  const [pinned, setPinned] = useState(true)
  return (
    <Menu align="start" trigger={<Button variant="secondary">Actions</Button>}>
      <MenuLabel>Fichier</MenuLabel>
      <MenuItem icon={<Pencil size={14} />} onSelect={() => undefined}>
        Renommer
      </MenuItem>
      <MenuItem icon={<Copy size={14} />} onSelect={() => undefined}>
        Dupliquer
      </MenuItem>
      <MenuCheckboxItem checked={pinned} onCheckedChange={setPinned}>
        Épingler
      </MenuCheckboxItem>
      <MenuSeparator />
      <MenuItem icon={<Lock size={14} />} onSelect={() => undefined} disabled>
        Momentanément impossible
      </MenuItem>
      <MenuItem icon={<Trash2 size={14} />} tone="critical" onSelect={() => undefined}>
        Supprimer
      </MenuItem>
    </Menu>
  )
}

export const Complet: Story = {
  render: () => <Demo />,
}
