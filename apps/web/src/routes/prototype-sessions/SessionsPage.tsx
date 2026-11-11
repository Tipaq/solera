/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * « Sessions » : toutes les conversations, de tous les projets et sans projet — l'endroit
 * que le lieu *Fils* de la sidebar ne donne pas (il s'arrête aux 40 plus récentes).
 * Modèle : la page « Récents » de Claude, avec les briques du proto : la bande de la coque
 * commune, la barre sur une ligne (recherche, Filtrer ▾, Affichage ▾), la liste unique
 * « Ce qui t'attend », les pastilles de projet. Aucune écriture : archiver, épingler,
 * supprimer sont simulés.
 */
import { CheckSquare, Columns3, Filter, FolderTree, List, MessageSquare, Pin, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Popover, cx } from '@solera/ui'
import type { AgentKind } from '@solera/protocol'
import { AgentIcon } from '../../components/AgentIcon'
import { HeaderBand } from '../../components/HeaderBand'
import { AskInbox } from '../../components/prototype/AskInbox'
import { DrawerLayer } from '../../components/prototype/Drawer'
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
import { relativeDate } from '../../lib/dates'
import { DemoToggle } from '../prototype-milestones/HorizonVariant'
import { ProjectGroupHeader, ProjectPip, toggled, useNotice } from '../prototype-portfolio/parts'
import { DAY, STATE_DOT, STATE_RANK, STATE_WORD, useSessionsData, type SessionRow, type SessionState } from './data'

type View = 'liste' | 'etat' | 'projet'
type Sort = 'recent' | 'attente' | 'nom'
type Scope = 'actives' | 'archivees'
type Period = 'all' | 'day' | 'week' | 'month'

const VIEWS: ViewOption<View>[] = [
  { key: 'liste', label: 'Liste', icon: <List size={14} /> },
  { key: 'etat', label: 'Par état', icon: <Columns3 size={14} /> },
  { key: 'projet', label: 'Par projet', icon: <FolderTree size={14} /> },
]

const AGENT_WORD: Record<string, string> = { claude: 'Claude', codex: 'Codex', grok: 'Grok', opencode: 'OpenCode' }
const STATES: SessionState[] = ['awaiting', 'error', 'review', 'running', 'done']
const PERIOD_WORD: Record<Exclude<Period, 'all'>, string> = { day: "aujourd'hui", week: '7 jours', month: '30 jours' }
const PERIOD_SPAN: Record<Exclude<Period, 'all'>, number> = { day: DAY, week: 7 * DAY, month: 30 * DAY }

interface Filters {
  projects: ReadonlySet<string>
  states: ReadonlySet<SessionState>
  agents: ReadonlySet<AgentKind>
  period: Period
  pinned: boolean
}

/** Les tranches de la Liste, comme le lieu *Fils* : la réponse à « que faisais-je ? » est datée. */
function bucketOf(at: number): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = today.getTime()
  if (at >= start) return "Aujourd'hui"
  if (at >= start - DAY) return 'Hier'
  if (at >= start - 7 * DAY) return 'Cette semaine'
  return 'Plus ancien'
}

