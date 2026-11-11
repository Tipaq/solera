/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'onglet **Actions** : les actions et les tâches planifiées du projet, fondues en un
 * seul objet (Quoi × Quand, voir `model.ts`). Une liste en quatre sections — En cours,
 * À relire, Planifiées, À la demande — ou l'agenda des passages. Une ligne s'ouvre dans
 * le tiroir commun ; « + Action » et « Planifier » ouvrent l'éditeur unifié.
 * Aucune écriture : chaque geste dit « Simulé ».
 */
import {
  AlarmClock,
  ArrowUpRight,
  Bot,
  CalendarDays,
  ChevronDown,
  LayoutGrid,
  List,
  Plus,
  Filter,
  Server,
  ShieldQuestion,
  Square,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ActionsStatusMeta, useActionsCount } from '../../components/prototype/actionsCount'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { ScheduleCadence } from '@solera/protocol'
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
import { cronToHuman } from '../../lib/cron'
import { locale } from '../../lib/i18n'
import { describeCadence, formatDateTime } from '../../lib/schedules'
import { DemoToggle } from '../prototype-milestones/HorizonVariant'
import { ActionsAgenda, type ActionsAgendaMode as AgendaMode } from './ActionsAgenda'
import { inShort } from '../prototype-schedules/data'
import { RUN_FILL, RUN_WORD } from '../prototype-schedules/shared'
import type { EditorSeed } from './Editor'
import { LaunchButton } from './LaunchButton'
import { SessionWorksSection, useSessionWorks } from './SessionWorks'
import { LauncherView } from './Launcher'
import { ActionDrawer, actionPanelOf, type ActionPanel } from './ActionDrawer'
import { useAutomations, type Automation, type UnifiedRun, type What } from './model'
import { ServedLine, ServedProvider, useServedOf } from './served'

type View = 'lanceur' | 'liste' | 'agenda'
const VIEWS: ViewOption<View>[] = [
  { key: 'lanceur', label: 'Lanceur', icon: <LayoutGrid size={14} /> },
  { key: 'liste', label: 'Liste', icon: <List size={14} /> },
  { key: 'agenda', label: 'Agenda', icon: <CalendarDays size={14} /> },
]

/** Les filtres de « Filtrer ▾ » : chaque groupe vide veut dire « tout ». */
interface Filters {
  what: What[]
  when: ('demand' | 'scheduled')[]
  state: ('live' | 'review' | 'failing')[]
}
const NO_FILTERS: Filters = { what: [], when: [], state: [] }
const WHAT_WORD: Record<What, string> = { command: 'Commandes', agent: 'Agents' }
const WHEN_WORD = { demand: 'À la demande', scheduled: 'Planifiées' } as const
const STATE_WORD = { live: 'En cours', review: 'À relire', failing: 'En échec' } as const

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
}

const cadenceText = (cadence: ScheduleCadence) => describeCadence(cadence, (expression) => cronToHuman(expression, locale()))

