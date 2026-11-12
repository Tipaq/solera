import { ArrowUpRight, ChevronRight, Cloud, FolderPlus, GitBranch, GitCommitHorizontal, MessageSquarePlus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, ConfirmDialog, cx } from '@solera/ui'
import { CardRef } from '../code/CardRef'
import { BranchDot } from '../code/VerdictDot'
import { PR_TONE, pluralOf, type BranchInfo } from '../../lib/code-model'
import { shortAge } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { useCleanBranches, useCreateWorktree } from '../../lib/worktrees'
import { laneFrame } from './Lane'
import { errorText, useTravailNotice } from './TravailNotice'

/** Le dépôt distant d'une branche qui n'existe que là-bas. */
const REMOTE = 'origin'

/** Le nom montré d'une branche : `origin/` devant une distante. */
export function branchLabel(branch: BranchInfo): string {
  return branch.remoteOnly ? `${REMOTE}/${branch.name}` : branch.name
}

/**
 * Les gestes de création d'une branche sans arbre : l'ouvrir dans un worktree, ou y
 * lancer une session (le worktree d'abord, puis la session dedans). Une distante devient
 * une branche locale qui la suit.
 */
function useOpenBranch(projectId: string, branch: BranchInfo) {
  const t = useTranslate()
  const navigate = useNavigate()
  const say = useTravailNotice()
  const create = useCreateWorktree(projectId)
  const open = async (then: 'stay' | 'session') => {
    try {
      const tree = await create.mutateAsync({ name: branch.name, baseRef: branch.remoteOnly ? `${REMOTE}/${branch.name}` : 'HEAD' })
      if (then === 'session') navigate(`/p/${projectId}/c/new?worktree=${tree.id}`)
      else say(t('travail.branchLane.opened', { branch: branch.name }))
    } catch (error) {
      say(errorText(error), 'critical')
    }
  }
  return { open, busy: create.isPending }
}

/**
 * Supprimer des branches fusionnées (S8), après confirmation. Le serveur rejuge chacune :
 * celles qu'il garde sont dites une à une, avec leur raison.
 */
export function useDeleteBranches(projectId: string) {
  const t = useTranslate()
  const say = useTravailNotice()
  const clean = useCleanBranches(projectId)
  const run = async (names: string[]) => {
    try {
      const result = await clean.mutateAsync(names)
      const refused = result.refused.map((entry) => t(`branchCleanup.refused.${entry.reason}`, { name: entry.name, message: entry.message ?? '' }))
      if (refused.length > 0) say(refused.join(' '), 'critical')
      else say(t(`travail.mergedBranches.deleted.${pluralOf(result.deleted.length)}`, { count: result.deleted.length }))
    } catch (error) {
      say(errorText(error), 'critical')
    }
  }
  return { run, busy: clean.isPending }
}

/**
 * Le couloir d'une branche sans arbre (`projet.md` T-4.5) : son genre, son avance, son
 * dernier commit, sa PR et sa carte ; ses trois derniers commits ; ses gestes en ligne.
 * Une branche fusionnée n'a pas de couloir : elle vit dans `MergedBranches`, qui la
 * supprime.
 */