export function SessionsPage() {
  const data = useSessionsData()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [notice, simulate] = useNotice()
  const [search, setSearch] = useState(() => params.get('q') ?? '') // PROTOTYPE : `?q=` vient de la palette
  const [scope, setScope] = useState<Scope>('actives')
  const [view, setView] = useView<View>('sessions', 'all', ['liste', 'etat', 'projet'])
  const [sort, setSort] = useState<Sort>('recent')
  const [filters, setFilters] = useState<Filters>(() => {
    const projet = params.get('projet')
    return { projects: new Set(projet ? [projet] : []), states: new Set(), agents: new Set(), period: 'all', pinned: false }
  })
  const [filterOpen, setFilterOpen] = useState(false)
  const [displayOpen, setDisplayOpen] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }))

  const inScope = useMemo(() => data.rows.filter((row) => (scope === 'archivees' ? row.archived : !row.archived)), [data.rows, scope])
  const agents = useMemo(() => [...new Set(inScope.map((row) => row.agent))], [inScope])
  const hasLoose = inScope.some((row) => row.project === null)

  const shown = useMemo(() => {
    const now = Date.now()
    const needle = search.trim().toLocaleLowerCase()
    const kept = inScope.filter((row) => {
      if (filters.projects.size > 0 && !filters.projects.has(row.project?.id ?? 'none')) return false
      if (filters.states.size > 0 && !filters.states.has(row.state)) return false
      if (filters.agents.size > 0 && !filters.agents.has(row.agent)) return false
      if (filters.period !== 'all' && now - row.at > PERIOD_SPAN[filters.period]) return false
      if (filters.pinned && !row.pinned) return false
      if (!needle) return true
      return [row.title, row.project?.name ?? '', row.branch ?? '', row.card ? `#${row.card.number}` : ''].some((text) => text.toLocaleLowerCase().includes(needle))
    })
    return kept.sort((a, b) =>
      sort === 'nom'
        ? a.title.localeCompare(b.title)
        : sort === 'attente'
          ? STATE_RANK[a.state] - STATE_RANK[b.state] || b.at - a.at
          : Number(b.pinned) - Number(a.pinned) || b.at - a.at,
    )
  }, [inScope, filters, search, sort])

  const chips = [
    ...[...filters.projects].map((id) => (
      <FilterChip key={`p-${id}`} onClear={() => set({ projects: toggled(filters.projects, id) })}>
        {id === 'none' ? 'sans projet' : (data.projects.find((project) => project.id === id)?.name ?? 'projet')}
      </FilterChip>
    )),
    ...[...filters.states].map((state) => <FilterChip key={`s-${state}`} onClear={() => set({ states: toggled(filters.states, state) })}>{STATE_WORD[state]}</FilterChip>),
    ...[...filters.agents].map((agent) => <FilterChip key={`a-${agent}`} onClear={() => set({ agents: toggled(filters.agents, agent) })}>{AGENT_WORD[agent] ?? agent}</FilterChip>),
    filters.period !== 'all' ? <FilterChip key="period" onClear={() => set({ period: 'all' })}>{PERIOD_WORD[filters.period]}</FilterChip> : null,
    filters.pinned ? <FilterChip key="pin" onClear={() => set({ pinned: false })}>épinglées</FilterChip> : null,
  ].filter(Boolean)

  const filterMenu = (
    <Popover
      open={filterOpen}
      onOpenChange={setFilterOpen}
      label="Filtrer"
      side="bottom"
      align="start"
      className="w-80"
      trigger={
        <button type="button" className={toolbarButtonClass(chips.length > 0)}>
          <Filter size={13} /> Filtrer
          {chips.length > 0 ? <span className="rounded bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink">{chips.length}</span> : null}
        </button>
      }
    >
      <div className="max-h-[70vh] overflow-y-auto pb-2">
        <MenuHeading>Projet</MenuHeading>
        {data.projects.map((project) => (
          <MenuCheck
            key={project.id}
            checked={filters.projects.has(project.id)}
            onChange={() => set({ projects: toggled(filters.projects, project.id) })}
            aside={inScope.filter((row) => row.project?.id === project.id).length}
          >
            <ProjectPip project={project} plain />
          </MenuCheck>
        ))}
        {hasLoose ? (
          <MenuCheck checked={filters.projects.has('none')} onChange={() => set({ projects: toggled(filters.projects, 'none') })} aside={inScope.filter((row) => !row.project).length}>
            Sans projet
          </MenuCheck>
        ) : null}
        <MenuHeading>État</MenuHeading>
        {STATES.map((state) => (
          <MenuCheck key={state} checked={filters.states.has(state)} onChange={() => set({ states: toggled(filters.states, state) })} aside={inScope.filter((row) => row.state === state).length}>
            <span className="inline-flex items-center gap-1.5"><span aria-hidden className={cx('size-2 rounded-full', STATE_DOT[state])} /> {STATE_WORD[state]}</span>
          </MenuCheck>
        ))}
        {agents.length > 1 ? (
          <>
            <MenuHeading>Agent</MenuHeading>
            {agents.map((agent) => (
              <MenuCheck key={agent} checked={filters.agents.has(agent)} onChange={() => set({ agents: toggled(filters.agents, agent) })}>
                <span className="inline-flex items-center gap-1.5"><AgentIcon agent={agent} size={13} /> {AGENT_WORD[agent] ?? agent}</span>
              </MenuCheck>
            ))}
          </>
        ) : null}
        <MenuHeading>Période</MenuHeading>
        <MenuSegment<Period>
          options={[{ key: 'all', label: 'Tout' }, { key: 'day', label: "Aujourd'hui" }, { key: 'week', label: '7 j' }, { key: 'month', label: '30 j' }]}
          value={filters.period}
          onChange={(next) => set({ period: next })}
        />
        <div className="pt-2">
          <MenuCheck checked={filters.pinned} onChange={(next) => set({ pinned: next })}>Épinglées seulement</MenuCheck>
        </div>
        {chips.length > 0 ? (
          <div className="mt-2 border-t border-line px-3 pt-2">
            <button type="button" onClick={() => setFilters({ projects: new Set(), states: new Set(), agents: new Set(), period: 'all', pinned: false })} className="text-xs text-ink-faint hover:text-ink">
              Effacer tous les filtres
            </button>
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
        <MenuHeading>Tri</MenuHeading>
        <MenuSegment<Sort>
          options={[{ key: 'recent', label: 'Récentes' }, { key: 'attente', label: 'Ce qui t’attend' }, { key: 'nom', label: 'Nom' }]}
          value={sort}
          onChange={setSort}
        />
      </div>
    </Popover>
  )

  const scopeSwitch = (
    <span role="radiogroup" aria-label="Sessions" className="hidden h-11 shrink-0 items-center rounded-md border border-line p-0.5 md:inline-flex md:h-9 pointer-coarse:h-11">
      {(['actives', 'archivees'] as const).map((key) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={scope === key}
          onClick={() => { setScope(key); setSelected(new Set()) }}
          className={cx('h-full rounded px-2.5 text-xs transition-colors', scope === key ? 'bg-surface-high text-ink' : 'text-ink-faint hover:text-ink')}
        >
          {key === 'actives' ? 'Actives' : 'Archivées'}
          <span className="ml-1 tabular-nums text-ink-faint">{data.rows.filter((row) => (key === 'archivees' ? row.archived : !row.archived)).length}</span>
        </button>
      ))}
    </span>
  )

  const open = (row: SessionRow) => {
    if (selecting) return setSelected((now) => toggled(now, row.id))
    if (!row.to) return simulate(`ouvrirait la session « ${row.title} »`)
    navigate(row.to)
  }

  const bulk = (verb: string) => {
    simulate(`${verb} ${selected.size} session${selected.size > 1 ? 's' : ''}`)
    setSelected(new Set())
    setSelecting(false)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* La bande de la coque commune (même gouttière que `PlaceShell`), sans rangée
          d'onglets : la page n'a qu'une vue, réglée par Affichage ▾. */}
      <HeaderBand className="pl-4! pr-4! md:pl-6! md:pr-6!">
        <span className="flex size-5 shrink-0 items-center justify-center text-ink-faint"><MessageSquare size={16} /></span>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Sessions</h1>
        <Button size="sm" icon={<Plus size={16} />} onClick={() => navigate('/c/new')}>
          <span className="hidden sm:inline">Conversation</span>
        </Button>
      </HeaderBand>

      <OneLineToolbar
        search={<ToolbarSearch value={search} onChange={setSearch} placeholder="Chercher une session" />}
        filter={filterMenu}
        chips={chips}
        extra={
          <>
            <span className="hidden lg:inline"><DemoToggle demo={data.demo} /></span>
            {scopeSwitch}
          </>
        }
        display={displayMenu}
        action={
          <button
            type="button"
            onClick={() => { setSelecting((now) => !now); setSelected(new Set()) }}
            className={toolbarButtonClass(selecting)}
          >
            <CheckSquare size={13} /> <span className="hidden sm:inline">{selecting ? 'Terminer' : 'Sélectionner'}</span>
          </button>
        }
      />

      {selecting ? (
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface/60 px-4 text-sm md:px-6">
          <span className="tabular-nums text-ink-soft">{selected.size} sélectionnée{selected.size > 1 ? 's' : ''}</span>
          <button type="button" className="text-xs text-ink-faint hover:text-ink" onClick={() => setSelected(new Set(shown.map((row) => row.id)))}>Tout</button>
          <span className="ml-auto flex items-center gap-1.5">
            {scope === 'actives' ? (
              <>
                <Button size="sm" variant="ghost" disabled={selected.size === 0} onClick={() => bulk('épinglerait')}>Épingler</Button>
                <Button size="sm" variant="ghost" disabled={selected.size === 0} onClick={() => bulk('archiverait')}>Archiver</Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" disabled={selected.size === 0} onClick={() => bulk('désarchiverait')}>Désarchiver</Button>
            )}
            <Button size="sm" variant="ghost" disabled={selected.size === 0} onClick={() => bulk('supprimerait')}>Supprimer</Button>
          </span>
        </div>
      ) : null}
      {notice}

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 p-4 md:p-6">
          {view === 'liste' && scope === 'actives' && !selecting ? <AskInbox items={data.inbox} /> : null}

          {shown.length === 0 ? (
            <p className="text-sm text-ink-faint">
              {data.pending ? 'Chargement…' : chips.length > 0 || search ? 'Aucune session ne correspond.' : scope === 'archivees' ? 'Aucune session archivée.' : 'Aucune session.'}
            </p>
          ) : view === 'etat' ? (
            <StateColumns rows={shown} renderRow={(row) => <Row key={row.id} row={row} onOpen={open} selecting={selecting} selected={selected.has(row.id)} compact />} />
          ) : (
            <Grouped
              groups={view === 'projet' ? byProject(shown) : byDay(shown, sort)}
              folded={folded}
              onFold={(key) => setFolded((now) => toggled(now, key))}
              foldable={view === 'projet'}
              renderRow={(row) => <Row key={row.id} row={row} onOpen={open} selecting={selecting} selected={selected.has(row.id)} hideProject={view === 'projet'} />}
            />
          )}
        </div>
        <DrawerLayer />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ groupes */

interface Group {
  key: string
  head: ReactNode
  rows: SessionRow[]
}

function byDay(rows: SessionRow[], sort: Sort): Group[] {
  // Les tranches datées n'ont de sens que triées par date ; sinon, une seule liste.
  if (sort !== 'recent') return [{ key: 'all', head: null, rows }]
  const pinned = rows.filter((row) => row.pinned)
  const rest = rows.filter((row) => !row.pinned)
  const groups: Group[] = pinned.length ? [{ key: 'pinned', head: <DayHead label="Épinglées" count={pinned.length} />, rows: pinned }] : []
  for (const row of rest) {
    const label = bucketOf(row.at)
    const last = groups[groups.length - 1]
    if (last && last.key === label) last.rows.push(row)
    else groups.push({ key: label, head: null, rows: [row] })
  }
  return groups.map((group) => (group.head ? group : { ...group, head: <DayHead label={group.key} count={group.rows.length} /> }))
}

function byProject(rows: SessionRow[]): Group[] {
  const map = new Map<string, SessionRow[]>()
  for (const row of rows) {
    const key = row.project?.id ?? 'none'
    map.set(key, [...(map.get(key) ?? []), row])
  }
  return [...map.entries()].map(([key, list]) => ({
    key,
    head: list[0]!.project ? <ProjectGroupHeader project={list[0]!.project} count={list.length} /> : <DayHead label="Sans projet" count={list.length} />,
    rows: list,
  }))
}

function DayHead({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <h2 className="text-xs font-medium tracking-wide text-ink-faint uppercase">{label}</h2>
      <span className="text-xs tabular-nums text-ink-faint">{count}</span>
    </div>
  )
}

function Grouped({ groups, folded, onFold, foldable, renderRow }: {
  groups: Group[]
  folded: ReadonlySet<string>
  onFold: (key: string) => void
  foldable: boolean
  renderRow: (row: SessionRow) => ReactNode
}) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => {
        const closed = foldable && folded.has(group.key)
        return (
          <section key={group.key} className="flex flex-col">
            {group.head ? (
              foldable ? (
                <button type="button" onClick={() => onFold(group.key)} className="text-left" aria-expanded={!closed}>{group.head}</button>
              ) : (
                group.head
              )
            ) : null}
            {closed ? null : <ul className="flex flex-col divide-y divide-line border-y border-line">{group.rows.map(renderRow)}</ul>}
          </section>
        )
      })}
    </div>
  )
}

