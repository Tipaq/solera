import type { Meta, StoryObj } from '@storybook/react-vite'
import { Clock, FolderTree, Table2, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { FilterChip, toolbarButtonClass } from '../toolbar/OneLineToolbar'
import { MenuCheck, MenuHeading } from '../toolbar/ToolbarMenus'
import { toggled } from '../../lib/filters'
import { PortfolioToolbar } from './PortfolioToolbar'

const projects = [
  { id: 'p1', name: 'Nimbus', image: null, color: '#5B9DF9' },
  { id: 'p2', name: 'Atlas', image: null, color: '#E0A43B' },
  { id: 'p3', name: 'Site vitrine', image: null, color: '#A78BFA' },
]
const counts = new Map([
  ['p1', 6],
  ['p2', 2],
  ['p3', 1],
])
const STATES = ['T’attend', 'Travaille', 'À relire', 'À nettoyer']

type View = 'projet' | 'tableau' | 'moment'

function Demo({ initial = [] }: { initial?: string[] }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initial))
  const [states, setStates] = useState<ReadonlySet<string>>(() => new Set())
  const [view, setView] = useState<View>('projet')
  const [merged, setMerged] = useState(false)
  return (
    <div className="w-[60rem] max-w-full border border-line">
      <PortfolioToolbar<View>
        search={search}
        onSearch={setSearch}
        placeholder="Chercher, #12, une branche"
        projects={projects}
        selected={selected}
        onSelected={setSelected}
        counts={counts}
        filterExtra={
          <>
            <MenuHeading>État</MenuHeading>
            {STATES.map((state) => (
              <MenuCheck key={state} checked={states.has(state)} onChange={() => setStates(toggled(states, state))}>
                {state}
              </MenuCheck>
            ))}
          </>
        }
        extraActive={states.size}
        onClearExtra={() => setStates(new Set())}
        extraChips={[...states].map((state) => (
          <FilterChip key={state} onClear={() => setStates(toggled(states, state))}>
            {state}
          </FilterChip>
        ))}
        views={[
          { key: 'projet', label: 'Par projet', icon: <FolderTree size={16} /> },
          { key: 'tableau', label: 'Tableau', icon: <Table2 size={16} /> },
          { key: 'moment', label: 'Par moment', icon: <Clock size={16} /> },
        ]}
        view={view}
        onView={setView}
        displayExtra={
          <>
            <MenuHeading>Montrer</MenuHeading>
            <MenuCheck checked={merged} onChange={setMerged}>
              Arbres fusionnés et à nettoyer
            </MenuCheck>
          </>
        }
        meta="9 arbres · 4,2 Go"
        action={
          <button type="button" className={toolbarButtonClass(false)}>
            <Trash2 size={13} /> Nettoyer · 3
          </button>
        }
      />
    </div>
  )
}

const meta = {
  title: "Composants d'application/Portefeuille/Barre d'outils",
  component: Demo,
  parameters: {
    docs: {
      description: {
        component:
          "La barre du portefeuille (PF-5), sur Travail, Tableau, Jalons et Actions : celle d'une page de projet, avec la section **Projet** en tête de Filtrer ▾ — avatar, nom, compte en regard. Les filtres de la page s'ajoutent dessous (`filterExtra`), leurs puces après celles des projets ; « Effacer tous les filtres » vide les deux. La méta, un bilan neutre, se lit à partir de `lg`.",
      },
    },
  },
} satisfies Meta<typeof Demo>

export default meta
type Story = StoryObj<typeof meta>

/** Aucun filtre posé. */
export const Repos: Story = {}

/** Deux projets cochés : leurs puces portent leur avatar. */
export const Filtree: Story = { args: { initial: ['p1', 'p3'] } }
