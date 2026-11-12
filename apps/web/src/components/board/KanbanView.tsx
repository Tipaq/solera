import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CardColumn } from '@solera/protocol'
import { cx } from '@solera/ui'
import {
  LANE_DONE_SHOWN,
  columnSlice,
  laneGroups,
  shownColumns,
  type BoardCard,
  type BoardDisplay,
  type BoardMilestone,
  type LaneGroup,
} from '../../lib/board-model'
import { useTranslate } from '../../lib/i18n'
import { BoardTile, HeldTile } from './BoardTile'
import { COLUMN_DOTS, columnLabel } from './columns'
import { tintDot } from './tints'

export interface KanbanViewProps {
  /** Les tuiles qui passent la recherche et les filtres. */
  entries: BoardCard[]
  milestones: BoardMilestone[]
  display: BoardDisplay
  projectId: string
  onOpen: (number: number) => void
  onMove: (entry: BoardCard, column: CardColumn) => void
  /** « Tout voir » de Fait, quand elle est limitée aux plus récentes. */
  onSeeAllDone: () => void
}

/** Fait et Abandonné : étroites et repliables, elles ne disent que ce qui est fini. */
const isNarrow = (column: CardColumn) => column === 'done' || column === 'abandoned'

/**
 * Ce que le pointeur survole, avec un repli sur le recouvrement des rectangles :
 * `pointerWithin` seul ne rend rien entre deux colonnes, et le geste y paraît mort.
 */
const collisionDetection: CollisionDetection = (args) => {
  const under = pointerWithin(args)
  return under.length > 0 ? under : rectIntersection(args)
}

/**
 * Le Kanban du Tableau (B-4) : des colonnes de largeur fixe, triées selon l'affichage,
 * Fait et Abandonné étroites et repliables, et au choix des **couloirs par jalon**.
 * Glisser une tuile dans une autre colonne la range pour de bon.
 */
export function KanbanView({ entries, milestones, display, projectId, onOpen, onMove, onSeeAllDone }: KanbanViewProps) {
  const [held, setHeld] = useState<BoardCard | null>(null)
  const sensors = useSensors(
    // Un seuil de déplacement, pour qu'un clic reste un clic.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Un appui long, sinon le glissement volerait le défilement.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  )
  const columns = shownColumns(display)

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setHeld(null)
    const entry = entries.find((item) => item.card.id === active.id)
    const column = (over?.data.current as { column?: CardColumn } | undefined)?.column
    if (entry && column && column !== entry.card.column) onMove(entry, column)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={({ active }) => setHeld(entries.find((item) => item.card.id === active.id) ?? null)}
      onDragEnd={onDragEnd}
      onDragCancel={() => setHeld(null)}
    >
      <div data-kanban className="h-full min-h-0 overflow-auto px-4 py-4 md:px-6">
        {display.lanes ? (
          <Lanes
            entries={entries}
            milestones={milestones}
            columns={columns}
            display={display}
            projectId={projectId}
            onOpen={onOpen}
          />
        ) : (
          <div className="flex min-h-full w-max gap-3">
            {columns.map((column) => (
              <Column key={column} column={column} entries={entries} display={display} onOpen={onOpen} onSeeAll={onSeeAllDone} />
            ))}
          </div>
        )}
      </div>
      {/* La tuile suit le pointeur ; à sa place, un creux. */}
      <DragOverlay dropAnimation={null}>{held ? <HeldTile entry={held} showMilestone={!display.lanes} /> : null}</DragOverlay>
    </DndContext>
  )
}

/** Une cible de dépôt : une colonne, ou la cellule d'un couloir. */
function useColumnDrop(id: string, column: CardColumn) {
  return useDroppable({ id, data: { column } })
}

function ColumnHeader({ column, count }: { column: CardColumn; count: number }) {
  return (
    <div className="flex h-8 items-center gap-2 px-1">
      <span aria-hidden className={cx('size-2 rounded-full', COLUMN_DOTS[column])} />
      <span className="text-sm font-medium text-ink">{columnLabel(column)}</span>
      <span className="text-xs tabular-nums text-ink-faint">{count}</span>
    </div>
  )
}