/** Par état : les quatre colonnes de Travail, plus « en erreur » rangée avec ce qui t'attend. */
function StateColumns({ rows, renderRow }: { rows: SessionRow[]; renderRow: (row: SessionRow) => ReactNode }) {
  const columns: { key: string; label: string; states: SessionState[] }[] = [
    { key: 'a', label: "T'attend", states: ['awaiting', 'error'] },
    { key: 'r', label: 'Travaille', states: ['running'] },
    { key: 'v', label: 'À relire', states: ['review'] },
    { key: 'd', label: 'Terminées', states: ['done'] },
  ]
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {columns.map((column) => {
        const list = rows.filter((row) => column.states.includes(row.state))
        return (
          <section key={column.key} className="flex min-w-0 flex-col">
            <DayHead label={column.label} count={list.length} />
            {list.length === 0 ? (
              <p className="py-2 text-xs text-ink-faint">Vide</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line border-y border-line">{list.slice(0, 30).map(renderRow)}</ul>
            )}
          </section>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ ligne */

function Row({ row, onOpen, selecting, selected, hideProject = false, compact = false }: {
  row: SessionRow
  onOpen: (row: SessionRow) => void
  selecting: boolean
  selected: boolean
  hideProject?: boolean
  compact?: boolean
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(row)}
        className={cx(
          'flex min-h-11 w-full min-w-0 items-center gap-3 px-1 text-left text-sm transition-colors hover:bg-surface-high/50 md:min-h-10',
          selected && 'bg-accent/10',
        )}
      >
        {selecting ? (
          <span aria-hidden className={cx('grid size-4 shrink-0 place-items-center rounded border', selected ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong')}>
            {selected ? '✓' : null}
          </span>
        ) : null}
        <span className="relative shrink-0 text-ink-soft" title={STATE_WORD[row.state]}>
          <AgentIcon agent={row.agent} size={15} />
          <span aria-hidden className={cx('absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-canvas', STATE_DOT[row.state])} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cx('truncate', row.state === 'awaiting' || row.state === 'error' ? 'font-medium text-ink' : 'text-ink')}>{row.title}</span>
          {row.pinned ? <Pin size={12} className="shrink-0 text-ink-faint" aria-label="épinglée" /> : null}
          {!compact && (row.state === 'awaiting' || row.state === 'error' || row.state === 'review') ? (
            <span className={cx('shrink-0 text-xs', row.state === 'error' ? 'text-critical' : row.state === 'awaiting' ? 'text-caution' : 'text-ink-faint')}>{STATE_WORD[row.state]}</span>
          ) : null}
        </span>
        {!compact ? (
          <span className="hidden min-w-0 shrink items-center gap-2 text-xs text-ink-faint lg:flex">
            {!hideProject && row.project ? <ProjectPip project={row.project} plain /> : null}
            {row.branch ? <span className="max-w-48 truncate font-mono">{row.branch}</span> : null}
            {row.card ? <span className="shrink-0 tabular-nums">#{row.card.number}</span> : null}
          </span>
        ) : null}
        <span className="w-20 shrink-0 text-right text-xs tabular-nums text-ink-faint">{relativeDate(row.at)}</span>
      </button>
    </li>
  )
}
