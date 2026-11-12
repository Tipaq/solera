import { Link } from 'react-router-dom'
import type { JournalEntryDto, JournalKind } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { BranchDot, VerdictDot, verdictReason } from '../code/VerdictDot'
import { positionOf, timelineTicks, type BarTone, type SessionBar, type Tick, type TimelineWindow } from '../../lib/activity-timeline'
import { shortBranch, type BranchInfo, type TreeRow } from '../../lib/code-model'
import { elapsed, formatDay, relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'

/** Une rangée d'arbre : ses sessions en barres, ses événements en points. */
export interface TimelineTree {
  tree: TreeRow
  bars: SessionBar[]
  events: JournalEntryDto[]
}

/** La teinte d'un événement, par sa nature ; la légende en nomme les principales. */
const EVENT_DOT: Record<JournalKind, string> = {
  session: 'bg-accent',
  run: 'bg-accent',
  branch: 'bg-ink-soft',
  cardOpened: 'bg-loop',
  cardClosed: 'bg-positive',
  note: 'bg-caution',
  audit: 'bg-ink-faint',
}

/** Le fond d'une barre, que la légende reprend, et l'encre de son icône. */
const BAR_FILL: Record<BarTone, string> = {
  running: 'bg-accent/25',
  awaiting: 'bg-caution/25',
  done: 'bg-surface-high',
}
const BAR_INK: Record<BarTone, string> = {
  running: 'text-accent',
  awaiting: 'text-caution',
  done: 'text-ink-faint',
}
const COMMIT_MARK = 'size-2 rotate-45 bg-ink-soft'

/**
 * Les deux lignes de barres dans une rangée de 40 px (`h-10`) : des barres de 16 px
 * (`h-4`), la première à 4 px du haut, la seconde 2 px sous elle.
 */
const BAR_TOP = [4, 22] as const

/** L'étiquette d'une rangée : `w-48`, `w-56` à partir de `md` ; `w-32` au téléphone, où l'axe a besoin de la place. */
const LABEL = 'w-32 shrink-0 sm:w-48 md:w-56'
const pct = (fraction: number) => `${fraction * 100}%`
/** La largeur d'une barre courte : son icône d'agent. */
const BAR_MIN = '1.25rem'

/**
 * La Frise de Travail (`projet.md` T-9) : une rangée par arbre, puis par branche sans
 * arbre, sur l'axe de la fenêtre (la période de « Filtrer », sinon sept jours).
 *
 * - L'axe colle en haut : les minuits datés, « maintenant » en accent à droite.
 * - Un arbre : ses sessions en barres (accent si elle tourne, ambre si elle t'attend,
 *   gris si elle est finie), alternées sur deux lignes, chacune menant à son fil ; ses
 *   événements en points ; le trait de « maintenant ».
 * - Une branche : ses commits en losanges, ou l'âge du dernier quand il est plus vieux
 *   que la fenêtre.
 * - Un clic sur l'étiquette choisit l'arbre ou la branche ; un second le relâche.
 */
export function ActivityTimeline({
  projectId,
  frame,
  trees,
  branches,
  targetKey,
  onSelect,
}: {
  projectId: string
  frame: TimelineWindow
  trees: TimelineTree[]
  branches: BranchInfo[]
  targetKey: string | null
  onSelect: (key: string | null) => void
}) {
  const t = useTranslate()
  const ticks = timelineTicks(frame)
  const x = (at: number) => pct(positionOf(at, frame))
  const toggle = (key: string) => onSelect(key === targetKey ? null : key)

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 flex border-b border-line bg-canvas/95 py-1.5 text-micro text-ink-faint backdrop-blur">
        <span className={LABEL} />
        <div className="relative h-4 flex-1">
          {ticks.map((tick) => (
            <TickLabel key={tick.at} tick={tick} />
          ))}
          <span className="absolute right-0 font-medium text-accent">{t('travail.timeline.now')}</span>
        </div>
      </div>

      <ol className="flex flex-col">
        {trees.map(({ tree, bars, events }) => {
          const active = targetKey === tree.key
          const name = tree.branch ?? tree.name
          return (
            <li key={tree.key} className={cx('flex items-center border-b border-line/60', active && 'bg-accent-wash/30')}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => toggle(tree.key)}
                title={verdictReason(t, tree.reason)}
                className={cx(LABEL, 'flex min-w-0 items-center gap-2 py-2.5 pr-3 text-left focus-visible:outline-2 focus-visible:outline-accent')}
              >
                <VerdictDot verdict={tree.verdict} />
                <span className={cx('min-w-0 truncate font-mono text-xs', tree.root && 'font-semibold')}>{tree.root ? name : shortBranch(name)}</span>
              </button>
              <div className="relative h-10 flex-1">
                <Grid ticks={ticks} />
                <span aria-hidden className="absolute top-0 right-0 bottom-0 w-0.5 bg-accent/60" />
                {bars.map((bar) => (
                  <Link
                    key={bar.id}
                    to={`/p/${projectId}/c/${bar.id}`}
                    title={t('travail.timeline.bar', { title: bar.title, state: t(`travail.timeline.tone.${bar.tone}`) })}
                    className={cx(
                      'absolute flex h-4 items-center overflow-hidden rounded px-1 hover:ring-1 hover:ring-accent focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none',
                      BAR_FILL[bar.tone],
                      BAR_INK[bar.tone],
                    )}
                    // Une barre a toujours la place de son icône, sans passer « maintenant ».
                    style={{
                      left: `min(${x(bar.start)}, calc(100% - ${BAR_MIN}))`,
                      width: `max(${BAR_MIN}, calc(${x(bar.end)} - ${x(bar.start)}))`,
                      top: BAR_TOP[bar.lane],
                    }}
                  >
                    <AgentIcon agent={bar.agent} size={10} decorative />
                  </Link>
                ))}
                {events.map((entry) => (
                  <span
                    key={entry.id}
                    title={t('travail.timeline.event', { title: entry.title, age: elapsed(entry.at) })}
                    className={cx('absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-canvas', EVENT_DOT[entry.kind])}
                    style={{ left: x(entry.at) }}
                  />
                ))}
              </div>
            </li>
          )
        })}
        {branches.map((branch) => {
          const active = targetKey === branch.key
          const commits = branch.commits.filter((commit) => commit.at >= frame.from)
          return (
            <li key={branch.key} className={cx('flex items-center border-b border-line/60', active && 'bg-accent-wash/30')}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => toggle(branch.key)}
                title={t(`code.branchKind.${branch.kind}`)}
                className={cx(LABEL, 'flex min-w-0 items-center gap-2 py-2.5 pr-3 text-left focus-visible:outline-2 focus-visible:outline-accent')}
              >
                <BranchDot kind={branch.kind} className="opacity-80" />
                <span className="min-w-0 truncate font-mono text-xs text-ink-soft">{branch.name}</span>
              </button>
              <div className="relative h-8 flex-1">
                <Grid ticks={ticks} />
                {commits.map((commit) => (
                  <span
                    key={commit.hash}
                    title={t('travail.timeline.event', { title: commit.title, age: elapsed(commit.at) })}
                    className={cx('absolute top-1/2 -translate-x-1/2 -translate-y-1/2', COMMIT_MARK)}
                    style={{ left: x(commit.at) }}
                  />
                ))}
                {branch.lastCommitAt !== null && branch.lastCommitAt < frame.from ? (
                  <span className="absolute top-1/2 left-1 -translate-y-1/2 text-micro text-ink-faint">
                    {t('travail.timeline.lastCommit', { age: relativeDate(branch.lastCommitAt) })}
                  </span>
                ) : null}
              </div>
            </li>
          )
        })}
      </ol>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-micro text-ink-faint">
        {(['running', 'awaiting', 'done'] as const).map((tone) => (
          <Legend key={tone} swatch={cx('h-2 w-4 rounded', BAR_FILL[tone])}>
            {t(`travail.timeline.legend.${tone}`)}
          </Legend>
        ))}
        <Legend swatch={cx('size-2 rounded-full', EVENT_DOT.cardClosed)}>{t('travail.timeline.legend.cardClosed')}</Legend>
        <Legend swatch={cx('size-2 rounded-full', EVENT_DOT.branch)}>{t('travail.timeline.legend.branch')}</Legend>
        <Legend swatch={COMMIT_MARK}>{t('travail.timeline.legend.commit')}</Legend>
      </p>
    </div>
  )
}

/** Une date de l'axe ; au téléphone, seulement celles qui ont la place. */
function TickLabel({ tick }: { tick: Tick }) {
  if (!tick.labelled) return null
  return (
    <span
      className={cx('absolute tabular-nums', tick.left === 0 ? '' : '-translate-x-1/2', !tick.compact && 'hidden md:inline')}
      style={{ left: pct(tick.left) }}
    >
      {formatDay(tick.at)}
    </span>
  )
}

function Grid({ ticks }: { ticks: Tick[] }) {
  return ticks.map((tick) => <span key={tick.at} aria-hidden className="absolute top-0 bottom-0 w-px bg-line/50" style={{ left: pct(tick.left) }} />)
}

function Legend({ swatch, children }: { swatch: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={swatch} />
      {children}
    </span>
  )
}