/** Le fond d'une cible de dépôt, éclairé quand une tuile la survole. */
const dropZone = (over: boolean, rest: string) =>
  cx('rounded-xl transition-colors', over ? 'bg-accent-wash/50 ring-1 ring-accent/40' : rest)

function Column({
  column,
  entries,
  display,
  onOpen,
  onSeeAll,
}: {
  column: CardColumn
  entries: BoardCard[]
  display: BoardDisplay
  onOpen: (number: number) => void
  onSeeAll: () => void
}) {
  const t = useTranslate()
  const { setNodeRef, isOver } = useColumnDrop(column, column)
  const [folded, setFolded] = useState(false)
  const { shown, total } = columnSlice(entries, column, display)
  const narrow = isNarrow(column)
  const label = columnLabel(column)

  // Repliée : une bande de 40 px, qui reçoit toujours une tuile.
  if (narrow && folded) {
    return (
      <section ref={setNodeRef} aria-label={label} className={cx('flex w-10 shrink-0 flex-col items-center py-2', dropZone(isOver, 'bg-surface/40'))}>
        <button
          type="button"
          onClick={() => setFolded(false)}
          aria-expanded={false}
          title={t('board.column.unfold', { column: label })}
          className="flex flex-col items-center gap-2 rounded-md px-1 py-1 text-xs text-ink-faint hover:text-ink"
        >
          <span aria-hidden className={cx('size-2 rounded-full', COLUMN_DOTS[column])} />
          <span className="[writing-mode:vertical-rl]">{label} · {total}</span>
        </button>
      </section>
    )
  }

  return (
    <section aria-label={label} className={cx('flex shrink-0 flex-col gap-2', narrow ? 'w-60' : 'w-72')}>
      {narrow ? (
        <button
          type="button"
          onClick={() => setFolded(true)}
          aria-expanded
          title={t('board.column.fold')}
          className="flex h-8 items-center gap-2 rounded-md px-1 text-left hover:bg-surface-high"
        >
          <span aria-hidden className={cx('size-2 rounded-full', COLUMN_DOTS[column])} />
          <span className="text-sm font-medium text-ink">{label}</span>
          <span className="text-xs tabular-nums text-ink-faint">· {total}</span>
          <ChevronRight size={13} aria-hidden className="ml-auto text-ink-faint" />
        </button>
      ) : (
        <ColumnHeader column={column} count={total} />
      )}
      <div ref={setNodeRef} className={cx('flex min-h-24 flex-1 flex-col gap-2 p-1.5', dropZone(isOver, 'bg-surface/50'))}>
        {shown.map((entry) => (
          <BoardTile key={entry.card.id} entry={entry} onOpen={() => onOpen(entry.card.number)} />
        ))}
        {total > shown.length ? (
          <button type="button" onClick={onSeeAll} className="rounded-md py-1.5 text-xs text-ink-faint hover:bg-surface-high hover:text-ink">
            {t('board.column.seeAll', { count: total })}
          </button>
        ) : null}
        {total === 0 ? <p className="px-2 py-1 text-meta text-ink-faint/70">{t('board.column.quietEmpty')}</p> : null}
      </div>
    </section>
  )
}

/**
 * Les **couloirs par jalon** (B-4.7) : une rangée par jalon qui a des feuilles ouvertes,
 * ses colonnes alignées sur la rangée d'en-têtes collante, puis ce qui n'a pas de jalon.
 */
