/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useParams } from 'react-router-dom'
import type { CardColumn } from '@solera/protocol'
import { cx } from '@solera/ui'
import { COLUMN_DOTS } from '../../components/board/columns'
import { elapsed } from '../../lib/dates'
import {
  COLUMN_WORD,
  inMilestone,
  matches,
  useBoardData,
  useOpenFiche,
  type BoardCard,
  type ExternalControls,
  type MilestoneFilter,
} from './data'
import { CardFlags, DueLabel, LiveAgents, SubtaskBar, Toggle, Toolbar, type SharedView } from './parts'

type SortKey = 'state' | 'number' | 'title' | 'due' | 'updated'
const COLUMN_RANK: Record<CardColumn, number> = { review: 0, in_progress: 1, todo: 2, done: 3, abandoned: 4 }

/** Grille commune à l'en-tête et aux lignes, pour des colonnes alignées au pixel. */
const GRID = 'grid grid-cols-[4.5rem_minmax(0,1fr)_7rem_5.5rem_5rem_6.5rem_4.5rem] items-center gap-3'

/**
 * **Liste** : le board en table dense, groupée par jalon, triable, pilotable au clavier.
 * ↑↓ (ou j/k) se déplacent, Entrée ouvre la fiche, 1 à 4 rangent la carte (à faire, en
 * cours, à relire, fait) — en local dans le proto.
 */
