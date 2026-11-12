import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { Tooltip, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { CardInfoButton } from '../cards/CardInfoButton'
import { STATE_DOT } from '../gantt/tones'
import { chainOf } from '../gantt/scale'
import { cardDestinationHref } from '../../lib/card-destination'
import { awaitsMe, cardState, isLate, isOpen, liveSessions, loadedStatus, type StatusOf } from '../../lib/card-state'
import { pluralOf } from '../../lib/code-model'
import { formatDay } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { layersOf, waveProgress, wavesOf } from '../../lib/milestone-model'
import { STATE_NODE } from './tones'

/** Largeur minimale d'une colonne : en dessous, le titre ne tient plus sur deux lignes. */
const MIN_COL = 160
/** Le couloir entre deux vagues, où passent les arêtes. */
const GAP = 32
const NODE_H = 76
const NODE_GAP = 12
const HEAD_H = 52
/** En dessous, les vagues s'empilent : une colonne par vague ne tient plus. */
const STACK_BELOW = 560

/** La pointe d'une arête : au repos, éclairée par le survol, ou qui ferme un cycle. */
const TIPS = { rest: 'fill-ink-faint/60', lit: 'fill-accent', cycle: 'fill-critical' } as const

const numbers = (links: readonly { number: number }[]) => links.map((link) => `#${link.number}`).join(', ')

/**
 * Un jalon en **vagues** (VAG-3..10) : une colonne par étage de dépendances, de gauche à
 * droite, qui remplissent toute la largeur. Les nœuds ont tous la même taille ; les
 * arêtes passent en coudes par le couloir entre deux vagues, et le survol d'une carte
 * éclaire sa chaîne, comme au Gantt. Étroit (téléphone), les vagues s'empilent et les
 * liens s'écrivent en clair (« après #N »). Les abandonnées n'y sont pas.
 */
export function WaveGraph({
  projectId,
  cards,
  concurrency,
  launchedAt,
  statusOf = loadedStatus,
}: {
  projectId: string
  cards: readonly CardDto[]
  concurrency: number
  launchedAt: number | null
  statusOf?: StatusOf
}) {
  const t = useTranslate()
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const measure = () => setWidth(element.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const waves = useMemo(() => wavesOf(cards), [cards])
  const shown = useMemo(() => waves.flat(), [waves])
  const inMilestone = useMemo(() => layersOf(shown), [shown])
  const chain = useMemo(() => chainOf(shown, hovered), [shown, hovered])
  const added = launchedAt === null ? [] : shown.filter((card) => card.createdAt > launchedAt)
  const stacked = width > 0 && width < STACK_BELOW

  const count = Math.max(1, waves.length)
  const column = Math.max(MIN_COL, (width - GAP * (count - 1)) / count)
  const position = new Map<string, { x: number; y: number }>()
  waves.forEach((wave, index) =>
    wave.forEach((card, row) => position.set(card.id, { x: index * (column + GAP), y: HEAD_H + row * (NODE_H + NODE_GAP) })),
  )
  const height = HEAD_H + Math.max(0, ...waves.map((wave) => wave.length)) * (NODE_H + NODE_GAP) - NODE_GAP
  const total = count * column + (count - 1) * GAP

  const node = (card: CardDto, style?: CSSProperties) => (
    <WaveNode
      key={card.id}
      projectId={projectId}
      card={card}
      added={launchedAt !== null && card.createdAt > launchedAt}
      dimmed={chain !== null && !chain.has(card.id)}
      lit={chain !== null && chain.has(card.id)}
      onHover={setHovered}
      style={style}
      showAfter={stacked}
      inMilestone={inMilestone}
      statusOf={statusOf}
    />
  )

  return (
    <div ref={box} className="min-w-0">
      {width === 0 ? null : stacked ? (
        <ol className="flex flex-col gap-4">
          {waves.map((wave, index) => (
            <li key={index} className="flex flex-col gap-2">
              <WaveHead index={index} wave={wave} concurrency={concurrency} />
              <div className="flex flex-col gap-2">{wave.map((card) => node(card))}</div>
            </li>
          ))}
        </ol>
      ) : (
        <div className={cx(total > width + 1 && 'overflow-x-auto')} onMouseLeave={() => setHovered(null)}>
          <div className="relative" style={{ width: total, height }}>
            {waves.map((wave, index) => (
              <div key={index} className="absolute top-0" style={{ left: index * (column + GAP), width: column, height: HEAD_H - 10 }}>
                <WaveHead index={index} wave={wave} concurrency={concurrency} />
              </div>
            ))}
            <Edges cards={shown} position={position} column={column} chain={chain} width={total} height={height} />
            {shown.map((card) => {
              const at = position.get(card.id)!
              return node(card, { position: 'absolute', left: at.x, top: at.y, width: column, height: NODE_H })
            })}
          </div>
        </div>
      )}
      {added.length ? (
        <p className="mt-3 text-xs text-caution">{t('milestone.waves.addedList', { cards: numbers(added) })}</p>
      ) : null}
    </div>
  )
}

/** L'en-tête d'une vague (VAG-5) : son rang, ce qui y reste ouvert, une barrette par carte. */
function WaveHead({ index, wave, concurrency }: { index: number; wave: readonly CardDto[]; concurrency: number }) {
  const t = useTranslate()
  const progress = waveProgress(wave, concurrency)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold tracking-wide text-ink-soft uppercase">{t('milestone.waves.wave', { number: index + 1 })}</span>
        <span className="truncate text-xs text-ink-faint">
          {progress.kind === 'finished'
            ? t('milestone.waves.finished')
            : `${t(`milestone.waves.open.${pluralOf(progress.open)}`, { count: progress.open })} · ${
                progress.passes > 1 ? t('milestone.waves.passes', { count: progress.passes }) : t('milestone.waves.parallel')
              }`}
        </span>
      </div>
      <span aria-hidden className="flex gap-0.5">
        {wave.map((card) => (
          <span key={card.id} className={cx('h-1 flex-1 rounded-full', STATE_DOT[cardState(card)])} />
        ))}
      </span>
    </div>
  )
}

/**
 * Une carte du graphe (VAG-6), qui mène à sa destination : sa session, ou sa fiche si
 * une session l'attend — elle passe alors en ambre, sans recopier la demande, qui vit
 * dans « Ce qui t'attend ».
 */
function WaveNode({
  projectId,
  card,
  added,
  dimmed,
  lit,
  onHover,
  style,
  showAfter,
  inMilestone,
  statusOf,
}: {
  projectId: string
  card: CardDto
  added: boolean
  dimmed: boolean
  lit: boolean
  onHover: (id: string | null) => void
  style?: CSSProperties
  showAfter: boolean
  inMilestone: ReadonlyMap<string, number>
  statusOf: StatusOf
}) {
  const t = useTranslate()
  const [search] = useSearchParams()
  const state = cardState(card)
  const live = liveSessions(card, statusOf)
  const late = isLate(card)
  const done = state === 'done'
  const waiting = card.blockedBy.filter(isOpen)
  const after = card.blockedBy.filter((link) => inMilestone.has(link.id))
  const asking = awaitsMe(card, statusOf)

  return (
    <Link
      to={cardDestinationHref(projectId, card, { statusOf, search })}
      style={style}
      onMouseEnter={() => onHover(card.id)}
      onFocus={() => onHover(card.id)}
      onBlur={() => onHover(null)}
      className={cx(
        'flex min-h-[76px] flex-col justify-between gap-1 rounded-xl border px-2.5 py-2 transition-[opacity,box-shadow,border-color] duration-150',
        'hover:border-accent focus-visible:outline-2 focus-visible:outline-accent',
        STATE_NODE[state],
        done && 'opacity-70',
        dimmed && 'opacity-30',
        lit && 'shadow-[0_0_0_2px_var(--color-accent)]',
        late && 'ring-1 ring-critical/70',
        asking && 'border-caution bg-caution/10 ring-2 ring-caution/30',
      )}
    >
      <span className="flex min-w-0 items-start gap-1.5 text-sm leading-snug">
        <span
          aria-hidden
          className={cx(
            'mt-1.5 size-2 shrink-0 rounded-full',
            asking ? 'bg-caution' : STATE_DOT[state],
            !asking && state === 'running' && 'animate-pulse',
          )}
        />
        <span className="line-clamp-2 min-w-0 flex-1 text-ink">
          <span className="text-xs text-ink-faint tabular-nums">#{card.number}</span> {card.title}
        </span>
        <CardInfoButton card={card} className="-mt-0.5 -mr-1" />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
        <span className={cx('shrink-0', asking && 'font-medium text-caution')}>
          {asking ? t('milestone.waves.awaiting') : t(`card.state.${state}`)}
        </span>
        {waiting.length && !done ? (
          <span className="min-w-0 truncate text-caution">{t('milestone.waves.by', { cards: numbers(waiting) })}</span>
        ) : showAfter && after.length ? (
          <span className="min-w-0 truncate">{t('milestone.waves.after', { cards: numbers(after) })}</span>
        ) : null}
        {added ? <span className="shrink-0 text-caution">{t('milestone.waves.added')}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {live.map((session) => {
            const awaiting = statusOf(session) === 'awaiting_input'
            return (
              <Tooltip key={session.id} label={t(awaiting ? 'milestone.waves.awaiting' : 'milestone.waves.running')}>
                <span className={cx('rounded-full p-0.5', awaiting ? 'bg-caution/20' : 'bg-accent/15')}>
                  <AgentIcon agent={session.agent} size={12} />
                </span>
              </Tooltip>
            )
          })}
          {card.dueAt !== null && !done ? (
            <span className={cx('tabular-nums', late && 'font-medium text-critical')}>{formatDay(card.dueAt)}</span>
          ) : null}
        </span>
      </span>
    </Link>
  )
}

/**
 * Les arêtes (VAG-7), du bord droit du bloqueur au bord gauche de la bloquée, en coudes
 * par le milieu du couloir ; en pointillé tant que le bloqueur n'est pas fait. Une arête
 * qui remonte (cycle) passe par-dessus, en pointillé rouge.
 */
function Edges({
  cards,
  position,
  column,
  chain,
  width,
  height,
}: {
  cards: readonly CardDto[]
  position: ReadonlyMap<string, { x: number; y: number }>
  column: number
  chain: ReadonlySet<string> | null
  width: number
  height: number
}) {
  const arrow = `wave-arrow-${useId().replace(/:/g, '')}`
  const edges = cards.flatMap((card) =>
    card.blockedBy
      .filter((link) => position.has(link.id))
      .map((link) => ({ from: link.id, to: card.id, done: link.column === 'done' })),
  )
  const r = 6
  return (
    <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width={width} height={height}>
      {/* Une pointe par teinte : un marqueur ne prend pas la couleur du trait qui le porte. */}
      <defs>
        {Object.entries(TIPS).map(([tone, fill]) => (
          <marker key={tone} id={`${arrow}-${tone}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" className={fill} />
          </marker>
        ))}
      </defs>
      {edges.map(({ from, to, done }) => {
        const a = position.get(from)!
        const b = position.get(to)!
        const lit = chain !== null && chain.has(from) && chain.has(to)
        const faded = chain !== null && !lit
        const backwards = b.x <= a.x
        const y1 = a.y + NODE_H / 2
        const y2 = b.y + NODE_H / 2
        let d: string
        if (backwards) {
          const x1 = a.x + column / 2
          const x2 = b.x + column / 2
          const top = Math.min(a.y, b.y) - 8
          d = `M ${x1} ${a.y} V ${top} H ${x2} V ${b.y - 2}`
        } else {
          const x1 = a.x + column
          const x2 = b.x - 3
          const mid = b.x - GAP / 2
          if (Math.abs(y2 - y1) < 1) d = `M ${x1} ${y1} H ${x2}`
          else {
            const dir = y2 > y1 ? 1 : -1
            d = `M ${x1} ${y1} H ${mid - r} Q ${mid} ${y1} ${mid} ${y1 + dir * r} V ${y2 - dir * r} Q ${mid} ${y2} ${mid + r} ${y2} H ${x2}`
          }
        }
        const tone = backwards ? 'cycle' : lit ? 'lit' : 'rest'
        return (
          <path
            key={`${from}-${to}`}
            d={d}
            fill="none"
            markerEnd={`url(#${arrow}-${tone})`}
            strokeWidth={lit ? 2 : 1.25}
            strokeDasharray={backwards ? '4 3' : done ? undefined : '5 4'}
            className={cx(
              'transition-opacity duration-150',
              backwards ? 'stroke-critical' : lit ? 'stroke-accent' : 'stroke-ink-faint/60',
              faded && 'opacity-20',
            )}
          />
        )
      })}
    </svg>
  )
}
