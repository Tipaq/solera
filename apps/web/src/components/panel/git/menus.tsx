import { useState, type ReactNode } from 'react'
import {
  ArrowUpFromLine,
  Copy,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  Link2,
  MessagesSquare,
  Pencil,
  RotateCcw,
  Rows3,
  Tag,
  Trash2,
  Undo2,
} from 'lucide-react'
import { api } from '../../../lib/api'
import { useTranslate } from '../../../lib/i18n'
import { Button, Menu, MenuItem, MenuSeparator, cx } from '@solera/ui'
import { useGitActions } from './actions'

/**
 * Les deux menus de la règle de rangement : celui d'un commit, celui d'une branche.
 *
 * La règle T0, qui est la vraie décision du dessin : un geste qui porte sur *cet*
 * objet vit dans le menu de cet objet, jamais dans la barre d'outils. C'est elle qui
 * permet de tout mettre sans que la barre finisse à dix-huit boutons — celle de
 * GitKraken en a huit pour la même raison.
 *
 * Les deux réinitialisations sont **dépliées** et non cachées derrière un sous-menu :
 * « doux » et « dur » n'ont pas les mêmes conséquences, et un sous-menu les ferait
 * passer pour deux variantes d'une même chose. Elles sont en rouge, et la dure passe
 * par le garde-fou de T13.
 */

/** Ce qu'un menu doit savoir du dépôt pour nommer ses entrées. */
export interface MenuContext {
  /** Branche courante, pour écrire « Fusionner dans main » plutôt que « Fusionner ». */
  branch: string | null
  locked: boolean
  projectId: string | null
  onOpenThread: (id: string) => void
  /** Ouvre le rebase interactif en partant de ce commit (planche T9). */
  onRebase: (hash: string) => void
}

export function CommitMenu({
  hash,
  shortHash,
  threadId,
  context,
  trigger,
}: {
  hash: string
  shortHash: string
  threadId: string | null
  context: MenuContext
  trigger: ReactNode
}) {
  const t = useTranslate()
  const { run } = useGitActions()
  const [asking, setAsking] = useState<'branch' | 'tag' | null>(null)
  const branch = context.branch ?? t('git.menu.currentBranch')

  return (
    <>
      <Menu align="start" trigger={trigger}>
        <MenuItem
          icon={<GitBranch size={13} />}
          disabled={context.locked}
          onSelect={() => run({ kind: 'commit-switch', hash })}
        >
          {t('git.menu.commit.switch')}
        </MenuItem>
        <MenuItem
          icon={<GitBranchPlus size={13} />}
          disabled={context.locked}
          onSelect={() => setAsking('branch')}
        >
          {t('git.menu.commit.branch')}
        </MenuItem>
        <MenuItem
          icon={<GitMerge size={13} />}
          disabled={context.locked}
          onSelect={() => run({ kind: 'commit-merge', hash })}
        >
          {t('git.menu.commit.merge', { branch })}
        </MenuItem>
        <MenuItem
          icon={<RotateCcw size={13} />}
          disabled={context.locked}
          onSelect={() => run({ kind: 'commit-rebase', hash })}
        >
          {t('git.menu.commit.rebase', { branch })}
        </MenuItem>
        {/* « À partir d'ici » : le commit désigné est le point de **départ**, pas un
            des commits rejoués. C'est la lecture qu'en fait GitKraken, et la seule qui
            ne demande pas de deviner où s'arrête la liste. */}
        <MenuItem
          icon={<Rows3 size={13} />}
          disabled={context.locked}
          onSelect={() => context.onRebase(hash)}
        >
          {t('git.menu.commit.interactive')}
        </MenuItem>

        <MenuSeparator />

        <MenuItem
          icon={<Copy size={13} />}
          disabled={context.locked}
          onSelect={() => run({ kind: 'commit-cherry-pick', hash })}
        >
          {t('git.menu.commit.cherryPick')}
        </MenuItem>
        <MenuItem
          icon={<Undo2 size={13} />}
          disabled={context.locked}
          onSelect={() => run({ kind: 'commit-revert', hash })}
        >
          {t('git.menu.commit.revert')}
        </MenuItem>
        <MenuItem
          tone="critical"
          disabled={context.locked}
          onSelect={() => run({ kind: 'commit-reset', hash, mode: 'soft' })}
        >
          {t('git.menu.commit.resetSoft', { branch })}
        </MenuItem>
        <MenuItem
          tone="critical"
          disabled={context.locked}
          onSelect={() => run({ kind: 'commit-reset', hash, mode: 'hard' })}
        >
          {t('git.menu.commit.resetHard', { branch })}
        </MenuItem>

        <MenuSeparator />

        <MenuItem icon={<Tag size={13} />} disabled={context.locked} onSelect={() => setAsking('tag')}>
          {t('git.menu.commit.tag')}
        </MenuItem>
        <MenuItem icon={<Copy size={13} />} onSelect={() => void copy(hash)}>
          {t('git.menu.commit.copySha', { sha: shortHash })}
        </MenuItem>
        {/* La dernière entrée est la nôtre, et c'est elle qui justifie cette vue :
            d'un commit, aller à la conversation qui l'a écrit. */}
        <MenuItem
          icon={<MessagesSquare size={13} />}
          disabled={threadId === null}
          onSelect={() => threadId && context.onOpenThread(threadId)}
        >
          {t('git.menu.commit.thread')}
        </MenuItem>
      </Menu>

      {asking ? (
        <NameDialog
          title={asking === 'branch' ? t('git.menu.commit.branch') : t('git.menu.commit.tag')}
          label={asking === 'branch' ? t('git.menu.branchName') : t('git.menu.tagName')}
          onClose={() => setAsking(null)}
          onConfirm={(name) => {
            setAsking(null)
            run(
              asking === 'branch'
                ? { kind: 'commit-branch', hash, name }
                : { kind: 'commit-tag', hash, name },
            )
          }}
        />
      ) : null}
    </>
  )
}

