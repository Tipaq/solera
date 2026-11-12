import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { CardColumn } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import {
  DEFAULT_LIST_SORT,
  listGroups,
  listDoneCut,
  nextListSort,
  type BoardCard,
  type BoardDisplay,
  type BoardMilestone,
  type ListSort,
  type ListSortKey,
} from '../../lib/board-model'
import { isOpen } from '../../lib/card-state'
import { elapsed } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { CardFlags, DueLabel, LiveAgents, SubtaskBar } from './BoardTile'
import { COLUMN_DOTS, columnLabel } from './columns'
import { tintDot } from './tints'

export interface ListViewProps {
  /** Les tuiles qui passent la recherche et les filtres. */
  entries: BoardCard[]
  milestones: BoardMilestone[]
  display: BoardDisplay
  /** Le filtre « colonne », posé par « Tout voir » de Fait : toute sa colonne se montre. */
  column: CardColumn | null
  onOpen: (number: number) => void
  onMove: (entry: BoardCard, column: CardColumn) => void
  /** « Tout voir » des faites que « Les 5 récentes » laisse de côté. */
  onSeeAllDone: () => void
}

/** Les colonnes que rangent les touches 1 à 4. */
const KEY_COLUMNS: readonly CardColumn[] = ['todo', 'in_progress', 'review', 'done']

/** Grille commune à l'en-tête et aux lignes, pour des colonnes alignées au pixel. */
const GRID = 'grid grid-cols-[4.5rem_minmax(0,1fr)_7rem_5.5rem_5rem_6.5rem_4.5rem] items-center gap-3'

/**
 * La **Liste** du Tableau (B-5) : une table dense groupée par jalon, triée par ses
 * en-têtes, pilotée au clavier. ↑↓ ou j/k déplacent la sélection, Entrée ouvre la fiche,
 * 1 à 4 rangent la carte pour de bon (à faire, en cours, à relire, fait).
 */
export function ListView({ entries, milestones, display, column, onOpen, onMove, onSeeAllDone }: ListViewProps) {
  const t = useTranslate()
  const [sort, setSort] = useState<ListSort>(DEFAULT_LIST_SORT)
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [cursor, setCursor] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const groups = listGroups(entries, milestones, display, column, sort)
  const rows = groups.flatMap((group) => (folded.has(group.key) ? [] : group.entries))
  const doneTotal = listDoneCut(entries, display, column)

  useEffect(() => {
    if (cursor === null) return
    list.current?.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const onKey = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    // Un en-tête de tri ou de groupe garde la main sur la liste, sauf pour Entrée qui l'active.
    const onControl = event.target !== event.currentTarget
    const index = rows.findIndex((entry) => entry.card.id === cursor)
    const at = (next: number) => {
      const entry = rows[Math.max(0, Math.min(rows.length - 1, next))]
      if (entry) setCursor(entry.card.id)
    }
    const current = rows[index]
    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault()
      at(index + 1)
    } else if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault()
      at(index - 1)
    } else if (event.key === 'Enter' && current && !onControl) {
      event.preventDefault()
      onOpen(current.card.number)
    } else if (current && /^[1-4]$/.test(event.key)) {
      event.preventDefault()
      const target = KEY_COLUMNS[Number(event.key) - 1]!
      if (target !== current.card.column) onMove(current, target)
    }
  }

  const toggle = (key: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const header = (key: ListSortKey, label: string, className?: string) => (
    <button
      type="button"
      onClick={() => setSort((current) => nextListSort(current, key))}
      className={cx('flex items-center gap-1 text-left hover:text-ink', sort.key === key && 'text-ink', className)}
    >
      {label}
      {sort.key === key ? sort.desc ? <ArrowDown size={11} aria-hidden /> : <ArrowUp size={11} aria-hidden /> : null}
    </button>
  )

  return (
    <div
      ref={list}
      data-board-list
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={t('board.list.label')}
      className="h-full min-h-0 overflow-auto px-4 pb-6 outline-none md:px-6"
    >
      <div className="min-w-[46rem]">
        <div className={cx(GRID, 'sticky top-0 z-10 h-9 border-b border-line bg-canvas text-xs text-ink-faint')}>
          {header('state', t('board.list.state'))}
          {header('title', t('board.list.title'))}
          <span>{t('board.list.signal')}</span>
          <span>{t('board.list.subtasks')}</span>
          <span>{t('board.list.sessions')}</span>
          {header('due', t('board.list.due'))}
          {header('seen', t('board.list.seen'), 'justify-end')}
        </div>

        {groups.map((group) => {
          const isFolded = folded.has(group.key)
          const { milestone } = group
          const title = milestone ? milestone.card.title : t('board.lane.none')
          return (
            <section key={group.key} aria-label={title}>
              <button
                type="button"
                onClick={() => toggle(group.key)}
                aria-expanded={!isFolded}
                className="mt-4 flex h-8 w-full items-center gap-2 text-left text-sm"
              >
                {isFolded ? <ChevronRight size={14} aria-hidden className="text-ink-faint" /> : <ChevronDown size={14} aria-hidden className="text-ink-faint" />}
                {milestone ? <span aria-hidden style={tintDot(milestone.tint)} className="size-2 shrink-0 rounded-full" /> : null}
                <span className="truncate font-medium">{title}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                  {milestone ? t('board.list.done', { done: milestone.done, total: milestone.leaves.length }) : group.entries.length}
                </span>
              </button>
              {isFolded ? null : (
                <ul>
                  {group.entries.map((entry) => (
                    <Row
                      key={entry.card.id}
                      entry={entry}
                      active={cursor === entry.card.id}
                      onOpen={() => {
                        setCursor(entry.card.id)
                        onOpen(entry.card.number)
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
        {groups.length === 0 ? <p className="py-10 text-center text-sm text-ink-faint">{t('board.list.empty')}</p> : null}
        {doneTotal !== null ? (
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={onSeeAllDone}>
              {t('board.column.seeAll', { count: doneTotal })}
            </Button>
          </div>
        ) : null}
        <p className="mt-6 text-xs text-ink-faint">{t('board.list.help')}</p>
      </div>
    </div>
  )
}

function Row({ entry, active, onOpen }: { entry: BoardCard; active: boolean; onOpen: () => void }) {
  const { card } = entry
  return (
    <li
      data-row={card.id}
      data-card-tile={card.number}
      aria-current={active || undefined}
      onClick={onOpen}
      className={cx(
        GRID,
        'h-10 cursor-pointer border-b border-line/60 text-sm transition-colors hover:bg-surface-high/60',
        active && 'bg-surface-high shadow-[inset_2px_0_0_var(--sg-accent)]',
        entry.waiting && !active && 'shadow-[inset_2px_0_0_var(--sg-caution)]',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
        <span aria-hidden className={cx('size-2 shrink-0 rounded-full', COLUMN_DOTS[card.column])} />
        <span className="truncate">{columnLabel(card.column)}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{card.number}</span>
        <span data-row-title className={cx('truncate', !isOpen(card) && 'text-ink-faint line-through decoration-line-strong')}>{card.title}</span>
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
      <span className="text-right text-xs tabular-nums text-ink-faint">{elapsed(card.updatedAt)}</span>
    </li>
  )
}
