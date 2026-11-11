/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ArrowRight, ChartGantt, Compass, Filter, Flag, Pencil, Plus, Sparkles, X } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { Badge, Button, Popover, cx } from '@solera/ui'
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
import { formatDay, relativeDate } from '../../lib/dates'
import { AXIS_H, DemoNotice, FloatingTip, GanttAxis, GanttGrid, TodayLine, ZoomToggle, scaleOf, useAxisWidth, useScrollToNow, useZoom } from './gantt'
import {
  MATURITIES,
  MATURITY_LABEL,
  MATURITY_TONE,
  horizonOf,
  maturityTooltip,
  nextAction,
  type HorizonMilestone,
  type Maturity,
} from './maturity'
import { DAY, DEMO_CAP, awaitsMe, isOpen, liveSessions, useProtoData, useProtoHref, type ProtoData } from './model'
import { useMilestoneFlagsVersion } from './flags'
import { CardInfoButton } from './CardDrawer'
import { DemoControls } from './DemoControls'
import { addIdea } from './demo-store'
import { NewMilestoneDrawer } from './MilestoneComposer'
import { newMilestoneSessionPath } from './refineSession'
import { GanttClassic } from './TimelineVariants'

/** La colonne des noms ; plus étroite au téléphone, où 280 px ne laissaient que 76 px à l'axe. */
const LABEL_WIDE = 280
const LABEL_NARROW = 150
const ROW_H = 52

/**
 * L'**Horizon** : le cap du projet, puis ses jalons — le passé et le présent sur un axe
 * daté, le futur en vagues sans dates.
 *
 * Le futur n'a pas de dates parce qu'on n'en a pas : un jalon qui n'est pas découpé n'a
 * ni durée ni début. On le range donc par maturité et par ordre du board, sans inventer.
 */
const VIEW_KEYS = ['horizon', 'gantt'] as const

/** Les deux affichages des Jalons, derrière le sélecteur commun (variante `vues`). */
const MILESTONE_VIEWS: ViewOption<View>[] = [
  { key: 'horizon', label: 'Horizon', icon: <Compass size={14} /> },
  { key: 'gantt', label: 'Gantt', icon: <ChartGantt size={14} /> },
]

/**
 * `flux="v2"` (PROTOTYPE, variante `flux-v2`) : « + Jalon » ouvre un vrai champ d'écriture
 * (`NewMilestoneDrawer`), et les jalons mènent à leur page en `jalon-v3`.
 */
