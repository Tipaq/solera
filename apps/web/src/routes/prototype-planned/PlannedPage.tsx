/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * La page globale des **Planifiées**, dans la DA des pages de lieu (`/projects`,
 * `/p/:id`) : une bande, la ligne d'outils sur une ligne (recherche, Filtrer ▾,
 * Affichage ▾, action), pleine largeur, gouttière 16/24 px, le tiroir commun des Actions.
 * Elle prend **tout** : les projets, le Savoir, l'instance — chaque tâche porte sa
 * pastille de portée.
 *
 * Trois vues (décision de Tim) : le **Lanceur** par défaut — des tuiles au gabarit exact
 * du Lanceur de l'onglet Actions, un geste chacune (lancer maintenant, reprendre,
 * relire) —, l'**Agenda** (quand tout tombe, ensemble), et la **Liste**, qui est
 * l'ancienne vue Santé renommée : ce qui échoue d'abord, la réussite, le coût. L'ancienne
 * Liste par échéance est retirée, elle redisait la Santé.
 *
 * Aucune écriture : lancer, mettre en pause, enregistrer disent « Simulé ».
 */
import {
  AlarmClock,
  BookOpen,
  Bot,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  Filter,
  FolderX,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Server,
  SquareTerminal,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button, Menu, MenuItem, MenuSeparator, Popover, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { HeaderBand } from '../../components/HeaderBand'
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
import { cronToHuman } from '../../lib/cron'
import { locale } from '../../lib/i18n'
import { elapsed } from '../../lib/dates'
import { describeCadence, formatDateTime } from '../../lib/schedules'
import { ActionDrawer, newActionPanel, type ActionPanel } from '../prototype-automations/ActionDrawer'
import { ActionsAgenda, type ActionsAgendaMode } from '../prototype-automations/ActionsAgenda'
import { Group, TILE_BOX } from '../prototype-automations/Launcher'
import { ReviewButton, StateIcon, quietGestureClass, type StateTone } from '../prototype-automations/LaunchButton'
import type { UnifiedRun, What } from '../prototype-automations/model'
import { DemoToggle } from '../prototype-milestones/HorizonVariant'
import { ProjectPip } from '../prototype-portfolio/parts'
import { formatCost, inShort } from '../prototype-schedules/data'
import { RUN_FILL, RUN_WORD } from '../prototype-schedules/shared'
import {
  DUE_WORD,
  dueOf,
  healthOf,
  projectIdOf,
  scopeKey,
  scopeLabel,
  usePlanned,
  type Due,
  type PlannedData,
  type PlannedItem,
  type Scope,
} from './data'

type View = 'lanceur' | 'agenda' | 'liste'
const VIEWS: ViewOption<View>[] = [
  { key: 'lanceur', label: 'Lanceur', icon: <LayoutGrid size={14} /> },
  { key: 'agenda', label: 'Agenda', icon: <CalendarDays size={14} /> },
  // L'ancienne vue Santé, sous le nom que Tim préfère.
  { key: 'liste', label: 'Liste', icon: <List size={14} /> },
]

type StateFilter = 'active' | 'paused' | 'failing' | 'review'
type NextFilter = 'today' | 'week'
interface Filters {
  scopes: string[]
  what: What[]
  state: StateFilter[]
  next: NextFilter | null
}
const NO_FILTERS: Filters = { scopes: [], what: [], state: [], next: null }
const STATE_WORD: Record<StateFilter, string> = { active: 'Actives', paused: 'En pause', failing: 'En échec', review: 'À relire' }
const NEXT_WORD: Record<NextFilter, string> = { today: "Passe aujourd'hui", week: 'Passe sous 7 jours' }

const toggleIn = <T,>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value])

function matchesState(item: PlannedItem, state: StateFilter): boolean {
  if (state === 'active') return Boolean(item.schedule?.enabled)
  if (state === 'paused') return !item.schedule?.enabled
  if (state === 'failing') return item.failStreak > 0
  return Boolean(item.review)
}

