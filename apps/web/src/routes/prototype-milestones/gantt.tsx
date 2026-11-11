/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { CardDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { formatDay } from '../../lib/dates'
import { DAY, STATE_BAR, STATE_DOT, STATE_LABEL, awaitsMe, isLate, liveSessions, stateOf, type CardState } from './model'

/* ------------------------------------------------------------------ échelle */

export type Zoom = 'semaine' | 'mois'
const PX_PER_DAY: Record<Zoom, number> = { semaine: 30, mois: 8 }

export interface Scale {
  from: number
  to: number
  ppd: number
  width: number
  x: (at: number) => number
}

function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Le lundi de la semaine de `at`. */
function mondayOf(at: number): number {
  const date = new Date(startOfDay(at))
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

/**
 * La fenêtre : de la plus ancienne création à la plus lointaine échéance, aujourd'hui
 * compris, calée sur des semaines entières — et serrée à droite : une semaine de marge
 * au plus, pour qu'il ne reste pas un mois de vide après la dernière date.
 */
export function scaleOf(cards: CardDto[], zoom: Zoom, now = Date.now(), minWidth = 0): Scale {
  const starts = cards.map((card) => card.createdAt)
  const ends = cards.flatMap((card) => (card.dueAt === null ? [] : [card.dueAt]))
  const from = mondayOf(Math.min(now, ...starts) - DAY)
  const to = mondayOf(Math.max(now, ...ends) + (zoom === 'semaine' ? 2 : 4) * DAY) + 7 * DAY
  // Au moins la largeur disponible : une fenêtre courte s'étire au lieu de laisser un
  // vide à droite. Le zoom semaine garde ses 30 px par jour et défile si la période est
  // longue ; le zoom mois est la vue d'ensemble, il tient toujours dans la largeur.
  const days = (to - from) / DAY
  const fit = minWidth > 0 ? minWidth / days : 0
  const ppd = zoom === 'mois' && fit > 0 ? Math.max(3, fit) : Math.max(PX_PER_DAY[zoom], fit)
  return { from, to, ppd, width: Math.round(((to - from) / DAY) * ppd), x: (at: number) => ((at - from) / DAY) * ppd }
}

/**
 * La largeur que l'axe peut occuper dans `ref` (sa largeur moins la liste collée à
 * gauche), suivie au redimensionnement. 0 tant que le conteneur n'est pas monté.
 */
export function useAxisWidth(ref: RefObject<HTMLElement | null>, listWidth: number): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(Math.max(0, Math.floor(element.clientWidth - listWidth)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, listWidth])
  return width
}

/**
 * Une infobulle sortie du flux : portail dans `body`, position fixe sous l'ancre, ou
 * au-dessus quand la place manque, et tenue dans la fenêtre. Posée en absolu dans le
 * Gantt, elle agrandissait le conteneur qui défile et y faisait naître une barre de
 * défilement dès qu'on survolait la dernière ligne.
 */
export function FloatingTip({ anchor, children }: { anchor: RefObject<HTMLElement | null>; children: ReactNode }) {
  const tip = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect()
    const t = tip.current?.getBoundingClientRect()
    if (!a || !t) return
    const gap = 6
    const below = a.bottom + gap + t.height <= window.innerHeight - 8
    const top = below ? a.bottom + gap : Math.max(8, a.top - gap - t.height)
    const left = Math.min(Math.max(8, a.left), window.innerWidth - t.width - 8)
    setPosition({ left, top })
  }, [anchor])
  return createPortal(
    <div
      ref={tip}
      role="tooltip"
      className="pointer-events-none fixed z-50"
      style={position ? { left: position.left, top: position.top } : { left: -9999, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** Début et fin d'une carte : création → échéance, ou → aujourd'hui sans échéance. */
export function barOf(card: CardDto, now = Date.now()): { start: number; end: number; loose: boolean } {
  if (card.dueAt === null) return { start: card.createdAt, end: Math.max(card.createdAt + DAY, now), loose: true }
  return { start: Math.min(card.createdAt, card.dueAt - DAY), end: card.dueAt, loose: false }
}

/**
 * Au montage et à chaque changement d'échelle, fait défiler le conteneur pour que
 * « aujourd'hui » tombe au milieu de la zone de l'axe (la liste collée à gauche exclue).
 */
export function useScrollToNow(ref: RefObject<HTMLElement | null>, scale: Scale, listWidth: number, now = Date.now()) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const visible = element.clientWidth - listWidth
    element.scrollLeft = Math.max(0, scale.x(now) - visible / 2)
    // `now` change à chaque rendu : seule l'échelle doit redéclencher le recentrage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, scale.from, scale.ppd, listWidth])
}

/* ------------------------------------------------------------------ zoom */

export function ZoomToggle({ zoom, onChange }: { zoom: Zoom; onChange: (zoom: Zoom) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line p-0.5 text-xs">
      {(['semaine', 'mois'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={cx(
            'rounded-md px-2.5 py-1 capitalize transition-colors',
            zoom === value ? 'bg-surface-high font-medium text-ink' : 'text-ink-faint hover:text-ink',
          )}
        >
          {value}
        </button>
      ))}
    </div>
  )
}

export function useZoom(initial: Zoom = 'semaine') {
  return useState<Zoom>(initial)
}

/* ------------------------------------------------------------------ axe et grille */

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })
const MONTH_SHORT = new Intl.DateTimeFormat('fr-FR', { month: 'long' })
const WEEKDAY = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

