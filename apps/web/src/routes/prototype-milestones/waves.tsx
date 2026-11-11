/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { formatDay } from '../../lib/dates'
import { cardDestination } from './destination'
import { CardInfoButton } from './CardDrawer'
import { STATE_DOT, STATE_LABEL, STATE_NODE, awaitsMe, isLate, isOpen, liveSessions, stateOf } from './model'

/** Largeur minimale d'une colonne : en dessous, le titre ne tient plus sur deux lignes. */
const MIN_COL = 160
/** Le couloir entre deux vagues, où passent les arêtes. */
const GAP = 32
const NODE_H = 76
const NODE_GAP = 12
const HEAD_H = 52
/** En dessous, les vagues s'empilent : une colonne par vague ne tient plus. */
const STACK_BELOW = 560

/** Étage d'une carte : 0 sans bloqueur dans le jalon, sinon un de plus que le plus haut. */
export function layersOf(cards: CardDto[]): Map<string, number> {
  const ids = new Set(cards.map((card) => card.id))
  const byId = new Map(cards.map((card) => [card.id, card]))
  const layer = new Map<string, number>()
  const visiting = new Set<string>()
  const visit = (card: CardDto): number => {
    const known = layer.get(card.id)
    if (known !== undefined) return known
    if (visiting.has(card.id)) return 0
    visiting.add(card.id)
    const blockers = card.blockedBy.filter((blocker) => ids.has(blocker.id))
    const value = blockers.length === 0 ? 0 : 1 + Math.max(...blockers.map((blocker) => visit(byId.get(blocker.id)!)))
    visiting.delete(card.id)
    layer.set(card.id, value)
    return value
  }
  cards.forEach(visit)
  return layer
}

/** Ce que la carte survolée entraîne : ses bloqueurs en amont et ce qu'elle bloque en aval. */
function chainOf(id: string, cards: CardDto[]): Set<string> {
  const ids = new Set(cards.map((card) => card.id))
  const byId = new Map(cards.map((card) => [card.id, card]))
  const chain = new Set<string>([id])
  const walk = (start: string, next: (card: CardDto) => string[]) => {
    const stack = [start]
    while (stack.length) {
      const card = byId.get(stack.pop()!)
      if (!card) continue
      for (const other of next(card)) {
        if (!ids.has(other) || chain.has(other)) continue
        chain.add(other)
        stack.push(other)
      }
    }
  }
  walk(id, (card) => card.blockedBy.map((link) => link.id))
  walk(id, (card) => card.blocks.map((link) => link.id))
  return chain
}

/**
 * Le jalon en **vagues** : une colonne par étage de dépendances, de gauche à droite,
 * qui remplissent toute la largeur. Les nœuds ont tous la même taille ; les arêtes
 * passent en coudes par le couloir entre deux vagues, et le survol d'une carte éclaire
 * sa chaîne — comme au Gantt. Étroit (téléphone), les vagues s'empilent et les liens
 * s'écrivent en clair (« après #N »).
 */
export function WaveGraph({
  projectId,
  cards,
  concurrency,
  href,
  launchedAt,
}: {
  projectId: string
  cards: CardDto[]
  concurrency: number
  href: (path: string) => string
  launchedAt: number | null
}) {
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

  const layers = useMemo(() => layersOf(cards), [cards])
  const count = Math.max(1, ...[...layers.values()].map((value) => value + 1))
  // Dans une vague, les ouvertes d'abord : ce qui reste à faire se lit en haut.
  const waves = Array.from({ length: count }, (_, index) =>
    cards
      .filter((card) => layers.get(card.id) === index)
      .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || a.number - b.number),
  )
  const chain = useMemo(() => (hovered ? chainOf(hovered, cards) : null), [hovered, cards])
  const added = launchedAt === null ? [] : cards.filter((card) => card.createdAt > launchedAt)
  const stacked = width > 0 && width < STACK_BELOW

  const column = Math.max(MIN_COL, (width - GAP * (count - 1)) / count)
  const position = new Map<string, { x: number; y: number }>()
  waves.forEach((wave, index) =>
    wave.forEach((card, row) => position.set(card.id, { x: index * (column + GAP), y: HEAD_H + row * (NODE_H + NODE_GAP) })),
  )
  const height = HEAD_H + Math.max(...waves.map((wave) => wave.length)) * (NODE_H + NODE_GAP) - NODE_GAP
  const total = count * column + (count - 1) * GAP

  const node = (card: CardDto, style?: React.CSSProperties) => (
    <WaveNode
      key={card.id}
      card={card}
      to={href(cardDestination(projectId, card))}
      added={launchedAt !== null && card.createdAt > launchedAt}
      dimmed={chain !== null && !chain.has(card.id)}
      lit={chain !== null && chain.has(card.id)}
      onHover={setHovered}
      style={style}
      showAfter={stacked}
      inMilestone={layers}
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
            <Edges cards={cards} position={position} column={column} chain={chain} width={total} height={height} />
            {cards.map((card) => {
              const at = position.get(card.id)!
              return node(card, { position: 'absolute', left: at.x, top: at.y, width: column, height: NODE_H })
            })}
          </div>
        </div>
      )}
      {added.length ? (
        <p className="mt-3 text-xs text-caution">
          Ajoutées depuis le lancement : {added.map((card) => `#${card.number}`).join(', ')}
        </p>
      ) : null}
    </div>
  )
}

