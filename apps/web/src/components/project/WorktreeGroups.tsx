import { BrushCleaning, Check, ChevronDown, ChevronRight, FolderGit2, GitBranch, GitMerge, Layers, TriangleAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ConversationDto, GitSummaryDto, WorktreeStatusDto, WorktreeStatusListDto } from '@solera/protocol'
import { Banner, Button, ConfirmDialog, EmptyState, IconButton, cx } from '@solera/ui'
import { ApiRequestError } from '../../lib/api'
import type { ActivityRow } from '../../lib/activity-rows'
import { shortAge } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { groupByWorktree, idleGestureOf, lastActivity, type IdleGesture } from '../../lib/worktree-groups'
import { useCleanWorktree } from '../../lib/worktrees'
import { WorktreeCleanupDialog, plural } from '../WorktreeCleanupDialog'
import { SessionRow } from './SessionRow'

/** La clé de pliage d'un groupe : un chemin d'arbre, ou l'un des trois groupes fixes. */
const ROOT_KEY = ':root'
const UNPLACED_KEY = ':unplaced'
const IDLE_KEY = ':idle'

/**
 * L'onglet Activité groupé par worktree : qui travaille où (planche B3 de
 * `docs/audits/2026-10-21-page-projet/final/`).
 *
 * Un groupe par arbre, la racine en tête. L'en-tête dit la branche, son écart à la base,
 * propre ou modifié, et le nombre de sessions ; les lignes perdent alors leur colonne
 * branche. Dessous, les arbres qu'aucune session n'occupe, avec le geste qui leur va,
 * puis les branches qu'aucun arbre n'a extraites.
 *
 * C'est l'ancienne vue Chantiers des réglages (#78), déplacée ici : elle lit la même
 * liste d'état des worktrees et ouvre la même confirmation de nettoyage. Rien ne se
 * nettoie de soi-même (#100) : chaque retrait part d'un geste.
 */
