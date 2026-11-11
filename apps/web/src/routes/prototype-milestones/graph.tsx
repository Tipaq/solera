/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { CardDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { formatDay } from '../../lib/dates'
import {
  STATE_DOT,
  STATE_LABEL,
  STATE_NODE,
  STATE_STROKE,
  isLate,
  awaitsMe,
  liveSessions,
  stateOf,
  type CardState,
} from './model'
import { cardDestination } from './destination'
import { CardInfoButton } from './CardDrawer'

export type GraphLayout = 'couches' | 'etats'

interface Placed {
  card: CardDto
  x: number
  y: number
}

const SIZES = {
  normal: { w: 232, h: 78, gapX: 76, gapY: 18 },
  compact: { w: 188, h: 58, gapX: 52, gapY: 12 },
}

/** Étage d'une carte : 0 sans bloqueur dans le jalon, sinon un de plus que le plus haut. */
function layersOf(cards: CardDto[]): Map<string, number> {
  const ids = new Set(cards.map((card) => card.id))
  const byId = new Map(cards.map((card) => [card.id, card]))
  const layer = new Map<string, number>()
  const visiting = new Set<string>()
  const visit = (card: CardDto): number => {
    const known = layer.get(card.id)
    if (known !== undefined) return known
    if (visiting.has(card.id)) return 0 // cycle : on coupe
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

const STATE_ORDER: CardState[] = ['todo', 'blocked', 'running', 'review', 'done']

function place(cards: CardDto[], layout: GraphLayout, size: (typeof SIZES)['normal']): Placed[] {
  const columns = new Map<number, CardDto[]>()
  if (layout === 'couches') {
    const layers = layersOf(cards)
    for (const card of cards) {
      const index = layers.get(card.id) ?? 0
      columns.set(index, [...(columns.get(index) ?? []), card])
    }
  } else {
    for (const card of cards) {
      const state = stateOf(card)
      const index = Math.max(0, STATE_ORDER.indexOf(state === 'abandoned' ? 'done' : state))
      columns.set(index, [...(columns.get(index) ?? []), card])
    }
  }

  // Ordre dans une colonne : le barycentre de ses bloqueurs déjà placés, pour limiter
  // les croisements ; à défaut, le numéro.
  const rowOf = new Map<string, number>()
  const placed: Placed[] = []
  const keys = [...columns.keys()].sort((a, b) => a - b)
  for (const key of keys) {
    const column = columns.get(key)!
    const weight = (card: CardDto) => {
      const rows = card.blockedBy.flatMap((blocker) => {
        const row = rowOf.get(blocker.id)
        return row === undefined ? [] : [row]
      })
      return rows.length === 0 ? Infinity : rows.reduce((a, b) => a + b, 0) / rows.length
    }
    column.sort((a, b) => weight(a) - weight(b) || a.number - b.number)
    column.forEach((card, row) => {
      rowOf.set(card.id, row)
      const x = key * (size.w + size.gapX)
      placed.push({ card, x, y: row * (size.h + size.gapY) })
    })
  }
  return placed
}

/**
 * Le graphe des sous-cartes d'un jalon : nœuds colorés par état, arêtes « bloque ».
 *
 * `couches` : de gauche à droite dans l'ordre où le travail peut partir.
 * `etats` : une colonne par état, les arêtes disent ce qui retient quoi.
 */
export function DependencyGraph({
  projectId,
  cards,
  layout,
  compact = false,
  hrefOf,
}: {
  projectId: string
  cards: CardDto[]
  layout: GraphLayout
  compact?: boolean
  hrefOf: (path: string) => string
}) {
  const size = compact ? SIZES.compact : SIZES.normal
  const nodes = useMemo(() => place(cards.filter((card) => card.column !== 'abandoned'), layout, size), [cards, layout, size])
  const at = useMemo(() => new Map(nodes.map((node) => [node.card.id, node])), [nodes])

  const head = layout === 'etats' ? 28 : 0
  const width = Math.max(...nodes.map((node) => node.x + size.w), size.w) + 8
  const height = Math.max(...nodes.map((node) => node.y + size.h), size.h) + head + 8
  const columns = layout === 'etats' ? STATE_ORDER : []

  return (
    <div className="relative" style={{ width, height }}>
      {columns.map((state, index) => (
        <div
          key={state}
          className="absolute top-0 flex items-center gap-1.5 text-xs font-medium tracking-wide text-ink-faint uppercase"
          style={{ left: index * (size.w + size.gapX), width: size.w }}
        >
          <span className={cx('size-2 rounded-full', STATE_DOT[state])} />
          {STATE_LABEL[state]}
          <span className="tabular-nums opacity-70">{nodes.filter((node) => node.x === index * (size.w + size.gapX)).length}</span>
        </div>
      ))}
      {layout === 'etats'
        ? columns.map((state, index) => (
            <div
              key={`bg-${state}`}
              aria-hidden
              className="absolute bottom-0 rounded-xl bg-surface-high/30"
              style={{ left: index * (size.w + size.gapX) - 8, top: head - 4, width: size.w + 16 }}
            />
          ))
        : null}

      <svg aria-hidden className="pointer-events-none absolute top-0 left-0 overflow-visible" width={width} height={height}>
        <defs>
          <marker id="proto-graph-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill="var(--color-ink-faint)" />
          </marker>
        </defs>
        {nodes.flatMap((node) =>
          node.card.blockedBy.flatMap((blocker) => {
            const source = at.get(blocker.id)
            if (!source) return []
            const state = stateOf(source.card)
            const forward = source.x < node.x
            const same = source.x === node.x
            const x1 = forward ? source.x + size.w : same ? source.x + size.w : source.x
            const y1 = source.y + head + size.h / 2
            const x2 = forward ? node.x : same ? node.x + size.w : node.x + size.w
            const y2 = node.y + head + size.h / 2
            const bend = same ? 40 : Math.max(30, Math.abs(x2 - x1) / 2)
            const d = same
              ? `M${x1},${y1} C${x1 + bend},${y1} ${x2 + bend},${y2} ${x2 + 1},${y2}`
              : forward
                ? `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2 - 1},${y2}`
                : `M${x1},${y1} C${x1 - bend},${y1} ${x2 + bend},${y2} ${x2 + 1},${y2}`
            return [
              <path
                key={`${blocker.id}-${node.card.id}`}
                d={d}
                fill="none"
                stroke={STATE_STROKE[state]}
                strokeWidth={1.6}
                strokeOpacity={state === 'done' ? 0.45 : 0.9}
                strokeDasharray={state === 'done' ? undefined : '5 4'}
                markerEnd="url(#proto-graph-arrow)"
              />,
            ]
          }),
        )}
      </svg>

      {nodes.map((node) => (
        <GraphNode
          key={node.card.id}
          card={node.card}
          compact={compact}
          href={hrefOf(cardDestination(projectId, node.card))}
          style={{ left: node.x, top: node.y + head, width: size.w, height: size.h }}
        />
      ))}
    </div>
  )
}

function GraphNode({
  card,
  compact,
  href,
  style,
}: {
  card: CardDto
  compact: boolean
  href: string
  style: React.CSSProperties
}) {
  const state = stateOf(card)
  const live = liveSessions(card)
  const late = isLate(card)
  const blockers = card.blockedBy.filter((blocker) => blocker.column !== 'done' && blocker.column !== 'abandoned')
  const asking = awaitsMe(card)

  return (
    <Link
      to={href}
      style={style}
      className={cx(
        'absolute flex flex-col justify-between gap-0.5 rounded-xl border px-3 py-2 shadow-sm transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent',
        STATE_NODE[state],
        late && 'ring-1 ring-critical/70',
        asking && 'border-caution bg-caution/10 ring-2 ring-caution/30',
      )}
    >
      <span className="flex min-w-0 items-start gap-1.5 text-sm leading-tight">
        <span className={cx('mt-1 size-2 shrink-0 rounded-full', asking ? 'bg-caution' : STATE_DOT[state], !asking && state === 'running' && 'animate-pulse')} />
        <span className="shrink-0 text-xs text-ink-faint tabular-nums">#{card.number}</span>
        <span className={cx('min-w-0 flex-1 text-ink', compact ? 'truncate' : 'line-clamp-2')}>{card.title}</span>
        <CardInfoButton card={card} className="-mt-0.5 -mr-1.5" />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
        <span className={cx('shrink-0', asking && 'font-medium text-caution')}>{asking ? 't’attend' : STATE_LABEL[state]}</span>
        {state === 'blocked' && blockers.length > 0 && !compact ? (
          <span className="truncate text-caution">par {blockers.map((blocker) => `#${blocker.number}`).join(', ')}</span>
        ) : null}
        {card.dueAt !== null ? (
          <span className={cx('ml-auto shrink-0 tabular-nums', late && 'font-medium text-critical')}>{formatDay(card.dueAt)}</span>
        ) : null}
        {live.length > 0 ? (
          <span className={cx('flex shrink-0 items-center gap-0.5', card.dueAt === null && 'ml-auto')}>
            {live.map((session) => (
              <span
                key={session.id}
                title={`${session.title} — ${session.status === 'awaiting_input' ? 'attend ta réponse' : 'au travail'}`}
                className={cx(
                  'flex items-center rounded-full p-0.5 ring-1',
                  session.status === 'awaiting_input' ? 'ring-caution' : 'animate-pulse ring-accent',
                )}
              >
                <AgentIcon agent={session.agent} size={11} />
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </Link>
  )
}