export function BranchLane({ projectId, branch, anchorId, highlight = false }: { projectId: string; branch: BranchInfo; anchorId: string; highlight?: boolean }) {
  const t = useTranslate()
  const { open, busy } = useOpenBranch(projectId, branch)
  const label = branchLabel(branch)

  return (
    <section
      id={anchorId}
      aria-label={label}
      data-lane={branch.key}
      data-highlight={highlight || undefined}
      className={laneFrame(highlight, branch.kind === 'pr' ? 'ring-accent/30' : 'ring-line')}
    >
      <header className="flex min-w-0 items-start gap-2.5 bg-surface/30 px-3 py-2">
        <BranchDot kind={branch.kind} className="mt-1.5" />
        <div className="flex max-w-[44rem] min-w-0 flex-initial flex-col gap-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            {branch.remoteOnly ? <Cloud size={13} aria-hidden className="shrink-0 text-ink-faint" /> : <GitBranch size={13} aria-hidden className="shrink-0 text-ink-faint" />}
            <span className="min-w-0 truncate font-mono text-sm font-medium">{label}</span>
            <span className="text-xs text-ink-soft">{t(`code.branchKind.${branch.kind}`)}</span>
            <span className="text-xs text-ink-faint">{t('travail.branchLane.noTree')}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
            {branch.ahead !== null ? (
              <span className="tabular-nums" title={t(`code.drift.ahead.${pluralOf(branch.ahead)}`, { count: branch.ahead })}>
                ↑{branch.ahead} ↓{branch.behind ?? 0}
              </span>
            ) : null}
            {branch.lastCommitAt !== null ? <span className="tabular-nums">{t('travail.branchLane.lastCommit', { age: shortAge(branch.lastCommitAt) })}</span> : null}
            {branch.pr ? (
              <a href={branch.pr.url} target="_blank" rel="noreferrer" className="inline-flex rounded focus-visible:outline-2 focus-visible:outline-accent">
                <Badge tone={PR_TONE[branch.pr.state]}>{t('travail.index.pr', { number: branch.pr.number, state: t(`code.pr.${branch.pr.state}`) })}</Badge>
              </a>
            ) : null}
            {branch.card ? <CardRef projectId={projectId} card={branch.card} /> : null}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-1 px-3 py-2">
        {branch.commits.length > 0 ? (
          <ol className="flex flex-col">
            {branch.commits.map((commit) => (
              <li key={commit.hash} className="flex min-h-8 min-w-0 items-center gap-2.5 text-sm">
                <GitCommitHorizontal size={13} aria-hidden className="shrink-0 text-ink-faint" />
                <code className="shrink-0 font-mono text-xs text-ink-faint">{commit.shortHash}</code>
                <span className="min-w-0 flex-1 truncate">{commit.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">{shortAge(commit.at)}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <div className="flex flex-wrap items-center gap-1">
          <Button size="sm" variant="ghost" icon={<FolderPlus size={13} />} onClick={() => void open('stay')} disabled={busy}>
            {t('travail.branchLane.openTree')}
          </Button>
          <Button size="sm" variant="ghost" icon={<MessageSquarePlus size={13} />} onClick={() => void open('session')} disabled={busy}>
            {t('travail.branchLane.launch')}
          </Button>
          {branch.pr ? (
            <a href={branch.pr.url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm text-ink-soft hover:bg-surface-high hover:text-ink focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:h-11">
              {t('travail.gesture.pr', { number: branch.pr.number })}
              <ArrowUpRight size={12} aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/** La confirmation d'une suppression de branches fusionnées. */
function DeleteBranchesDialog({ names, busy, onClose, onConfirm }: { names: string[] | null; busy: boolean; onClose: () => void; onConfirm: (names: string[]) => void }) {
  const t = useTranslate()
  const count = names?.length ?? 0
  return (
    <ConfirmDialog
      open={names !== null}
      onOpenChange={(open) => (open ? null : onClose())}
      title={t(`travail.mergedBranches.confirm.${pluralOf(count)}`, { count })}
      confirmLabel={t('travail.branchLane.delete')}
      tone="critical"
      busy={busy}
      onConfirm={() => (names ? onConfirm(names) : onClose())}
    >
      <p className="text-sm text-ink-soft">{t('travail.mergedBranches.intro')}</p>
      <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
        {(names ?? []).map((name) => (
          <li key={name} className="truncate font-mono text-xs text-ink-soft">
            {name}
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  )
}

/**
 * Les branches fusionnées sans arbre (`projet.md` T-4.8), repliées : « › N branches
 * fusionnées · sans arbre, rien à perdre » et « Supprimer » ; dépliées, leur liste.
 */
export function MergedBranches({ projectId, branches, open: forced, anchorId }: { projectId: string; branches: BranchInfo[]; open: boolean; anchorId: string }) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteBranches(projectId)
  const shown = open || forced
  const count = branches.length
  // Seules les branches locales se suppriment ; une distante fusionnée reste à la forge.
  const local = branches.filter((branch) => !branch.remoteOnly).map((branch) => branch.name)

  return (
    <section id={anchorId} aria-label={t(`travail.mergedBranches.toggle.${pluralOf(count)}`, { count })} className="flex scroll-mt-4 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={shown}
          className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          <ChevronRight size={14} aria-hidden className={cx('transition-transform', shown && 'rotate-90')} />
          <GitBranch size={13} aria-hidden className="text-ink-faint" />
          <span className="font-medium">{t(`travail.mergedBranches.toggle.${pluralOf(count)}`, { count })}</span>
          <span className="text-xs text-ink-faint">{t('travail.mergedBranches.hint')}</span>
        </button>
        {local.length > 0 ? (
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirming(true)} disabled={remove.busy} className="ml-auto">
            {t('travail.branchLane.delete')}
          </Button>
        ) : null}
      </div>
      {shown ? (
        <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
          {branches.map((branch) => (
            <li key={branch.key} className="flex min-h-9 min-w-0 items-center gap-2.5 px-3 text-sm">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-positive" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm">{branchLabel(branch)}</span>
              {branch.pr ? <span className="shrink-0 text-xs text-ink-faint">{t('travail.gesture.pr', { number: branch.pr.number })}</span> : null}
              <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-faint">{branch.lastCommitAt !== null ? shortAge(branch.lastCommitAt) : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <DeleteBranchesDialog
        names={confirming ? local : null}
        busy={remove.busy}
        onClose={() => setConfirming(false)}
        onConfirm={(names) => {
          setConfirming(false)
          void remove.run(names)
        }}
      />
    </section>
  )
}
