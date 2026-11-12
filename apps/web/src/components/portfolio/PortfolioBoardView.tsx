import { useState } from 'react'
import type { CardColumn } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { doneCut, listRows, openColumn, type LaneMode, type PortfolioEntry, type PortfolioLane } from '../../lib/portfolio-board'
import { useTranslate } from '../../lib/i18n'
import { StillTile } from '../board/BoardTile'
import { columnLabel } from '../board/columns'
import { tintDot } from '../board/tints'
import { ProjectGroupHeader, ProjectPip } from '../places/ProjectPip'

export type PortfolioView = 'kanban' | 'liste'

/** Les quatre colonnes du portefeuille : l'abandon est un classement, pas une étape. */
const COLUMNS: readonly CardColumn[] = ['todo', 'in_progress', 'review', 'done']

/**
 * Le Tableau du portefeuille (`coque.md` PF-23 à PF-25) : ses couloirs, chacun en Kanban
 * ou en Liste. Les tuiles sont celles du Tableau d'un projet, sans glisser : chaque
 * projet range ses cartes chez lui. La pastille du projet coiffe la tuile hors couloirs
 * par projet, le jalon s'y lit hors couloirs par jalon. Un clic passe par `onOpen`.
 */
export function PortfolioBoardView({
  lanes,
  mode,
  view,
  onOpen,
}: {
  lanes: PortfolioLane[]
  mode: LaneMode
  view: PortfolioView
  onOpen: (entry: PortfolioEntry) => void
}) {
  /* « Tout voir » de Fait se déplie couloir par couloir. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())
  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      {lanes.map((lane) => (
        <section key={lane.key} data-lane={lane.key} aria-label={laneName(lane)} className="flex flex-col gap-2">
          <LaneHeader lane={lane} mode={mode} />
          {view === 'kanban' ? (
            <LaneKanban
              lane={lane}
              mode={mode}
              allDone={unfolded.has(lane.key)}
              onSeeAllDone={() => setUnfolded((current) => new Set(current).add(lane.key))}
              onOpen={onOpen}
            />
          ) : (
            <LaneList lane={lane} onOpen={onOpen} />
          )}
        </section>
      ))}
    </div>
  )
}

function laneName(lane: PortfolioLane): string | undefined {
  if (lane.milestone) return `#${lane.milestone.card.number} ${lane.milestone.card.title}`
  return lane.project?.name
}

/** L'en-tête d'un couloir : le projet, ou le jalon avec son projet et son avancement, ou « Sans jalon ». */
function LaneHeader({ lane, mode }: { lane: PortfolioLane; mode: LaneMode }) {
  const t = useTranslate()
  if (mode === 'none') return null
  if (mode === 'project' && lane.project) {
    return <ProjectGroupHeader project={lane.project} count={lane.entries.filter((entry) => entry.card.column !== 'done').length} />
  }
  const { milestone } = lane
  if (!milestone) return <h2 className="py-1 text-sm font-medium text-ink-soft">{t('board.lane.none')}</h2>
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 py-1">
      <span aria-hidden style={tintDot(milestone.tint)} className="size-2 shrink-0 rounded-full" />
      <h2 className="min-w-0 truncate text-sm font-medium text-ink" title={milestone.card.title}>
        <span className="tabular-nums">#{milestone.card.number}</span> {milestone.card.title}
      </h2>
      <ProjectPip project={milestone.project} />
      <span className="text-xs tabular-nums text-ink-faint">
        {milestone.done}/{milestone.leaves.length}
      </span>
    </div>
  )
}

/** Quatre colonnes au fond creusé, Fait plus étroite ; la page défile de côté au téléphone. */
function LaneKanban({
  lane,
  mode,
  allDone,
  onSeeAllDone,
  onOpen,
}: {
  lane: PortfolioLane
  mode: LaneMode
  allDone: boolean
  onSeeAllDone: () => void
  onOpen: (entry: PortfolioEntry) => void
}) {
  const t = useTranslate()
  return (
    <div className="overflow-x-auto">
      <div className="grid w-max grid-cols-[repeat(3,16rem)_14rem] gap-3 md:w-auto md:grid-cols-[repeat(3,minmax(14rem,1fr))_minmax(12rem,0.8fr)]">
        {COLUMNS.map((column) => {
          const total = lane.entries.filter((entry) => entry.card.column === column).length
          const shown = column === 'done' ? doneCut(lane.entries, allDone).shown : openColumn(lane.entries, column)
          return (
            <div key={column} data-column={column} className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface/40 p-2">
              <div className="flex items-center gap-2 px-1 text-xs font-medium text-ink-soft">
                {columnLabel(column)} <span className="tabular-nums text-ink-faint">{total}</span>
              </div>
              {shown.length === 0 ? <p className="px-1 py-2 text-xs text-ink-faint">{t('board.column.quietEmpty')}</p> : null}
              {shown.map((entry) => (
                <div key={entry.card.id} className="flex flex-col gap-1">
                  {mode !== 'project' ? <ProjectPip project={entry.project} className="px-1" /> : null}
                  <StillTile entry={entry} showMilestone={mode !== 'milestone'} onOpen={() => onOpen(entry)} />
                </div>
              ))}
              {total > shown.length ? (
                <Button variant="ghost" size="sm" onClick={onSeeAllDone}>
                  {t('board.column.seeAll', { count: total })}
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** La Liste d'un couloir, sans les faites : état, projet, carte, jalon. */
function LaneList({ lane, onOpen }: { lane: PortfolioLane; onOpen: (entry: PortfolioEntry) => void }) {
  const t = useTranslate()
  const rows = listRows(lane.entries)
  if (rows.length === 0) return null
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {rows.map((entry) => (
        <li key={entry.card.id}>
          <button
            type="button"
            data-card-tile={entry.card.number}
            onClick={() => onOpen(entry)}
            className="grid min-h-9 w-full grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-3 px-3 py-2 text-left hover:bg-surface-high/40 pointer-coarse:min-h-11 sm:grid-cols-[6rem_9rem_minmax(0,1fr)_10rem] sm:gap-4"
          >
            <span className={cx('truncate text-xs', entry.waiting ? 'font-medium text-caution' : 'text-ink-faint')}>
              {entry.waiting ? t('board.tile.waiting') : columnLabel(entry.card.column)}
            </span>
            {/* Au téléphone, le couloir dit déjà le projet ; la ligne garde sa place au titre. */}
            <span className="hidden min-w-0 sm:block">
              <ProjectPip project={entry.project} plain />
            </span>
            <span className="min-w-0 truncate text-sm">
              <span className="text-xs tabular-nums text-ink-faint">#{entry.card.number}</span> {entry.card.title}
            </span>
            <span className="hidden truncate text-xs text-ink-faint sm:block" title={entry.milestone?.card.title}>
              {entry.milestone ? t('portfolio.board.milestone', { number: entry.milestone.card.number }) : '—'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
