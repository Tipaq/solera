import type { Meta, StoryObj } from '@storybook/react-vite'
import { CalendarClock, Flag, Layers, Plus, SquareKanban, Target, Zap } from 'lucide-react'
import { Button } from '@solera/ui'
import { ProjectAvatar } from '../ProjectAvatar'
import { PlaceBand, PlaceShell, PlaceTabs, type PlaceTab } from './PlaceShell'

const TABS: PlaceTab[] = [
  { to: '/', end: true, label: 'Aperçu', icon: <Target size={15} /> },
  { to: '/travail', label: 'Travail', icon: <Layers size={15} />, count: 2, tone: 'caution', countTitle: '2 t’attendent' },
  { to: '/board', label: 'Tableau', icon: <SquareKanban size={15} />, count: 9, countTitle: '9 cartes ouvertes' },
  { to: '/timeline', label: 'Jalons', icon: <Flag size={15} /> },
  { to: '/actions', label: 'Actions', icon: <Zap size={15} />, count: 3, tone: 'running', countTitle: '3 en marche' },
]

const avatar = <ProjectAvatar project={{ image: null, color: '#5B9DF9' }} className="size-5" />

const meta = {
  title: "Composants d'application/La coque d'un lieu",
  component: PlaceShell,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La coque d'un projet et du portefeuille : **une bande**, **une rangée**, puis le contenu — la même des deux côtés.\n\n**La bande** porte l'avatar ou l'icône du lieu, le titre et les gestes de la page, tous en `Button size=\"sm\"`. Plus de `⋯` ni de pastille de branche.\n\n**La rangée** ne porte que des vues : *+ Carte* et *+ Tâche* sont partis dans leur vue. **Réglages** est au bout, après un filet ; au téléphone, l'icône seule. Un compte suit une seule règle à trois tons : **gris** pour un inventaire, **ambre** pour ce qui t'attend, **vert** pour ce qui tourne, et rien à zéro.\n\n**Une seule gouttière**, 16 px puis 24 px dès `md`, pour la bande, la rangée, la barre d'outils et le contenu : l'avatar, l'icône du premier onglet et le premier texte de la page tombent sur la même verticale.",
      },
    },
  },
  args: {
    icon: avatar,
    title: 'Nimbus',
    label: 'Vues du projet',
    tabs: TABS,
    settings: { to: '/settings', label: 'Réglages du projet' },
    actions: (
      <Button size="sm" aria-label="Conversation" icon={<Plus size={16} />}>
        <span className="hidden sm:inline">Conversation</span>
      </Button>
    ),
    children: <div className="p-4 text-sm text-ink-soft md:p-6">Le contenu de la vue part de la même gouttière que la bande.</div>,
  },
} satisfies Meta<typeof PlaceShell>

export default meta
type Story = StoryObj<typeof meta>

/** Un projet : l'Aperçu actif, les trois tons de compte, Réglages au bout. */
export const Projet: Story = {}

/** Le portefeuille : Réglages ouvre une fenêtre au lieu de mener à une page. */
export const Portefeuille: Story = {
  args: {
    icon: <SquareKanban size={16} className="text-ink-faint" />,
    title: 'Projets',
    label: 'Vues du portefeuille',
    settings: { onOpen: () => {}, label: 'Réglages de l’instance' },
  },
}

/** La rangée seule, dans une colonne de téléphone : elle défile, et Réglages n'y garde
    que son icône sous `sm`. */
export const RangeeEtroite: Story = {
  render: (args) => (
    <div className="w-[390px] border-r border-line">
      <PlaceTabs label={args.label} tabs={args.tabs} settings={args.settings} />
    </div>
  ),
}

/** La bande seule, pour les pages de lieu qui n'ont qu'une vue (`/schedules`, `/sessions`). */
export const BandeSeule: Story = {
  render: () => (
    <PlaceBand
      icon={<CalendarClock size={16} className="text-ink-faint" />}
      title="Planifiées"
      actions={<Button size="sm" icon={<Plus size={15} />}>Tâche</Button>}
    />
  ),
}
