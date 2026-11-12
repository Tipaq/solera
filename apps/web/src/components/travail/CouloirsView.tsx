import { ChevronRight, GitBranch, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { JournalEntryDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { verdictLabel } from '../code/VerdictDot'
import { toolbarButtonClass } from '../toolbar/OneLineToolbar'
import type { ActivityRow } from '../../lib/activity-rows'
import { formatBytes, pluralOf, type TreeRow } from '../../lib/code-model'
import { useLocale, useTranslate } from '../../lib/i18n'
import type { ServedMark } from '../../lib/served'
import { laneAnchor, type LaneData, type LaneGroupLabel, type LaneItem, type LaneLayout } from '../../lib/travail-lanes'
import { BranchLane, MergedBranches } from './BranchLane'
import { Lane, ProjectLane, type LaneRail } from './Lane'

type Layout = LaneLayout<ActivityRow, JournalEntryDto>
type Item = LaneItem<ActivityRow, JournalEntryDto>

/** Les ancres fixes de la vue, hors arbres et branches. */
export const PROJECT_KEY = 'projet'
export const CLEANUP_KEY = 'nettoyer'
export const MERGED_KEY = 'branches-fusionnees'

/**
 * La vue « Par arbre » de Travail (`projet.md` T-4) : les couloirs des arbres, puis
 * ceux des branches sans worktree (ou leurs sections, regroupés) ; le couloir
 * « Projet » ; « À nettoyer » et les branches fusionnées, repliés en bas.
 *
 * La disposition vient de `laneLayout` ; la vue ne fait que la dessiner. Chaque couloir
 * porte l'ancre (`laneAnchor`) où l'index fait défiler, et s'entoure d'accent quand
 * l'index vient d'y mener (`flash`).
 */
export function CouloirsView({
  projectId,
  layout,
  rail,
  served,
  flash,
  onOpen,
  onCleanTree,
  onCleanTrees,
}: {
  projectId: string
  layout: Layout
  rail: LaneRail
  served: Map<string, ServedMark[]>
  flash: string | null
  onOpen: (key: string) => void
  onCleanTree: (tree: TreeRow) => void
  onCleanTrees: (trees: TreeRow[]) => void
}) {
  const t = useTranslate()
  const lane = (data: LaneData<ActivityRow, JournalEntryDto>, dim = false) => (
    <Lane
      key={data.tree.key}
      projectId={projectId}
      lane={data}
      rail={rail}
      served={served.get(data.tree.key)}
      anchorId={laneAnchor(data.tree.key)}
      highlight={flash === data.tree.key}
      dim={dim}
      onOpen={onOpen}
      onClean={onCleanTree}
    />
  )
  const render = (item: Item) =>
    item.kind === 'tree' ? (
      lane(item.lane)
    ) : (
      <BranchLane key={item.branch.key} projectId={projectId} branch={item.branch} anchorId={laneAnchor(item.branch.key)} highlight={flash === item.branch.key} />
    )

  return (
    <div className="flex flex-col gap-6">
      {layout.groups ? (
        layout.groups.map((group) => (
          <section key={group.key} aria-label={groupTitle(t, group.label)} className="flex flex-col gap-2.5">
            <GroupHeading label={groupTitle(t, group.label)} count={group.items.length} />
            {group.items.map(render)}
          </section>
        ))
      ) : (
        <>
          {layout.trees.length > 0 ? <div className="flex flex-col gap-2.5">{layout.trees.map((data) => lane(data))}</div> : null}
          {layout.branches.length > 0 ? (
            <section aria-label={t('travail.group.branchesNoTree')} className="flex flex-col gap-2.5">
              <GroupHeading label={t('travail.group.branchesNoTree')} count={layout.branches.length} icon={<GitBranch size={12} aria-hidden />} upper />
              {layout.branches.map((branch) => render({ kind: 'branch', branch }))}
            </section>
          ) : null}
        </>
      )}

      {layout.project ? <ProjectLane entries={layout.project} rail={rail} anchorId={laneAnchor(PROJECT_KEY)} highlight={flash === PROJECT_KEY} /> : null}

      {layout.cleanup ? <CleanupSection cleanup={layout.cleanup} render={(data) => lane(data, true)} onClean={onCleanTrees} /> : null}

      {layout.merged ? <MergedBranches projectId={projectId} branches={layout.merged.branches} open={layout.merged.open} anchorId={laneAnchor(MERGED_KEY)} /> : null}
    </div>
  )
}

type Translate = ReturnType<typeof useTranslate>

function groupTitle(t: Translate, label: LaneGroupLabel): string {
  switch (label.kind) {
    case 'milestone':
      return t('travail.group.milestone', { number: label.number, title: label.title })
    case 'noMilestone':
      return t('travail.group.noMilestone')
    case 'verdict':
      return verdictLabel(t, label.verdict)
    case 'branch':
      return t('travail.group.branch', { kind: t(`code.branchKind.${label.branchKind}`) })
  }
}

function GroupHeading({ label, count, icon, upper = false }: { label: string; count: number; icon?: ReactNode; upper?: boolean }) {
  return (
    <h3 className="flex items-center gap-2 px-1 text-xs font-medium tracking-wide text-ink-faint uppercase">
      {icon}
      <span className={cx('min-w-0 truncate', upper ? null : 'text-sm font-semibold tracking-normal text-ink-soft normal-case')}>{label}</span>
      <span className="tabular-nums">{count}</span>
    </h3>
  )
}

/**
 * « À nettoyer » (`projet.md` T-4.7) : un filet, « › N arbres fusionnés · X · rien à
 * perdre » qui déplie leurs couloirs atténués, et « Nettoyer », qui les retire tous.
 * Déplié d'office quand un filtre d'état les réclame.
 */
function CleanupSection({
  cleanup,
  render,
  onClean,
}: {
  cleanup: NonNullable<Layout['cleanup']>
  render: (lane: LaneData<ActivityRow, JournalEntryDto>) => ReactNode
  onClean: (trees: TreeRow[]) => void
}) {
  const t = useTranslate()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const shown = open || cleanup.open
  const { count, bytes } = cleanup.summary
  // Les introuvables se retirent un à un, par leur tiroir : le lot ne prend que ce qui se nettoie sans rien perdre.
  const cleanable = cleanup.lanes.map((lane) => lane.tree).filter((tree) => tree.verdict === 'clean' && tree.id !== null)
  const toggle = t(`travail.cleanup.toggle.${pluralOf(count)}`, { count })
  return (
    <section id={laneAnchor(CLEANUP_KEY)} aria-label={toggle} className="flex scroll-mt-4 flex-col gap-2">
      <div className="flex items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={shown}
          className="flex min-w-0 items-center gap-2 rounded-md px-1 py-1 text-sm text-ink-soft hover:bg-surface-high hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronRight size={14} aria-hidden className={cx('shrink-0 transition-transform', shown && 'rotate-90')} />
          <span className="font-medium">{toggle}</span>
          <span className="truncate text-xs tabular-nums text-ink-faint">
            {bytes !== null ? `${formatBytes(bytes, locale)} · ` : ''}
            {t('travail.cleanup.nothingLost')}
          </span>
        </button>
        {cleanable.length > 0 ? (
          <button type="button" onClick={() => onClean(cleanable)} className={cx(toolbarButtonClass(false), 'ml-auto shrink-0')}>
            <Trash2 size={13} aria-hidden /> {t('travail.cleanup.action')}
          </button>
        ) : null}
      </div>
      {shown ? <div className="flex flex-col gap-2.5">{cleanup.lanes.map(render)}</div> : null}
    </section>
  )
}
