import { ArrowDown, ArrowUp, Cloud, FolderGit2, GitBranch, MoreHorizontal, TriangleAlert } from 'lucide-react'
import { Fragment } from 'react'
import type { JournalEntryDto } from '@solera/protocol'
import { Badge, Button, IconButton, Menu, MenuItem, MenuSeparator, cx } from '@solera/ui'
import { BranchDiffDrawer } from '../code/BranchDiffDrawer'
import { CardRef } from '../code/CardRef'
import { SessionStack } from '../code/SessionStack'
import { BranchDot, REASON_TONE, VerdictDot, verdictReason } from '../code/VerdictDot'
import type { ActivityRow } from '../../lib/activity-rows'
import { BEHIND_ALERT, PR_TONE, formatBytes, pluralOf, type BranchInfo, type TreeRow } from '../../lib/code-model'
import { shortAge } from '../../lib/dates'
import { useLocale, useTranslate } from '../../lib/i18n'
import { isHeavy } from '../../lib/tree-actions'
import { laneAnchor, type LaneItem, type LaneLayout } from '../../lib/travail-lanes'
import { branchLabel, MergedBranches, useBranchActions, type BranchAction } from './BranchLane'
import { CleanupSection, GroupHeading, MERGED_KEY, groupTitle } from './CouloirsView'
import { usePrimaryAction, useTreeActions, type TreeAction } from './useTreeActions'

type Layout = LaneLayout<ActivityRow, JournalEntryDto>
type Item = LaneItem<ActivityRow, JournalEntryDto>

/**
 * La grille du tableau (T-6.1) : la branche, puis des colonnes de faits resserrées. Au
 * téléphone, il n'y a plus de grille : chaque ligne devient une carte (T-6.5).
 */
export const TABLE_GRID = 'md:grid md:grid-cols-[minmax(0,1fr)_9rem_8rem_5.5rem_5rem_5.5rem_2.5rem] md:items-center md:gap-x-4'

/** Ce qui se pose au-dessus du bouton étiré d'une ligne : il reste un geste à part. */
const ABOVE = 'relative z-[1]'

/** Une ligne : carte bordée au téléphone, rangée du tableau au-delà. */
const ROW = 'relative rounded-xl border border-line px-3 py-3 md:rounded-none md:border-0 md:px-0 md:py-2.5'

/**
 * La vue « Tableau » de Travail (`projet.md` T-6) : une ligne par arbre, puis par branche
 * sans worktree, sur la même disposition que « Par arbre » (`laneLayout`) : mêmes
 * regroupements, même tri, « À nettoyer » et les branches fusionnées en bas.
 */
export function TableView({ projectId, layout, onOpen }: { projectId: string; layout: Layout; onOpen: (key: string) => void }) {
  const t = useTranslate()
  const row = (item: Item) =>
    item.kind === 'tree' ? (
      <TreeLine key={item.lane.tree.key} projectId={projectId} tree={item.lane.tree} onOpen={onOpen} />
    ) : (
      <BranchRowLine key={item.branch.key} projectId={projectId} branch={item.branch} />
    )
  const list = (items: Item[]) => <ul className="flex flex-col gap-2 md:gap-0 md:divide-y md:divide-line">{items.map(row)}</ul>
  const items: Item[] = [...layout.trees.map((lane) => ({ kind: 'tree' as const, lane })), ...layout.branches.map((branch) => ({ kind: 'branch' as const, branch }))]

  return (
    <div className="flex flex-col gap-6" role="region" aria-label={t('travail.table.label')}>
      <div className="flex flex-col gap-4">
        <div aria-hidden className={cx('hidden border-b border-line pb-2 text-meta font-medium tracking-wide text-ink-faint uppercase', TABLE_GRID)}>
          <span>{t('travail.table.branch')}</span>
          <span>{t('travail.table.sessions')}</span>
          <span>{t('travail.table.pr')}</span>
          <span className="text-right">{t('travail.table.base')}</span>
          <span className="text-right">{t('travail.table.disk')}</span>
          <span className="text-right">{t('travail.table.seen')}</span>
          <span />
        </div>
        {layout.groups
          ? layout.groups.map((group) => (
              <section key={group.key} aria-label={groupTitle(t, group.label)} className="flex flex-col gap-1">
                <GroupHeading label={groupTitle(t, group.label)} count={group.items.length} />
                {list(group.items)}
              </section>
            ))
          : list(items)}
      </div>

      {layout.cleanup ? (
        <CleanupSection cleanup={layout.cleanup}>
          <ul className="flex flex-col gap-2 opacity-80 md:gap-0 md:divide-y md:divide-line">
            {layout.cleanup.lanes.map((lane) => (
              <TreeLine key={lane.tree.key} projectId={projectId} tree={lane.tree} onOpen={onOpen} />
            ))}
          </ul>
        </CleanupSection>
      ) : null}

      {layout.merged ? <MergedBranches branches={layout.merged.branches} open={layout.merged.open} anchorId={laneAnchor(MERGED_KEY)} /> : null}
    </div>
  )
}

