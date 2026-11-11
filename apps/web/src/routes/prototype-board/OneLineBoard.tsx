/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le Tableau avec sa barre sur **une seule ligne** (retour de Tim sur `vues`) :
 * - à gauche, la recherche compacte, puis « Filtrer ▾ » qui regroupe tous les filtres,
 *   et les filtres actifs en puces effaçables sur la même ligne ;
 * - à droite, « Affichage ▾ » qui regroupe le choix de vue, le regroupement, les
 *   colonnes fermées et le tri, puis « + Carte », seule au bout.
 * Plus de seconde ligne de puces de jalon, plus d'interrupteurs éparpillés.
 */
import { Columns3, Filter, Hand, List, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { agentKindSchema, type AgentKind, type CardColumn } from '@solera/protocol'
import { Button, Popover, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import {
  FilterChip,
  MenuCheck,
  MenuHeading,
  MenuSegment,
  OneLineToolbar,
  ToolbarSearch,
  ViewTiles,
  toolbarButtonClass,
  useView,
  type ViewOption,
} from '../../components/prototype/ViewSwitch'
import { DAY } from '../prototype-milestones/model'
import { DemoToggle } from '../prototype-milestones/HorizonVariant'
import {
  COLUMN_WORD,
  DEFAULT_DISPLAY,
  matches,
  shortTitle,
  useBoardData,
  type BoardCard,
  type BoardDisplay,
  type BoardSort,
  type ExternalControls,
} from './data'
import { GestureVariant } from './GestureVariant'
import { KanbanVariant } from './KanbanVariant'
import { ListVariant } from './ListVariant'
import { TAB_MENU_FLAG } from './ViewsBoard'

type View = 'kanban' | 'liste' | 'geste'
const VIEWS: ViewOption<View>[] = [
  { key: 'kanban', label: 'Kanban', icon: <Columns3 size={16} /> },
  { key: 'liste', label: 'Liste', icon: <List size={16} /> },
  { key: 'geste', label: 'Par geste', icon: <Hand size={16} /> },
]
const VIEW_KEYS = VIEWS.map((view) => view.key)

interface Filters {
  /** Ids de jalon, `none` pour « sans jalon ». Vide : tous. */
  milestones: string[]
  waiting: boolean
  clarify: boolean
  accept: boolean
  due: 'late' | 'week' | null
  agents: AgentKind[]
  /** Posé par « Tout voir » de la colonne Fait. */
  column: CardColumn | null
}
const NO_FILTERS: Filters = { milestones: [], waiting: false, clarify: false, accept: false, due: null, agents: [], column: null }

const AGENT_WORD: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok', opencode: 'OpenCode' } as Record<AgentKind, string>

function passes(entry: BoardCard, filters: Filters): boolean {
  const { card } = entry
  if (filters.milestones.length > 0) {
    const key = entry.milestone?.card.id ?? 'none'
    if (!filters.milestones.includes(key)) return false
  }
  // Les états se cumulent en « ou » : « t'attend ou à préciser » est la question qu'on se pose.
  const states = [filters.waiting && entry.waiting, filters.clarify && card.toClarifySince !== null, filters.accept && card.acceptedAt === null]
  if ((filters.waiting || filters.clarify || filters.accept) && !states.some(Boolean)) return false
  if (filters.due === 'late' && !entry.late) return false
  if (filters.due === 'week' && (card.dueAt === null || card.dueAt - Date.now() > 7 * DAY)) return false
  if (filters.agents.length > 0 && !card.conversations.some((session) => session.archivedAt === null && filters.agents.includes(session.agent))) return false
  if (filters.column && entry.column !== filters.column) return false
  return true
}

function useStoredDisplay(projectId: string | undefined): [BoardDisplay, (next: BoardDisplay) => void] {
  const key = `proto-tableau-affichage:${projectId ?? ''}`
  const [display, setDisplay] = useState<BoardDisplay>(() => {
    try {
      return { ...DEFAULT_DISPLAY, ...(JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<BoardDisplay>) }
    } catch {
      return DEFAULT_DISPLAY
    }
  })
  return [
    display,
    (next) => {
      localStorage.setItem(key, JSON.stringify(next))
      setDisplay(next)
    },
  ]
}

export function OneLineBoard() {
  const { projectId } = useParams()
  const data = useBoardData(projectId)
  const [view, setView] = useView<View>('tableau', projectId, VIEW_KEYS)
  const [display, setDisplay] = useStoredDisplay(projectId)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [displayOpen, setDisplayOpen] = useState(false)
  const [notice, setNotice] = useState(false)

  // Cette variante n'a pas de menu dans l'onglet : la rangée reprend son onglet simple.
  useEffect(() => {
    localStorage.setItem(TAB_MENU_FLAG, '0')
    window.dispatchEvent(new Event(TAB_MENU_FLAG))
  }, [])

  const external: ExternalControls = useMemo(
    () => ({
      predicate: (entry) => matches(entry, query) && passes(entry, filters),
      display,
      onSeeAllDone: () => {
        setFilters((current) => ({ ...current, column: 'done' }))
        setView('liste')
      },
    }),
    [query, filters, display, setView],
  )

  const openMilestones = data.milestones.filter((milestone) => milestone.done < milestone.leaves.length)
  const loose = data.cards.filter((entry) => entry.milestone === null && entry.column !== 'done' && entry.column !== 'abandoned').length
  const agents = agentKindSchema.options.filter((agent) => data.cards.some((entry) => entry.card.conversations.some((session) => session.agent === agent)))
  const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }))

  /* Les puces des filtres actifs, sur la même ligne. */
  const chips = [
    ...filters.milestones.map((id) => {
      const milestone = data.milestones.find((entry) => entry.card.id === id)
      return (
        <FilterChip key={`m-${id}`} title={milestone?.card.title} onClear={() => set({ milestones: filters.milestones.filter((item) => item !== id) })}>
          {milestone ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cx('size-1.5 rounded-full', milestone.tint.dot)} />#{milestone.card.number} {shortTitle(milestone.card.title, 18)}
            </span>
          ) : 'Sans jalon'}
        </FilterChip>
      )
    }),
    filters.waiting ? <FilterChip key="w" onClear={() => set({ waiting: false })}>t'attend</FilterChip> : null,
    filters.clarify ? <FilterChip key="c" onClear={() => set({ clarify: false })}>à préciser</FilterChip> : null,
    filters.accept ? <FilterChip key="a" onClear={() => set({ accept: false })}>à accepter</FilterChip> : null,
    filters.due ? <FilterChip key="d" onClear={() => set({ due: null })}>{filters.due === 'late' ? 'en retard' : 'échéance cette semaine'}</FilterChip> : null,
    ...filters.agents.map((agent) => <FilterChip key={`g-${agent}`} onClear={() => set({ agents: filters.agents.filter((item) => item !== agent) })}>{AGENT_WORD[agent] ?? agent}</FilterChip>),
    filters.column ? <FilterChip key="col" onClear={() => set({ column: null })}>colonne : {COLUMN_WORD[filters.column]}</FilterChip> : null,
  ].filter(Boolean)
  const activeCount = chips.length

  const filterMenu = (
    <Popover
      open={filterOpen}
      onOpenChange={setFilterOpen}
      label="Filtrer"
      side="bottom"
      align="start"
      className="w-80"
      trigger={
        <button type="button" className={toolbarButtonClass(activeCount > 0)}>
          <Filter size={13} /> Filtrer
          {activeCount > 0 ? <span className="rounded bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink">{activeCount}</span> : null}
        </button>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto pb-2">
        <MenuHeading>Jalon</MenuHeading>
        {openMilestones.map((milestone) => (
          <MenuCheck
            key={milestone.card.id}
            checked={filters.milestones.includes(milestone.card.id)}
            onChange={() => set({ milestones: toggleIn(filters.milestones, milestone.card.id) })}
            aside={`${milestone.done}/${milestone.leaves.length}`}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5" title={milestone.card.title}>
              <span aria-hidden className={cx('size-2 shrink-0 rounded-full', milestone.tint.dot)} />
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{milestone.card.number}</span>
              <span className="truncate">{shortTitle(milestone.card.title, 30)}</span>
            </span>
          </MenuCheck>
        ))}
        {loose > 0 ? (
          <MenuCheck checked={filters.milestones.includes('none')} onChange={() => set({ milestones: toggleIn(filters.milestones, 'none') })} aside={loose}>
            Sans jalon
          </MenuCheck>
        ) : null}

        <MenuHeading>État</MenuHeading>
        <MenuCheck checked={filters.waiting} onChange={(next) => set({ waiting: next })}>T'attend</MenuCheck>
        <MenuCheck checked={filters.clarify} onChange={(next) => set({ clarify: next })}>À préciser</MenuCheck>
        <MenuCheck checked={filters.accept} onChange={(next) => set({ accept: next })}>À accepter</MenuCheck>

        <MenuHeading>Échéance</MenuHeading>
        <MenuCheck checked={filters.due === 'late'} onChange={(next) => set({ due: next ? 'late' : null })}>En retard</MenuCheck>
        <MenuCheck checked={filters.due === 'week'} onChange={(next) => set({ due: next ? 'week' : null })}>Cette semaine</MenuCheck>

        {agents.length > 0 ? (
          <>
            <MenuHeading>Agent</MenuHeading>
            {agents.map((agent) => (
              <MenuCheck key={agent} checked={filters.agents.includes(agent)} onChange={() => set({ agents: toggleIn(filters.agents, agent) })}>
                <span className="inline-flex items-center gap-1.5"><AgentIcon agent={agent} size={13} /> {AGENT_WORD[agent] ?? agent}</span>
              </MenuCheck>
            ))}
          </>
        ) : null}

        {activeCount > 0 ? (
          <div className="mt-2 border-t border-line px-3 pt-2">
            <button type="button" onClick={() => setFilters(NO_FILTERS)} className="text-xs text-ink-faint hover:text-ink">Effacer tous les filtres</button>
          </div>
        ) : null}
      </div>
    </Popover>
  )

  const current = VIEWS.find((option) => option.key === view)!
  const displayMenu = (
    <Popover
      open={displayOpen}
      onOpenChange={setDisplayOpen}
      label="Affichage"
      side="bottom"
      align="end"
      className="w-80"
      trigger={
        <button type="button" className={toolbarButtonClass(false)} title={`Affichage : ${current.label}`}>
          {current.icon} <span className="hidden sm:inline">Affichage</span>
        </button>
      }
    >
      <div className="pb-3">
        <ViewTiles options={VIEWS} value={view} onChange={setView} />
        {view === 'kanban' ? (
          <>
            <MenuHeading>Regroupement</MenuHeading>
            <MenuSegment
              options={[{ key: 'none', label: 'Aucun' }, { key: 'lanes', label: 'Couloirs par jalon' }]}
              value={display.lanes ? 'lanes' : 'none'}
              onChange={(next) => setDisplay({ ...display, lanes: next === 'lanes' })}
            />
          </>
        ) : null}
        {view !== 'geste' ? (
          <>
            <MenuHeading>Fait</MenuHeading>
            <MenuSegment
              options={[{ key: 'recent', label: 'Les 5 récentes' }, { key: 'all', label: 'Toutes' }, { key: 'hidden', label: 'Masquées' }]}
              value={display.done}
              onChange={(next) => setDisplay({ ...display, done: next })}
            />
            <MenuCheck checked={display.abandoned} onChange={(next) => setDisplay({ ...display, abandoned: next })}>Montrer les abandonnées</MenuCheck>
          </>
        ) : null}
        {view === 'kanban' ? (
          <>
            <MenuHeading>Tri dans les colonnes</MenuHeading>
            <MenuSegment<BoardSort>
              options={[{ key: 'geste', label: 'Ce qui t’attend' }, { key: 'recent', label: 'Récentes' }, { key: 'due', label: 'Échéance' }, { key: 'number', label: 'Numéro' }]}
              value={display.sort}
              onChange={(next) => setDisplay({ ...display, sort: next })}
            />
          </>
        ) : null}
        {view === 'liste' ? <p className="px-3 pt-2 text-xs text-ink-faint">Le tri de la liste se règle en cliquant ses en-têtes.</p> : null}
      </div>
    </Popover>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder="Chercher, ou #12" />}
        filter={filterMenu}
        chips={chips}
        extra={
          <span className="hidden items-center gap-1.5 lg:flex">
            {data.movedCount > 0 ? (
              <button
                type="button"
                onClick={data.resetMoves}
                title="Les glissements du proto ne vont pas au serveur"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-fuchsia-700 hover:bg-fuchsia-500/10 dark:text-fuchsia-300"
              >
                <RotateCcw size={12} /> {data.movedCount} local
              </button>
            ) : null}
            <DemoToggle demo={data.proto.demo} />
          </span>
        }
        display={displayMenu}
        action={
          <Button size="sm" icon={<Plus size={15} />} onClick={() => setNotice(true)}>
            Carte
          </Button>
        }
      />
      {notice ? (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-lg border border-dashed border-fuchsia-500/60 px-3 py-2 text-xs text-fuchsia-600 md:mx-6 dark:text-fuchsia-300">
          Simulé : la création passe par le formulaire existant (variante « actuel »).
          <button type="button" className="ml-auto underline" onClick={() => setNotice(false)}>Fermer</button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        {view === 'liste' ? (
          <ListVariant external={external} onlyColumn={filters.column} />
        ) : view === 'geste' ? (
          <GestureVariant external={external} />
        ) : (
          <KanbanVariant external={external} />
        )}
      </div>
    </div>
  )
}