export function BranchMenu({
  name,
  current,
  upstream,
  threadId,
  worktreePath,
  context,
  trigger,
}: {
  name: string
  current: boolean
  upstream: string | null
  threadId: string | null
  worktreePath: string | null
  context: MenuContext
  trigger: ReactNode
}) {
  const t = useTranslate()
  const { run } = useGitActions()
  const [asking, setAsking] = useState<'rename' | 'track' | null>(null)
  const [worktreeError, setWorktreeError] = useState<string | null>(null)

  return (
    <>
      <Menu align="end" trigger={trigger}>
        <MenuItem
          icon={<GitBranch size={13} />}
          disabled={context.locked || current}
          onSelect={() => run({ kind: 'branch-switch', name })}
        >
          {t('git.menu.branch.switch')}
        </MenuItem>
        <MenuItem
          icon={<GitMerge size={13} />}
          disabled={context.locked || current}
          onSelect={() => run({ kind: 'branch-merge', name })}
        >
          {t('git.menu.branch.merge', { branch: context.branch ?? '' })}
        </MenuItem>
        <MenuItem
          icon={<RotateCcw size={13} />}
          disabled={context.locked || current}
          onSelect={() => run({ kind: 'branch-rebase', name })}
        >
          {t('git.menu.branch.rebase', { branch: context.branch ?? '' })}
        </MenuItem>

        <MenuSeparator />

        <MenuItem
          icon={<ArrowUpFromLine size={13} />}
          disabled={context.locked}
          onSelect={() => run({ kind: 'push', force: false, branch: name })}
        >
          {t('git.menu.branch.push')}
        </MenuItem>
        <MenuItem
          tone="critical"
          disabled={context.locked}
          onSelect={() => run({ kind: 'push', force: true, branch: name })}
        >
          {t('git.menu.branch.forcePush')}
        </MenuItem>
        <MenuItem
          icon={<Link2 size={13} />}
          disabled={context.locked}
          onSelect={() => setAsking('track')}
        >
          {upstream ? t('git.menu.branch.retrack', { upstream }) : t('git.menu.branch.track')}
        </MenuItem>

        <MenuSeparator />

        <MenuItem icon={<Pencil size={13} />} disabled={context.locked} onSelect={() => setAsking('rename')}>
          {t('git.menu.branch.rename')}
        </MenuItem>
        {/* Un worktree n'est pas un geste git isolé : c'est un chantier que Solera
            inscrit en base. On passe donc par la route qui existe déjà, et pas par un
            `git worktree add` qui laisserait un dossier que personne ne connaît. */}
        <MenuItem
          icon={<GitBranchPlus size={13} />}
          disabled={context.locked || context.projectId === null || worktreePath !== null}
          onSelect={() => {
            if (!context.projectId) return
            void api
              .post(`/api/projects/${context.projectId}/worktrees`, { name, baseRef: name })
              .catch((err: unknown) => setWorktreeError(err instanceof Error ? err.message : String(err)))
          }}
        >
          {t('git.menu.branch.worktree')}
        </MenuItem>
        <MenuItem
          icon={<MessagesSquare size={13} />}
          disabled={threadId === null}
          onSelect={() => threadId && context.onOpenThread(threadId)}
        >
          {t('git.menu.branch.thread')}
        </MenuItem>

        <MenuSeparator />

        <MenuItem
          icon={<Trash2 size={13} />}
          tone="critical"
          disabled={context.locked || current}
          onSelect={() => run({ kind: 'branch-delete', name, force: true })}
        >
          {t('git.menu.branch.delete')}
        </MenuItem>
      </Menu>

      {asking ? (
        <NameDialog
          title={asking === 'rename' ? t('git.menu.branch.rename') : t('git.menu.branch.track')}
          label={asking === 'rename' ? t('git.menu.branchName') : t('git.menu.upstreamName')}
          initial={asking === 'rename' ? name : upstream ?? `origin/${name}`}
          onClose={() => setAsking(null)}
          onConfirm={(value) => {
            setAsking(null)
            run(
              asking === 'rename'
                ? { kind: 'branch-rename', name, to: value }
                : { kind: 'branch-track', name, upstream: value },
            )
          }}
        />
      ) : null}

      {worktreeError ? (
        <NoteDialog message={worktreeError} onClose={() => setWorktreeError(null)} />
      ) : null}
    </>
  )
}