export function PlannedPage() {
  const data = usePlanned()
  const [view, setView] = useView('planifiees-v2', 'all', ['lanceur', 'agenda', 'liste'] as const)
  const [group, setGroup] = useState<'due' | 'scope'>('due')
  const [agendaMode, setAgendaMode] = useState<ActionsAgendaMode>('semaine')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [displayOpen, setDisplayOpen] = useState(false)
  const [panel, setPanel] = useState<ActionPanel | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const simulate = (text: string) => {
    setNotice(`Simulé : ${text}`)
    window.setTimeout(() => setNotice(null), 3200)
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const now = Date.now()
    return data.items.filter((item) => {
      if (filters.scopes.length && !filters.scopes.includes(scopeKey(item.scope))) return false
      if (filters.what.length && !filters.what.includes(item.what)) return false
      if (filters.state.length && !filters.state.some((state) => matchesState(item, state))) return false
      if (filters.next) {
        const next = item.schedule?.enabled ? item.schedule.nextRunAt : null
        if (next === null) return false
        if (filters.next === 'today' && dueOf(item, now) !== 'today') return false
        if (filters.next === 'week' && next > now + 7 * 86_400_000) return false
      }
      if (!needle) return true
      return [item.label, item.prompt, item.command, scopeLabel(item.scope)].some((text) => text?.toLocaleLowerCase().includes(needle))
    })
  }, [data.items, query, filters])

  const open = panel?.mode === 'detail' ? data.items.find((item) => item.id === panel.id) : undefined
  const openItem = (item: PlannedItem) => setPanel({ mode: 'detail', id: item.id })

  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }))
  const count = (test: (item: PlannedItem) => boolean) => data.items.filter(test).length
  const chips = [
    ...filters.scopes.map((key) => {
      const option = data.scopes.find((entry) => entry.key === key)
      return option ? <FilterChip key={`p-${key}`} onClear={() => set({ scopes: toggleIn(filters.scopes, key) })}>{scopeLabel(option.scope)}</FilterChip> : null
    }),
    ...filters.what.map((entry) => <FilterChip key={`w-${entry}`} onClear={() => set({ what: toggleIn(filters.what, entry) })}>{entry === 'agent' ? 'Agents' : 'Commandes'}</FilterChip>),
    ...filters.state.map((entry) => <FilterChip key={`s-${entry}`} onClear={() => set({ state: toggleIn(filters.state, entry) })}>{STATE_WORD[entry]}</FilterChip>),
    ...(filters.next ? [<FilterChip key="n" onClear={() => set({ next: null })}>{NEXT_WORD[filters.next]}</FilterChip>] : []),
  ].filter(Boolean)

  const filterMenu = (
    <Popover
      open={filterOpen}
      onOpenChange={setFilterOpen}
      label="Filtrer"
      side="bottom"
      align="start"
      className="max-h-[70vh] w-72 overflow-y-auto"
      trigger={
        <button type="button" className={toolbarButtonClass(chips.length > 0)}>
          <Filter size={13} /> Filtrer
          {chips.length > 0 ? <span className="rounded bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink">{chips.length}</span> : null}
        </button>
      }
    >
      <div className="pb-2">
        <MenuHeading>Portée</MenuHeading>
        {data.scopes.map((option) => (
          <MenuCheck
            key={option.key}
            checked={filters.scopes.includes(option.key)}
            onChange={() => set({ scopes: toggleIn(filters.scopes, option.key) })}
            aside={option.count}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5"><ScopeMark scope={option.scope} /> <span className="truncate">{scopeLabel(option.scope)}</span></span>
          </MenuCheck>
        ))}
        <MenuHeading>Quoi</MenuHeading>
        <MenuCheck checked={filters.what.includes('agent')} onChange={() => set({ what: toggleIn(filters.what, 'agent') })} aside={count((item) => item.what === 'agent')}>Tâches d'agent</MenuCheck>
        <MenuCheck checked={filters.what.includes('command')} onChange={() => set({ what: toggleIn(filters.what, 'command') })} aside={count((item) => item.what === 'command')}>Commandes</MenuCheck>
        <MenuHeading>État</MenuHeading>
        {(['active', 'paused', 'failing', 'review'] as const).map((state) => (
          <MenuCheck key={state} checked={filters.state.includes(state)} onChange={() => set({ state: toggleIn(filters.state, state) })} aside={count((item) => matchesState(item, state))}>
            {STATE_WORD[state]}
          </MenuCheck>
        ))}
        <MenuHeading>Prochain passage</MenuHeading>
        {(['today', 'week'] as const).map((next) => (
          <MenuCheck key={next} checked={filters.next === next} onChange={() => set({ next: filters.next === next ? null : next })}>{NEXT_WORD[next]}</MenuCheck>
        ))}
        {chips.length > 0 ? (
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
      className="w-72"
      trigger={
        <button type="button" className={toolbarButtonClass(false)} title={`Affichage : ${current.label}`}>
          {current.icon} <span className="hidden sm:inline">Affichage</span>
        </button>
      }
    >
      <div className="pb-3">
        <ViewTiles options={VIEWS} value={view} onChange={setView} />
        {view === 'agenda' ? (
          <>
            <MenuHeading>Période</MenuHeading>
            <MenuSegment<ActionsAgendaMode> options={[{ key: 'semaine', label: 'Semaine' }, { key: 'jour', label: 'Jour' }]} value={agendaMode} onChange={setAgendaMode} />
          </>
        ) : (
          <>
            <MenuHeading>Regrouper</MenuHeading>
            <MenuSegment<'due' | 'scope'>
              options={[{ key: 'due', label: view === 'liste' ? 'Par état' : 'Par échéance' }, { key: 'scope', label: 'Par portée' }]}
              value={group}
              onChange={setGroup}
            />
          </>
        )}
      </div>
    </Popover>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* La bande des pages de lieu : même gouttière que `PlaceShell`, sans rangée
          d'onglets — la page n'a qu'une vue, réglée par Affichage. */}
      <HeaderBand className="pl-4! pr-4! md:pl-6! md:pr-6!">
        <span className="flex size-5 shrink-0 items-center justify-center"><CalendarClock size={16} className="text-ink-faint" /></span>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">Planifiées</h1>
        <NewTaskMenu onPick={(kind) => setPanel(newActionPanel(kind))} />
      </HeaderBand>

      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder="Chercher une tâche" />}
        filter={filterMenu}
        chips={chips}
        extra={
          <>
            <span className="hidden text-xs tabular-nums text-ink-faint lg:inline">
              {data.items.length} tâches · {data.scopes.length} portées
            </span>
            <span className="hidden xl:inline-flex"><DemoToggle demo={data.demo} /></span>
          </>
        }
        display={displayMenu}
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {data.items.length === 0 && !data.isPending ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
            <CalendarClock size={22} className="text-ink-faint" />
            <p className="text-sm text-ink">Aucune tâche planifiée</p>
            <p className="max-w-sm text-xs text-ink-faint">Une tâche part seule, à sa cadence : une revue nocturne, un rapport, une sauvegarde. Elle peut viser un projet, le Savoir ou toute l'instance.</p>
            <Button size="sm" icon={<Plus size={14} />} onClick={() => setPanel(newActionPanel('agent'))}>Tâche</Button>
          </div>
        ) : view === 'agenda' ? (
          <div className="flex flex-col gap-3 p-4 md:p-6">
            <ActionsAgenda items={shown} mode={agendaMode} onMode={setAgendaMode} onOpen={(item) => openItem(item as PlannedItem)} />
          </div>
        ) : view === 'lanceur' ? (
          <PlannedLauncher
            items={shown}
            scopes={data.scopes}
            group={group}
            onOpen={openItem}
            onPanel={setPanel}
            simulate={simulate}
          />
        ) : (
          <HealthView items={shown} data={data} group={group} onOpen={openItem} />
        )}
        {notice ? (
          <p role="status" className="pointer-events-none fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-xs text-canvas shadow-lg">{notice}</p>
        ) : null}
      </div>

      <ActionDrawer
        projectId={open ? projectIdOf(open) : ''}
        items={data.items}
        panel={panel}
        onPanel={setPanel}
        onClose={() => setPanel(null)}
        simulate={simulate}
        launchWhere={open ? where(open.scope) : undefined}
      />
    </div>
  )
}