export function HorizonVariant({ mode, flux }: { mode?: 'vues'; flux?: 'v2' } = {}) {
  const { projectId } = useParams()
  const baseHref = useProtoHref()
  const navigate = useNavigate()
  const href = flux === 'v2' ? (path: string) => baseHref(path.replace('variant=jalon-v2', 'variant=jalon-v3')) : baseHref
  const [composing, setComposing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const data = useProtoData(projectId)
  const [zoom, setZoom] = useZoom('mois')
  const [created, setCreated] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [params, setParams] = useSearchParams()
  const [savedView, setSavedView] = useView<View>('jalons', projectId, VIEW_KEYS)
  const legacyView: View = params.get('vue') === 'gantt' ? 'gantt' : 'horizon'
  const view: View = mode === 'vues' ? savedView : legacyView
  const setView = (next: View) =>
    mode === 'vues'
      ? setSavedView(next)
      : setParams((current) => {
          if (next === 'gantt') current.set('vue', 'gantt')
          else current.delete('vue')
          return current
        })

  /* Variante `vues` : la barre sur une ligne (recherche, Filtrer ▾, Affichage ▾, + Jalon). */
  const [query, setQuery] = useState('')
  const [maturities, setMaturities] = useState<Maturity[]>([])
  const [lateOnly, setLateOnly] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [displayOpen, setDisplayOpen] = useState(false)

  const flags = useMilestoneFlagsVersion()
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `flags` relance le calcul quand un drapeau change
  const all = useMemo(() => horizonOf(data), [data, flags])
  if (data.isPending || !projectId) return null

  /* Variante `vues` : la barre sur une ligne, même motif que le Tableau. */
  const lateOf = (entry: HorizonMilestone) => entry.card.dueAt !== null && entry.card.dueAt < Date.now() && entry.maturity !== 'delivered'
  const keepEntry = (entry: HorizonMilestone) => {
    if (mode !== 'vues') return true
    const search = query.trim().toLocaleLowerCase().replace(/^#/, '')
    if (search && !`${entry.card.number} ${entry.card.title}`.toLocaleLowerCase().includes(search)) return false
    if (maturities.length > 0 && !maturities.includes(entry.maturity)) return false
    if (lateOnly && !lateOf(entry)) return false
    return true
  }
  const activeCount = maturities.length + Number(lateOnly)
  const currentView = MILESTONE_VIEWS.find((option) => option.key === view)!
  const toolbar =
    mode === 'vues' ? (
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder="Chercher un jalon" />}
        filter={
          <Popover
            open={filterOpen}
            onOpenChange={setFilterOpen}
            label="Filtrer"
            side="bottom"
            align="start"
            className="w-72"
            trigger={
              <button type="button" className={toolbarButtonClass(activeCount > 0)}>
                <Filter size={13} /> Filtrer
                {activeCount > 0 ? <span className="rounded bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink">{activeCount}</span> : null}
              </button>
            }
          >
            <div className="pb-2">
              <MenuHeading>Maturité</MenuHeading>
              {MATURITIES.map((maturity) => (
                <MenuCheck
                  key={maturity}
                  checked={maturities.includes(maturity)}
                  onChange={() => setMaturities((current) => (current.includes(maturity) ? current.filter((item) => item !== maturity) : [...current, maturity]))}
                  aside={all.filter((entry) => entry.maturity === maturity).length}
                >
                  {MATURITY_LABEL[maturity]}
                </MenuCheck>
              ))}
              <MenuHeading>Échéance</MenuHeading>
              <MenuCheck checked={lateOnly} onChange={setLateOnly}>En retard</MenuCheck>
              {activeCount > 0 ? (
                <div className="mt-2 border-t border-line px-3 pt-2">
                  <button type="button" onClick={() => { setMaturities([]); setLateOnly(false) }} className="text-xs text-ink-faint hover:text-ink">Effacer tous les filtres</button>
                </div>
              ) : null}
            </div>
          </Popover>
        }
        chips={[
          ...maturities.map((maturity) => (
            <FilterChip key={maturity} onClear={() => setMaturities((current) => current.filter((item) => item !== maturity))}>{MATURITY_LABEL[maturity]}</FilterChip>
          )),
          lateOnly ? <FilterChip key="late" onClear={() => setLateOnly(false)}>en retard</FilterChip> : null,
        ]}
        extra={
          <span className="hidden items-center gap-1.5 lg:flex">
            <DemoControls />
            <DemoToggle demo={data.demo} />
          </span>
        }
        display={
          <Popover
            open={displayOpen}
            onOpenChange={setDisplayOpen}
            label="Affichage"
            side="bottom"
            align="end"
            className="w-72"
            trigger={
              <button type="button" className={toolbarButtonClass(false)} title={`Affichage : ${currentView.label}`}>
                {currentView.icon} <span className="hidden sm:inline">Affichage</span>
              </button>
            }
          >
            <div className="pb-3">
              <ViewTiles options={MILESTONE_VIEWS} value={view} onChange={setView} />
              <MenuHeading>Échelle du temps</MenuHeading>
              <MenuSegment
                options={[{ key: 'semaine', label: 'Semaine' }, { key: 'mois', label: 'Mois' }]}
                value={zoom}
                onChange={setZoom}
              />
            </div>
          </Popover>
        }
        action={
          <Button
            size="sm"
            icon={<Plus size={15} />}
            onClick={() => {
              setView('horizon')
              if (flux === 'v2') setComposing(true)
              else setAdding(true)
            }}
          >
            Jalon
          </Button>
        }
      />
    ) : null

  if (mode === 'vues' && view === 'gantt') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {toolbar}
        <div className="min-h-0 flex-1">
          <GanttClassic bare zoom={zoom} keep={(id) => all.some((entry) => entry.card.id === id && keepEntry(entry))} />
        </div>
      </div>
    )
  }

  /* Le Gantt détaillé (décidé le 2026-11-10) : la même page, toutes les cartes sur l'axe. */
  if (view === 'gantt') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 md:px-6">
          <Compass size={16} className="text-ink-faint" />
          <h2 className="text-base font-semibold">Jalons</h2>
          <ViewToggle view={view} onChange={setView} />
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <DemoControls />
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <GanttClassic />
        </div>
      </div>
    )
  }

  // SIMULÉ : les jalons « créés » par le formulaire ne vivent que dans cet état local.
  const stubIdeas: HorizonMilestone[] = created.map((title, index) => ({
    card: { ...fakeCard(projectId, title), number: -(index + 1) },
    cards: [],
    done: 0,
    maturity: 'idea',
    questions: [],
    toClarify: [],
    notAccepted: [],
    cycle: [],
    startable: [],
    addedSinceLaunch: [],
    launchedAt: null,
    draft: null,
    run: null,
  }))
  const milestones = [...all, ...stubIdeas].filter(keepEntry)

  /* Sur l'axe : ce qui a un passé — lancé, livré, ou une carte déjà en mouvement. */
  const moving = (entry: HorizonMilestone) =>
    entry.maturity === 'launched' ||
    entry.maturity === 'delivered' ||
    entry.cards.some((card) => card.column === 'in_progress' || card.column === 'review')
  const dated = milestones
    .filter(moving)
    .sort((a, b) => (a.maturity === 'delivered' ? 1 : 0) - (b.maturity === 'delivered' ? 1 : 0) || a.card.createdAt - b.card.createdAt)
  const future = milestones.filter((entry) => !dated.includes(entry))
  const byBoard = (a: HorizonMilestone, b: HorizonMilestone) => a.card.position - b.card.position
  const next = future.filter((entry) => entry.maturity === 'ready' || entry.maturity === 'split').sort(byBoard)
  const later = future.filter((entry) => entry.maturity === 'refine' || entry.maturity === 'idea').sort(byBoard)

  const counts = new Map<Maturity, number>(MATURITIES.map((maturity) => [maturity, milestones.filter((entry) => entry.maturity === maturity).length]))

  return (
    <div className={mode === 'vues' ? 'flex h-full min-h-0 flex-col' : 'h-full overflow-y-auto'}>
      {toolbar}
      <div className={mode === 'vues' ? 'min-h-0 flex-1 overflow-y-auto' : undefined}>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {mode === 'vues' ? null : (
          <div className="flex items-center gap-2">
            <Compass size={16} className="text-ink-faint" />
            <h2 className="text-base font-semibold">Jalons</h2>
            <ViewToggle view={view} onChange={setView} />
            <span className="ml-auto flex flex-wrap items-center gap-2">
              <DemoControls />
              <DemoNotice demo={data.demo} />
              <DemoToggle demo={data.demo} />
              <Button size="sm" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Jalon</Button>
            </span>
          </div>
        )}

        <CapBlock key={String(data.demo)} projectId={projectId} demo={data.demo} />

        {notice ? (
          <p className="flex items-center gap-2 rounded-md bg-fuchsia-500/10 px-3 py-2 text-sm text-fuchsia-700 dark:text-fuchsia-300">
            <span className="min-w-0 flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs hover:underline">Fermer</button>
          </p>
        ) : null}
        {flux === 'v2' ? (
          <NewMilestoneDrawer
            open={composing}
            onClose={() => setComposing(false)}
            cards={data.cards}
            demo={data.demo}
            onSimulate={setNotice}
            onOpenSession={(prompt) => navigate(newMilestoneSessionPath(projectId ?? '', prompt))}
            onCreated={(number, intent, prompt) => {
              // Une idée notée reste ici, dans « Plus tard » ; un affinage part en session :
              // une conversation sur la carte du jalon, qui invoque `/affiner-un-jalon`.
              if (intent === 'note' || !prompt) {
                setNotice(`Idée notée : #${number}, dans « Plus tard ». Tu l'affineras quand tu voudras.`)
                return
              }
              navigate(href(`/p/${projectId}/c/new?${new URLSearchParams({ prompt, 'proto-carte': String(number) }).toString()}`))
            }}
          />
        ) : null}

        {adding ? (
          <NewMilestoneForm
            onCancel={() => setAdding(false)}
            onCreate={(title, refineNow) => {
              // En démo, le jalon entre vraiment dans le magasin : il suit tout le parcours.
              if (data.demo) addIdea(title, refineNow)
              else setCreated((current) => [...current, title])
              setAdding(false)
            }}
          />
        ) : null}

        {/* La chaîne de maturité, en une ligne : combien de jalons à chaque étape. */}
        <ol className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-6">
          {MATURITIES.map((maturity, index) => (
            <li key={maturity} className="flex flex-col gap-0.5 bg-canvas px-3 py-2">
              <span className="flex items-center gap-1.5 text-xs text-ink-faint">
                <span className="tabular-nums">{index + 1}</span>
                {MATURITY_LABEL[maturity]}
              </span>
              <span className={cx('text-lg font-semibold tabular-nums', counts.get(maturity) ? 'text-ink' : 'text-ink-faint/50')}>
                {counts.get(maturity)}
              </span>
            </li>
          ))}
        </ol>

        <Section title="Maintenant" hint="sur l'axe : création → échéance" right={mode === 'vues' ? undefined : <ZoomToggle zoom={zoom} onChange={setZoom} />}>
          {dated.length === 0 ? (
            <Quiet>Aucun jalon en mouvement. Lance celui qui est prêt.</Quiet>
          ) : (
            <DatedAxis projectId={projectId} entries={dated} zoom={zoom} data={data} href={href} />
          )}
        </Section>

        <Section title="Ensuite" hint="prêts ou découpés, dans l'ordre du tableau — sans dates inventées">
          {next.length === 0 ? <Quiet>Rien de découpé en attente.</Quiet> : <Wave projectId={projectId} entries={next} href={href} />}
        </Section>

        <Section title="Plus tard" hint="idées et jalons à affiner">
          {later.length === 0 ? <Quiet>Pas d'idée en réserve.</Quiet> : <Wave projectId={projectId} entries={later} href={href} />}
        </Section>
      </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ cap */

/** SIMULÉ : le cap vit dans le localStorage du navigateur, rien côté serveur. */
function CapBlock({ projectId, demo }: { projectId: string; demo: boolean }) {
  const key = `proto-cap-${projectId}`
  const [cap, setCap] = useState(() => (demo ? DEMO_CAP : (localStorage.getItem(key) ?? '')))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(cap)

  const save = () => {
    setCap(draft.trim())
    if (!demo) localStorage.setItem(key, draft.trim())
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
        <textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder="Où va ce projet, en une phrase ?"
          className="w-full resize-none bg-transparent text-base outline-none"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-fuchsia-600 dark:text-fuchsia-300">SIMULÉ · gardé dans ce navigateur seulement</span>
          <span className="ml-auto flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Annuler</Button>
            <Button size="sm" onClick={save}>Enregistrer</Button>
          </span>
        </div>
      </div>
    )
  }

  if (!cap) {
    return (
      <button
        type="button"
        onClick={() => { setDraft(''); setEditing(true) }}
        className="flex items-center gap-1.5 self-start rounded px-1 text-sm text-ink-faint hover:text-ink"
      >
        <Plus size={14} /> Ajouter un cap
      </button>
    )
  }

  return (
    <div className="group flex items-start gap-3">
      <span className="mt-1 h-10 w-0.5 shrink-0 rounded-full bg-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">Cap</p>
        <p className="text-lg leading-snug text-ink">{cap}</p>
      </div>
      <button
        type="button"
        aria-label="Modifier le cap"
        onClick={() => { setDraft(cap); setEditing(true) }}
        className="rounded p-1 text-ink-faint opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
      >
        <Pencil size={14} />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ axe daté */

function DatedAxis({
  projectId,
  entries,
  zoom,
  data,
  href,
}: {
  projectId: string
  entries: HorizonMilestone[]
  zoom: 'semaine' | 'mois'
  data: ProtoData
  href: (path: string) => string
}) {
  const now = Date.now()
  const plotted = entries.flatMap((entry) => [entry.card, ...entry.cards])
  const scroller = useRef<HTMLDivElement>(null)
  const LABEL_W = window.innerWidth < 640 ? LABEL_NARROW : LABEL_WIDE
  const axisWidth = useAxisWidth(scroller, LABEL_W)
  const scale = scaleOf(plotted, zoom, now, axisWidth)
  const height = entries.length * ROW_H
  const [hovered, setHovered] = useState<string | null>(null)
  useScrollToNow(scroller, scale, LABEL_W, now)

  return (
    <div ref={scroller} className="overflow-x-auto rounded-xl border border-line" onMouseLeave={() => setHovered(null)}>
      <div className="flex" style={{ width: LABEL_W + scale.width }}>
        <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-canvas" style={{ width: LABEL_W }}>
          <div className="flex items-end border-b border-line px-3 pb-1.5 text-xs font-medium text-ink-faint" style={{ height: AXIS_H }}>
            Jalon
          </div>
          {entries.map((entry) => (
            <Link
              key={entry.card.id}
              to={href(`/p/${projectId}/timeline/${entry.card.number}?variant=jalon-v2`)}
              onMouseEnter={() => setHovered(entry.card.id)}
              className={cx(
                'flex flex-col justify-center gap-1 border-b border-line/60 px-3 transition-colors',
                hovered === entry.card.id ? 'bg-surface-high' : 'bg-canvas',
              )}
              style={{ height: ROW_H }}
            >
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                <span className="text-xs text-ink-faint tabular-nums">#{entry.card.number}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{entry.card.title}</span>
                <CardInfoButton card={entry.card} />
              </span>
              <span className="flex items-center gap-1.5">
                <MaturityPill maturity={entry.maturity} entry={entry} />
                {entry.addedSinceLaunch.length ? (
                  <span className="text-xs text-caution" title={entry.addedSinceLaunch.map((card) => `#${card.number} ${card.title}`).join('\n')}>
                    +{entry.addedSinceLaunch.length} depuis le lancement
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
        <div className="relative">
          <GanttAxis scale={scale} zoom={zoom} now={now} />
          <div className="relative" style={{ height }}>
            <GanttGrid scale={scale} zoom={zoom} height={height} now={now} today={false} />
            {/* le fond des lignes : séparateurs et surlignage du survol, sur toute la largeur */}
            {entries.map((entry, index) => (
              <div
                key={entry.card.id}
                aria-hidden
                onMouseEnter={() => setHovered(entry.card.id)}
                className={cx('absolute right-0 left-0 border-b border-line/60 transition-colors', hovered === entry.card.id && 'bg-accent/[0.07]')}
                style={{ top: index * ROW_H, height: ROW_H }}
              />
            ))}
            {entries.map((entry, index) => (
              <MilestoneBar
                key={entry.card.id}
                entry={entry}
                scale={scale}
                top={index * ROW_H}
                now={now}
                data={data}
                hovered={hovered === entry.card.id}
                dimmed={hovered !== null && hovered !== entry.card.id}
                onHover={setHovered}
              />
            ))}
            <div className="pointer-events-none absolute inset-0 z-[4]">
              <TodayLine scale={scale} height={height} now={now} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const BAR_TOP = 15
const BAR_HEIGHT = 22

/**
 * La barre d'un jalon sur l'horizon : de sa première carte à son échéance, remplie de
 * ce qui est livré, avec le trait du lancement posé dessus — ce qui est ajouté ensuite
 * est à sa droite. Le retard se lit au losange rouge et au prolongement hachuré, pas
 * à une barre entièrement rouge.
 */
function MilestoneBar({
  entry,
  scale,
  top,
  now,
  data,
  hovered,
  dimmed,
  onHover,
}: {
  entry: HorizonMilestone
  scale: ReturnType<typeof scaleOf>
  top: number
  now: number
  data: ProtoData
  hovered: boolean
  dimmed: boolean
  onHover: (id: string | null) => void
}) {
  const start = Math.min(entry.card.createdAt, ...entry.cards.map((card) => card.createdAt))
  const due = entry.card.dueAt
  const end = due ?? Math.max(now, start + DAY)
  const left = scale.x(start)
  const width = Math.max(scale.x(end) - left, 8)
  const total = entry.cards.filter((card) => card.column !== 'abandoned').length || 1
  const share = entry.done / total
  const delivered = entry.maturity === 'delivered'
  const late = due !== null && due < now && !delivered
  const overdue = late ? Math.max(scale.x(now) - scale.x(due), 2) : 0
  const live = entry.cards.reduce((sum, card) => sum + liveSessions(card).length, 0)
  const asking = entry.cards.filter(awaitsMe).length
  const launched = data.launched.has(entry.card.id)
  const diamond = 12
  const anchor = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={anchor}
      className={cx('absolute transition-opacity duration-150', dimmed && 'opacity-40', hovered && 'z-30')}
      style={{ top: top + BAR_TOP, left, width, height: BAR_HEIGHT }}
      onMouseEnter={() => onHover(entry.card.id)}
    >
      {overdue > 0 ? (
        <span
          aria-hidden
          className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-r-full"
          style={{
            left: width,
            width: overdue,
            background:
              'repeating-linear-gradient(135deg, color-mix(in oklab, var(--color-critical) 55%, transparent) 0 3px, transparent 3px 6px)',
          }}
        />
      ) : null}
      <div
        className={cx(
          'relative h-full overflow-hidden rounded-[6px] border',
          delivered ? 'border-positive/50 bg-positive/15' : 'border-line-strong bg-surface-high',
          due === null && 'border-dashed',
          launched && !delivered && 'border-accent/70',
          hovered && 'shadow-[0_0_0_2px_var(--color-accent)]',
        )}
      >
        <div className={cx('h-full', delivered ? 'bg-positive/40' : 'bg-accent/35')} style={{ width: `${share * 100}%` }} />
        <span className="absolute inset-0 flex items-center gap-2 px-2 text-xs font-medium whitespace-nowrap text-ink">
          <span className="tabular-nums">{entry.done}/{total}</span>
          {width > 90 ? <span className="font-normal text-ink-soft tabular-nums">{Math.round(share * 100)} %</span> : null}
          {asking ? (
            <span className="flex items-center gap-1 text-caution" title="cartes dont une session t’attend">
              <span className="size-2 rounded-full bg-caution" />
              {asking} t’attend{asking > 1 ? 'ent' : ''}
            </span>
          ) : live ? (
            <span className="flex items-center gap-1 text-accent">
              <span className="size-1.5 animate-pulse rounded-full bg-accent" />
              {live}
            </span>
          ) : null}
        </span>
      </div>
      {/* Le lancement, posé sur la barre : ce qui a été ajouté ensuite est à sa droite. */}
      {entry.launchedAt !== null ? (
        <span
          aria-hidden
          className="absolute -top-1 -bottom-1 w-0.5 rounded bg-accent"
          style={{ left: scale.x(entry.launchedAt) - left }}
        />
      ) : null}
      {due !== null ? (
        <span
          aria-hidden
          className={cx('absolute rotate-45 rounded-[2px] border-2 bg-canvas', late ? 'border-critical' : delivered ? 'border-positive' : 'border-ink-soft')}
          style={{ left: width - diamond / 2, top: BAR_HEIGHT / 2 - diamond / 2, width: diamond, height: diamond }}
        />
      ) : null}
      {hovered ? (
        <FloatingTip anchor={anchor}>
          <MilestoneTooltip entry={entry} total={total} live={live} late={late} now={now} />
        </FloatingTip>
      ) : null}
    </div>
  )
}

function MilestoneTooltip({ entry, total, live, late, now }: { entry: HorizonMilestone; total: number; live: number; late: boolean; now: number }) {
  const due = entry.card.dueAt
  return (
    <div className="w-64 rounded-lg border border-line bg-surface p-2.5 text-xs shadow-lg">
      <p className="flex items-start gap-1.5 text-sm leading-snug font-medium text-ink">
        <span className="shrink-0 font-normal text-ink-faint tabular-nums">#{entry.card.number}</span>
        <span className="min-w-0">{entry.card.title}</span>
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-soft">
        <dt className="text-ink-faint">Maturité</dt>
        <dd>{MATURITY_LABEL[entry.maturity]}</dd>
        <dt className="text-ink-faint">Cartes</dt>
        <dd className="tabular-nums">
          {entry.done}/{total} faites{entry.addedSinceLaunch.length ? ` · +${entry.addedSinceLaunch.length} depuis le lancement` : ''}
        </dd>
        <dt className="text-ink-faint">Créé</dt>
        <dd className="tabular-nums">{formatDay(entry.card.createdAt)}</dd>
        {entry.launchedAt !== null ? (
          <>
            <dt className="text-ink-faint">Lancé</dt>
            <dd className="tabular-nums">{formatDay(entry.launchedAt)}</dd>
          </>
        ) : null}
        <dt className="text-ink-faint">Échéance</dt>
        <dd className={cx('tabular-nums', late && 'font-medium text-critical')}>
          {due === null ? 'aucune' : formatDay(due)}
          {late && due !== null ? ` · ${Math.ceil((now - due) / DAY)} j de retard` : ''}
        </dd>
        {live ? (
          <>
            <dt className="text-ink-faint">Sessions</dt>
            <dd className="text-accent">{live} vivante{live > 1 ? 's' : ''}</dd>
          </>
        ) : null}
      </dl>
    </div>
  )
}

/* ------------------------------------------------------------------ vagues sans dates */

function Wave({ projectId, entries, href }: { projectId: string; entries: HorizonMilestone[]; href: (path: string) => string }) {
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {entries.map((entry, index) => {
        const action = nextAction(entry)
        // Une idée a aussi sa page : c'est de là qu'on lance son affinage.
        const to = entry.card.number < 0 ? null : href(`/p/${projectId}/timeline/${entry.card.number}?variant=jalon-v2`)
        const body = (
          <>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-faint tabular-nums">{index + 1}.</span>
              <MaturityPill maturity={entry.maturity} entry={entry} />
              {entry.cards.some(awaitsMe) ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-caution">
                  <span className="size-2 rounded-full bg-caution" />
                  t’attend
                </span>
              ) : null}
              {entry.card.number < 0 ? <span className="text-xs text-fuchsia-600 dark:text-fuchsia-300">SIMULÉ</span> : null}
              {entry.card.dueAt !== null ? (
                <span className="ml-auto text-xs text-ink-faint">échéance {relativeDate(entry.card.dueAt)}</span>
              ) : null}
            </div>
            <p className="flex min-w-0 items-start gap-1 font-medium">
              <span className="min-w-0 flex-1">
                {entry.card.number > 0 ? <span className="mr-1 text-ink-faint tabular-nums">#{entry.card.number}</span> : null}
                {entry.card.title}
              </span>
              {entry.card.number > 0 ? <CardInfoButton card={entry.card} /> : null}
            </p>
            <MaturitySteps maturity={entry.maturity} />
            <p className="text-xs text-ink-faint">
              {entry.cards.length ? `${entry.cards.filter(isOpen).length} cartes ouvertes` : 'Pas encore découpé'}
            </p>
            <p className="mt-auto flex items-center gap-1.5 border-t border-line pt-2 text-xs">
              <span className="font-medium text-accent">{action.label}</span>
              <span className="min-w-0 truncate text-ink-faint">{action.detail}</span>
              <ArrowRight size={12} className="ml-auto shrink-0 text-ink-faint" />
            </p>
          </>
        )
        const shape = 'flex h-full flex-col gap-2 rounded-xl border border-line p-3'
        return (
          <li key={entry.card.id} className="min-w-0">
            {to ? (
              <Link to={to} className={cx(shape, 'transition-colors hover:border-line-strong')}>{body}</Link>
            ) : (
              <div className={cx(shape, 'border-dashed')}>{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/* ------------------------------------------------------------------ petites pièces */

export function MaturityPill({ maturity, entry }: { maturity: Maturity; entry?: HorizonMilestone }) {
  // PROTOTYPE : avec son jalon, la pastille dit pourquoi il est à cette étape.
  return <span title={entry ? maturityTooltip(entry) : undefined} className={cx('rounded-full px-2 py-0.5 text-meta font-medium', MATURITY_TONE[maturity])}>{MATURITY_LABEL[maturity]}</span>
}

/** Les six étapes en pointillés : faites, courante, à venir. */
export function MaturitySteps({ maturity }: { maturity: Maturity }) {
  const at = MATURITIES.indexOf(maturity)
  return (
    <div className="flex items-center gap-1" aria-label={`Maturité : ${MATURITY_LABEL[maturity]}`}>
      {MATURITIES.map((step, index) => (
        <span
          key={step}
          title={MATURITY_LABEL[step]}
          className={cx('h-1 flex-1 rounded-full', index < at ? 'bg-accent/50' : index === at ? 'bg-accent' : 'bg-surface-high')}
        />
      ))}
    </div>
  )
}

function Section({ title, hint, right, children }: { title: string; hint?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
        {hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
        {right ? <span className="ml-auto">{right}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Quiet({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-sm text-ink-faint">{children}</p>
}

type View = 'horizon' | 'gantt'

/** La bascule de l'onglet : l'horizon à l'arrivée, le Gantt détaillé en zoom. */
function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <span role="radiogroup" aria-label="Vue" className="inline-flex rounded-lg border border-line p-0.5 text-xs">
      {(['horizon', 'gantt'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={view === value}
          onClick={() => onChange(value)}
          className={cx('rounded-md px-2.5 py-1', view === value ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint hover:text-ink')}
        >
          {value === 'horizon' ? 'Horizon' : 'Gantt détaillé'}
        </button>
      ))}
    </span>
  )
}

export function DemoToggle({ demo }: { demo: boolean }) {
  const [, setParams] = useSearchParams()
  return (
    <button
      type="button"
      onClick={() => setParams((current) => {
        if (demo) current.delete('demo')
        else current.set('demo', '1')
        return current
      })}
      className="rounded-lg border border-dashed border-fuchsia-500/60 px-2 py-1 text-xs text-fuchsia-600 hover:bg-fuchsia-500/10 dark:text-fuchsia-300"
    >
      {demo ? 'Vraies cartes' : 'Données de démo'}
    </button>
  )
}

/** SIMULÉ : le formulaire ne crée rien côté serveur. */
function NewMilestoneForm({ onCancel, onCreate }: { onCancel: () => void; onCreate: (title: string, refineNow: boolean) => void }) {
  const [title, setTitle] = useState('')
  const [refine, setRefine] = useState(true)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (title.trim()) onCreate(title.trim(), refine)
      }}
      className="flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent-wash/30 p-3"
    >
      <div className="flex items-center gap-2">
        <Flag size={14} className="text-accent" />
        <span className="text-sm font-medium">Nouveau jalon</span>
        <Badge>stub</Badge>
        <button type="button" aria-label="Fermer" onClick={onCancel} className="ml-auto rounded p-1 text-ink-faint hover:text-ink"><X size={14} /></button>
      </div>
      <input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Ce que le jalon doit livrer, en quelques mots"
        className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-accent"
      />
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={refine} onChange={(event) => setRefine(event.target.checked)} />
        <Sparkles size={13} className="text-accent" />
        L'affiner tout de suite avec un agent (questions, puis découpage proposé)
      </label>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Annuler</Button>
        <Button size="sm" type="submit" disabled={!title.trim()}>Créer comme idée</Button>
      </div>
    </form>
  )
}

function fakeCard(projectId: string, title: string): CardDto {
  const now = Date.now()
  return {
    id: `stub-${title}`,
    projectId,
    number: 0,
    title,
    description: '',
    column: 'todo',
    position: 1_000_000,
    dueAt: null,
    parent: null,
    children: [],
    acceptedAt: now,
    toClarifySince: null,
    createdBy: 'tim',
    createdByName: 'Tim',
    createdAt: now,
    updatedAt: now,
    columnSince: now,
    conversations: [],
    attachmentCount: 0,
    noteCount: 0,
    references: [],
    referencedBy: [],
    blocks: [],
    blockedBy: [],
    related: [],
    duplicateOf: null,
    duplicates: [],
    issue: null,
  }
}