function daysOf(scale: Scale): number[] {
  const days: number[] = []
  // Par le calendrier et non par pas de 24 h : au passage à l'heure d'hiver, un pas de
  // 24 h retombe à 23 h la veille, et la boucle comptait un jour de trop — une semaine
  // entière dessinée après la fin de l'axe, qui l'élargissait de 7 jours.
  const date = new Date(startOfDay(scale.from))
  while (date.getTime() < scale.to) {
    days.push(date.getTime())
    date.setDate(date.getDate() + 1)
  }
  return days
}

function isWeekend(at: number): boolean {
  const day = new Date(at).getDay()
  return day === 0 || day === 6
}

/** Numéro de semaine ISO, pour l'étage bas en zoom mois. */
function isoWeek(at: number): number {
  const date = new Date(startOfDay(at))
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7))
  const firstThursday = new Date(date.getFullYear(), 0, 4)
  return 1 + Math.round(((date.getTime() - firstThursday.getTime()) / DAY - 3 + ((firstThursday.getDay() + 6) % 7)) / 7)
}

export const AXIS_H = 48
const AXIS_TOP = 22

/**
 * L'en-tête de l'axe, sur deux étages : les mois en haut (une bande par mois, son nom
 * collé à gauche pendant qu'on défile), puis les jours (zoom semaine) ou les semaines
 * (zoom mois). Aujourd'hui est une pastille posée sur l'étage bas.
 */