/** Où partirait un lancement à la main, dit dans le retour simulé du tiroir. */
function where(scope: Scope): string {
  if (scope.kind === 'project') return `à la racine de ${scope.project.name}`
  if (scope.kind === 'knowledge') return 'dans le vault'
  if (scope.kind === 'instance') return "sur l'instance"
  return 'hors projet'
}

/* ------------------------------------------------------------------ portée */

function ScopeMark({ scope }: { scope: Scope }) {
  if (scope.kind === 'knowledge') return <BookOpen size={13} className="shrink-0 text-ink-faint" />
  if (scope.kind === 'instance') return <Server size={13} className="shrink-0 text-ink-faint" />
  if (scope.kind === 'none') return <FolderX size={13} className="shrink-0 text-ink-faint" />
  return <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: scope.project.color ?? 'var(--color-line-strong)' }} />
}

export function ScopePip({ scope }: { scope: Scope }) {
  if (scope.kind === 'project') return <ProjectPip project={scope.project} />
  return (
    <span className="inline-flex min-w-0 max-w-[12rem] items-center gap-1.5 text-xs text-ink-soft">
      <ScopeMark scope={scope} />
      <span className="truncate">{scopeLabel(scope)}</span>
    </span>
  )
}

/* ------------------------------------------------------------------ lanceur */