export function ActionsPage() {
  const { projectId } = useParams()
  const data = useAutomations(projectId)
  const sessionWorks = useSessionWorks(projectId)
  // PROTOTYPE : ce que disait le ⚡ retiré, repris dans la ligne d'outils (mêmes mots et
  // mêmes couleurs que le compte de l'onglet) ; un clic filtre sur le groupe concerné.
  const statusCount = useActionsCount(projectId)
  const [view, setView] = useView('actions', projectId, ['lanceur', 'liste', 'agenda'] as const)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const [displayOpen, setDisplayOpen] = useState(false)
  const [agendaMode, setAgendaMode] = useState<AgendaMode>('semaine')
  const [params, setParams] = useSearchParams()
  /*
    **Un seul tiroir** pour une action, en trois modes : le détail, l'édition (nouvelle
    action, ou « Modifier » depuis le détail, qui y revient à l'annulation), et « Planifier
    une action existante… ». `?nouvelle=` (le ⚡) l'ouvre en édition ; le fermer retire le
    paramètre.
  */
  const [panel, setPanel] = useState<Panel | null>(() => {
    const action = params.get('action')
    return action ? { mode: 'detail', id: action } : panelOf(params.get('nouvelle'))
  })
  useEffect(() => {
    const wanted = panelOf(params.get('nouvelle'))
    if (wanted) setPanel((current) => current ?? wanted)
  }, [params])
  const setOpenId = (id: string | null) => setPanel(id ? { mode: 'detail', id } : null)
  const setEditor = (seed: EditorSeed) => setPanel({ mode: 'edit', seed, back: null })
  const setPicking = (on: boolean) => setPanel(on ? { mode: 'pick' } : null)
  const closeEditor = () => {
    setPanel(null)
    if (params.has('nouvelle')) {
      setParams((current) => {
        current.delete('nouvelle')
        return current
      }, { replace: true })
    }
  }
  const [notice, setNotice] = useState<string | null>(null)
  const simulate = (text: string) => {
    setNotice(`Simulé : ${text}`)
    window.setTimeout(() => setNotice(null), 3200)
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return data.items.filter((item) => {
      if (filters.what.length && !filters.what.includes(item.what)) return false
      if (filters.when.length && !filters.when.some((entry) => (entry === 'scheduled' ? item.schedule : item.onDemand))) return false
      if (
        filters.state.length &&
        !filters.state.some((entry) => (entry === 'live' ? item.live : entry === 'review' ? item.review : item.failStreak > 0))
      ) return false
      if (!needle) return true
      return [item.label, item.description, item.command, item.prompt].some((text) => text?.toLocaleLowerCase().includes(needle))
    })
  }, [data.items, query, filters])

  /* Chaque action dans une seule section : ce qui tourne d'abord, puis ce qui attend Tim. */
  const live = shown.filter((item) => item.live)
  /* Ce que les sessions ont laissé tourner : montré tant que les filtres ne l'excluent pas
     (« Agents », « Planifiées », « À relire » ou « En échec » seuls l'excluent). */
  const sessionWorksShown = (() => {
    if (filters.what.length && !filters.what.includes('command')) return []
    if (filters.when.length && !filters.when.includes('demand')) return []
    if (filters.state.length && !filters.state.includes('live')) return []
    const needle = query.trim().toLocaleLowerCase()
    return sessionWorks.works.filter((work) => !needle || `${work.label} ${work.command ?? ''} ${work.conversationTitle}`.toLocaleLowerCase().includes(needle))
  })()
  const worksSection = (
    <SessionWorksSection projectId={projectId ?? ''} works={sessionWorksShown} onMakeAction={setEditor} simulate={simulate} />
  )
  const review = shown.filter((item) => !item.live && item.review)
  const scheduled = shown.filter((item) => !item.live && !item.review && item.schedule)
  const demand = shown.filter((item) => !item.live && !item.review && !item.schedule)

  if (!projectId) return null

  const set = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }))
  const count = (test: (item: Automation) => boolean) => data.items.filter(test).length
  const chips = [
    ...filters.what.map((entry) => <FilterChip key={`w-${entry}`} onClear={() => set({ what: toggleIn(filters.what, entry) })}>{WHAT_WORD[entry]}</FilterChip>),
    ...filters.when.map((entry) => <FilterChip key={`q-${entry}`} onClear={() => set({ when: toggleIn(filters.when, entry) })}>{WHEN_WORD[entry]}</FilterChip>),
    ...filters.state.map((entry) => <FilterChip key={`s-${entry}`} onClear={() => set({ state: toggleIn(filters.state, entry) })}>{STATE_WORD[entry]}</FilterChip>),
  ]

  const filterMenu = (
    <Popover
      open={filterOpen}
      onOpenChange={setFilterOpen}
      label="Filtrer"
      side="bottom"
      align="start"
      className="w-72"
      trigger={
        <button type="button" className={toolbarButtonClass(chips.length > 0)}>
          <Filter size={13} /> Filtrer
          {chips.length > 0 ? <span className="rounded bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink">{chips.length}</span> : null}
        </button>
      }
    >
      <div className="pb-2">
        <MenuHeading>Quoi</MenuHeading>
        <MenuCheck checked={filters.what.includes('command')} onChange={() => set({ what: toggleIn(filters.what, 'command') })} aside={count((item) => item.what === 'command')}>Commandes</MenuCheck>
        <MenuCheck checked={filters.what.includes('agent')} onChange={() => set({ what: toggleIn(filters.what, 'agent') })} aside={count((item) => item.what === 'agent')}>Agents</MenuCheck>
        <MenuHeading>Quand</MenuHeading>
        <MenuCheck checked={filters.when.includes('demand')} onChange={() => set({ when: toggleIn(filters.when, 'demand') })} aside={count((item) => item.onDemand)}>À la demande</MenuCheck>
        <MenuCheck checked={filters.when.includes('scheduled')} onChange={() => set({ when: toggleIn(filters.when, 'scheduled') })} aside={count((item) => Boolean(item.schedule))}>Planifiées</MenuCheck>
        <MenuHeading>État</MenuHeading>
        <MenuCheck checked={filters.state.includes('live')} onChange={() => set({ state: toggleIn(filters.state, 'live') })} aside={count((item) => Boolean(item.live))}>En cours</MenuCheck>
        <MenuCheck checked={filters.state.includes('review')} onChange={() => set({ state: toggleIn(filters.state, 'review') })} aside={count((item) => Boolean(item.review))}>À relire</MenuCheck>
        <MenuCheck checked={filters.state.includes('failing')} onChange={() => set({ state: toggleIn(filters.state, 'failing') })} aside={count((item) => item.failStreak > 0)}>En échec</MenuCheck>
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
            <MenuSegment<AgendaMode> options={[{ key: 'semaine', label: 'Semaine' }, { key: 'jour', label: 'Jour' }]} value={agendaMode} onChange={setAgendaMode} />
          </>
        ) : (
          <p className="px-3 pt-1 text-xs text-ink-faint">{view === 'lanceur' ? 'Des boutons, rangés par nature : services, commandes, agents.' : 'Par état : En cours, À relire, Planifiées, puis À la demande.'}</p>
        )}
      </div>
    </Popover>
  )

  return (
    <ServedProvider projectId={projectId}>
    <div className="flex h-full min-h-0 flex-col">
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder="Chercher une action" />}
        filter={filterMenu}
        chips={chips}
        extra={
          <>
            <span className="hidden sm:flex">
              <ActionsStatusMeta
                count={statusCount}
                onRunning={() => setFilters({ ...NO_FILTERS, state: ['live'] })}
                onReview={() => setFilters({ ...NO_FILTERS, state: ['review'] })}
              />
            </span>
            <span className="hidden xl:inline-flex"><DemoToggle demo={data.demo} /></span>
          </>
        }
        display={displayMenu}
        action={<NewActionMenu onPick={(seed) => setEditor(seed)} onPlan={() => setPicking(true)} />}
      />

      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {view === 'lanceur' ? (
          <LauncherView projectId={projectId} items={shown} onOpen={(item) => setOpenId(item.id)} onEdit={setEditor} simulate={simulate} before={worksSection} />
        ) : view === 'agenda' ? (
          <div className="flex flex-col gap-3 p-4 md:p-6">
            <ActionsAgenda items={shown} mode={agendaMode} onMode={setAgendaMode} onOpen={(item) => setOpenId(item.id)} />
          </div>
        ) : (
          <div className="flex flex-col gap-7 p-4 md:p-6">
            {data.items.length === 0 && !data.isPending ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
                Aucune action ni tâche planifiée. « + Action » pour en créer une, ou « Données de démo » pour juger la vue.
              </p>
            ) : null}
            <Section title="En cours" hint="Ce qui tourne maintenant : services, commandes dans un terminal, passages d'agent." items={live}>
              {(item) => <Row key={item.id} item={item} onOpen={() => setOpenId(item.id)} right={<LiveGestures item={item} simulate={simulate} />} />}
            </Section>
            {worksSection}
            <Section title="À relire" hint="Écrites ou modifiées par un agent : elles ne partent pas d'un clic avant ta relecture." items={review} tone="caution">
              {(item) => (
                <Row key={item.id} item={item} onOpen={() => setOpenId(item.id)} right={
                  <Button size="sm" variant="secondary" icon={<ShieldQuestion size={13} />} onClick={() => setOpenId(item.id)}>Relire</Button>
                } />
              )}
            </Section>
            <Section title="Planifiées" hint="Elles partent seules, à leur cadence." items={scheduled}>
              {(item) => <Row key={item.id} item={item} onOpen={() => setOpenId(item.id)} right={<ScheduleFacts item={item} />} />}
            </Section>
            <Section title="À la demande" hint="Un clic, ou un agent par run_action. « Planifier » leur donne une cadence." items={demand}>
              {(item) => (
                <Row key={item.id} item={item} onOpen={() => setOpenId(item.id)} right={
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" icon={<AlarmClock size={13} />} onClick={() => setEditor({ from: item, schedule: true })}>Planifier</Button>
                    <LaunchButton projectId={projectId} item={item} simulate={simulate} />
                  </span>
                } />
              )}
            </Section>
          </div>
        )}
        {notice ? (
          <p role="status" className="pointer-events-none fixed bottom-28 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink px-3 py-2 text-xs text-canvas shadow-lg">{notice}</p>
        ) : null}
      </div>

      <ActionDrawer
        projectId={projectId ?? ''}
        items={data.items}
        panel={panel}
        onPanel={setPanel}
        onClose={closeEditor}
        simulate={simulate}
      />
    </div>
    </ServedProvider>
  )
}