function WaveHead({ index, wave, concurrency }: { index: number; wave: CardDto[]; concurrency: number }) {
  const open = wave.filter(isOpen)
  const passes = Math.ceil(open.length / concurrency)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="text-xs font-semibold tracking-wide text-ink-soft uppercase">Vague {index + 1}</span>
        <span className="truncate text-xs text-ink-faint">
          {open.length === 0
            ? 'terminée'
            : `${open.length} ouverte${open.length > 1 ? 's' : ''} · ${passes > 1 ? `${passes} passes` : 'en parallèle'}`}
        </span>
      </div>
      <span className="flex gap-0.5">
        {wave.map((card) => (
          <span key={card.id} className={cx('h-1 flex-1 rounded-full', STATE_DOT[stateOf(card)])} />
        ))}
      </span>
    </div>
  )
}

function WaveNode({
  card,
  to,
  added,
  dimmed,
  lit,
  onHover,
  style,
  showAfter,
  inMilestone,
}: {
  card: CardDto
  to: string
  added: boolean
  dimmed: boolean
  lit: boolean
  onHover: (id: string | null) => void
  style?: React.CSSProperties
  showAfter: boolean
  inMilestone: Map<string, number>
}) {
  const state = stateOf(card)
  const live = liveSessions(card)
  const late = isLate(card)
  const done = state === 'done'
  const waiting = card.blockedBy.filter((link) => link.column !== 'done' && link.column !== 'abandoned')
  const after = card.blockedBy.filter((link) => inMilestone.has(link.id))
  const asking = awaitsMe(card)

  return (
    <Link
      to={to}
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
        // Le repère : une session de cette carte attend Tim. La demande vit dans « Ce qui t'attend ».
        asking && 'border-caution bg-caution/10 ring-2 ring-caution/30',
      )}
    >
      <span className="flex min-w-0 items-start gap-1.5 text-sm leading-snug">
        <span className={cx('mt-1.5 size-2 shrink-0 rounded-full', asking ? 'bg-caution' : STATE_DOT[state], !asking && state === 'running' && 'animate-pulse')} />
        <span className="line-clamp-2 min-w-0 flex-1">
          <span className="text-xs text-ink-faint tabular-nums">#{card.number}</span> {card.title}
        </span>
        <CardInfoButton card={card} className="-mt-0.5 -mr-1" />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
        <span className={cx('shrink-0', asking && 'font-medium text-caution')}>{asking ? 't’attend' : STATE_LABEL[state]}</span>
        {waiting.length && !done ? (
          <span className="min-w-0 truncate text-caution">par {waiting.map((link) => `#${link.number}`).join(', ')}</span>
        ) : showAfter && after.length ? (
          <span className="min-w-0 truncate">après {after.map((link) => `#${link.number}`).join(', ')}</span>
        ) : null}
        {added ? <span className="shrink-0 text-caution">ajoutée</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {live.map((session) => (
            <span key={session.id} title={session.status === 'awaiting_input' ? 't’attend' : 'tourne'} className={cx('rounded-full p-0.5', session.status === 'awaiting_input' ? 'bg-caution/20' : 'bg-accent/15')}>
              <AgentIcon agent={session.agent} size={12} />
            </span>
          ))}
          {card.dueAt !== null && !done ? (
            <span className={cx('tabular-nums', late && 'font-medium text-critical')}>{formatDay(card.dueAt)}</span>
          ) : null}
        </span>
      </span>
    </Link>
  )
}

/**
 * Les arêtes, du bord droit du bloqueur au bord gauche de la bloquée, en coudes par le
 * milieu du couloir. Une arête qui remonte (cycle) passe par-dessus, en pointillé rouge.
 */
function Edges({
  cards,
  position,
  column,
  chain,
  width,
  height,
}: {
  cards: CardDto[]
  position: Map<string, { x: number; y: number }>
  column: number
  chain: Set<string> | null
  width: number
  height: number
}) {
  const edges = cards.flatMap((card) =>
    card.blockedBy
      .filter((link) => position.has(link.id))
      .map((link) => ({ from: link.id, to: card.id, done: link.column === 'done' })),
  )
  const r = 6
  return (
    <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width={width} height={height}>
      <defs>
        <marker id="wave-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
        </marker>
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
        return (
          <path
            key={`${from}-${to}`}
            d={d}
            fill="none"
            markerEnd="url(#wave-arrow)"
            strokeWidth={lit ? 2 : 1.25}
            strokeDasharray={backwards ? '4 3' : done ? undefined : '5 4'}
            className={cx(
              'transition-opacity duration-150',
              backwards ? 'stroke-critical text-critical' : lit ? 'stroke-accent text-accent' : 'stroke-ink-faint/60 text-ink-faint/60',
              faded && 'opacity-20',
            )}
          />
        )
      })}
    </svg>
  )
}
