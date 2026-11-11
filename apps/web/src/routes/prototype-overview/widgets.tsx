/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les petites pièces que plusieurs variantes dessinent : le mini-graphe d'un jalon, le
 * point d'une session, la puce d'une PR. Des widgets, pas une mise en page.
 */
import { ArrowDown, ArrowUp, CircleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { CardColumn, CardDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import type { SessionMarker } from '../../components/project/SessionRow'
import type { Milestone } from '../../lib/timeline'
import type { CodeLine } from './data'
import { cardDestination } from '../prototype-milestones/destination'

export const COLUMN_WORD: Record<CardColumn, string> = {
  todo: 'À faire',
  in_progress: 'En cours',
  review: 'À relire',
  done: 'Terminée',
  abandoned: 'Abandonnée',
}

const NODE_TONE: Record<CardColumn, string> = {
  todo: 'border-line bg-surface text-ink-soft',
  in_progress: 'border-accent bg-accent/10 text-ink',
  review: 'border-caution bg-caution/10 text-ink',
  done: 'border-positive/50 bg-positive/10 text-ink-faint',
  abandoned: 'border-line border-dashed bg-transparent text-ink-faint line-through',
}

export const COLUMN_DOT: Record<CardColumn, string> = {
  todo: 'bg-line-strong',
  in_progress: 'bg-accent',
  review: 'bg-caution',
  done: 'bg-positive',
  abandoned: 'bg-line',
}

const MARKER_DOT: Record<SessionMarker, string> = {
  working: 'bg-accent animate-pulse',
  awaiting: 'bg-caution',
  broken: 'bg-critical',
  unread: 'bg-ink',
  review: 'bg-positive',
  quiet: 'bg-line-strong',
}

export function SessionDot({ marker, className }: { marker: SessionMarker; className?: string }) {
  return <span aria-hidden className={cx('inline-block size-2 shrink-0 rounded-full', MARKER_DOT[marker], className)} />
}

/** Avance / retard sur la branche par défaut, et l'état du disque, en chiffres serrés. */
export function DriftFigures({ line }: { line: CodeLine }) {
  return (
    <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-ink-faint">
      {line.root ? null : (
        <>
          <span className={cx('flex items-center gap-0.5', line.ahead > 0 && 'text-ink-soft')} title="Commits d'avance">
            <ArrowUp size={11} />{line.ahead}
          </span>
          <span className={cx('flex items-center gap-0.5', line.behind > 10 && 'text-caution')} title="Commits de retard">
            <ArrowDown size={11} />{line.behind}
          </span>
        </>
      )}
      {line.dirty > 0 ? <span className="text-caution" title="Fichiers non commités">●{line.dirty}</span> : null}
      {line.conflicts ? <CircleAlert size={12} className="text-critical" aria-label="Conflit avec la base" /> : null}
    </span>
  )
}

/**
 * Le mini-graphe d'un jalon : ses cartes en nœuds, ses liens « bloque » en flèches.
 *
 * Mise en couches par plus long chemin. Sans aucun lien entre ses cartes, le graphe n'a
 * rien à dire de l'ordre : il se replie en couloirs d'état (à faire → en cours → à relire
 * → terminé), ce qui reste lisible au lieu d'une colonne unique de vingt nœuds.
 */
export function MilestoneGraph({
  projectId,
  milestone,
  size = 'md',
}: {
  projectId: string
  milestone: Milestone
  size?: 'sm' | 'md' | 'lg'
}) {
  const geometry = { sm: { w: 120, h: 30, gx: 28, gy: 8 }, md: { w: 168, h: 40, gx: 36, gy: 10 }, lg: { w: 200, h: 48, gx: 44, gy: 12 } }[size]
  const nodes = milestone.cards
  const ids = new Set(nodes.map((card) => card.id))
  const edges: [string, string][] = []
  for (const card of nodes) {
    for (const blocker of card.blockedBy) if (ids.has(blocker.id)) edges.push([blocker.id, card.id])
  }

  const level = new Map<string, number>()
  if (edges.length > 0) {
    const preds = new Map<string, string[]>()
    for (const [from, to] of edges) preds.set(to, [...(preds.get(to) ?? []), from])
    const depth = (id: string, seen: Set<string>): number => {
      if (level.has(id)) return level.get(id)!
      if (seen.has(id)) return 0
      seen.add(id)
      const value = Math.max(-1, ...(preds.get(id) ?? []).map((pred) => depth(pred, seen))) + 1
      level.set(id, value)
      return value
    }
    for (const card of nodes) depth(card.id, new Set())
  } else {
    const lane: Record<CardColumn, number> = { todo: 0, in_progress: 1, review: 2, done: 3, abandoned: 3 }
    for (const card of nodes) level.set(card.id, lane[card.column])
  }

  const columns = new Map<number, CardDto[]>()
  for (const card of nodes) {
    const at = level.get(card.id) ?? 0
    columns.set(at, [...(columns.get(at) ?? []), card])
  }
  const levels = [...columns.keys()].sort((a, b) => a - b)
  const position = new Map<string, { x: number; y: number }>()
  levels.forEach((at, index) => {
    columns.get(at)!.forEach((card, row) => {
      position.set(card.id, { x: index * (geometry.w + geometry.gx), y: row * (geometry.h + geometry.gy) })
    })
  })
  const width = levels.length * (geometry.w + geometry.gx) - geometry.gx
  const height = Math.max(...[...columns.values()].map((list) => list.length)) * (geometry.h + geometry.gy) - geometry.gy

  return (
    <div className="min-w-0 overflow-x-auto pb-1">
      {edges.length === 0 ? (
        <div className="mb-1.5 flex gap-0 text-meta tracking-wide text-ink-faint uppercase" style={{ width }}>
          {levels.map((at) => (
            <span key={at} style={{ width: geometry.w + geometry.gx }}>
              {['À faire', 'En cours', 'À relire', 'Terminé'][at]}
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative" style={{ width, height }}>
        <svg className="pointer-events-none absolute inset-0 overflow-visible" width={width} height={height} aria-hidden>
          <defs>
            <marker id={`arrow-${size}`} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L6,3 L0,6 z" className="fill-ink-faint" />
            </marker>
          </defs>
          {edges.map(([from, to]) => {
            const a = position.get(from)!
            const b = position.get(to)!
            const x1 = a.x + geometry.w
            const y1 = a.y + geometry.h / 2
            const x2 = b.x - 2
            const y2 = b.y + geometry.h / 2
            const mid = (x1 + x2) / 2
            return (
              <path
                key={`${from}-${to}`}
                d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                className="fill-none stroke-line-strong"
                strokeWidth={1.25}
                markerEnd={`url(#arrow-${size})`}
              />
            )
          })}
        </svg>
        {nodes.map((card) => {
          const at = position.get(card.id)!
          const working = card.conversations.some((conversation) => conversation.status === 'running')
          return (
            <Link
              key={card.id}
              to={cardDestination(projectId, card)}
              title={`#${card.number} ${card.title} — ${COLUMN_WORD[card.column]}`}
              className={cx(
                'absolute flex items-center gap-1.5 overflow-hidden rounded-md border px-2 transition-colors hover:border-ink-faint',
                size === 'sm' ? 'text-xs' : 'text-sm',
                NODE_TONE[card.column],
              )}
              style={{ left: at.x, top: at.y, width: geometry.w, height: geometry.h }}
            >
              {working ? <SessionDot marker="working" /> : null}
              <span className="shrink-0 text-xs tabular-nums opacity-60">#{card.number}</span>
              <span className="min-w-0 truncate">{card.title}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

/** La barre d'avancement d'un jalon, segmentée par état plutôt qu'un simple pourcentage. */
export function MilestoneBar({ milestone, className }: { milestone: Milestone; className?: string }) {
  const total = milestone.cards.length || 1
  const order: CardColumn[] = ['done', 'review', 'in_progress', 'todo']
  return (
    <div className={cx('flex h-2 overflow-hidden rounded-full bg-surface-high', className)}>
      {order.map((column) => {
        const count = milestone.cards.filter((card) => card.column === column).length
        if (count === 0) return null
        return <div key={column} className={COLUMN_DOT[column]} style={{ width: `${(count / total) * 100}%` }} title={`${count} ${COLUMN_WORD[column]}`} />
      })}
    </div>
  )
}