export function GanttAxis({ scale, zoom, now = Date.now() }: { scale: Scale; zoom: Zoom; now?: number }) {
  const days = daysOf(scale)
  const months: { at: number; end: number }[] = []
  for (const at of days) {
    if (months.length === 0 || new Date(at).getDate() === 1) months.push({ at, end: at + DAY })
    else months[months.length - 1]!.end = at + DAY
  }
  const today = startOfDay(now)

  return (
    <div className="relative border-b border-line bg-canvas select-none" style={{ width: scale.width, height: AXIS_H }}>
      {/* étage haut : les mois */}
      {months.map(({ at, end }) => {
        const width = scale.x(end) - scale.x(at)
        return (
          <div
            key={at}
            className="absolute top-0 border-b border-l border-line/70"
            style={{ left: scale.x(at), width, height: AXIS_TOP }}
          >
            <span className="sticky left-0 inline-block px-2 text-xs leading-[22px] font-medium whitespace-nowrap text-ink-soft first-letter:uppercase">
              {width > 110 ? MONTH.format(at) : MONTH_SHORT.format(at)}
            </span>
          </div>
        )
      })}

      {/* étage bas : les jours, ou les semaines */}
      {zoom === 'semaine'
        ? days.map((at) => (
            <span
              key={at}
              className={cx(
                'absolute flex flex-col items-center justify-center text-meta leading-none tabular-nums',
                isWeekend(at) ? 'bg-surface-high/40 text-ink-faint/70' : 'text-ink-faint',
                at === today && 'font-semibold text-accent',
              )}
              style={{ left: scale.x(at), width: scale.ppd, top: AXIS_TOP, height: AXIS_H - AXIS_TOP }}
            >
              <span className="text-[9px] opacity-70">{WEEKDAY[new Date(at).getDay()]}</span>
              <span>{new Date(at).getDate()}</span>
            </span>
          ))
        : days
            .filter((at) => new Date(at).getDay() === 1)
            .map((at) => (
              <span
                key={at}
                className="absolute flex items-center gap-1 border-l border-line/50 pl-1 text-meta whitespace-nowrap text-ink-faint tabular-nums"
                style={{ left: scale.x(at), width: scale.ppd * 7, top: AXIS_TOP, height: AXIS_H - AXIS_TOP }}
              >
                <span className="opacity-60">S{isoWeek(at)}</span>
                <span>{new Date(at).getDate()}</span>
              </span>
            ))}

      {/* aujourd'hui : la pastille, au pied de la ligne qui descend dans la grille */}
      <span
        className="absolute top-0.5 z-10 -translate-x-1/2 rounded-md bg-accent px-1.5 py-px text-meta font-semibold whitespace-nowrap text-accent-ink"
        style={{ left: scale.x(now) }}
      >
        auj.
      </span>
    </div>
  )
}

/**
 * Le fond des lignes : week-ends teintés en zoom semaine, lundis tracés, débuts de mois
 * plus marqués. Le trait d'aujourd'hui peut en sortir (`today={false}` et `TodayLine`)
 * pour passer au-dessus des barres.
 */
export function GanttGrid({
  scale,
  zoom,
  height,
  now = Date.now(),
  today = true,
}: {
  scale: Scale
  zoom: Zoom
  height: number
  now?: number
  today?: boolean
}) {
  const days = daysOf(scale)
  return (
    <div aria-hidden className="pointer-events-none absolute top-0 left-0" style={{ width: scale.width, height }}>
      {days.map((at) => {
        const date = new Date(at)
        if (zoom === 'semaine' && isWeekend(at)) {
          return <span key={at} className="absolute top-0 bottom-0 bg-surface-high/35" style={{ left: scale.x(at), width: scale.ppd }} />
        }
        if (date.getDate() === 1) return <span key={at} className="absolute top-0 bottom-0 w-px bg-line" style={{ left: scale.x(at) }} />
        if (date.getDay() === 1) return <span key={at} className="absolute top-0 bottom-0 w-px bg-line/45" style={{ left: scale.x(at) }} />
        return null
      })}
      {today ? <span className="absolute top-0 bottom-0 w-px bg-accent" style={{ left: scale.x(now) }} /> : null}
    </div>
  )
}

/** Le trait d'aujourd'hui, en surcouche : net, au-dessus des barres, sans capter la souris. */
export function TodayLine({ scale, height, now = Date.now() }: { scale: Scale; height: number; now?: number }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-0 w-px bg-accent"
      style={{ left: scale.x(now), height }}
    />
  )
}

/* ------------------------------------------------------------------ mesure du texte */

let measureContext: CanvasRenderingContext2D | null = null

/** Largeur d'un libellé en `text-xs`, pour décider s'il tient dans sa barre. */
function textWidth(text: string): number {
  if (typeof document === 'undefined') return text.length * 6.5
  if (!measureContext) {
    measureContext = document.createElement('canvas').getContext('2d')
    if (measureContext) measureContext.font = `12px ${getComputedStyle(document.body).fontFamily}`
  }
  return measureContext ? measureContext.measureText(text).width : text.length * 6.5
}

/* ------------------------------------------------------------------ barres */

export const BAR_H = 20
const BAR_PAD = 8