export function WorktreeGroups({
  projectId,
  rows,
  status,
  rootGit,
  conversations,
  filtering,
  words,
}: {
  projectId: string
  /** Les lignes que le filtre garde, dans l'ordre de la liste. */
  rows: ActivityRow[]
  status: WorktreeStatusListDto | undefined
  rootGit: GitSummaryDto | null
  /** Toutes les conversations du projet, pour dater la dernière session d'un arbre. */
  conversations: ConversationDto[]
  /** Un filtre est posé : les arbres sans session ne restent que si leur nom y répond. */
  filtering: boolean
  words: string[]
}) {
  const t = useTranslate()
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [cleaning, setCleaning] = useState<WorktreeStatusDto | null>(null)
  const [batch, setBatch] = useState(false)

  const base = status?.base ?? null
  const grouping = groupByWorktree(
    rows.map((row) => ({ ...row, updatedAt: row.entry.conversation.updatedAt })),
    status?.worktrees ?? [],
  )
  // Un filtre de texte cherche aussi dans le nom des arbres sans session ; un filtre
  // d'état ou de carte ne peut pas leur répondre, ils n'ont ni l'un ni l'autre.
  const idle = filtering
    ? grouping.idle.filter(
        (tree) => words.length > 0 && words.every((word) => tree.name.toLocaleLowerCase().includes(word)),
      )
    : grouping.idle
  const merged = idle.filter((tree) => tree.state === 'merged')
  const missing = idle.filter((tree) => tree.state === 'missing').length
  const branches = filtering ? [] : (status?.branches ?? [])

  const toggle = (key: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const sessions = (members: ActivityRow[]) => (
    <ul className="divide-y divide-line">
      {members.map((row) => (
        <SessionRow
          key={row.entry.conversation.id}
          conversation={row.entry.conversation}
          marker={row.marker}
          summary={row.summary}
          place={row.place}
          inTree
        />
      ))}
    </ul>
  )

  const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]))
  const lastSession = (tree: WorktreeStatusDto): number | null => {
    const dates = tree.conversations.flatMap((link) => {
      const conversation = byId.get(link.id)
      return conversation ? [conversation.updatedAt] : []
    })
    return dates.length > 0 ? Math.max(...dates) : null
  }

  const nothing =
    rows.length === 0 && grouping.inhabited.length === 0 && idle.length === 0 && branches.length === 0
  if (nothing) {
    return filtering ? (
      <EmptyState title={t('projectActivity.noMatch')} />
    ) : (
      <EmptyState icon={<Layers size={20} />} title={t('projectActivity.empty')} description={t('projectActivity.emptyHint')} />
    )
  }

  return (
    <>
      {grouping.root.length > 0 ? (
        <TreeSection
          id={ROOT_KEY}
          open={!folded.has(ROOT_KEY)}
          onToggle={() => toggle(ROOT_KEY)}
          icon={<GitBranch size={14} aria-hidden className="shrink-0 text-ink-faint" />}
          name={rootGit?.branch ?? t('projectActivity.row.root')}
          facts={
            <>
              <span>{t('projectActivity.tree.root')}</span>
              {rootGit && base && rootGit.branch === base ? <span>{t('projectActivity.tree.defaultBranch')}</span> : null}
              {rootGit ? <Cleanliness changed={rootGit.changedFiles} /> : null}
            </>
          }
          count={grouping.root.length}
        >
          {sessions(grouping.root)}
        </TreeSection>
      ) : null}

      {grouping.inhabited.map(({ tree, rows: members }) => (
        <TreeSection
          key={tree.path}
          id={tree.path}
          open={!folded.has(tree.path)}
          onToggle={() => toggle(tree.path)}
          icon={<FolderGit2 size={14} aria-hidden className="shrink-0 text-ink-faint" />}
          name={tree.name}
          title={tree.path}
          facts={
            <>
              {base ? <span>{divergence(tree, base, t)}</span> : null}
              {tree.state === 'missing' ? (
                <span className="text-critical">{t('projectActivity.tree.missing')}</span>
              ) : (
                <Cleanliness changed={tree.modified + tree.untracked} />
              )}
            </>
          }
          // La place du badge de PR (#115), avant le compteur.
          trailing={
            <IconButton size="sm" label={t('worktrees.clean.title', { name: tree.name })} onClick={() => setCleaning(tree)}>
              <BrushCleaning size={14} />
            </IconButton>
          }
          count={members.length}
        >
          {sessions(members)}
        </TreeSection>
      ))}

      {grouping.unplaced.length > 0 ? (
        <TreeSection
          id={UNPLACED_KEY}
          open={!folded.has(UNPLACED_KEY)}
          onToggle={() => toggle(UNPLACED_KEY)}
          icon={<TriangleAlert size={14} aria-hidden className="shrink-0 text-critical" />}
          name={t('projectActivity.tree.unplaced')}
          mono={false}
          count={grouping.unplaced.length}
        >
          {/* L'arbre inconnu n'a pas d'en-tête qui dise sa branche : la ligne la garde. */}
          <ul className="divide-y divide-line">
            {grouping.unplaced.map((row) => (
              <SessionRow
                key={row.entry.conversation.id}
                conversation={row.entry.conversation}
                marker={row.marker}
                summary={row.summary}
                place={row.place}
              />
            ))}
          </ul>
        </TreeSection>
      ) : null}

      {idle.length > 0 ? (
        <TreeSection
          id={IDLE_KEY}
          open={!folded.has(IDLE_KEY)}
          onToggle={() => toggle(IDLE_KEY)}
          icon={<FolderGit2 size={14} aria-hidden className="shrink-0 text-ink-faint" />}
          name={t('projectActivity.idle.title')}
          mono={false}
          facts={
            <>
              <span>{plural('projectActivity.idle.trees', idle.length)}</span>
              {merged.length > 0 ? <span>{plural('projectActivity.idle.merged', merged.length)}</span> : null}
              {missing > 0 ? <span>{plural('projectActivity.idle.missing', missing)}</span> : null}
            </>
          }
          trailing={
            merged.length > 0 ? (
              <Button variant="secondary" size="sm" icon={<BrushCleaning size={14} />} onClick={() => setBatch(true)}>
                {plural('projectActivity.idle.cleanMerged', merged.length)}
              </Button>
            ) : null
          }
        >
          <ul className="divide-y divide-line">
            {idle.map((tree) => (
              <IdleTreeRow
                key={tree.path}
                projectId={projectId}
                tree={tree}
                base={base}
                lastSession={lastSession(tree)}
                onClean={() => setCleaning(tree)}
              />
            ))}
            {branches.length > 0 ? <LooseBranches branches={branches} /> : null}
          </ul>
        </TreeSection>
      ) : branches.length > 0 ? (
        <ul className="border-t border-line">
          <LooseBranches branches={branches} />
        </ul>
      ) : null}

      {cleaning ? (
        <WorktreeCleanupDialog projectId={projectId} tree={cleaning} base={base} onClose={() => setCleaning(null)} />
      ) : null}
      {batch ? <CleanMergedDialog projectId={projectId} trees={merged} onClose={() => setBatch(false)} /> : null}
    </>
  )
}

