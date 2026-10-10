import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Tabs, type Tab } from './Tabs'

const SECTIONS: [Tab<string>, ...Tab<string>[]] = [
  { value: 'details', label: 'Détails' },
  { value: 'activity', label: 'Activité', count: 3 },
  { value: 'sessions', label: 'Sessions', count: 12 },
]

const FILTERS: [Tab<string>, ...Tab<string>[]] = [
  { value: 'all', label: 'Tout' },
  { value: 'awaiting', label: 'En attente', count: 2, tone: 'caution' },
  { value: 'unread', label: 'Non lus', count: 7 },
]

const meta = {
  title: 'Primitives/Tabs',
  parameters: {
    docs: {
      description: {
        component:
          "Une navigation entre les vues d'un même panneau.\n\nTrois copies de ce motif coexistaient dans l'application, avec **trois traitements de l'état actif** (`font-semibold`, `text-ink`, `text-accent`) et **trois hauteurs** (44, 44, 48 px) : la même mécanique sous trois apparences. Le soulignement d'accent suffit — souligner en accent *et* colorer le texte en accent dit deux fois la même chose, et le gras déplace les intitulés voisins au changement d'onglet.\n\nSémantique de liste d'onglets, pas de boutons pressés : le `tabindex` tourne, la flèche circule entre les onglets et `Tab` sort du groupe.\n\n`layout` est le seul paramètre libre : `fill` partage la largeur (panneau étroit, où les onglets tiennent lieu de filtre), `start` laisse les onglets à leur largeur naturelle (panneau large, où une rangée pleine serait démesurée).",
      },
    },
  },
} satisfies Meta<typeof Tabs>

export default meta
type Story = StoryObj<typeof meta>

function Demo({ tabs, layout }: { tabs: [Tab<string>, ...Tab<string>[]]; layout?: 'fill' | 'start' }) {
  const [value, setValue] = useState(tabs[0].value)
  return (
    <div className="w-full max-w-lg">
      <Tabs label="Sections" value={value} tabs={tabs} onChange={setValue} layout={layout} className="px-5" />
      <p className="px-5 py-4 text-sm text-ink-soft">Contenu de l'onglet « {value} ».</p>
    </div>
  )
}

/** Largeur naturelle : le gabarit d'un panneau de fiche. */
export const Debut: Story = {
  name: 'Au début',
  render: () => <Demo tabs={SECTIONS} />,
}

/** Largeur partagée : les onglets d'un panneau étroit, qui filtrent une liste. */
export const Reparti: Story = {
  name: 'Réparti',
  render: () => <Demo tabs={FILTERS} layout="fill" />,
}