/**
 * Le **Lanceur** des tâches planifiées : le gabarit exact des tuiles de l'onglet Actions
 * (`TILE_BOX`, `TILE_GRID`, `Group`) — même taille, même hauteur, rien ne déborde. Une
 * tuile = en-tête (nature + point d'état, libellé, ⋯), une ligne d'état, une ligne de
 * détail (cadence + portée), et un seul geste en bas.
 */
function PlannedLauncher({ items, scopes, group, onOpen, onPanel, simulate }: {
  items: PlannedItem[]
  scopes: PlannedData['scopes']
  group: 'due' | 'scope'
  onOpen: (item: PlannedItem) => void
  onPanel: (panel: ActionPanel) => void
  simulate: (text: string) => void
}) {
  const add = { label: 'Tâche', onClick: () => onPanel(newActionPanel('any')) }
  const sections = useMemo(() => {
    const byNext = (a: PlannedItem, b: PlannedItem) => (a.schedule?.nextRunAt ?? Infinity) - (b.schedule?.nextRunAt ?? Infinity)
    if (group === 'scope') {
      return scopes.map((option) => ({
        key: option.key,
        icon: <ScopeMark scope={option.scope} />,
        title: scopeLabel(option.scope),
        items: items.filter((item) => scopeKey(item.scope) === option.key).sort(byNext),
      }))
    }
    const order: Due[] = ['today', 'week', 'later', 'idle']
    const icons: Record<Due, ReactNode> = {
      today: <AlarmClock size={14} />,
      week: <CalendarDays size={14} />,
      later: <CalendarClock size={14} />,
      idle: <Pause size={14} />,
    }
    return order.map((due) => ({ key: due, icon: icons[due], title: DUE_WORD[due], items: items.filter((item) => dueOf(item) === due).sort(byNext) }))
  }, [items, scopes, group])

  if (items.length === 0) {
    return <p className="p-4 text-sm text-ink-faint md:p-6">Aucune tâche ne correspond aux filtres.</p>
  }
  return (
    <div className="flex flex-col gap-7 p-4 md:p-6">
      {sections.map((section) =>
        section.items.length === 0 ? null : (
          <Group key={section.key} icon={section.icon} title={section.title} count={section.items.length} add={add}>
            {section.items.map((item) => (
              <PlannedTile key={item.id} item={item} onOpen={onOpen} onPanel={onPanel} simulate={simulate} />
            ))}
          </Group>
        ),
      )}
    </div>
  )
}

