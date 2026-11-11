/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ArrowUpRight, ChevronDown, ChevronRight, Flag, Rocket } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { Badge, EmptyState, cx } from '@solera/ui'
import { formatDay, relativeDate } from '../../lib/dates'
import type { Milestone } from '../../lib/timeline'
import {
  AXIS_H,
  BAR_H,
  CardBar,
  DemoNotice,
  GanttArrows,
  GanttAxis,
  GanttGrid,
  Legend,
  TodayLine,
  ZoomToggle,
  anchorsOf,
  barOf,
  chainOf,
  scaleOf,
  useAxisWidth,
  useScrollToNow,
  useZoom,
  type Scale,
  type Zoom,
} from './gantt'
import { DependencyGraph, type GraphLayout } from './graph'
import { DAY, STATE_DOT, awaitsMe, isLate, liveSessions, stateOf, useProtoData, useProtoHref, type CardState, type ProtoData } from './model'
import { cardDestination } from './destination'
import { CardInfoButton } from './CardDrawer'

/* ------------------------------------------------------------------ commun */

function DemoToggle({ demo }: { demo: boolean }) {
  const [, setParams] = useSearchParams()
  return (
    <button
      type="button"
      onClick={() =>
        setParams((current) => {
          if (demo) current.delete('demo')
          else current.set('demo', '1')
          return current
        })
      }
      className="rounded-lg border border-dashed border-fuchsia-500/60 px-2 py-1 text-xs text-fuchsia-600 hover:bg-fuchsia-500/10 dark:text-fuchsia-300"
    >
      {demo ? 'Revenir aux vraies cartes' : 'Données de démo'}
    </button>
  )
}

function Toolbar({ data, zoom, setZoom, children }: { data: ProtoData; zoom: Zoom; setZoom: (zoom: Zoom) => void; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-2.5">
      <ZoomToggle zoom={zoom} onChange={setZoom} />
      {children}
      <span className="ml-auto flex items-center gap-2">
        <DemoNotice demo={data.demo} />
        <DemoToggle demo={data.demo} />
      </span>
    </div>
  )
}

function progressOf(milestone: Milestone) {
  const total = milestone.cards.filter((card) => card.column !== 'abandoned').length
  return { done: milestone.done, total, share: total === 0 ? 0 : milestone.done / total }
}

function delivered(milestone: Milestone) {
  const { done, total } = progressOf(milestone)
  return total > 0 && done === total
}

function Empty({ data }: { data: ProtoData }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex justify-end px-4 py-2.5"><DemoToggle demo={data.demo} /></div>
      <EmptyState icon={<Flag size={22} />} title="Aucun jalon ni carte datée" description="Essaie les données de démo pour voir le Gantt." />
    </div>
  )
}

/** Toutes les cartes que le Gantt dessine : jalons, leurs enfants, les isolées datées. */
function plottedCards(data: ProtoData): CardDto[] {
  return [...data.milestones.flatMap((milestone) => [milestone.card, ...milestone.cards]), ...data.loose]
}

/** Répartition des enfants par état, pour les barres composées. */
function stateMix(cards: CardDto[]): { state: CardState; count: number }[] {
  const order: CardState[] = ['done', 'review', 'running', 'blocked', 'todo']
  return order
    .map((state) => ({ state, count: cards.filter((card) => stateOf(card) === state).length }))
    .filter((entry) => entry.count > 0)
}

const MIX_FILL: Record<CardState, string> = {
  done: 'bg-positive/70',
  review: 'bg-positive/35',
  running: 'bg-accent/60',
  blocked: 'bg-caution/60',
  todo: 'bg-ink-faint/25',
  abandoned: 'bg-transparent',
}

/**
 * La barre d'un jalon : son étendue, remplie de gauche à droite par l'état de ses
 * cartes (faites d'abord, puis à relire, en cours…), un losange centré sur l'échéance
 * et le pourcentage livré juste après.
 */