function Lanes({
  entries,
  milestones,
  columns,
  display,
  projectId,
  onOpen,
}: {
  entries: BoardCard[]
  milestones: BoardMilestone[]
  columns: CardColumn[]
  display: BoardDisplay
  projectId: string
  onOpen: (number: number) => void
}) {
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = (key: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  return (
    <div className="flex w-max min-w-full flex-col">
      <div className="sticky top-0 z-10 flex gap-3 bg-canvas pb-2">
        {columns.map((column) => (
          <div key={column} className="w-72 shrink-0">
            <ColumnHeader column={column} count={entries.filter((entry) => entry.card.column === column).length} />
          </div>
        ))}
      </div>
      {laneGroups(entries, milestones).map((group) => (
        <Lane
          key={group.key}
          group={group}
          columns={columns}
          display={display}
          projectId={projectId}
          folded={folded.has(group.key)}
          onToggle={() => toggle(group.key)}
          onOpen={onOpen}
        />
      ))}
    </div>
  )
}

function Lane({
  group,
  columns,
  display,
  projectId,
  folded,
  onToggle,
  onOpen,
}: {
  group: LaneGroup
  columns: CardColumn[]
  display: BoardDisplay
  projectId: string
  folded: boolean
  onToggle: () => void
  onOpen: (number: number) => void
}) {
  const t = useTranslate()
  const { milestone } = group
  const waiting = group.entries.filter((entry) => entry.waiting).length
  const title = milestone ? milestone.card.title : t('board.lane.none')
  return (
    <section aria-label={title} className="border-t border-line py-3">
      <div className="sticky left-0 mb-2 flex w-fit max-w-[calc(100vw-4rem)] items-center gap-2">
        <button type="button" onClick={onToggle} aria-expanded={!folded} className="flex min-w-0 items-center gap-2 rounded-md py-0.5 pr-2 text-sm hover:bg-surface-high">
          {folded ? <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-faint" /> : <ChevronDown size={14} aria-hidden className="shrink-0 text-ink-faint" />}
          {milestone ? <span aria-hidden style={tintDot(milestone.tint)} className="size-2 shrink-0 rounded-full" /> : null}
          <span className="truncate font-medium">{title}</span>
        </button>
        {milestone ? (
          <>
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">
              {milestone.done}/{milestone.leaves.length}
            </span>
            <span className="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-surface-high">
              <span
                className="block h-full rounded-full"
                style={{ ...tintDot(milestone.tint), width: `${(milestone.done / Math.max(milestone.leaves.length, 1)) * 100}%` }}
              />
            </span>
            {waiting > 0 ? <span className="shrink-0 text-xs font-medium text-caution">{t('board.lane.waiting', { count: waiting })}</span> : null}
            <Link to={`/p/${projectId}/timeline/${milestone.card.number}`} className="shrink-0 text-xs text-ink-faint hover:text-ink">
              {t('board.lane.open')}
            </Link>
          </>
        ) : null}
      </div>
      {folded ? null : (
        <div className="flex gap-3">
          {columns.map((column) => (
            <LaneCell key={column} laneKey={group.key} column={column} entries={group.entries} display={display} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}

function LaneCell({
  laneKey,
  column,
  entries,
  display,
  onOpen,
}: {
  laneKey: string
  column: CardColumn
  entries: BoardCard[]
  display: BoardDisplay
  onOpen: (number: number) => void
}) {
  const t = useTranslate()
  const { setNodeRef, isOver } = useColumnDrop(`${laneKey}:${column}`, column)
  const [all, setAll] = useState(false)
  const { shown, total } = columnSlice(entries, column, display, all ? Infinity : LANE_DONE_SHOWN)
  return (
    <div ref={setNodeRef} data-lane-cell={column} className={cx('flex min-h-14 w-72 shrink-0 flex-col gap-2 p-1.5', dropZone(isOver, 'bg-surface/40'))}>
      {shown.map((entry) => (
        <BoardTile key={entry.card.id} entry={entry} showMilestone={false} onOpen={() => onOpen(entry.card.number)} />
      ))}
      {total > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className="rounded-md py-1 text-xs text-ink-faint hover:bg-surface-high hover:text-ink">
          {t('board.lane.more', { count: total - shown.length })}
        </button>
      ) : null}
    </div>
  )
}