/** L'état d'une tâche planifiée en une phrase : ce qui vient, puis ce qui s'est passé. */
function plannedState(item: PlannedItem): { tone: StateTone; text: string } {
  if (item.review) return { tone: 'review', text: `À relire — ${item.review}` }
  if (item.live) return { tone: 'live', text: `En cours · ${item.live.text}` }
  const run = item.runs[0]
  const fail = run ? run.status === 'failed' || run.status === 'timed_out' || (run.exitCode != null && run.exitCode !== 0) : false
  const last = run ? `dernier ${fail ? '✗' : '✓'} il y a ${elapsed(run.startedAt)}` : 'jamais lancée'
  if (item.failStreak >= 2) return { tone: 'fail', text: `${item.failStreak} échecs d'affilée · ${last}` }
  if (!item.schedule?.enabled) return { tone: 'idle', text: `En pause · ${last}` }
  const next = item.schedule.nextRunAt
  return { tone: fail ? 'fail' : 'idle', text: `${next ? `Prochain ${inShort(next)}` : 'Pas de prochain passage'} · ${last}` }
}

const TILE_ACTION = 'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-high md:h-9 pointer-coarse:h-11'

function PlannedTile({ item, onOpen, onPanel, simulate }: {
  item: PlannedItem
  onOpen: (item: PlannedItem) => void
  onPanel: (panel: ActionPanel) => void
  simulate: (text: string) => void
}) {
  const state = plannedState(item)
  const paused = !item.schedule?.enabled
  const cadence = item.schedule ? describeCadence(item.schedule.cadence, (expression) => cronToHuman(expression, locale())) : 'À la demande'
  const edit = (schedule: boolean) => onPanel({ mode: 'edit', seed: { from: item, schedule }, back: item.id })

  return (
    <article
      className={cx(
        TILE_BOX,
        'gap-2 transition-colors',
        item.live ? 'border-accent/40 bg-accent/5' : item.review ? 'border-caution/40' : 'border-line hover:border-line-strong',
      )}
    >
      <header className="flex min-w-0 items-start gap-2.5">
        <StateIcon item={item} tone={state.tone} />
        <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 flex-col items-start text-left">
          <span className={cx('w-full truncate text-sm font-medium hover:underline', paused ? 'text-ink-soft' : 'text-ink')}>{item.label}</span>
          <span className={cx('w-full truncate text-xs', state.tone === 'review' ? 'text-caution' : state.tone === 'fail' ? 'text-critical' : 'text-ink-faint')}>
            {state.text}
          </span>
        </button>
        <Menu
          trigger={
            <button type="button" aria-label={`Plus pour « ${item.label} »`} className="-mt-0.5 -mr-1 grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink">
              <MoreHorizontal size={15} />
            </button>
          }
        >
          <MenuItem onSelect={() => onOpen(item)}>Voir le détail</MenuItem>
          {item.review ? null : <MenuItem onSelect={() => edit(true)}>Modifier</MenuItem>}
          <MenuItem onSelect={() => simulate(paused ? `reprendre « ${item.label} »` : `mettre « ${item.label} » en pause`)}>
            {paused ? 'Reprendre' : 'Mettre en pause'}
          </MenuItem>
          <MenuItem onSelect={() => simulate(`dupliquer « ${item.label} »`)}>Dupliquer</MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => simulate(`supprimer « ${item.label} »`)}>Supprimer</MenuItem>
        </Menu>
      </header>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-[2.625rem] text-xs text-ink-faint">
        <span className="inline-flex min-w-0 shrink items-center gap-1"><AlarmClock size={11} className="shrink-0" /> <span className="truncate">{cadence}</span></span>
        <span className="flex min-w-0 max-w-[50%] shrink-0 items-center"><ScopePip scope={item.scope} /></span>
      </div>

      <footer className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {item.review ? (
          <ReviewButton onReview={() => onOpen(item)} />
        ) : item.live?.kind === 'session' && item.live.href ? (
          <Link to={item.live.href} className={quietGestureClass()}>Session ↗</Link>
        ) : paused ? (
          <button type="button" onClick={() => simulate(`reprendre « ${item.label} »`)} className={TILE_ACTION}>
            <Play size={12} /> Reprendre
          </button>
        ) : (
          <button type="button" onClick={() => simulate(`lancer « ${item.label} » maintenant, ${where(item.scope)}`)} className={TILE_ACTION}>
            <Play size={12} /> Lancer maintenant
          </button>
        )}
      </footer>
    </article>
  )
}

