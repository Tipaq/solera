import type { Meta, StoryObj } from '@storybook/react-vite'
import { Copy, MoreHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button, IconButton, Menu, MenuItem } from '@solera/ui'
import { DetailSurfaceContext, type DetailSurface } from '../../lib/detail-surface'
import { Detail } from './Detail'
import { Drawer, DrawerLayer, type DrawerWidth } from './Drawer'

/** Une zone de contenu de lieu, sous une rangée, qui porte le calque des tiroirs. */
function Place({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex h-[32rem] flex-col border border-line">
      <div className="h-11 shrink-0 border-b border-line" />
      <div className="relative flex min-h-0 flex-1 overflow-clip">
        <div className="min-w-0 flex-1 p-4 text-sm text-ink-soft md:p-6">{children}</div>
        {aside}
        <DrawerLayer />
      </div>
    </div>
  )
}

function Card({ width }: { width: DrawerWidth }) {
  const [open, setOpen] = useState(true)
  return (
    <Place>
      <Button size="sm" onClick={() => setOpen(true)}>Ouvrir le tiroir</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        label="Carte #161"
        title="Tiroir commun, Échap par couches"
        subtitle={<><span>#161</span><span>en cours</span></>}
        width={width}
      >
        <div className="flex items-center justify-end px-5 py-3">
          <Menu trigger={<IconButton label="Plus" size="sm"><MoreHorizontal size={15} /></IconButton>}>
            <MenuItem icon={<Copy size={14} />} onSelect={() => {}}>Copier le lien</MenuItem>
          </Menu>
        </div>
        <p className="px-5 text-sm text-ink-soft">Échap ferme le menu ouvert d'abord, le tiroir ensuite.</p>
      </Drawer>
    </Place>
  )
}

function Surface({ surface }: { surface: DetailSurface }) {
  const [open, setOpen] = useState(true)
  const detail = (
    <Detail open={open} onClose={() => setOpen(false)} label="Action" title="Lancer les tests" subtitle="commande · à la demande" back="Actions">
      <p className="p-3 text-sm text-ink-soft">Le détail de l'action.</p>
    </Detail>
  )
  return (
    <DetailSurfaceContext.Provider value={surface}>
      <Place
        aside={surface === 'panel' ? (
          <aside className="flex w-80 flex-col border-l border-line">
            {open ? null : <p className="p-3 text-sm text-ink-soft">La liste des actions.</p>}
            {detail}
          </aside>
        ) : undefined}
      >
        <Button size="sm" onClick={() => setOpen(true)}>Ouvrir l'action</Button>
        {surface === 'drawer' ? detail : null}
      </Place>
    </DetailSurfaceContext.Provider>
  )
}

const meta = {
  title: "Composants d'application/Tiroir",
  component: Drawer,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          "Le **tiroir commun** : un détail passager qui passe **par-dessus** le contenu, sous la rangée d'onglets jusqu'en bas, bord gauche fin, sans coins arrondis, une ombre portée vers la gauche. 36 rem, 48 pour un éditeur ; plein écran au téléphone. Un clic dehors ou `✕` le ferme, le focus revient à ce qui l'a ouvert.\n\n**Échap ferme la couche la plus haute** : un menu Radix ouvert, une autocomplétion, puis le tiroir.\n\n**Un seul comportement de panneau par page** : `Detail` s'ouvre dans le tiroir sur une page sans panneau, en pile dans le panneau d'une conversation. Règles : *Gabarits/Panneau et tiroir* du design system.",
      },
    },
  },
  args: { open: true, onClose: () => {}, label: 'Carte', children: null },
} satisfies Meta<typeof Drawer>

export default meta
type Story = StoryObj<typeof meta>

/** 36 rem, l'en-tête commun, un menu dans le tiroir. */
export const Normal: Story = { render: () => <Card width="normal" /> }

/** 48 rem, la seule autre largeur : l'éditeur d'une action. */
export const Large: Story = { render: () => <Card width="wide" /> }

/** Une page sans panneau : le détail s'ouvre dans le tiroir. */
export const DetailEnTiroir: Story = { render: () => <Surface surface="drawer" /> }

/** Une conversation : le détail s'ouvre dans le panneau, en pile, « ‹ Actions » pour revenir. */
export const DetailEnPile: Story = { render: () => <Surface surface="panel" /> }