/* ------------------------------------------------------------------ liste */

function Section({ title, hint, items, tone, children }: { title: string; hint: string; items: Automation[]; tone?: 'caution'; children: (item: Automation) => ReactNode }) {
  if (items.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-baseline gap-2">
        <h2 className={cx('text-sm font-semibold', tone === 'caution' ? 'text-caution' : 'text-ink')}>{title}</h2>
        <span className="text-xs tabular-nums text-ink-faint">{items.length}</span>
        <span className="hidden min-w-0 truncate text-xs text-ink-faint md:inline">— {hint}</span>
      </header>
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">{items.map(children)}</ul>
    </section>
  )
}

function WhatIcon({ item }: { item: Automation }) {
  if (item.what === 'agent') return <AgentIcon agent={item.agent ?? 'claude'} size={15} />
  return item.commandKind === 'service' ? <Server size={15} className="text-ink-soft" /> : <SquareTerminal size={15} className="text-ink-soft" />
}

function KindChip({ item }: { item: Automation }) {
  const nature = item.what === 'agent' ? 'Agent' : item.commandKind === 'service' ? 'Commande · service' : 'Commande · tâche'
  const when = [item.onDemand ? 'à la demande' : null, item.schedule ? 'planifiée' : null].filter(Boolean).join(' + ')
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded border border-line px-1.5 py-px text-meta text-ink-soft">{nature}</span>
      <span className="text-meta text-ink-faint">{when}</span>
      {item.simulated ? <span className="rounded bg-fuchsia-500/15 px-1 text-meta text-fuchsia-700 dark:text-fuchsia-300">simulé</span> : null}
    </span>
  )
}