/**
 * Une barre de carte : la teinte de son état, plus discrète sans échéance.
 *
 * Le titre se loge dans la barre quand il y tient en entier, sinon il passe à droite,
 * entier lui aussi : un libellé tronqué en « … » ne se lit pas. Le retard ne peint pas
 * la barre : un prolongement hachuré fin de l'échéance à aujourd'hui, et un cran rouge
 * sur l'échéance, suffisent à le voir sans que tout vire au rouge.
 */
export function CardBar({
  card,
  scale,
  top,
  height = BAR_H,
  onOpen,
  labelInside = true,
  now = Date.now(),
  hovered = false,
  dimmed = false,
  onHover,
}: {
  card: CardDto
  scale: Scale
  top: number
  height?: number
  onOpen: () => void
  /** Faux : pas de libellé du tout (la liste à gauche le porte déjà). */
  labelInside?: boolean
  now?: number
  hovered?: boolean
  dimmed?: boolean
  onHover?: (id: string | null) => void
}) {
  const state = stateOf(card)
  const { start, end, loose } = barOf(card, now)
  const left = scale.x(start)
  const width = Math.max(scale.x(end) - left, 8)
  const late = isLate(card, now)
  const overdue = late && card.dueAt !== null ? Math.max(scale.x(now) - scale.x(card.dueAt), 2) : 0
  const live = liveSessions(card)
  const asking = awaitsMe(card)
  const label = `#${card.number} ${card.title}`
  const fits = textWidth(label) + BAR_PAD * 2 + (live.length ? 10 : 0) <= width
  // L'étiquette posée à droite ne doit pas sortir de l'axe (elle élargirait le conteneur
  // qui défile) : quand elle déborderait, elle passe à gauche de la barre.
  const outsideLeft = left + width + overdue + 6 + textWidth(label) > scale.width
  const anchor = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={anchor}
      className={cx('absolute transition-opacity duration-150', dimmed && 'opacity-30', hovered && 'z-30')}
      style={{ left, top, height, width }}
      onMouseEnter={() => onHover?.(card.id)}
      onMouseLeave={() => onHover?.(null)}
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
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${label} — ${STATE_LABEL[state]}`}
        className={cx(
          'absolute inset-0 flex items-center gap-1 overflow-hidden rounded-[5px] text-left text-xs whitespace-nowrap',
          'transition-[filter,box-shadow] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-accent',
          STATE_BAR[state],
          loose && 'border-dashed opacity-75 [mask-image:linear-gradient(to_right,black_70%,transparent)]',
          hovered && 'shadow-[0_0_0_2px_var(--color-accent)]',
          asking && 'ring-2 ring-caution',
        )}
        style={{ paddingInline: BAR_PAD }}
      >
        {asking ? (
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-caution ring-2 ring-canvas" />
        ) : live.length > 0 ? (
          <span aria-hidden className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
        ) : null}
        {labelInside && fits ? (
          <>
            <span className="shrink-0 tabular-nums opacity-60">#{card.number}</span>
            <span>{card.title}</span>
          </>
        ) : null}
      </button>
      {/* Le cran de l'échéance dépassée, sur le bord droit de la barre. */}
      {late ? <span aria-hidden className="absolute -top-0.5 -bottom-0.5 right-0 w-0.5 rounded-full bg-critical" /> : null}
      {labelInside && !fits ? (
        <span
          className={cx('pointer-events-none absolute top-0 text-xs whitespace-nowrap', hovered ? 'text-ink' : 'text-ink-soft')}
          style={outsideLeft ? { right: width + 6, lineHeight: `${height}px` } : { left: width + overdue + 6, lineHeight: `${height}px` }}
        >
          <span className="tabular-nums text-ink-faint">#{card.number}</span> {card.title}
        </span>
      ) : null}
      {hovered ? (
        <FloatingTip anchor={anchor}>
          <CardTooltip card={card} now={now} />
        </FloatingTip>
      ) : null}
    </div>
  )
}

/** L'infobulle d'une carte : titre, état, création, échéance, sessions vivantes. */
function CardTooltip({ card, now }: { card: CardDto; now: number }) {
  const state = stateOf(card)
  const late = isLate(card, now)
  const live = liveSessions(card)
  const lateBy = late && card.dueAt !== null ? Math.ceil((now - card.dueAt) / DAY) : 0
  return (
    <div className="w-64 rounded-lg border border-line bg-surface p-2.5 text-xs shadow-lg">
      <p className="flex items-start gap-1.5 text-sm leading-snug font-medium text-ink">
        <span className="shrink-0 font-normal text-ink-faint tabular-nums">#{card.number}</span>
        <span className="min-w-0">{card.title}</span>
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-ink-soft">
        <dt className="text-ink-faint">État</dt>
        <dd className="flex items-center gap-1.5">
          <span className={cx('size-2 rounded-full', STATE_DOT[state])} />
          {STATE_LABEL[state]}
        </dd>
        <dt className="text-ink-faint">Créée</dt>
        <dd className="tabular-nums">{formatDay(card.createdAt)}</dd>
        <dt className="text-ink-faint">Échéance</dt>
        <dd className={cx('tabular-nums', late && 'font-medium text-critical')}>
          {card.dueAt === null ? 'aucune' : formatDay(card.dueAt)}
          {late ? ` · ${lateBy} j de retard` : ''}
        </dd>
        {live.length > 0 ? (
          <>
            <dt className="text-ink-faint">Sessions</dt>
            <dd className="flex flex-col gap-0.5">
              {live.map((session) => (
                <span key={session.id} className="flex min-w-0 items-center gap-1.5">
                  <AgentIcon agent={session.agent} size={12} />
                  <span className={session.status === 'awaiting_input' ? 'text-caution' : 'text-accent'}>
                    {session.status === 'awaiting_input' ? 't’attend' : 'tourne'}
                  </span>
                </span>
              ))}
            </dd>
          </>
        ) : null}
      </dl>
      <p className="mt-2 text-meta text-ink-faint">Clic : ouvrir sa session</p>
    </div>
  )
}

/* ------------------------------------------------------------------ flèches */

export interface Anchor {
  x1: number
  y1: number
  x2: number
  y2: number
  state: CardState
  /** La carte qui bloque, et celle qui attend : de quoi éclairer une chaîne au survol. */
  from?: string
  to?: string
}

/** Un tracé orthogonal à coins arrondis, à travers les points donnés. */
function elbow(points: [number, number][], radius = 5): string {
  let d = `M${points[0]![0]},${points[0]![1]}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const [px, py] = points[index - 1]!
    const [x, y] = points[index]!
    const [nx, ny] = points[index + 1]!
    const r = Math.min(radius, Math.abs(x - px + y - py) / 2, Math.abs(nx - x + ny - y) / 2)
    d += ` L${x - Math.sign(x - px) * r},${y - Math.sign(y - py) * r} Q${x},${y} ${x + Math.sign(nx - x) * r},${y + Math.sign(ny - y) * r}`
  }
  const last = points[points.length - 1]!
  return `${d} L${last[0]},${last[1]}`
}