function MilestoneBar({
  milestone,
  scale,
  top,
  height,
  launched,
  onOpen,
  now = Date.now(),
}: {
  milestone: Milestone
  scale: Scale
  top: number
  height: number
  launched: boolean
  onOpen: () => void
  now?: number
}) {
  const starts = [milestone.card.createdAt, ...milestone.cards.map((card) => card.createdAt)]
  const start = Math.min(...starts)
  const due = milestone.card.dueAt
  const end = due ?? Math.max(now, ...milestone.cards.map((card) => barOf(card, now).end))
  const left = scale.x(start)
  const width = Math.max(scale.x(end) - left, 12)
  const mix = stateMix(milestone.cards)
  const total = mix.reduce((sum, entry) => sum + entry.count, 0)
  const progress = progressOf(milestone)
  const late = due !== null && due < now && !delivered(milestone)
  const diamond = height + 2

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        title={`${milestone.card.title} — ${progress.done}/${progress.total}`}
        className={cx(
          'absolute flex overflow-hidden rounded-full border bg-surface-high/60 hover:brightness-105 focus-visible:outline-2 focus-visible:outline-accent',
          late ? 'border-critical/70' : 'border-line-strong',
          due === null && 'border-dashed',
          launched && 'shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-accent)_55%,transparent)]',
        )}
        style={{ left, width, top, height }}
      >
        {mix.map((entry) => (
          <span key={entry.state} className={MIX_FILL[entry.state]} style={{ width: `${(entry.count / Math.max(total, 1)) * 100}%` }} />
        ))}
      </button>
      {due !== null ? (
        <span
          aria-hidden
          title={`Échéance ${formatDay(due)}`}
          className={cx('absolute rotate-45 rounded-[2px] border-2 bg-canvas', late ? 'border-critical' : 'border-ink-soft')}
          style={{ left: scale.x(due) - diamond / 2, top: top + height / 2 - diamond / 2, width: diamond, height: diamond }}
        />
      ) : null}
      <span
        className="pointer-events-none absolute text-xs font-medium whitespace-nowrap text-ink-faint tabular-nums"
        style={{ left: left + width + (due !== null ? diamond / 2 + 6 : 6), top, lineHeight: `${height}px` }}
      >
        {progress.total === 0 ? '—' : `${Math.round(progress.share * 100)} %`}
      </span>
    </>
  )
}

/* ================================================================== A — Gantt classique */

const ROW = 32
const HEAD_ROW = 40
const LIST_WIDE = 296
const LIST_NARROW = 170

interface Group {
  key: string
  milestone: Milestone | null
  title: string
  cards: { card: CardDto; depth: number }[]
}

/**
 * A — **Gantt classique** : la liste à gauche (jalons repliables, cartes en retrait),
 * l'axe à droite, barres colorées par état, flèches « bloque » en coudes, losange
 * d'échéance.
 *
 * Chaque jalon est un groupe : un fond à lui, un en-tête qui reste collé sous l'axe tant
 * qu'on lit ses cartes. Le survol d'une ligne — dans la liste ou sur sa barre — la
 * surligne sur toute la largeur, éclaire sa chaîne de dépendances et ouvre son infobulle.
 */
