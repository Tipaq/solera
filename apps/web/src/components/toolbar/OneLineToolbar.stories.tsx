import type { Meta, StoryObj } from '@storybook/react-vite'
import { Columns3, Hand, List, Plus, Replace, Search } from 'lucide-react'
import { useState } from 'react'
import { Button, PanelToolbar, panelToolClass } from '@solera/ui'
import { toggled } from '../../lib/filters'
import { useView } from '../../lib/use-view'
import { FilterChip, OneLineToolbar, ToolbarSearch, toolbarFieldClass } from './OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, MenuSegment, type ViewOption } from './ToolbarMenus'

type View = 'kanban' | 'liste' | 'geste'
const VIEWS: ViewOption<View>[] = [
  { key: 'kanban', label: 'Kanban', icon: <Columns3 size={16} /> },
  { key: 'liste', label: 'Liste', icon: <List size={16} /> },
  { key: 'geste', label: 'Par geste', icon: <Hand size={16} /> },
]
const VIEW_KEYS = VIEWS.map((view) => view.key)

const MILESTONES = [
  { id: '157', label: '#157 Socle commun', count: 6 },
  { id: '164', label: '#164 Aperçu, Travail, Tableau', count: 9 },
  { id: '182', label: '#182 Jalons', count: 11 },
  { id: '200', label: '#200 Actions et Planifiées, une page plus longue que la puce', count: 7 },
]
const STATES = [
  { id: 'waiting', label: 'T’attend', count: 2 },
  { id: 'clarify', label: 'À préciser', count: 3 },
  { id: 'accept', label: 'À accepter', count: 1 },
]

/**
 * Une page de démonstration : la barre et ce qu'elle règle, sans données. Montée aussi
 * par `scripts/toolbar-ui-check.mjs`.
 */
export function ToolbarDemo({ initial = [] }: { initial?: string[] }) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ReadonlySet<string>>(new Set(initial))
  const [view, setView] = useView('demo', 'p1', VIEW_KEYS)
  const [lanes, setLanes] = useState<'none' | 'milestone'>('none')
  const [abandoned, setAbandoned] = useState(false)
  const labels = new Map([...MILESTONES, ...STATES].map((entry) => [entry.id, entry.label]))
  const flip = (id: string) => setFilters((current) => toggled(current, id))

  return (
    <div className="flex h-dvh flex-col">
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder="Chercher, ou #12" />}
        filter={
          <FilterMenu active={filters.size} onClearAll={() => setFilters(new Set())}>
            <MenuHeading>Jalon</MenuHeading>
            {MILESTONES.map((entry) => (
              <MenuCheck key={entry.id} checked={filters.has(entry.id)} onChange={() => flip(entry.id)} aside={entry.count}>
                {entry.label}
              </MenuCheck>
            ))}
            <MenuHeading>État</MenuHeading>
            {STATES.map((entry) => (
              <MenuCheck key={entry.id} checked={filters.has(entry.id)} onChange={() => flip(entry.id)} aside={entry.count}>
                {entry.label}
              </MenuCheck>
            ))}
          </FilterMenu>
        }
        chips={[...filters].map((id) => (
          <FilterChip key={id} title={labels.get(id)} onClear={() => flip(id)}>
            {labels.get(id)}
          </FilterChip>
        ))}
        extra={<span className="hidden text-xs text-ink-faint lg:inline">12 cartes</span>}
        display={
          <DisplayMenu views={VIEWS} value={view} onChange={setView}>
            <MenuHeading>Regroupement</MenuHeading>
            <MenuSegment
              label="Regroupement"
              segments={[{ value: 'none', label: 'Aucun' }, { value: 'milestone', label: 'Couloirs par jalon' }]}
              value={lanes}
              onChange={setLanes}
            />
            <MenuHeading>Montrer</MenuHeading>
            <MenuCheck checked={abandoned} onChange={setAbandoned}>Les abandonnées</MenuCheck>
          </DisplayMenu>
        }
        action={
          <Button size="sm" icon={<Plus size={15} />}>
            Carte
          </Button>
        }
      />
      <p data-view={view} className="p-4 text-sm text-ink-soft md:p-6">
        Vue {VIEWS.find((entry) => entry.key === view)?.label} · {query ? `« ${query} »` : 'sans recherche'}
      </p>
    </div>
  )
}

const meta = {
  title: "Composants d'application/La barre sur une ligne",
  component: ToolbarDemo,
  excludeStories: ['ToolbarDemo'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          "La barre d'outils d'une page — Tableau, Travail, Jalons, Actions, Planifiées, Sessions, portefeuille — tient sur **une ligne**.\n\n**À gauche ce qui restreint** : la recherche, étroite au repos et élargie au focus ; « Filtrer ▾ », qui compte les filtres posés ; les filtres actifs en puces, qui défilent de côté plutôt que de passer à la ligne.\n\n**À droite ce qui présente** : les commandes discrètes, « Affichage ▾ » — les vues en tuiles, puis le regroupement, le tri et ce qu'on montre —, et l'action principale, seule au bout.\n\nLes boutons ont la hauteur de `Button size=\"sm\"` : 36 px à la souris, 44 au doigt. La vue choisie se lit dans `?vue=`, sinon dans la mémoire du projet, sinon c'est la première.",
      },
    },
  },
} satisfies Meta<typeof ToolbarDemo>

export default meta
type Story = StoryObj<typeof meta>

/** Au repos : rien de filtré. */
export const AuRepos: Story = {}

/** Des filtres posés : le compte de « Filtrer », les puces, leur défilement. */
export const FiltresActifs: Story = { args: { initial: ['157', '200', 'waiting', 'clarify'] } }


/**
 * Dans une ligne d'outils du panneau (l'onglet Recherche) : le champ au format de la
 * recherche tient lieu de titre, « Filtrer ▾ » est `compact` — son libellé ne paraît
 * qu'à partir de 22 rem de ligne, et son popover s'aligne sur la fin.
 */
export const DansLePanneau: Story = {
  render: () => <PanelLine />,
}

function PanelLine() {
  const [checked, setChecked] = useState(true)
  return (
    <div className="flex flex-col gap-4 p-4">
      {['w-[30rem]', 'w-[20rem]'].map((width) => (
        <div key={width} className={`flex flex-col border-l border-line bg-canvas ${width}`}>
          <PanelToolbar>
            <label className={`${toolbarFieldClass()} flex-1`}>
              <Search size={16} className="shrink-0" />
              <input aria-label="Chercher" placeholder="Chercher…" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-soft" />
            </label>
            <FilterMenu compact active={checked ? 1 : 0} onClearAll={() => setChecked(false)}>
              <MenuHeading>Correspondance</MenuHeading>
              <MenuCheck checked={checked} onChange={setChecked}>Mot entier</MenuCheck>
            </FilterMenu>
            <button type="button" aria-label="Afficher le remplacement" className={panelToolClass()}>
              <Replace size={14} />
            </button>
          </PanelToolbar>
        </div>
      ))}
    </div>
  )
}