/**
 * Les flèches « bloque », en coudes : de la fin de la bloquante au début de la bloquée.
 * Discrètes au repos ; au survol d'une barre, sa chaîne s'éclaire et le reste s'efface.
 * Quand la bloquée commence avant la fin de sa bloquante, la flèche fait le tour par
 * l'interligne plutôt que de traverser les barres.
 */
export function GanttArrows({
  anchors,
  width,
  height,
  chain,
}: {
  anchors: Anchor[]
  width: number
  height: number
  /** Les cartes de la chaîne survolée, ou `null` au repos. */
  chain?: ReadonlySet<string> | null
}) {
  return (
    <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width={width} height={height}>
      <defs>
        <marker id="proto-arrow-rest" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0.5 L8,4 L0,7.5 z" fill="var(--color-ink-faint)" />
        </marker>
        <marker id="proto-arrow-lit" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0.5 L8,4 L0,7.5 z" fill="var(--color-accent)" />
        </marker>
      </defs>
      {anchors.map((anchor, index) => {
        const { x1, y1, x2, y2 } = anchor
        const out = x1 + 8
        const middle = (y1 + y2) / 2
        const points: [number, number][] =
          x2 - x1 >= 18
            ? [[x1, y1], [out, y1], [out, y2], [x2 - 1, y2]]
            : [[x1, y1], [out, y1], [out, middle], [x2 - 10, middle], [x2 - 10, y2], [x2 - 1, y2]]
        const lit = chain ? chain.has(anchor.from ?? '') && chain.has(anchor.to ?? '') : false
        const faded = chain ? !lit : false
        return (
          <path
            key={index}
            d={elbow(points)}
            fill="none"
            stroke={lit ? 'var(--color-accent)' : 'var(--color-ink-faint)'}
            strokeWidth={lit ? 1.75 : 1.1}
            strokeOpacity={lit ? 1 : faded ? 0.12 : 0.45}
            markerEnd={lit ? 'url(#proto-arrow-lit)' : 'url(#proto-arrow-rest)'}
            className="transition-[stroke-opacity] duration-150"
          />
        )
      })}
    </svg>
  )
}