function Row({ item, onOpen, right }: { item: Automation; onOpen: () => void; right: ReactNode }) {
  const detail = item.live?.text ?? item.review ?? (item.what === 'agent' ? item.prompt : item.command)
  const served = useServedOf(item)
  return (
    <li className="flex min-h-14 items-center gap-3 px-3.5 py-2.5 hover:bg-surface-high/40">
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-high/70"><WhatIcon item={item} /></span>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left">
        <span className="flex min-w-0 max-w-full items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{item.label}</span>
          <span className="hidden sm:inline"><KindChip item={item} /></span>
        </span>
        <span className={cx('max-w-full truncate text-xs', item.what === 'command' && !item.live && !item.review ? 'font-mono text-ink-faint' : 'text-ink-faint')}>{detail}</span>
        {served ? <ServedLine served={served} className="max-w-full" /> : null}
      </button>
      <span className="flex shrink-0 items-center gap-2">{right}</span>
    </li>
  )
}

function Pips({ runs }: { runs: UnifiedRun[] }) {
  const shown = runs.slice(0, 10).reverse()
  return (
    <span className="hidden items-center gap-0.5 md:flex" aria-label={`${shown.length} derniers passages`}>
      {Array.from({ length: 10 - shown.length }, (_, index) => <span key={`e${index}`} className="h-3 w-1.5 rounded-sm bg-surface-high" />)}
      {shown.map((run) => (
        <span key={run.id} title={`${formatDateTime(run.startedAt)} · ${RUN_WORD[run.status]}${run.exitCode != null ? ` · code ${run.exitCode}` : ''}`} className={cx('h-3 w-1.5 rounded-sm', RUN_FILL[run.status])} />
      ))}
    </span>
  )
}