export function ListVariant({ shared, external, onlyColumn }: { shared?: SharedView; external?: ExternalControls; onlyColumn?: CardColumn | null } = {}) {
  const { projectId } = useParams()
  const data = useBoardData(projectId)
  const open = useOpenFiche()
  const [ownQuery, setOwnQuery] = useState('')
  const [ownFilter, setOwnFilter] = useState<MilestoneFilter>(null)
  const query = shared?.query ?? ownQuery
  const setQuery = shared?.setQuery ?? setOwnQuery
  const filter = shared ? shared.filter : ownFilter
  const setFilter = shared?.setFilter ?? setOwnFilter
  const [ownClosed, setClosed] = useState(false)
  const closed = external ? external.display.done !== 'hidden' || external.display.abandoned || onlyColumn === 'done' : ownClosed
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'state', desc: false })
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [cursor, setCursor] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const groups = useMemo(() => {
    const visible = data.cards.filter(
      (entry) =>
        (external ? external.predicate(entry) : matches(entry, query) && inMilestone(entry, filter)) &&
        (onlyColumn ? entry.column === onlyColumn : closed || (entry.column !== 'done' && entry.column !== 'abandoned')) &&
        (!external || external.display.abandoned || entry.column !== 'abandoned' || onlyColumn === 'abandoned'),
    )
    const compare = (a: BoardCard, b: BoardCard): number => {
      const sign = sort.desc ? -1 : 1
      switch (sort.key) {
        case 'state':
          return sign * (Number(b.waiting) - Number(a.waiting) || COLUMN_RANK[a.column] - COLUMN_RANK[b.column] || b.card.columnSince - a.card.columnSince)
        case 'number':
          return sign * (a.card.number - b.card.number)
        case 'title':
          return sign * a.card.title.localeCompare(b.card.title)
        case 'due':
          return sign * ((a.card.dueAt ?? Infinity) - (b.card.dueAt ?? Infinity))
        case 'updated':
          return sign * (b.card.updatedAt - a.card.updatedAt)
      }
    }
    return [
      ...data.milestones.map((milestone) => ({ key: milestone.card.id, milestone, entries: visible.filter((entry) => entry.milestone?.card.id === milestone.card.id) })),
      { key: 'none', milestone: null, entries: visible.filter((entry) => entry.milestone === null) },
    ]
      .filter((group) => group.entries.length > 0)
      .map((group) => ({ ...group, entries: [...group.entries].sort(compare) }))
  }, [data.cards, data.milestones, query, filter, closed, sort, external, onlyColumn])

  const rows = groups.flatMap((group) => (folded.has(group.key) ? [] : group.entries))

  useEffect(() => {
    if (cursor === null) return
    list.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const onKey = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).closest('input, textarea')) return
    const index = rows.findIndex((entry) => entry.card.id === cursor)
    const at = (next: number) => {
      const entry = rows[Math.max(0, Math.min(rows.length - 1, next))]
      if (entry) setCursor(entry.card.id)
    }
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault()
      at(index + 1)
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault()
      at(index - 1)
    } else if (event.key === 'Enter' && rows[index]) {
      open(rows[index]!.card.number)
    } else if (['1', '2', '3', '4'].includes(event.key) && rows[index]) {
      data.move(rows[index]!.card.id, (['todo', 'in_progress', 'review', 'done'] as const)[Number(event.key) - 1]!)
    }
  }

  const header = (key: SortKey, label: string, className?: string) => (
    <button
      type="button"
      onClick={() => setSort((current) => ({ key, desc: current.key === key ? !current.desc : false }))}
      className={cx('flex items-center gap-1 text-left hover:text-ink', sort.key === key && 'text-ink', className)}
    >
      {label}
      {sort.key === key ? sort.desc ? <ArrowDown size={11} /> : <ArrowUp size={11} /> : null}
    </button>
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {external ? null : (
        <Toolbar data={data} query={query} onQuery={setQuery} filter={filter} onFilter={setFilter} view={shared?.view}>
          <Toggle on={closed} onChange={setClosed}>Fermées</Toggle>
        </Toolbar>
      )}

      <div
        ref={list}
        tabIndex={0}
        onKeyDown={onKey}
        className="min-h-0 flex-1 overflow-auto px-4 pb-6 outline-none md:px-6"
        aria-label="Cartes du tableau"
      >
        <div className="min-w-[46rem]">
          <div className={cx(GRID, 'sticky top-0 z-10 h-9 border-b border-line bg-canvas text-xs text-ink-faint')}>
            {header('state', 'État')}
            {header('title', 'Titre')}
            <span>Signal</span>
            <span>Sous-tâches</span>
            <span>Sessions</span>
            {header('due', 'Échéance')}
            {header('updated', 'Vu', 'justify-end')}
          </div>

          {groups.map((group) => {
            const isFolded = folded.has(group.key)
            const done = group.milestone ? group.milestone.done : 0
            const total = group.milestone ? group.milestone.leaves.length : group.entries.length
            return (
              <section key={group.key}>
                <button
                  type="button"
                  onClick={() =>
                    setFolded((current) => {
                      const next = new Set(current)
                      if (next.has(group.key)) next.delete(group.key)
                      else next.add(group.key)
                      return next
                    })
                  }
                  className="mt-4 flex h-8 w-full items-center gap-2 text-left text-sm"
                >
                  {isFolded ? <ChevronRight size={14} className="text-ink-faint" /> : <ChevronDown size={14} className="text-ink-faint" />}
                  {group.milestone ? <span aria-hidden className={cx('size-2 rounded-full', group.milestone.tint.dot)} /> : null}
                  <span className="font-medium">{group.milestone ? group.milestone.card.title : 'Sans jalon'}</span>
                  <span className="text-xs tabular-nums text-ink-faint">
                    {group.milestone ? `${done}/${total} faites` : `${total}`}
                  </span>
                </button>
                {isFolded ? null : (
                  <ul>
                    {group.entries.map((entry) => (
                      <Row key={entry.card.id} entry={entry} active={cursor === entry.card.id} onSelect={() => setCursor(entry.card.id)} onOpen={() => open(entry.card.number)} />
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
          {groups.length === 0 ? <p className="py-10 text-center text-sm text-ink-faint">Aucune carte ne correspond.</p> : null}
          <p className="mt-6 text-xs text-ink-faint">↑↓ ou j/k pour se déplacer · Entrée ouvre la fiche · 1–4 range la carte (local au proto)</p>
        </div>
      </div>
    </div>
  )
}

function Row({ entry, active, onSelect, onOpen }: { entry: BoardCard; active: boolean; onSelect: () => void; onOpen: () => void }) {
  return (
    <li
      data-row={entry.card.id}
      onClick={() => {
        onSelect()
        onOpen()
      }}
      className={cx(
        GRID,
        'h-10 cursor-pointer border-b border-line/60 text-sm transition-colors hover:bg-surface-high/60',
        active && 'bg-surface-high shadow-[inset_2px_0_0_var(--color-accent)]',
        entry.waiting && !active && 'shadow-[inset_2px_0_0_var(--color-caution)]',
      )}
    >
      <span className="flex items-center gap-1.5 text-xs text-ink-soft">
        <span aria-hidden className={cx('size-2 shrink-0 rounded-full', COLUMN_DOTS[entry.column])} />
        {COLUMN_WORD[entry.column]}
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{entry.card.number}</span>
        <span className={cx('truncate', (entry.column === 'done' || entry.column === 'abandoned') && 'text-ink-faint line-through decoration-line-strong')}>
          {entry.card.title}
        </span>
        {entry.moved ? <span className="shrink-0 text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-300">local</span> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        <CardFlags entry={entry} />
      </span>
      <span>
        <SubtaskBar {...entry.subtasks} />
      </span>
      <span>
        <LiveAgents entry={entry} />
      </span>
      <span>
        <DueLabel entry={entry} />
      </span>
      <span className="text-right text-xs tabular-nums text-ink-faint">{elapsed(entry.card.updatedAt)}</span>
    </li>
  )
}