/** Les ancres des liens entre cartes visibles, à partir de leur ligne (centre vertical). */
export function anchorsOf(cards: CardDto[], centerY: Map<string, number>, scale: Scale, now = Date.now()): Anchor[] {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const anchors: Anchor[] = []
  for (const card of cards) {
    const y2 = centerY.get(card.id)
    if (y2 === undefined) continue
    for (const blocker of card.blockedBy) {
      const source = byId.get(blocker.id)
      const y1 = centerY.get(blocker.id)
      if (!source || y1 === undefined) continue
      anchors.push({
        x1: scale.x(barOf(source, now).end),
        y1,
        x2: scale.x(barOf(card, now).start),
        y2,
        state: stateOf(source),
        from: source.id,
        to: card.id,
      })
    }
  }
  return anchors
}

/**
 * La chaîne d'une carte : elle, tout ce qui la bloque en remontant, tout ce qu'elle
 * bloque en descendant. C'est ce qui s'éclaire au survol.
 */
export function chainOf(cards: CardDto[], id: string | null): ReadonlySet<string> | null {
  if (id === null) return null
  const byId = new Map(cards.map((card) => [card.id, card]))
  const blocks = new Map<string, string[]>()
  for (const card of cards) {
    for (const blocker of card.blockedBy) blocks.set(blocker.id, [...(blocks.get(blocker.id) ?? []), card.id])
  }
  const seen = new Set<string>([id])
  const walk = (start: string, next: (at: string) => string[]) => {
    const stack = [start]
    while (stack.length) {
      for (const other of next(stack.pop()!)) {
        if (seen.has(other)) continue
        seen.add(other)
        stack.push(other)
      }
    }
  }
  walk(id, (at) => (byId.get(at)?.blockedBy ?? []).map((blocker) => blocker.id).filter((other) => byId.has(other)))
  walk(id, (at) => blocks.get(at) ?? [])
  return seen
}

/* ------------------------------------------------------------------ légende */

export function Legend({ children }: { children?: ReactNode }) {
  const item = (cls: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className={cx('inline-block h-2.5 w-5 rounded-[3px]', cls)} />
      {label}
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
      {item(STATE_BAR.todo, 'à faire')}
      {item(STATE_BAR.blocked, 'bloquée')}
      {item(STATE_BAR.running, 'en cours')}
      {item(STATE_BAR.review, 'à relire')}
      {item(STATE_BAR.done, 'faite')}
      {item('border border-dashed border-line-strong opacity-75', 'sans échéance')}
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-1.5 w-5 rounded-r-full"
          style={{ background: 'repeating-linear-gradient(135deg, color-mix(in oklab, var(--color-critical) 55%, transparent) 0 3px, transparent 3px 6px)' }}
        />
        retard
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 animate-pulse rounded-full bg-accent" /> session vivante
      </span>
      {children}
    </div>
  )
}

export function DemoNotice({ demo }: { demo: boolean }) {
  if (!demo) return null
  return (
    <span className="rounded-full bg-fuchsia-500/15 px-2 py-0.5 text-xs font-medium text-fuchsia-600 dark:text-fuchsia-300">
      données de démo (?demo=1)
    </span>
  )
}