/** Un groupe : son en-tête collant, qui plie et déplie, puis ses lignes. */
function TreeSection({
  id,
  open,
  onToggle,
  icon,
  name,
  title,
  mono = true,
  facts,
  trailing,
  count,
  children,
}: {
  id: string
  open: boolean
  onToggle: () => void
  icon: ReactNode
  name: string
  title?: string
  mono?: boolean
  facts?: ReactNode
  trailing?: ReactNode
  count?: number
  children: ReactNode
}) {
  const headingId = `worktree-group-${id.replace(/[^A-Za-z0-9_-]/g, '_')}`
  return (
    <section aria-labelledby={headingId}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-line bg-sunken pr-4 first:border-t-0">
        <h2 id={headingId} className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-2.5 py-1.5 pl-4 text-left text-sm text-ink-soft hover:text-ink"
          >
            {open ? (
              <ChevronDown size={14} aria-hidden className="shrink-0 text-ink-faint" />
            ) : (
              <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-faint" />
            )}
            {icon}
            <span title={title} className={cx('min-w-0 shrink truncate text-ink', mono && 'font-mono text-[0.8125rem]')}>
              {name}
            </span>
            {facts ? (
              <span className="hidden min-w-0 items-center gap-3 truncate text-xs text-ink-faint sm:flex">{facts}</span>
            ) : null}
          </button>
        </h2>
        {trailing}
        {count !== undefined ? <span className="text-xs text-ink-faint tabular-nums">{count}</span> : null}
      </div>
      {open ? children : null}
    </section>
  )
}