export function GanttClassic({ zoom: outerZoom, bare = false, keep }: {
  /** Tenu par la barre de la page (variante `vues` des Jalons) : la petite barre interne disparaît. */
  zoom?: Zoom
  bare?: boolean
  /** Filtre de jalon venu de la barre de la page. */
  keep?: (milestoneId: string) => boolean
} = {}) {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const href = useProtoHref()
  const data = useProtoData(projectId)
  const [ownZoom, setZoom] = useZoom('semaine')
  const zoom = outerZoom ?? ownZoom
  const [folded, setFolded] = useState<ReadonlySet<string> | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const now = Date.now()

  const foldedSet = folded ?? new Set(data.milestones.filter(delivered).map((milestone) => milestone.card.id))
  const toggle = (id: string) => {
    const next = new Set(foldedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setFolded(next)
  }

  const plotted = useMemo(() => plottedCards(data), [data])
  const LIST_W = window.innerWidth < 640 ? LIST_NARROW : LIST_WIDE
  // La gouttière de la page (16 px, 24 px à partir de md) : la colonne des libellés part du
  // même bord que la barre d'outils et la rangée d'onglets.
  const GUTTER = window.innerWidth < 768 ? 16 : 24
  const axisWidth = useAxisWidth(scroller, LIST_W)
  const scale = useMemo(() => scaleOf(plotted, zoom, Date.now(), axisWidth), [plotted, zoom, axisWidth])
  useScrollToNow(scroller, scale, LIST_W, now)
  const chain = useMemo(() => chainOf(plotted, hovered), [plotted, hovered])

  const groups: Group[] = data.milestones.filter((milestone) => !keep || keep(milestone.card.id)).map((milestone) => ({
    key: milestone.card.id,
    milestone,
    title: milestone.card.title,
    cards: foldedSet.has(milestone.card.id)
      ? []
      : [...milestone.cards]
          .filter((card) => card.column !== 'abandoned')
          .sort((a, b) => barOf(a).start - barOf(b).start)
          .map((card) => ({ card, depth: 1 })),
  }))
  if (data.loose.length > 0) {
    groups.push({ key: 'loose', milestone: null, title: 'Hors jalon', cards: data.loose.map((card) => ({ card, depth: 0 })) })
  }

  // Les ordonnées, au pixel : la liste et l'axe se lisent sur la même grille.
  const centers = new Map<string, number>()
  let y = 0
  for (const group of groups) {
    y += HEAD_ROW
    for (const { card } of group.cards) {
      centers.set(card.id, y + ROW / 2)
      y += ROW
    }
  }
  const total = y
  const anchors = anchorsOf(plotted, centers, scale, now)

  if (data.isPending) return null
  if (groups.length === 0) return <Empty data={data} />

  const openCard = (card: CardDto) => navigate(href(cardDestination(projectId!, card)))
  const openMilestone = (number: number) => navigate(href(`/p/${projectId}/timeline/${number}?variant=couches`))

  return (
    <div className="flex h-full min-h-0 flex-col">
      {bare ? null : (
        <Toolbar data={data} zoom={zoom} setZoom={setZoom}>
          <Legend />
        </Toolbar>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <div className="relative" style={{ width: LIST_W + scale.width, minHeight: '100%' }}>
          {/* axe, collé en haut */}
          <div className="sticky top-0 z-20 flex">
            <div
              className="sticky left-0 z-30 flex shrink-0 items-end justify-between border-r border-b border-line bg-canvas pr-3 pb-1.5 text-xs font-medium text-ink-faint"
              style={{ width: LIST_W, height: AXIS_H, paddingLeft: GUTTER }}
            >
              <span>Jalon / carte</span>
              <span>échéance</span>
            </div>
            <GanttAxis scale={scale} zoom={zoom} now={now} />
          </div>

          <div className="relative" onMouseLeave={() => setHovered(null)}>
            <div className="absolute top-0" style={{ left: LIST_W }}>
              <GanttGrid scale={scale} zoom={zoom} height={total} now={now} today={false} />
            </div>

            {groups.map((group) => {
              const milestone = group.milestone
              const open = milestone ? !foldedSet.has(milestone.card.id) : true
              const progress = milestone ? progressOf(milestone) : null
              const launched = milestone ? data.launched.has(milestone.card.id) : false
              return (
                <section key={group.key} className={cx('relative', milestone ? 'bg-surface-high/20' : '')}>
                  {/* en-tête du groupe, collé sous l'axe tant qu'on lit ses cartes */}
                  <div className="sticky z-[12] flex border-t border-b border-t-line border-b-line/60 bg-surface" style={{ top: AXIS_H, height: HEAD_ROW }}>
                    <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface pr-2" style={{ width: LIST_W, paddingLeft: GUTTER - 2 }}>
                      {milestone ? (
                        <>
                          <button type="button" onClick={() => toggle(milestone.card.id)} className="rounded p-0.5 text-ink-faint hover:text-ink" aria-label={open ? 'Replier' : 'Déplier'}>
                            {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          </button>
                          <Flag size={13} className={cx('shrink-0', launched ? 'text-accent' : 'text-ink-faint')} />
                          <button type="button" onClick={() => openMilestone(milestone.card.number)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-accent">
                            {group.title}
                          </button>
                          {launched ? <Badge tone="accent">lancé</Badge> : null}
                          <span className="shrink-0 text-xs text-ink-faint tabular-nums">{progress!.done}/{progress!.total}</span>
                        </>
                      ) : (
                        <span className="pl-0.5 text-sm font-semibold text-ink-soft">{group.title}</span>
                      )}
                    </div>
                    <div className="relative flex-1">
                      {milestone ? (
                        <MilestoneBar
                          milestone={milestone}
                          scale={scale}
                          top={(HEAD_ROW - 12) / 2}
                          height={12}
                          launched={launched}
                          onOpen={() => openMilestone(milestone.card.number)}
                          now={now}
                        />
                      ) : null}
                    </div>
                  </div>

                  {group.cards.map(({ card, depth }) => {
                    const late = isLate(card, now)
                    const lit = hovered === card.id
                    const dim = chain !== null && !chain.has(card.id)
                    return (
                      <div
                        key={card.id}
                        className={cx('flex transition-colors', lit && 'bg-accent/[0.07]')}
                        style={{ height: ROW }}
                        onMouseEnter={() => setHovered(card.id)}
                      >
                        <button
                          type="button"
                          onClick={() => openCard(card)}
                          className={cx(
                            'sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line pr-3 text-left text-sm transition-colors',
                            lit ? 'bg-surface-high' : 'bg-canvas',
                            dim && 'text-ink-faint',
                          )}
                          style={{ width: LIST_W, paddingLeft: GUTTER + depth * 20 }}
                        >
                          <span className={cx('size-2 shrink-0 rounded-full', STATE_DOT[stateOf(card)])} />
                          <span className="shrink-0 text-xs text-ink-faint tabular-nums">#{card.number}</span>
                          <span className="min-w-0 flex-1 truncate">{card.title}</span>
                          <CardInfoButton card={card} />
                          {awaitsMe(card) ? (
                            <span aria-hidden title="t’attend" className="size-2 shrink-0 rounded-full bg-caution ring-2 ring-caution/25" />
                          ) : liveSessions(card).length > 0 ? (
                            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                          ) : null}
                          <span className={cx('w-12 shrink-0 text-right text-xs tabular-nums', late ? 'font-medium text-critical' : 'text-ink-faint')}>
                            {card.dueAt === null ? '—' : formatDay(card.dueAt)}
                          </span>
                        </button>
                        <div className="relative flex-1">
                          <CardBar
                            card={card}
                            scale={scale}
                            top={(ROW - BAR_H) / 2}
                            onOpen={() => openCard(card)}
                            now={now}
                            hovered={lit}
                            dimmed={dim}
                            onHover={setHovered}
                          />
                        </div>
                      </div>
                    )
                  })}
                </section>
              )
            })}

            {/* surcouches : aujourd'hui, puis les flèches — sous la liste collée (z-10) */}
            <div className="pointer-events-none absolute top-0 z-[4]" style={{ left: LIST_W, height: total }}>
              <TodayLine scale={scale} height={total} now={now} />
            </div>
            <div className="pointer-events-none absolute top-0 z-[5]" style={{ left: LIST_W }}>
              <GanttArrows anchors={anchors} width={scale.width} height={total} chain={chain} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== B — Gantt + graphe */

/**
 * B — **Gantt des jalons + panneau du jalon** : une ligne par jalon (barre composée
 * de l'état de ses cartes), et à droite le graphe de dépendances du jalon choisi.
 * Le Gantt dit *quand*, le graphe dit *dans quel ordre et qui bloque qui*.
 */
export function GanttWithGraph() {
  const { projectId } = useParams()
  const href = useProtoHref()
  const data = useProtoData(projectId)
  const [zoom, setZoom] = useZoom('mois')
  const [graphLayout, setGraphLayout] = useState<GraphLayout>('couches')
  const [chosen, setChosen] = useState<string | null>(null)
  const now = Date.now()

  const scale = useMemo(() => scaleOf(plottedCards(data), zoom), [data, zoom])
  if (data.isPending) return null
  if (data.milestones.length === 0) return <Empty data={data} />

  const selected =
    data.milestones.find((milestone) => milestone.card.id === chosen) ??
    data.milestones.find((milestone) => !delivered(milestone)) ??
    data.milestones[0]!
  const progress = progressOf(selected)
  const LANE = 58
  const LIST = 220

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar data={data} zoom={zoom} setZoom={setZoom}>
        <span className="text-xs text-ink-faint">Clique un jalon pour voir son graphe →</span>
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Gantt des jalons */}
        <div className="min-h-0 min-w-0 overflow-auto border-line lg:w-[55%] lg:border-r">
          <div className="relative" style={{ width: LIST + scale.width }}>
            <div className="sticky top-0 z-20 flex">
              <div className="sticky left-0 z-30 shrink-0 border-r border-b border-line bg-canvas" style={{ width: LIST, height: AXIS_H }} />
              <GanttAxis scale={scale} zoom={zoom} now={now} />
            </div>
            <div className="relative">
              <div className="absolute top-0" style={{ left: LIST }}>
                <GanttGrid scale={scale} zoom={zoom} height={data.milestones.length * LANE} now={now} />
              </div>
              {data.milestones.map((milestone) => {
                const active = milestone.card.id === selected.card.id
                const launched = data.launched.has(milestone.card.id)
                const p = progressOf(milestone)
                const live = milestone.cards.reduce((sum, card) => sum + liveSessions(card).length, 0)
                return (
                  <div
                    key={milestone.card.id}
                    className={cx('flex border-b border-line', active && 'bg-accent-wash/40')}
                    style={{ height: LANE }}
                  >
                    <button
                      type="button"
                      onClick={() => setChosen(milestone.card.id)}
                      className={cx(
                        'sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-0.5 border-r border-line px-3 text-left',
                        active ? 'bg-accent-wash' : 'bg-canvas hover:bg-surface-high',
                      )}
                      style={{ width: LIST }}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <Flag size={13} className={cx('shrink-0', launched ? 'text-accent' : 'text-ink-faint')} />
                        <span className="truncate">{milestone.card.title}</span>
                      </span>
                      <span className="flex items-center gap-1.5 pl-5 text-xs text-ink-faint tabular-nums">
                        {p.done}/{p.total}
                        {milestone.card.dueAt !== null ? ` · ${formatDay(milestone.card.dueAt)}` : ' · sans date'}
                        {live > 0 ? (
                          <span className="flex items-center gap-1 text-accent">
                            · <span className="size-1.5 animate-pulse rounded-full bg-accent" /> {live}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <div className="relative flex-1">
                      <MilestoneBar
                        milestone={milestone}
                        scale={scale}
                        top={(LANE - 18) / 2}
                        height={18}
                        launched={launched}
                        onOpen={() => setChosen(milestone.card.id)}
                        now={now}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="p-4">
            <Legend />
          </div>
        </div>

        {/* Panneau du jalon */}
        <aside className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Flag size={16} className="shrink-0 text-accent" />
              <h2 className="min-w-0 truncate text-base font-semibold">
                <span className="text-ink-faint tabular-nums">#{selected.card.number}</span> {selected.card.title}
              </h2>
              {data.launched.has(selected.card.id) ? <Badge tone="accent">lancé</Badge> : null}
              <Link
                to={href(`/p/${projectId}/timeline/${selected.card.number}?variant=couches`)}
                className="ml-auto flex shrink-0 items-center gap-1 text-xs text-ink-faint hover:text-ink"
              >
                Vue du jalon <ArrowUpRight size={13} />
              </Link>
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-faint">
              <div className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-high">
                <div className="h-full rounded-full bg-positive" style={{ width: `${progress.share * 100}%` }} />
              </div>
              <span className="tabular-nums">{progress.done}/{progress.total} faites</span>
              <span>{selected.card.dueAt === null ? 'sans échéance' : `échéance ${relativeDate(selected.card.dueAt)}`}</span>
              <div className="ml-auto inline-flex rounded-lg border border-line p-0.5">
                {(['couches', 'etats'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setGraphLayout(value)}
                    className={cx('rounded-md px-2 py-0.5', graphLayout === value ? 'bg-surface-high text-ink' : 'hover:text-ink')}
                  >
                    {value === 'couches' ? 'Ordre' : 'Par état'}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {projectId ? (
              <DependencyGraph projectId={projectId} cards={selected.cards} layout={graphLayout} compact hrefOf={href} />
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  )
}

/* ================================================================== C — Roadmap en couloirs */

const TRACK = 28
const LANE_PAD = 30

/** Range des barres dans le moins de pistes possible, sans chevauchement. */
function pack(cards: CardDto[], now: number): Map<string, number> {
  const tracks: number[] = []
  const placed = new Map<string, number>()
  const ordered = [...cards].sort((a, b) => barOf(a, now).start - barOf(b, now).start)
  for (const card of ordered) {
    const { start, end } = barOf(card, now)
    // marge pour l'étiquette : 4 jours
    let index = tracks.findIndex((last) => last + 2 * DAY < start)
    if (index === -1) {
      index = tracks.length
      tracks.push(end)
    } else tracks[index] = end
    placed.set(card.id, index)
  }
  return placed
}

/**
 * C — **Roadmap en couloirs** : pas de liste à gauche. Chaque jalon est un couloir
 * teinté, son nom flotte en tête, ses cartes sont tassées en pistes avec leur titre
 * dans la barre. Une ligne verticale par échéance de jalon. Plus proche d'une feuille
 * de route que d'un outil de planification.
 */
export function GanttRoadmap() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const href = useProtoHref()
  const data = useProtoData(projectId)
  const [zoom, setZoom] = useZoom('mois')
  const [showDone, setShowDone] = useState(false)
  const now = Date.now()

  const scale = useMemo(() => scaleOf(plottedCards(data), zoom), [data, zoom])
  if (data.isPending) return null
  if (data.milestones.length === 0 && data.loose.length === 0) return <Empty data={data} />

  const lanes = [
    ...data.milestones
      .filter((milestone) => showDone || !delivered(milestone))
      .map((milestone) => ({ key: milestone.card.id, milestone, cards: milestone.cards.filter((card) => card.column !== 'abandoned') })),
    ...(data.loose.length > 0 ? [{ key: 'loose', milestone: null, cards: data.loose }] : []),
  ]
  const hidden = data.milestones.filter(delivered).length

  const centers = new Map<string, number>()
  let y = 0
  const laid = lanes.map((lane) => {
    const tracks = pack(lane.cards, now)
    const count = Math.max(1, ...[...tracks.values()].map((track) => track + 1))
    const top = y
    const height = LANE_PAD + count * TRACK + 10
    for (const card of lane.cards) centers.set(card.id, top + LANE_PAD + (tracks.get(card.id) ?? 0) * TRACK + 11)
    y += height + 8
    return { ...lane, tracks, top, height }
  })
  const total = y
  const anchors = anchorsOf(lanes.flatMap((lane) => lane.cards), centers, scale, now)
  const openCard = (card: CardDto) => navigate(href(cardDestination(projectId!, card)))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar data={data} zoom={zoom} setZoom={setZoom}>
        {hidden > 0 ? (
          <label className="flex items-center gap-1.5 text-xs text-ink-faint">
            <input type="checkbox" checked={showDone} onChange={(event) => setShowDone(event.target.checked)} />
            Jalons livrés ({hidden})
          </label>
        ) : null}
        <Legend />
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="relative" style={{ width: scale.width + 32 }}>
          <div className="sticky top-0 z-20 pl-4"><GanttAxis scale={scale} zoom={zoom} now={now} /></div>
          <div className="relative mt-3 ml-4" style={{ height: total }}>
            <GanttGrid scale={scale} zoom={zoom} height={total} now={now} />
            {laid.map((lane) => {
              const milestone = lane.milestone
              const launched = milestone ? data.launched.has(milestone.card.id) : false
              const due = milestone?.card.dueAt ?? null
              const late = milestone !== null && due !== null && due < now && !delivered(milestone)
              const progress = milestone ? progressOf(milestone) : null
              return (
                <section
                  key={lane.key}
                  className={cx(
                    'absolute right-0 left-0 rounded-xl border',
                    milestone ? 'border-line bg-surface/70' : 'border-dashed border-line bg-transparent',
                    launched && 'border-accent/60 bg-accent-wash/25',
                  )}
                  style={{ top: lane.top, height: lane.height }}
                >
                  <div className="sticky left-2 z-10 inline-flex max-w-[28rem] items-center gap-2 px-2.5 pt-1.5 text-sm">
                    {milestone ? (
                      <>
                        <Flag size={13} className={cx('shrink-0', launched ? 'text-accent' : 'text-ink-faint')} />
                        <Link to={href(`/p/${projectId}/timeline/${milestone.card.number}?variant=couches`)} className="truncate font-medium hover:text-accent">
                          {milestone.card.title}
                        </Link>
                        {launched ? <Rocket size={13} className="shrink-0 text-accent" /> : null}
                        <span className="shrink-0 text-xs text-ink-faint tabular-nums">{progress!.done}/{progress!.total}</span>
                        {due !== null ? (
                          <span className={cx('shrink-0 text-xs', late ? 'font-medium text-critical' : 'text-ink-faint')}>· {relativeDate(due)}</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="font-medium text-ink-soft">Hors jalon</span>
                    )}
                  </div>
                  {due !== null ? (
                    <span
                      aria-hidden
                      className={cx('absolute top-0 bottom-0 w-0 border-l-2', late ? 'border-critical' : 'border-ink/60')}
                      style={{ left: scale.x(due) }}
                    >
                      <Flag size={12} className={cx('absolute -top-1 left-0.5', late ? 'text-critical' : 'text-ink')} />
                    </span>
                  ) : null}
                  {lane.cards.map((card) => (
                    <CardBar
                      key={card.id}
                      card={card}
                      scale={scale}
                      top={LANE_PAD + (lane.tracks.get(card.id) ?? 0) * TRACK}
                      onOpen={() => openCard(card)}
                      now={now}
                    />
                  ))}
                </section>
              )
            })}
            <div className="pointer-events-none absolute top-0 left-0 z-[5]">
              <GanttArrows anchors={anchors} width={scale.width} height={total} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

