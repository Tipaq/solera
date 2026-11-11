/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ChevronRight, FolderGit2, GitBranch, Layers, MoreHorizontal, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { JOURNAL_FAMILY_OF, type JournalEntryDto, type ProjectDto } from '@solera/protocol'
import { IconButton, Menu, MenuItem, MenuSeparator, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { AskInbox } from '../../components/prototype/AskInbox'
import { SessionRow } from '../../components/project/SessionRow'
import { elapsed } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { JOURNAL_KIND_LABELS } from '../../lib/journal'
import type { ActivityRow } from '../../lib/activity-rows'
import { Pip } from '../prototype-activity/FilActivity'
import { KindFilter, SearchField, type ActivityModel } from '../prototype-activity/shared'
import { Branches, VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import { ServiceMark } from '../prototype-automations/served'
import { formatBytes, isCleanable, type TreeRow } from '../prototype-code/data'
import { CardDrawerHost } from '../prototype-milestones/CardDrawer'
import { useProtoHref } from '../prototype-milestones/model'
import { Notice, SessionDots, TreeFacts, TreeSummary, entryInTree, rowInTree, useTravail, useTravailActions, useTreeActions, type Travail } from './shared'

/** Événements montrés par couloir avant « plus ». */
const LANE_ENTRIES = 3

/**
 * `couloirs` — un **couloir par arbre**, triés par activité (ce qui t'attend d'abord) :
 * l'en-tête est la ligne de l'arbre (verdict, PR, base, taille, gestes), le corps est
 * **son fil** (sessions vivantes, puis ses derniers événements). Un dernier couloir
 * **Projet** pour ce qui ne vit dans aucun arbre ; les arbres à nettoyer, repliés en bas.
 */
export function Couloirs({ projectId, project }: { projectId: string; project: ProjectDto }) {
  const travail = useTravail(projectId, project)
  const { model, code, overview } = travail
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const lanes = useLanes(travail)

  if (model.isPending) return null
  const hasTrees = Boolean(project.git || code.demo)

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-6">
        <SearchField model={model} className="h-8 w-40 shrink-0 sm:w-64" />
        <KindFilter model={model} className="ml-auto" />
      </header>

      <div className="flex flex-col gap-6 px-4 pt-4 pb-28 md:px-6">
        <AskInbox items={overview.inbox} />

        {hasTrees ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-sm font-semibold text-ink">Arbres</h2>
            <TreeSummary code={code} />
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          {lanes.active.map((lane) => (
            <Lane key={lane.tree.key} tree={lane.tree} live={lane.live} entries={lane.entries} travail={travail} projectId={projectId} />
          ))}
          <ProjectLane entries={lanes.loose} model={model} />
        </div>

        {lanes.cleanup.length > 0 ? (
          <section className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setCleanupOpen((value) => !value)}
              aria-expanded={cleanupOpen}
              className="flex items-center gap-2 self-start rounded-md px-1 py-1 text-sm text-ink-soft hover:text-ink"
            >
              <ChevronRight size={14} className={cx('transition-transform', cleanupOpen && 'rotate-90')} />
              <Trash2 size={13} className="text-ink-faint" />
              <span className="font-medium">À nettoyer</span>
              <span className="text-xs tabular-nums text-ink-faint">
                {lanes.cleanup.length} arbre{lanes.cleanup.length > 1 ? 's' : ''} · {formatBytes(lanes.cleanup.reduce((sum, lane) => sum + lane.tree.sizeBytes, 0))}
              </span>
            </button>
            {cleanupOpen ? (
              <div className="flex flex-col gap-3">
                {lanes.cleanup.map((lane) => (
                  <Lane key={lane.tree.key} tree={lane.tree} live={lane.live} entries={lane.entries} travail={travail} projectId={projectId} dim />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {hasTrees && code.branches.length > 0 ? <Branches data={code} /> : null}
      </div>
      <CardDrawerHost />
    </div>
  )
}

/** Un couloir : un arbre, ses sessions vivantes, ses événements. */
export interface LaneData {
  tree: TreeRow
  live: ActivityRow[]
  entries: JournalEntryDto[]
}

/**
 * Les couloirs d'un projet : les arbres actifs (ce qui t'attend d'abord, puis le plus
 * récent), ceux à nettoyer, et les événements qui ne vivent dans aucun arbre.
 */
export function useLanes(travail: Travail): { active: LaneData[]; cleanup: LaneData[]; loose: JournalEntryDto[] } {
  const { model, code, scopes } = travail
  // Les lignes du couloir suivent le filtre de nature, comme le fil.
  const entries = useMemo(
    () => (model.kind === 'all' ? model.entries : model.entries.filter((entry) => JOURNAL_FAMILY_OF[entry.kind] === model.kind)),
    [model.entries, model.kind],
  )

  return useMemo(() => {
    const ordered = [...code.trees.filter((tree) => !tree.root), ...code.trees.filter((tree) => tree.root)]
    const owner = new Map<string, string>()
    for (const entry of entries) {
      const tree = ordered.find((candidate) => entryInTree(entry, candidate, scopes.get(candidate.key)!))
      if (tree) owner.set(entry.id, tree.key)
    }
    const ofTree = (tree: TreeRow) => ({
      tree,
      live: model.live.filter((row) => rowInTree(row, tree, scopes.get(tree.key)!)),
      entries: entries.filter((entry) => owner.get(entry.id) === tree.key),
    })
    const all = code.trees.map(ofTree)
    const recency = (lane: (typeof all)[number]) =>
      Math.max(lane.tree.lastUsedAt ?? 0, lane.entries[0]?.at ?? 0, lane.live.length > 0 || lane.tree.sessions.length > 0 ? Date.now() : 0)
    const waiting = (lane: (typeof all)[number]) => (lane.tree.verdict === 'waiting' ? 1 : 0)
    const cleanup = all.filter((lane) => isCleanable(lane.tree) || lane.tree.verdict === 'missing')
    const active = all.filter((lane) => !cleanup.includes(lane)).sort((a, b) => waiting(b) - waiting(a) || recency(b) - recency(a))
    const loose = entries.filter((entry) => !owner.has(entry.id))
    return { active, cleanup, loose }
  }, [code.trees, entries, model.live, scopes])

}

export function Lane({
  tree,
  live,
  entries,
  travail,
  projectId,
  dim = false,
  dense = false,
  anchorId,
  highlight = false,
}: {
  tree: TreeRow
  live: ActivityRow[]
  entries: JournalEntryDto[]
  travail: Travail
  projectId: string
  dim?: boolean
  /** Hybride : un couloir sans activité se réduit à son en-tête, et l'en-tête se resserre. */
  dense?: boolean
  anchorId?: string
  highlight?: boolean
}) {
  const [more, setMore] = useState(false)
  const href = useProtoHref()
  const tone = VERDICT_TONE[tree.verdict]
  const { actions, notice } = useTreeActions(projectId, tree, travail.code.demo)
  const page = useTravailActions()
  const shownEntries = more ? entries.slice(0, 20) : entries.slice(0, LANE_ENTRIES)
  // En démo, les sessions vivantes sont celles de l'arbre ; en vrai, les lignes d'activité.
  const demoLive = travail.code.demo ? tree.sessions : []
  const empty = live.length === 0 && demoLive.length === 0 && entries.length === 0

  return (
    <section
      id={anchorId}
      data-tree={tree.key}
      className={cx(
        'flex scroll-mt-4 flex-col overflow-hidden rounded-xl ring-1 transition-shadow',
        highlight ? 'ring-2 ring-accent' : tree.verdict === 'waiting' ? 'ring-caution/50' : 'ring-line',
        dim && 'opacity-80',
      )}
    >
      {/* L'en-tête : la ligne de l'arbre, comme dans Code. */}
      <header
        className={cx(
          'flex min-w-0 items-start gap-2.5 px-3',
          dense ? 'py-2' : 'py-2.5',
          tree.root ? 'bg-surface/60' : 'bg-surface/30',
          // Dans Travail `une-ligne`, l'en-tête ouvre le tiroir de l'arbre : il en a l'air.
          page && 'cursor-pointer transition-colors hover:bg-surface-high/70',
        )}
        onClick={
          page
            ? (event) => {
                if ((event.target as HTMLElement).closest('a, button, [role="menu"], [role="menuitem"]')) return
                page.openTree(tree.key)
              }
            : undefined
        }
      >
        <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
        <div className={cx('flex min-w-0 flex-col gap-1', dense ? 'max-w-[44rem] flex-initial' : 'flex-1')}>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {tree.root ? <FolderGit2 size={13} className="shrink-0 text-ink-faint" /> : <GitBranch size={13} className="shrink-0 text-ink-faint" />}
            <span className={cx('min-w-0 truncate font-mono text-[13px]', tree.root ? 'font-semibold' : 'font-medium')}>{tree.branch ?? tree.name}</span>
            <span className={cx('text-xs', tone.text)}>{tree.reason}</span>
            <ServiceMark treeKey={tree.key} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <TreeFacts tree={tree} />
            {tree.card ? (
              <Link to={href(`?fiche=${tree.card.number}`)} className="min-w-0 truncate text-xs text-ink-faint underline-offset-2 hover:text-ink hover:underline">
                #{tree.card.number} {tree.card.title}
                {tree.card.milestone ? <span className="ml-1.5 rounded bg-surface-high px-1.5 py-px">Jalon #{tree.card.milestone.number}</span> : null}
              </Link>
            ) : null}
          </div>
        </div>
        {dense ? <span aria-hidden className="flex-1" /> : null}
        <SessionDots tree={tree} />
        <Menu
          trigger={
            <IconButton label={`Gestes sur ${tree.branch ?? tree.name}`} size="sm">
              <MoreHorizontal size={15} />
            </IconButton>
          }
        >
          {actions.flatMap((action, index) => [
            action.tone === 'critical' && index > 0 ? <MenuSeparator key={`${action.key}-sep`} /> : null,
            <MenuItem key={action.key} icon={action.icon} onSelect={action.run} tone={action.tone}>
              {action.label}
            </MenuItem>,
          ])}
        </Menu>
      </header>

      {notice ? (
        <div className="px-3 pt-2">
          <Notice text={notice} />
        </div>
      ) : null}

      {/* Le corps : le fil de l'arbre. En dense, un couloir vide n'a pas de corps. */}
      {dense && empty ? null : (
      <div className="flex flex-col py-1">
        {live.length > 0 ? (
          <ul className="divide-y divide-line">
            {live.map((row) => (
              <SessionRow key={row.entry.conversation.id} conversation={row.entry.conversation} marker={row.marker} summary={row.summary} place={row.place} pr={row.pr} />
            ))}
          </ul>
        ) : null}
        {demoLive.length > 0 ? (
          <ul className="flex flex-col px-1.5">
            {demoLive.map((session) => (
              <li key={session.id} className="flex min-h-9 items-center gap-2.5 rounded-md px-1.5 text-sm">
                <span className={cx('flex size-5 items-center justify-center rounded', session.status === 'running' ? 'text-accent' : 'bg-caution/15 text-caution')}>
                  <AgentIcon agent={session.agent} size={12} />
                </span>
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <span className={cx('shrink-0 text-xs', session.status === 'running' ? 'text-ink-soft' : 'text-caution')}>
                  {session.status === 'running' ? 'tourne' : 't’attend'}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {shownEntries.length > 0 ? (
          <ol className="flex flex-col px-1.5">
            {shownEntries.map((entry) => (
              <LaneEntry key={entry.id} entry={entry} model={travail.model} />
            ))}
          </ol>
        ) : null}
        {empty ? <p className="px-3 py-2 text-xs text-ink-faint">Rien ne s’y est passé ces derniers jours.</p> : null}
        {entries.length > LANE_ENTRIES ? (
          <button type="button" onClick={() => setMore((value) => !value)} className="mx-3 my-1 self-start rounded px-1 text-xs text-ink-faint hover:text-ink">
            {more ? 'Moins' : `Plus · ${entries.length - LANE_ENTRIES} autre${entries.length - LANE_ENTRIES > 1 ? 's' : ''}`}
          </button>
        ) : null}
      </div>
      )}
    </section>
  )
}

/** Le couloir de ce qui ne vit dans aucun arbre : notes, cartes fermées seules, jalons. */
export function ProjectLane({ entries, model, anchorId, highlight = false }: { entries: JournalEntryDto[]; model: ActivityModel; anchorId?: string; highlight?: boolean }) {
  const [more, setMore] = useState(false)
  if (entries.length === 0) return null
  const shown = more ? entries.slice(0, 20) : entries.slice(0, LANE_ENTRIES + 1)
  return (
    <section id={anchorId} data-tree="projet" className={cx('flex scroll-mt-4 flex-col overflow-hidden rounded-xl ring-1', highlight ? 'ring-2 ring-accent' : 'ring-line')}>
      <header className="flex items-center gap-2.5 bg-surface/30 px-3 py-2.5">
        <Layers size={13} className="shrink-0 text-ink-faint" />
        <span className="text-sm font-medium">Projet</span>
        <span className="text-xs text-ink-faint">ce qui ne vit dans aucun arbre</span>
      </header>
      <ol className="flex flex-col px-1.5 py-1">
        {shown.map((entry) => (
          <LaneEntry key={entry.id} entry={entry} model={model} />
        ))}
      </ol>
      {entries.length > LANE_ENTRIES + 1 ? (
        <button type="button" onClick={() => setMore((value) => !value)} className="mx-3 mb-2 self-start rounded px-1 text-xs text-ink-faint hover:text-ink">
          {more ? 'Moins' : `Plus · ${entries.length - LANE_ENTRIES - 1} autre${entries.length - LANE_ENTRIES - 1 > 1 ? 's' : ''}`}
        </button>
      ) : null}
    </section>
  )
}

function LaneEntry({ entry, model }: { entry: JournalEntryDto; model: ActivityModel }) {
  const t = useTranslate()
  const to = model.entryHref(entry)
  const body: ReactNode = (
    <>
      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-faint">{elapsed(entry.at)}</span>
      <Pip entry={entry} model={model} size="sm" />
      <span className="min-w-0 flex-1 truncate text-sm">{entry.title}</span>
      <span className="hidden shrink-0 text-meta font-medium tracking-wide text-ink-faint uppercase sm:inline">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
    </>
  )
  const shape = 'flex min-h-8 min-w-0 items-center gap-2.5 rounded-md px-1.5'
  return <li>{to ? <Link to={to} className={cx(shape, 'hover:bg-sunken/60')}>{body}</Link> : <div className={shape}>{body}</div>}</li>
}