function WhatIcon({ item }: { item: PlannedItem }) {
  if (item.what === 'agent') return <AgentIcon agent={item.agent ?? 'claude'} size={15} />
  return item.commandKind === 'service' ? <Server size={15} className="text-ink-soft" /> : <SquareTerminal size={15} className="text-ink-soft" />
}

function Pips({ runs }: { runs: UnifiedRun[] }) {
  const shown = runs.slice(0, 10).reverse()
  return (
    <span className="flex w-[4.75rem] items-center justify-end gap-0.5" aria-label={`${shown.length} derniers passages`}>
      {Array.from({ length: 10 - shown.length }, (_, index) => <span key={`e${index}`} className="h-3 w-1.5 rounded-sm bg-surface-high" />)}
      {shown.map((run) => (
        <span key={run.id} title={`${formatDateTime(run.startedAt)} · ${RUN_WORD[run.status]}`} className={cx('h-3 w-1.5 rounded-sm', RUN_FILL[run.status])} />
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ santé */

function HealthView({ items, data, group, onOpen }: { items: PlannedItem[]; data: PlannedData; group: 'due' | 'scope'; onOpen: (item: PlannedItem) => void }) {
  const rows = items.map((item) => ({ item, health: healthOf(item, data.costOf) }))
  const judged = rows.reduce((sum, row) => sum + row.health.judged, 0)
  const ok = rows.reduce((sum, row) => sum + (row.health.rate ?? 0) * row.health.judged, 0)
  const cost = rows.reduce((sum, row) => sum + row.health.cost30, 0)
  const failing = rows.filter((row) => row.item.failStreak > 0)
  const next = items.map((item) => (item.schedule?.enabled ? item.schedule.nextRunAt : null)).filter((at): at is number => at !== null).sort((a, b) => a - b)[0]

  const sections: { key: string; title: ReactNode; rows: typeof rows }[] =
    group === 'scope'
      ? [...new Map(rows.map((row) => [scopeKey(row.item.scope), row.item.scope])).entries()].map(([key, scope]) => ({
          key,
          title: <ScopePip scope={scope} />,
          rows: rows.filter((row) => scopeKey(row.item.scope) === key).sort((a, b) => b.item.failStreak - a.item.failStreak),
        }))
      : [
          { key: 'fail', title: <span className="text-sm font-semibold text-critical">À regarder</span>, rows: rows.filter((row) => row.item.failStreak > 0 || row.item.review) },
          { key: 'ok', title: <span className="text-sm font-semibold text-ink">En bonne santé</span>, rows: rows.filter((row) => row.item.failStreak === 0 && !row.item.review && row.item.schedule?.enabled) },
          { key: 'pause', title: <span className="text-sm font-semibold text-ink-soft">En pause</span>, rows: rows.filter((row) => row.item.failStreak === 0 && !row.item.review && !row.item.schedule?.enabled) },
        ]

  return (
    <div className="flex flex-col gap-7 p-4 md:p-6">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
        <Figure label="Réussite sur 30 j" value={judged ? `${Math.round((ok / judged) * 100)} %` : '—'} />
        <Figure label="En échec" value={String(failing.length)} tone={failing.length ? 'critical' : undefined} />
        <Figure label="Coût sur 30 j" value={formatCost(cost)} />
        <Figure label="Prochain passage" value={next ? inShort(next) : '—'} />
      </div>
      {sections.map((section) =>
        section.rows.length === 0 ? null : (
          <section key={section.key} className="flex flex-col gap-1">
            <header className="flex items-center gap-2 pb-1">
              {section.title}
              <span className="text-xs tabular-nums text-ink-faint">{section.rows.length}</span>
            </header>
            <ul className="flex flex-col divide-y divide-line">
              {section.rows.map(({ item, health }) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(item)}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2.5 text-left transition-colors hover:bg-surface-high/40 md:grid-cols-[minmax(0,1.4fr)_11rem_5rem_5rem_auto]"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-center gap-2">
                        <WhatIcon item={item} />
                        <span className="truncate text-sm font-medium text-ink">{item.label}</span>
                      </span>
                      {item.failStreak > 0 || item.review ? (
                        <span className="truncate pl-[23px] text-xs text-ink-soft">
                          {item.review ? 'Script de vérification à relire : les passages sont écartés.' : `${item.failStreak} échec${item.failStreak > 1 ? 's' : ''} d'affilée — ${health.lastError ?? 'voir le dernier passage'}`}
                        </span>
                      ) : null}
                    </span>
                    <span className="hidden min-w-0 md:block"><ScopePip scope={item.scope} /></span>
                    <span className="hidden text-right text-xs tabular-nums text-ink-soft md:block">{health.rate === null ? '—' : `${Math.round(health.rate * 100)} %`}</span>
                    <span className="hidden text-right text-xs tabular-nums text-ink-faint md:block">{item.what === 'agent' ? formatCost(health.cost30) : '—'}</span>
                    <Pips runs={item.runs} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'critical' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className={cx('text-xl font-semibold tabular-nums', tone === 'critical' ? 'text-critical' : 'text-ink')}>{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ + Tâche */

function NewTaskMenu({ onPick }: { onPick: (kind: 'commande' | 'agent' | 'planifier') => void }) {
  const [open, setOpen] = useState(false)
  const pick = (kind: 'commande' | 'agent' | 'planifier') => { setOpen(false); onPick(kind) }
  const entry = 'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-high'
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Nouvelle tâche"
      side="bottom"
      align="end"
      className="w-72 p-1"
      trigger={<Button size="sm" icon={<Plus size={14} />}>Tâche <ChevronDown size={13} className="-mr-1" /></Button>}
    >
      <button type="button" className={entry} onClick={() => pick('agent')}>
        <Bot size={15} className="mt-0.5 shrink-0 text-ink-soft" />
        <span className="flex flex-col"><span className="text-sm text-ink">Tâche d'agent</span><span className="text-xs text-ink-faint">Un prompt confié à un CLI, à sa cadence.</span></span>
      </button>
      <button type="button" className={entry} onClick={() => pick('commande')}>
        <SquareTerminal size={15} className="mt-0.5 shrink-0 text-ink-soft" />
        <span className="flex flex-col"><span className="text-sm text-ink">Commande planifiée</span><span className="text-xs text-ink-faint">Un script qui se termine : sauvegarde, nettoyage.</span></span>
      </button>
      <div className="my-1 border-t border-line" />
      <button type="button" className={entry} onClick={() => pick('planifier')}>
        <AlarmClock size={15} className="mt-0.5 shrink-0 text-ink-soft" />
        <span className="flex flex-col"><span className="text-sm text-ink">Planifier une action existante…</span><span className="text-xs text-ink-faint">La choisir, puis lui donner une cadence.</span></span>
      </button>
    </Popover>
  )
}