function ScheduleFacts({ item }: { item: Automation }) {
  const schedule = item.schedule!
  return (
    <>
      {item.failStreak >= 2 ? (
        <span className="hidden items-center gap-1 text-xs text-critical lg:inline-flex"><TriangleAlert size={12} /> {item.failStreak} échecs d'affilée</span>
      ) : null}
      <span className="hidden w-40 truncate text-right text-xs text-ink-soft lg:block">{cadenceText(schedule.cadence)}</span>
      <span className="w-20 text-right text-xs tabular-nums text-ink-faint">{schedule.enabled ? (schedule.nextRunAt ? inShort(schedule.nextRunAt) : '—') : 'en pause'}</span>
      <Pips runs={item.runs} />
    </>
  )
}

function LiveGestures({ item, simulate }: { item: Automation; simulate: (text: string) => void }) {
  const live = item.live!
  if (live.kind === 'service') {
    return (
      <span className="flex items-center gap-1">
        {live.href ? (
          <a href={live.href} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-accent hover:bg-surface-high">Ouvrir <ArrowUpRight size={12} /></a>
        ) : null}
        <Button size="sm" variant="ghost" icon={<Square size={12} />} onClick={() => simulate(`arrêter « ${item.label} »`)}>Arrêter</Button>
      </span>
    )
  }
  if (live.kind === 'session' && live.href) {
    return <Link to={live.href} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-accent hover:bg-surface-high">Session <ArrowUpRight size={12} /></Link>
  }
  return <Button size="sm" variant="ghost" icon={<SquareTerminal size={13} />} onClick={() => simulate('ouvrir le terminal de la tâche dans le panneau')}>Terminal</Button>
}

/* L'éditeur unifié vit dans `Editor.tsx`. */

type Panel = ActionPanel
const panelOf = actionPanelOf

/** « + Action » : la nature d'abord, ou planifier une action qui existe déjà. */
function NewActionMenu({ onPick, onPlan }: { onPick: (seed: EditorSeed) => void; onPlan: () => void }) {
  const [open, setOpen] = useState(false)
  const pick = (run: () => void) => { setOpen(false); run() }
  const entry = 'flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-high'
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Nouvelle action"
      side="bottom"
      align="end"
      className="w-72 p-1"
      trigger={<Button size="sm" icon={<Plus size={14} />}>Action <ChevronDown size={13} className="-mr-1" /></Button>}
    >
      <button type="button" className={entry} onClick={() => pick(() => onPick({ preset: { what: 'command', kind: 'task' } }))}>
        <SquareTerminal size={15} className="mt-0.5 shrink-0 text-ink-soft" />
        <span className="flex flex-col"><span className="text-sm text-ink">Nouvelle commande</span><span className="text-xs text-ink-faint">Un script qui se termine : tests, sauvegarde.</span></span>
      </button>
      <button type="button" className={entry} onClick={() => pick(() => onPick({ preset: { what: 'command', kind: 'service' } }))}>
        <Server size={15} className="mt-0.5 shrink-0 text-ink-soft" />
        <span className="flex flex-col"><span className="text-sm text-ink">Nouveau service</span><span className="text-xs text-ink-faint">Ce qui tourne en continu : serveur de dev.</span></span>
      </button>
      <button type="button" className={entry} onClick={() => pick(() => onPick({ preset: { what: 'agent' } }))}>
        <Bot size={15} className="mt-0.5 shrink-0 text-ink-soft" />
        <span className="flex flex-col"><span className="text-sm text-ink">Nouvelle tâche d’agent</span><span className="text-xs text-ink-faint">Un prompt confié à un CLI.</span></span>
      </button>
      <div className="my-1 border-t border-line" />
      <button type="button" className={entry} onClick={() => pick(onPlan)}>
        <AlarmClock size={15} className="mt-0.5 shrink-0 text-ink-soft" />
        <span className="flex flex-col"><span className="text-sm text-ink">Planifier une action existante…</span><span className="text-xs text-ink-faint">La choisir, puis lui donner une cadence.</span></span>
      </button>
    </Popover>
  )
}