/** Propre, ou le nombre de fichiers que `git status` signale, en ambre. */
function Cleanliness({ changed }: { changed: number }) {
  const t = useTranslate()
  if (changed === 0) {
    return (
      <span className="inline-flex items-center gap-1">
        <Check size={12} aria-hidden />
        {t('projectActivity.tree.clean')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-caution">
      <span aria-hidden className="size-1.5 rounded-full bg-caution" />
      {plural('projectActivity.tree.changed', changed)}
    </span>
  )
}

/** L'écart à la base : « +4 sur main », « +9 · −14 derrière main », « à jour avec main ». */
function divergence(
  tree: Pick<WorktreeStatusDto, 'ahead' | 'behind'>,
  base: string,
  t: ReturnType<typeof useTranslate>,
): string {
  if (tree.ahead > 0 && tree.behind > 0) return t('projectActivity.tree.diverged', { ahead: tree.ahead, behind: tree.behind, base })
  if (tree.ahead > 0) return t('projectActivity.tree.ahead', { count: tree.ahead, base })
  if (tree.behind > 0) return t('projectActivity.tree.behind', { count: tree.behind, base })
  return t('projectActivity.tree.even', { base })
}

const GESTURE_LABEL: Record<IdleGesture, 'worktrees.clean' | 'projectActivity.idle.resume' | 'projectActivity.idle.forget'> = {
  clean: 'worktrees.clean',
  resume: 'projectActivity.idle.resume',
  forget: 'projectActivity.idle.forget',
}

/**
 * Un arbre sans session : ce qu'il garde, depuis quand personne n'y est venu, et son
 * geste. « Reprendre » ouvre un brouillon dans l'arbre ; le nettoyage reste à portée,
 * en icône, pour un arbre dont on sait le travail abandonné.
 */
function IdleTreeRow({
  projectId,
  tree,
  base,
  lastSession,
  onClean,
}: {
  projectId: string
  tree: WorktreeStatusDto
  base: string | null
  lastSession: number | null
  onClean: () => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const gesture = idleGestureOf(tree)
  const icon =
    tree.state === 'merged' ? (
      <GitMerge size={14} aria-hidden className="text-loop" />
    ) : tree.state === 'missing' || tree.state === 'unreadable' ? (
      <TriangleAlert size={14} aria-hidden className="text-critical" />
    ) : (
      <FolderGit2 size={14} aria-hidden className="text-ink-faint" />
    )
  const activity = lastActivity(tree)
  const when =
    lastSession !== null
      ? t('projectActivity.idle.lastSession', { age: shortAge(lastSession) })
      : activity > 0
        ? t('projectActivity.idle.lastActivity', { age: shortAge(activity) })
        : null

  return (
    <li className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 px-4 py-1.5 md:grid-cols-[1rem_minmax(0,16rem)_minmax(0,1fr)_auto_auto] md:pl-[2.625rem]">
      {icon}
      <span title={tree.path} className="min-w-0 truncate font-mono text-[0.8125rem] text-ink-soft">
        {tree.name}
      </span>
      <span className="col-start-2 row-start-2 min-w-0 truncate text-sm md:col-start-auto md:row-start-auto">
        {idleDetail(tree, base, t)}
      </span>
      <span className="hidden text-xs whitespace-nowrap text-ink-faint md:block">{when}</span>
      <span className="col-start-3 row-span-2 row-start-1 flex items-center justify-end gap-1 md:col-start-auto md:row-span-1 md:row-start-auto">
        {gesture === 'resume' ? (
          <IconButton size="sm" label={t('worktrees.clean.title', { name: tree.name })} onClick={onClean}>
            <BrushCleaning size={14} />
          </IconButton>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => (gesture === 'resume' ? navigate(`/p/${projectId}/c/new?worktree=${tree.id}`) : onClean())}
        >
          {t(GESTURE_LABEL[gesture])}
        </Button>
      </span>
    </li>
  )
}

/** Ce qu'un arbre sans session garde, en une phrase courte. */
function idleDetail(tree: WorktreeStatusDto, base: string | null, t: ReturnType<typeof useTranslate>): ReactNode {
  if (tree.state === 'missing') return <span className="text-critical">{t('projectActivity.tree.missing')}</span>
  if (tree.state === 'unreadable') return <span className="text-critical">{t('worktrees.state.unreadable')}</span>
  if (tree.state === 'merged') return <span className="text-ink-soft">{t('projectActivity.idle.mergedOne')}</span>
  if (tree.state === 'empty') return <span className="text-ink-faint">{t('worktrees.state.empty')}</span>
  const changed = tree.modified + tree.untracked
  const parts = [
    ...(base && tree.ahead > 0 ? [t('projectActivity.tree.ahead', { count: tree.ahead, base })] : []),
    changed > 0 ? plural('worktrees.modified', changed) : t('projectActivity.tree.clean'),
  ]
  return <span className="text-ink-soft">{parts.join(' · ')}</span>
}

/** La ligne pliée en pied : les branches qu'aucun arbre n'a extraites. */
function LooseBranches({ branches }: { branches: { name: string; merged: boolean }[] }) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const merged = branches.filter((branch) => branch.merged).length
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm text-ink-soft hover:text-ink md:pl-[2.625rem]"
      >
        <GitBranch size={14} aria-hidden className="shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate">
          {merged > 0
            ? t(branches.length > 1 ? 'projectActivity.branches.manyMerged' : 'projectActivity.branches.oneMerged', {
                count: branches.length,
                merged,
              })
            : plural('projectActivity.branches', branches.length)}
        </span>
        <span className="shrink-0 text-ink-faint">{t(open ? 'projectActivity.branches.hide' : 'projectActivity.branches.show')}</span>
      </button>
      {open ? (
        <ul className="pb-2">
          {branches.map((branch) => (
            <li key={branch.name} className="flex items-center gap-3 py-0.5 pr-4 pl-[3.625rem] text-sm md:pl-[4.375rem]">
              <span className="min-w-0 truncate font-mono text-[0.8125rem] text-ink-soft">{branch.name}</span>
              {branch.merged ? <span className="text-xs text-loop">{t('projectActivity.idle.mergedOne')}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * « Nettoyer les N fusionnés » : un seul geste pour tous les arbres fusionnés sans
 * session, chacun retiré avec sa branche. Un arbre fusionné ne garde rien que la base
 * n'ait déjà, et le serveur refait ses vérifications au moment d'agir : un arbre où une
 * session s'est mise à travailler entre-temps est laissé, et dit.
 */
function CleanMergedDialog({
  projectId,
  trees,
  onClose,
}: {
  projectId: string
  trees: WorktreeStatusDto[]
  onClose: () => void
}) {
  const t = useTranslate()
  const clean = useCleanWorktree(projectId)
  const [running, setRunning] = useState(false)
  const [failures, setFailures] = useState<string[]>([])

  const run = async () => {
    setRunning(true)
    const failed: string[] = []
    for (const tree of trees) {
      try {
        await clean.mutateAsync({ path: tree.path, deleteBranch: true, stopServices: true })
      } catch (err) {
        failed.push(`${tree.name} : ${err instanceof ApiRequestError ? err.message : String(err)}`)
      }
    }
    setRunning(false)
    if (failed.length === 0) onClose()
    else setFailures(failed)
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={(open: boolean) => {
        if (!open && !running) onClose()
      }}
      title={plural('projectActivity.idle.cleanMerged', trees.length)}
      confirmLabel={t('worktrees.clean.confirm')}
      busy={running || failures.length > 0}
      onConfirm={() => void run()}
    >
      <p>{t('projectActivity.idle.cleanMergedIntro')}</p>
      <ul className="flex flex-col gap-0.5">
        {trees.map((tree) => (
          <li key={tree.path} className="truncate font-mono text-[0.8125rem] text-ink-soft" title={tree.path}>
            {tree.name}
          </li>
        ))}
      </ul>
      {failures.length > 0 ? (
        <Banner>
          {t('projectActivity.idle.cleanMergedFailed')}
          <ul>
            {failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
    </ConfirmDialog>
  )
}
