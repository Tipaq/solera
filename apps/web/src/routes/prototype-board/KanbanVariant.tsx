/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ChevronDown, ChevronRight, Rows3 } from 'lucide-react'
import { useState, type DragEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { CardColumn } from '@solera/protocol'
import { cx } from '@solera/ui'
import { COLUMN_DOTS } from '../../components/board/columns'
import { useProtoHref } from '../prototype-milestones/model'
import {
  ALL_COLUMNS,
  COLUMN_WORD,
  OPEN_COLUMNS,
  inMilestone,
  matches,
  sortEntries,
  useBoardData,
  useOpenFiche,
  type BoardCard,
  type BoardMilestone,
  type BoardSort,
  type ExternalControls,
  type MilestoneFilter,
} from './data'
import { DRAG_TYPE, Tile, Toggle, Toolbar, type SharedView } from './parts'

/** Les fermées d'une colonne « Fait » montrées avant « N de plus ». */
const DONE_SHOWN = 5

/**
 * **Kanban retravaillé** : des colonnes de largeur fixe, des en-têtes sobres, des tuiles
 * qui disent d'abord ce qui demande un geste. Les cartes-jalons ne sont plus des tuiles
 * (elles regroupaient leurs enfants et comptaient deux fois le travail) : elles
 * deviennent les puces du filtre, et, au choix, des **couloirs**.
 */
export function KanbanVariant({ shared, external }: { shared?: SharedView; external?: ExternalControls } = {}) {
  const { projectId } = useParams()
  const data = useBoardData(projectId)
  const open = useOpenFiche()
  const [ownQuery, setOwnQuery] = useState('')
  const [ownFilter, setOwnFilter] = useState<MilestoneFilter>(null)
  const query = shared?.query ?? ownQuery
  const setQuery = shared?.setQuery ?? setOwnQuery
  const filter = shared ? shared.filter : ownFilter
  const setFilter = shared?.setFilter ?? setOwnFilter
  const [ownLanes, setLanes] = useState(false)
  const [ownClosed, setClosed] = useState(true)
  const [ownAbandoned, setAbandoned] = useState(false)
  const lanes = external ? external.display.lanes : ownLanes
  const closed = external ? external.display.done !== 'hidden' : ownClosed
  const abandoned = external ? external.display.abandoned : ownAbandoned
  const doneMode = external?.display.done ?? 'recent'
  const sort = external?.display.sort ?? 'geste'

  const columns = ALL_COLUMNS.filter((column) => OPEN_COLUMNS.includes(column) || (column === 'done' && closed) || (column === 'abandoned' && abandoned))
  const visible = data.cards.filter((entry) => (external ? external.predicate(entry) : matches(entry, query) && inMilestone(entry, filter)))

  return (
    <div className="flex h-full min-h-0 flex-col">
      {external ? null : (
        <Toolbar data={data} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} view={shared?.view}>
          <Toggle on={lanes} onChange={setLanes}>
            <Rows3 size={13} /> Couloirs par jalon
          </Toggle>
          <Toggle on={closed} onChange={setClosed}>Fait</Toggle>
          <Toggle on={abandoned} onChange={setAbandoned}>Abandonné</Toggle>
        </Toolbar>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
        {lanes ? (
          <Lanes data={visible} milestones={data.milestones} columns={columns} onOpen={open} onMove={data.move} />
        ) : (
          <div className="flex min-h-full gap-3">
            {columns.map((column) => (
              <Column
                key={column}
                column={column}
                entries={visible.filter((entry) => entry.column === column)}
                onOpen={open}
                onMove={data.move}
                sort={sort}
                doneMode={doneMode}
                quiet={external !== undefined}
                onSeeAll={external?.onSeeAllDone}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function useDrop(column: CardColumn, onMove: (cardId: string, column: CardColumn) => void) {
  const [over, setOver] = useState(false)
  return {
    over,
    handlers: {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        setOver(true)
      },
      onDragLeave: () => setOver(false),
      onDrop: (event: DragEvent) => {
        setOver(false)
        const id = event.dataTransfer.getData(DRAG_TYPE)
        if (id) onMove(id, column)
      },
    },
  }
}

/** L'ordre d'une colonne : ce qui t'attend d'abord, puis à accepter, puis le plus récent. */
function ordered(entries: BoardCard[]): BoardCard[] {
  return [...entries].sort(
    (a, b) =>
      Number(b.waiting) - Number(a.waiting) ||
      Number(a.card.acceptedAt !== null) - Number(b.card.acceptedAt !== null) ||
      Number(b.late) - Number(a.late) ||
      b.card.columnSince - a.card.columnSince,
  )
}

function ColumnHeader({ column, count }: { column: CardColumn; count: number }) {
  return (
    <div className="flex h-8 items-center gap-2 px-1">
      <span aria-hidden className={cx('size-2 rounded-full', COLUMN_DOTS[column])} />
      <span className="text-sm font-medium text-ink">{COLUMN_WORD[column]}</span>
      <span className="text-xs tabular-nums text-ink-faint">{count}</span>
    </div>
  )
}

function Column({
  column,
  entries,
  onOpen,
  onMove,
  sort = 'geste',
  doneMode = 'recent',
  quiet = false,
  onSeeAll,
}: {
  column: CardColumn
  entries: BoardCard[]
  onOpen: (number: number) => void
  onMove: (cardId: string, column: CardColumn) => void
  sort?: BoardSort
  doneMode?: 'recent' | 'all' | 'hidden'
  /** Variante `une-ligne` : colonne vide discrète, colonne Fait étroite et repliable. */
  quiet?: boolean
  onSeeAll?: () => void
}) {
  const { over, handlers } = useDrop(column, onMove)
  const [all, setAll] = useState(false)
  const [folded, setFolded] = useState(false)
  const sorted = column === 'done' ? sortEntries(entries, 'recent') : sortEntries(entries, sort)
  const capped = column === 'done' && doneMode === 'recent' && !all ? sorted.slice(0, DONE_SHOWN) : sorted
  const narrow = quiet && (column === 'done' || column === 'abandoned')

  // Fait, repliée : une bande étroite qui garde le dépôt d'une carte.
  if (quiet && narrow && folded) {
    return (
      <section
        {...handlers}
        aria-label={COLUMN_WORD[column]}
        className={cx('flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl py-2', over ? 'bg-accent-wash/50' : 'bg-surface/40')}
      >
        <button type="button" onClick={() => setFolded(false)} title={`Déplier ${COLUMN_WORD[column]}`} className="flex flex-col items-center gap-2 text-xs text-ink-faint hover:text-ink">
          <span aria-hidden className={cx('size-2 rounded-full', COLUMN_DOTS[column])} />
          <span className="[writing-mode:vertical-rl]">{COLUMN_WORD[column]} · {entries.length}</span>
        </button>
      </section>
    )
  }

  return (
    <section className={cx('flex shrink-0 flex-col gap-2', narrow ? 'w-60' : 'w-72')} aria-label={COLUMN_WORD[column]}>
      {narrow ? (
        <button type="button" onClick={() => setFolded(true)} title="Replier" className="flex h-8 items-center gap-2 rounded-md px-1 text-left hover:bg-surface-high">
          <span aria-hidden className={cx('size-2 rounded-full', COLUMN_DOTS[column])} />
          <span className="text-sm font-medium text-ink">{COLUMN_WORD[column]}</span>
          <span className="text-xs tabular-nums text-ink-faint">· {entries.length}</span>
          <ChevronRight size={13} className="ml-auto text-ink-faint" />
        </button>
      ) : (
        <ColumnHeader column={column} count={entries.length} />
      )}
      <div
        {...handlers}
        className={cx(
          'flex min-h-24 flex-1 flex-col gap-2 rounded-xl p-1.5 transition-colors',
          over ? 'bg-accent-wash/50 ring-1 ring-accent/40' : 'bg-surface/50',
        )}
      >
        {capped.map((entry) => (
          <Tile key={entry.card.id} entry={entry} onOpen={() => onOpen(entry.card.number)} />
        ))}
        {sorted.length > capped.length ? (
          <button
            type="button"
            onClick={() => (quiet && onSeeAll ? onSeeAll() : setAll(true))}
            className="rounded-md py-1.5 text-xs text-ink-faint hover:bg-surface-high hover:text-ink"
          >
            {quiet ? `Tout voir (${sorted.length})` : `${sorted.length - capped.length} de plus`}
          </button>
        ) : null}
        {entries.length === 0 ? (
          quiet ? <p className="px-2 py-1 text-[11px] text-ink-faint/70">Vide</p> : <p className="px-2 py-3 text-center text-xs text-ink-faint">Rien ici</p>
        ) : null}
      </div>
    </section>
  )
}

/**
 * Les **couloirs par jalon** : une rangée par jalon ouvert, ses colonnes alignées sur
 * celles du haut, et une dernière rangée pour ce qui n'a pas de jalon. L'en-tête de la
 * rangée dit l'avancement et mène au jalon.
 */
function Lanes({
  data,
  milestones,
  columns,
  onOpen,
  onMove,
}: {
  data: BoardCard[]
  milestones: BoardMilestone[]
  columns: CardColumn[]
  onOpen: (number: number) => void
  onMove: (cardId: string, column: CardColumn) => void
}) {
  const href = useProtoHref()
  const { projectId } = useParams()
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const groups = [
    ...milestones.map((milestone) => ({ key: milestone.card.id, milestone, entries: data.filter((entry) => entry.milestone?.card.id === milestone.card.id) })),
    { key: 'none', milestone: null, entries: data.filter((entry) => entry.milestone === null) },
  ].filter((group) => group.entries.some((entry) => entry.column !== 'done' && entry.column !== 'abandoned'))

  return (
    <div className="flex w-max min-w-full flex-col">
      <div className="sticky top-0 z-10 flex gap-3 bg-canvas pb-2">
        {columns.map((column) => (
          <div key={column} className="w-72 shrink-0">
            <ColumnHeader column={column} count={data.filter((entry) => entry.column === column).length} />
          </div>
        ))}
      </div>
      {groups.map((group) => {
        const isFolded = folded.has(group.key)
        const toggle = () =>
          setFolded((current) => {
            const next = new Set(current)
            if (next.has(group.key)) next.delete(group.key)
            else next.add(group.key)
            return next
          })
        const waiting = group.entries.filter((entry) => entry.waiting).length
        return (
          <section key={group.key} className="border-t border-line py-3">
            <div className="sticky left-0 mb-2 flex w-fit max-w-[calc(100vw-4rem)] items-center gap-2">
              <button type="button" onClick={toggle} className="flex items-center gap-2 rounded-md py-0.5 pr-2 text-sm hover:bg-surface-high">
                {isFolded ? <ChevronRight size={14} className="text-ink-faint" /> : <ChevronDown size={14} className="text-ink-faint" />}
                {group.milestone ? (
                  <span aria-hidden className={cx('size-2 rounded-full', group.milestone.tint.dot)} />
                ) : null}
                <span className="font-medium">{group.milestone ? group.milestone.card.title : 'Sans jalon'}</span>
              </button>
              {group.milestone ? (
                <>
                  <span className="text-xs tabular-nums text-ink-faint">
                    {group.milestone.done}/{group.milestone.leaves.length}
                  </span>
                  <span className="h-1 w-16 overflow-hidden rounded-full bg-surface-high">
                    <span
                      className={cx('block h-full rounded-full', group.milestone.tint.dot)}
                      style={{ width: `${(group.milestone.done / Math.max(group.milestone.leaves.length, 1)) * 100}%` }}
                    />
                  </span>
                  {waiting > 0 ? <span className="text-xs font-medium text-caution">{waiting} t'attend</span> : null}
                  <Link
                    to={href(`/p/${projectId}/timeline/${group.milestone.card.number}`)}
                    className="text-xs text-ink-faint hover:text-ink"
                  >
                    Ouvrir le jalon
                  </Link>
                </>
              ) : null}
            </div>
            {isFolded ? null : (
              <div className="flex gap-3">
                {columns.map((column) => (
                  <LaneCell
                    key={column}
                    column={column}
                    entries={group.entries.filter((entry) => entry.column === column)}
                    onOpen={onOpen}
                    onMove={onMove}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

function LaneCell({
  column,
  entries,
  onOpen,
  onMove,
}: {
  column: CardColumn
  entries: BoardCard[]
  onOpen: (number: number) => void
  onMove: (cardId: string, column: CardColumn) => void
}) {
  const { over, handlers } = useDrop(column, onMove)
  const [all, setAll] = useState(false)
  const sorted = ordered(entries)
  const capped = column === 'done' && !all ? sorted.slice(0, 2) : sorted
  return (
    <div
      {...handlers}
      className={cx('flex min-h-14 w-72 shrink-0 flex-col gap-2 rounded-xl p-1.5 transition-colors', over ? 'bg-accent-wash/50 ring-1 ring-accent/40' : 'bg-surface/40')}
    >
      {capped.map((entry) => (
        <Tile key={entry.card.id} entry={entry} showMilestone={false} onOpen={() => onOpen(entry.card.number)} />
      ))}
      {sorted.length > capped.length ? (
        <button type="button" onClick={() => setAll(true)} className="rounded-md py-1 text-xs text-ink-faint hover:bg-surface-high hover:text-ink">
          {sorted.length - capped.length} de plus
        </button>
      ) : null}
    </div>
  )
}
