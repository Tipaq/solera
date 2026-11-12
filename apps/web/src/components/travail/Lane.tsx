import { FolderGit2, GitBranch, Layers, MoreHorizontal } from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import type { JournalEntryDto } from '@solera/protocol'
import { IconButton, Menu, MenuItem, MenuSeparator, cx } from '@solera/ui'
import { Pip, type RailModel } from '../activity/ActivityRail'
import { CardRef } from '../code/CardRef'
import { ServiceMark } from '../code/ServiceMark'
import { SessionStack } from '../code/SessionStack'
import { TreeFacts } from '../code/TreeFacts'
import { REASON_TONE, VerdictDot, verdictReason } from '../code/VerdictDot'
import { SessionRow } from '../project/SessionRow'
import type { ActivityRow } from '../../lib/activity-rows'
import { pluralOf, type TreeRow } from '../../lib/code-model'
import { shortAge } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { JOURNAL_KIND_LABELS } from '../../lib/journal'
import type { ServedMark } from '../../lib/served'
import { LANE_ENTRIES, LANE_ENTRIES_MAX, PROJECT_ENTRIES, shownEntries, type LaneData } from '../../lib/travail-lanes'
import { useTreeActions } from './useTreeActions'

/** Ce qu'un couloir lit du fil pour dessiner une ligne d'historique. */
export type LaneRail = Pick<RailModel, 'isMilestone' | 'agentOf' | 'entryHref'>

/**
 * Le cadre d'un couloir, d'arbre, de branche ou « Projet » : un anneau d'accent quand
 * l'index vient d'y mener, sinon celui que le couloir choisit (ambre s'il t'attend).
 */
export function laneFrame(highlight: boolean, ring = 'ring-line'): string {
  return cx('flex scroll-mt-4 flex-col overflow-hidden rounded-xl ring-1 transition-shadow', highlight ? 'ring-2 ring-accent' : ring)
}

/** Ce qui se pose au-dessus du lien étiré d'un en-tête : il reste un geste à part. */
const ABOVE = 'relative z-[1]'

/**
 * Le couloir d'un arbre (`projet.md` T-4.3, T-4.4), en mode dense : l'en-tête est la
 * ligne de l'arbre, le corps **son fil** — ses sessions vivantes, puis ses derniers
 * événements. Un couloir où rien ne vit ni ne s'est passé se réduit à son en-tête.
 *
 * Tout l'en-tête ouvre le tiroir de l'arbre, par un bouton étiré sur son nom : la
 * carte, le service, les sessions et le menu `⋯` restent des gestes à part, posés
 * au-dessus de lui.
 */
export function Lane({
  projectId,
  lane,
  rail,
  served,
  anchorId,
  highlight = false,
  dim = false,
  onOpen,
  onClean,
}: {
  projectId: string
  lane: LaneData<ActivityRow, JournalEntryDto>
  rail: LaneRail
  served?: ServedMark[]
  anchorId: string
  /** L'index vient d'y mener : un anneau d'accent, un instant. */
  highlight?: boolean
  /** Dans « À nettoyer ». */
  dim?: boolean
  onOpen: (key: string) => void
  onClean: (tree: TreeRow) => void
}) {
  const t = useTranslate()
  const { tree, live, entries } = lane
  const [more, setMore] = useState(false)
  const actions = useTreeActions(projectId, tree, { onClean })
  const name = tree.branch ?? tree.name
  const empty = live.length === 0 && entries.length === 0

  return (
    <section
      id={anchorId}
      aria-label={name}
      data-lane={tree.key}
      data-highlight={highlight || undefined}
      className={cx(laneFrame(highlight, tree.verdict === 'waiting' ? 'ring-caution/50' : 'ring-line'), dim && 'opacity-80')}
    >
      <header className={cx('relative flex min-w-0 items-start gap-2.5 px-3 py-2 transition-colors hover:bg-surface-high/70', tree.root ? 'bg-surface/60' : 'bg-surface/30')}>
        <VerdictDot verdict={tree.verdict} className="mt-1.5" />
        <div className="flex max-w-[44rem] min-w-0 flex-initial flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {tree.root ? <FolderGit2 size={13} aria-hidden className="shrink-0 text-ink-faint" /> : <GitBranch size={13} aria-hidden className="shrink-0 text-ink-faint" />}
            <button
              type="button"
              onClick={() => onOpen(tree.key)}
              title={t('travail.lane.open', { branch: name })}
              className={cx(
                'min-w-0 truncate text-left font-mono text-sm outline-none',
                'after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent',
                tree.root ? 'font-semibold' : 'font-medium',
              )}
            >
              {name}
            </button>
            <span className={cx('text-xs', REASON_TONE[tree.verdict])}>{verdictReason(t, tree.reason)}</span>
            <ServiceMark projectId={projectId} marks={served} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <TreeFacts tree={tree} />
            {tree.card ? <CardRef projectId={projectId} card={tree.card} /> : null}
          </div>
        </div>
        <span aria-hidden className="flex-1" />
        <span className={cx(ABOVE, 'shrink-0')}>
          <SessionStack projectId={projectId} sessions={tree.sessions} />
        </span>
        <span className={cx(ABOVE, 'shrink-0')}>
          <Menu
            trigger={
              <IconButton label={t('travail.lane.gestures', { branch: name })} size="sm">
                <MoreHorizontal size={15} />
              </IconButton>
            }
          >
            {actions.map((action, index) => (
              <Fragment key={action.key}>
                {action.tone === 'critical' && index > 0 ? <MenuSeparator /> : null}
                <MenuItem icon={action.icon} onSelect={action.run} tone={action.tone}>
                  {action.label}
                </MenuItem>
              </Fragment>
            ))}
          </Menu>
        </span>
      </header>

      {empty ? null : (
        <div className="flex flex-col py-1">
          {live.length > 0 ? (
            <ul className="divide-y divide-line">
              {live.map((row) => (
                <SessionRow key={row.entry.conversation.id} conversation={row.entry.conversation} marker={row.marker} summary={row.summary} place={row.place} inTree />
              ))}
            </ul>
          ) : null}
          {entries.length > 0 ? (
            <ol className="flex flex-col px-1.5">
              {shownEntries(entries, more).map((entry) => (
                <LaneEntry key={entry.id} entry={entry} rail={rail} />
              ))}
            </ol>
          ) : null}
          <MoreToggle total={entries.length} more={more} onToggle={() => setMore((value) => !value)} />
        </div>
      )}
    </section>
  )
}