/** Le menu `⋯` d'une ligne : les gestes, un filet avant celui qui retire. */
function GestureMenu({ label, lead, actions }: { label: string; lead?: TreeAction | null; actions: (TreeAction | BranchAction)[] }) {
  return (
    <Menu
      align="end"
      trigger={
        <IconButton label={label} size="sm">
          <MoreHorizontal size={15} />
        </IconButton>
      }
    >
      {lead ? (
        <>
          <MenuItem icon={lead.icon} onSelect={lead.run}>
            {lead.label}
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      {actions.map((action, index) => (
        <Fragment key={action.key}>
          {action.tone === 'critical' && index > 0 ? <MenuSeparator /> : null}
          <MenuItem icon={action.icon} onSelect={action.run} tone={action.tone} disabled={action.disabled}>
            {action.label}
          </MenuItem>
        </Fragment>
      ))}
    </Menu>
  )
}

/**
 * La ligne d'un arbre (T-6.2). Toute la ligne ouvre son tiroir, par un bouton étiré sur
 * son nom ; la carte, les sessions, la PR et les gestes restent à part, au-dessus. Le
 * geste que le verdict appelle se montre en clair au téléphone seulement, et en tête du
 * menu partout.
 */
export function TreeLine({ projectId, tree, onOpen }: { projectId: string; tree: TreeRow; onOpen: (key: string) => void }) {
  const t = useTranslate()
  const locale = useLocale()
  const actions = useTreeActions(projectId, tree)
  const primary = usePrimaryAction(projectId, tree)
  const name = tree.branch ?? tree.name

  return (
    <li data-tree-line={tree.key} className={cx(ROW, TABLE_GRID, 'transition-colors hover:bg-surface-high/60', tree.root && 'md:bg-surface/40')}>
      <div className="flex min-w-0 items-start gap-2.5">
        <VerdictDot verdict={tree.verdict} className="mt-1.5" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {tree.root ? <FolderGit2 size={13} aria-hidden className="shrink-0 text-ink-faint" /> : <GitBranch size={13} aria-hidden className="shrink-0 text-ink-faint" />}
            <button
              type="button"
              onClick={() => onOpen(tree.key)}
              title={t('travail.lane.open', { branch: name })}
              className={cx(
                'min-w-0 truncate text-left font-mono text-code text-ink outline-none',
                'after:absolute after:inset-0 after:rounded-xl md:after:rounded-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent',
                tree.root && 'font-semibold',
              )}
            >
              {name}
            </button>
            {tree.external ? <Badge>{t('travail.table.external')}</Badge> : null}
            {tree.conflicts ? (
              <Badge tone="critical" icon={<TriangleAlert size={11} />}>
                {t('code.drift.conflict')}
              </Badge>
            ) : null}
          </div>
          <p className={cx('text-xs', REASON_TONE[tree.verdict])}>{verdictReason(t, tree.reason)}</p>
          {tree.card ? <CardRef projectId={projectId} card={tree.card} /> : null}
        </div>
      </div>

      {/* Au téléphone, les colonnes suivantes deviennent une rangée de faits sous le titre. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-[18px] text-xs md:contents">
        <div className="flex min-w-0 items-center">
          {tree.sessions.length === 0 ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <span className={ABOVE}>
              <SessionStack projectId={projectId} sessions={tree.sessions} />
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center">
          {tree.pr ? <PrCell pr={tree.pr} /> : <span className="text-ink-faint">{tree.root ? '' : t('code.pr.none')}</span>}
        </div>

        <div className="flex items-center gap-2 tabular-nums md:justify-end">
          {tree.root ? null : <AheadBehind ahead={tree.ahead} behind={tree.behind} />}
          {tree.uncommitted > 0 ? (
            <span title={t(`code.drift.dirty.${pluralOf(tree.uncommitted)}`, { count: tree.uncommitted })} className="text-caution">
              ●{tree.uncommitted}
            </span>
          ) : null}
        </div>

        <span title={t('code.size')} className={cx('tabular-nums md:text-right', isHeavy(tree) ? 'text-ink' : 'text-ink-soft')}>
          {tree.sizeBytes !== null ? formatBytes(tree.sizeBytes, locale) : '—'}
        </span>

        <span className="tabular-nums text-ink-faint md:text-right">{tree.lastUsedAt ? shortAge(tree.lastUsedAt) : '—'}</span>

        <div className={cx(ABOVE, 'ml-auto flex items-center justify-end gap-1 md:ml-0')}>
          {primary ? (
            <Button size="sm" variant="ghost" icon={primary.icon} onClick={primary.run} className="md:hidden">
              {primary.label}
            </Button>
          ) : null}
          <GestureMenu label={t('travail.lane.gestures', { branch: name })} lead={primary} actions={actions} />
        </div>
      </div>
    </li>
  )
}

/** La PR d'un arbre : « #n » et son état, qui mènent à la forge quand on en a l'adresse. */
function PrCell({ pr }: { pr: NonNullable<TreeRow['pr']> }) {
  const t = useTranslate()
  const body = (
    <>
      <span className="tabular-nums text-ink-faint">#{pr.number}</span>
      <Badge tone={PR_TONE[pr.state]}>{t(`code.pr.${pr.state}`)}</Badge>
    </>
  )
  if (!pr.url) return <span className="inline-flex items-center gap-1.5">{body}</span>
  return (
    <a href={pr.url} target="_blank" rel="noopener noreferrer" className={cx(ABOVE, 'inline-flex items-center gap-1.5 rounded underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent')}>
      {body}
    </a>
  )
}

/** ↑ l'avance, ↓ le retard (ambre au-delà de 20), estompés à zéro. */
function AheadBehind({ ahead, behind }: { ahead: number; behind: number }) {
  const t = useTranslate()
  return (
    <>
      <span title={t(`code.drift.ahead.${pluralOf(ahead)}`, { count: ahead })} className={cx('inline-flex items-center', ahead ? 'text-ink-soft' : 'text-ink-faint/60')}>
        <ArrowUp size={11} aria-hidden />
        {ahead}
      </span>
      <span
        title={t(`code.drift.behind.${pluralOf(behind)}`, { count: behind })}
        className={cx('inline-flex items-center', behind > BEHIND_ALERT.tree ? 'text-caution' : behind ? 'text-ink-soft' : 'text-ink-faint/60')}
      >
        <ArrowDown size={11} aria-hidden />
        {behind}
      </span>
    </>
  )
}

/**
 * La ligne d'une branche sans arbre (T-6.3), sur la grille des arbres : son genre, sa
 * carte, « sans arbre », sa PR, son avance (vide une fois fusionnée), l'âge de son
 * dernier commit, et ses gestes (T-13.2) dans le menu.
 */
export function BranchRowLine({ projectId, branch }: { projectId: string; branch: BranchInfo }) {
  const t = useTranslate()
  const { actions, compare, closeCompare, base } = useBranchActions(projectId, branch)
  const label = branchLabel(branch)
  return (
    <li data-branch-line={branch.name} className={cx(ROW, TABLE_GRID)}>
      <div className="flex min-w-0 items-start gap-2.5">
        <BranchDot kind={branch.kind} className="mt-1.5" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {branch.remoteOnly ? <Cloud size={12} aria-hidden className="shrink-0 text-ink-faint" /> : <GitBranch size={12} aria-hidden className="shrink-0 text-ink-faint" />}
            <span className="min-w-0 truncate font-mono text-code">{label}</span>
            <span className="shrink-0 text-xs text-ink-soft">{t(`code.branchKind.${branch.kind}`)}</span>
          </div>
          {branch.card ? <CardRef projectId={projectId} card={branch.card} /> : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-[18px] text-xs md:contents">
        <span className="text-ink-faint">{t('travail.table.noTree')}</span>
        <span className="min-w-0 truncate text-ink-soft">{branch.pr ? t('travail.table.prState', { number: branch.pr.number, state: t(`code.pr.${branch.pr.state}`) }) : '—'}</span>
        <span className="flex items-center gap-2 tabular-nums md:justify-end">
          {branch.merged || branch.ahead === null ? null : <AheadBehind ahead={branch.ahead} behind={branch.behind ?? 0} />}
        </span>
        <span className="hidden text-ink-faint md:block md:text-right">—</span>
        <span className="tabular-nums text-ink-faint md:text-right">{branch.lastCommitAt !== null ? shortAge(branch.lastCommitAt) : '—'}</span>
        <div className="ml-auto flex items-center justify-end md:ml-0">
          <GestureMenu label={t('travail.lane.gestures', { branch: label })} actions={actions} />
        </div>
      </div>
      <BranchDiffDrawer projectId={projectId} base={base} branch={branch.name} open={compare} onClose={closeCompare} />
    </li>
  )
}