/**
 * Le sha dans le presse-papier, ou à défaut sélectionnable.
 *
 * `navigator.clipboard` n'existe pas hors contexte sécurisé, ce qui est le cas d'une
 * instance atteinte par son IP sur le réseau local — un repli silencieux vaut mieux
 * qu'une exception qui casse le menu.
 */
async function copy(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // Rien : l'entrée du menu a fait ce qu'elle pouvait.
  }
}

/** Un nom à saisir — une branche, une étiquette, un amont. */
export function NameDialog({
  title,
  label,
  initial = '',
  onConfirm,
  onClose,
}: {
  title: string
  label: string
  initial?: string
  onConfirm: (value: string) => void
  onClose: () => void
}) {
  const t = useTranslate()
  const [value, setValue] = useState(initial)

  return (
    <Shell onClose={onClose} title={title}>
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value.trim().length > 0) onConfirm(value.trim())
          if (event.key === 'Escape') onClose()
        }}
        aria-label={label}
        placeholder={label}
        className={cx(
          'w-full rounded-md border border-line bg-transparent px-2.5 py-1.5 text-sm text-ink',
          'outline-none focus:border-accent placeholder:text-ink-faint',
        )}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('git.guard.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={value.trim().length === 0}
          onClick={() => onConfirm(value.trim())}
        >
          {t('git.menu.confirm')}
        </Button>
      </div>
    </Shell>
  )
}

function NoteDialog({ message, onClose }: { message: string; onClose: () => void }) {
  const t = useTranslate()
  return (
    <Shell onClose={onClose} title={t('git.menu.failed')}>
      <p className="text-sm text-ink-soft">{message}</p>
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t('git.guard.cancel')}
        </Button>
      </div>
    </Shell>
  )
}

function Shell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div
      className="scrim fixed inset-0 z-40 flex items-center justify-center p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="surface flex w-[min(22rem,92vw)] flex-col gap-3 rounded-lg border border-line p-4 shadow-pop"
      >
        <p className="text-heading font-semibold tracking-tight">{title}</p>
        {children}
      </div>
    </div>
  )
}