/** « Plus · N autres » / « Moins », quand le couloir en tait : N, ce que le dépli montrera. */
function MoreToggle({ total, base = LANE_ENTRIES, more, onToggle }: { total: number; base?: number; more: boolean; onToggle: () => void }) {
  const t = useTranslate()
  if (total <= base) return null
  const extra = Math.min(total, LANE_ENTRIES_MAX) - base
  return (
    <button type="button" onClick={onToggle} aria-expanded={more} className="mx-3 my-1 self-start rounded px-1 text-xs text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
      {more ? t('travail.lane.less') : t(`travail.lane.more.${pluralOf(extra)}`, { count: extra })}
    </button>
  )
}

/** Le couloir de ce qui ne vit dans aucun arbre : notes, cartes fermées seules, jalons (T-4.6). */
export function ProjectLane({ entries, rail, anchorId, highlight = false }: { entries: JournalEntryDto[]; rail: LaneRail; anchorId: string; highlight?: boolean }) {
  const t = useTranslate()
  const [more, setMore] = useState(false)
  return (
    <section
      id={anchorId}
      aria-label={t('travail.index.project')}
      data-highlight={highlight || undefined}
      className={laneFrame(highlight)}
    >
      <header className="flex items-center gap-2.5 bg-surface/30 px-3 py-2">
        <Layers size={13} aria-hidden className="shrink-0 text-ink-faint" />
        <span className="text-sm font-medium">{t('travail.index.project')}</span>
        <span className="text-xs text-ink-faint">{t('travail.index.projectHint')}</span>
      </header>
      <ol className="flex flex-col px-1.5 py-1">
        {shownEntries(entries, more, PROJECT_ENTRIES).map((entry) => (
          <LaneEntry key={entry.id} entry={entry} rail={rail} />
        ))}
      </ol>
      <MoreToggle total={entries.length} base={PROJECT_ENTRIES} more={more} onToggle={() => setMore((value) => !value)} />
    </section>
  )
}

/** Une ligne d'historique d'un couloir : l'âge, la pastille, le titre, la nature. */
function LaneEntry({ entry, rail }: { entry: JournalEntryDto; rail: LaneRail }) {
  const t = useTranslate()
  const to = rail.entryHref(entry)
  const body = (
    <>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-faint">{shortAge(entry.at)}</span>
      <Pip entry={entry} model={rail} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
      <span className="hidden shrink-0 text-meta font-medium tracking-wide text-ink-faint uppercase sm:inline">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
    </>
  )
  const shape = 'flex min-h-8 min-w-0 items-center gap-2.5 rounded-md px-1.5'
  return (
    <li>
      {to ? (
        <Link to={to} className={cx(shape, 'hover:bg-sunken/60 focus-visible:outline-2 focus-visible:outline-accent')}>
          {body}
        </Link>
      ) : (
        <div className={shape}>{body}</div>
      )}
    </li>
  )
}
