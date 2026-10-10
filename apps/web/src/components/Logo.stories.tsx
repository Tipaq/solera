import type { Meta, StoryObj } from '@storybook/react-vite'
import { FolderGit2 } from 'lucide-react'
import { Logo } from './Logo'
import { UpdateDot } from './UpdateDot'
import { IconButton } from '@solera/ui'

const meta = {
  title: "Composants d'application/Marque",
  component: Logo,
  parameters: {
    docs: {
      description: {
        component:
          "La bague : un anneau ouvert en haut, et le chaton en triangle inversé qui s'y reverse. L'anneau est la solera — la recette qui ne bouge pas ; le triangle est ce qu'on y recomplète au lieu de le redemander.\n\nTracé en `currentColor`, donc il suit la teinte choisie dans les réglages.\n\nLe tracé de référence vit dans `docs/brand/symbol.svg`. Les copies autonomes — favicons, site, signatures — doivent rester identiques, et se régénèrent avec `node scripts/brand-assets.mjs`. Un favicon est chargé comme une image et n'hérite d'aucun jeton : c'est pour ça qu'il y a plusieurs exemplaires du même tracé.",
      },
    },
  },
} satisfies Meta<typeof Logo>

export default meta
type Story = StoryObj<typeof meta>

export const Bac: Story = { args: { size: 40 } }

export const Tailles: Story = {
  render: () => (
    <div className="flex items-end gap-5 text-accent">
      {[16, 20, 28, 40, 64].map((size) => (
        <span key={size} className="flex flex-col items-center gap-2">
          <Logo size={size} />
          <span className="font-mono text-meta text-ink-faint">{size}</span>
        </span>
      ))}
    </div>
  ),
}

export const Couleurs: Story = {
  name: 'Suit la couleur du texte',
  render: () => (
    <div className="flex items-center gap-4">
      <Logo size={32} className="text-ink" />
      <Logo size={32} className="text-ink-faint" />
      <Logo size={32} className="text-accent" />
      <Logo size={32} className="text-positive" />
      <Logo size={32} className="text-critical" />
    </div>
  ),
}

/**
 * La pastille d'une mise à jour en attente. Une pastille et non un bandeau : la mise à
 * jour attend sans presser, elle doit seulement se voir depuis n'importe quel écran.
 *
 * Le parent doit être en `relative` — la pastille se positionne sur lui.
 */
export const Pastille: Story = {
  name: 'UpdateDot',
  render: () => (
    <div className="flex items-center gap-4">
      <span className="relative inline-flex">
        <IconButton label="Projets">
          <FolderGit2 size={16} />
        </IconButton>
        <UpdateDot />
      </span>
      <span className="font-mono text-meta text-ink-faint">parent en relative</span>
    </div>
  ),
}
