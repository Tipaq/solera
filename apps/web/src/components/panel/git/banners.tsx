import { Lock, Undo2, X } from 'lucide-react'
import type { GitLockDto, GitUndoDto, GitUndoKind } from '@solera/protocol'
import { useTranslate, type MessageKey } from '../../../lib/i18n'
import { cx } from '@solera/ui'
import { useGitActions } from './actions'

/**
 * Les trois choses que la vue dit au-dessus de tout le reste : qui tient le dépôt, ce
 * qui vient d'être fait et peut être défait, et ce qui a échoué.
 *
 * Les deux premiers sont les deux moitiés d'une même promesse (planches
 * `tour-1/clair/04` et T13) : on n'écrit pas à deux, et on ne promet pas une
 * annulation qu'on ne peut pas tenir.
 */

/** Chaque geste annulable a sa phrase : « annuler » tout court n'apprend rien. */
const UNDO_LABELS: Record<GitUndoKind, MessageKey> = {
  commit: 'git.undo.commit',
  amend: 'git.undo.amend',
  merge: 'git.undo.merge',
  rebase: 'git.undo.rebase',
  'cherry-pick': 'git.undo.cherryPick',
  revert: 'git.undo.revert',
  reset: 'git.undo.reset',
  switch: 'git.undo.switch',
  'branch-create': 'git.undo.branchCreate',
  'branch-delete': 'git.undo.branchDelete',
  'branch-rename': 'git.undo.branchRename',
  tag: 'git.undo.tag',
  track: 'git.undo.track',
  'stash-push': 'git.undo.stashPush',
  'rebase-interactive': 'git.undo.rebaseInteractive',
}

/**
 * Le bandeau du verrou : qui travaille, et quoi attendre.
 *
 * Il ne dit pas « indisponible ». Le prix du verrou est un tour de dix minutes pendant
 * lequel on ne peut pas commiter, et le subir sans savoir pourquoi est ce qui rend un
 * verrou insupportable.
 */
export function LockBanner({
  lock,
  onOpenThread,
}: {
  lock: GitLockDto
  onOpenThread: (id: string) => void
}) {
  const t = useTranslate()
  return (
    <div className="flex items-center gap-2 border-b border-line bg-surface-high px-2.5 py-2">
      <Lock size={14} className="shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-ink">
          {t('git.lock.title', { title: lock.title })}
        </p>
        <p className="truncate text-micro text-ink-faint">{t('git.lock.hint')}</p>
      </div>
      <button
        type="button"
        onClick={() => onOpenThread(lock.threadId)}
        className="shrink-0 rounded-md border border-line px-2 py-1 text-micro font-medium text-ink-soft hover:bg-surface"
      >
        {t('git.lock.open')}
      </button>
    </div>
  )
}

/**
 * Le bandeau d'annulation : *quoi* on annule et *où* ça ramène.
 *
 * Il n'est affiché que tant que c'est vrai — le serveur ne rend `undo` que si le dépôt
 * est resté où le geste l'a laissé. D'où l'absence de bouton quand un agent a commité
 * par-dessus : l'offre disparaît au lieu d'échouer.
 */
export function UndoBanner({ undo }: { undo: GitUndoDto }) {
  const t = useTranslate()
  const { undo: run, pending, lock } = useGitActions()

  return (
    <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
      <Undo2 size={14} className="shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-ink">{t(UNDO_LABELS[undo.kind], { subject: undo.subject })}</p>
        <p className="truncate text-micro text-ink-faint">
          {undo.target ? t('git.undo.back', { target: undo.target }) : t('git.undo.backNowhere')}
          {' '}
          {undo.pushed ? t('git.undo.pushed') : t('git.undo.notPushed')}
        </p>
      </div>
      <button
        type="button"
        onClick={run}
        disabled={pending || !!lock}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-micro font-medium text-on-accent disabled:opacity-45"
      >
        <Undo2 size={12} />
        {t('git.toolbar.undo')}
      </button>
    </div>
  )
}

/** Ce que git a répondu quand il a refusé. Sa phrase, pas une reformulation. */
export function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  const t = useTranslate()
  return (
    <div className={cx('flex items-start gap-2 border-b border-critical/30 bg-critical/8 px-2.5 py-2')}>
      <p className="min-w-0 flex-1 text-micro break-words text-critical">{message}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('git.error.dismiss')}
        className="shrink-0 rounded text-critical/70 hover:text-critical"
      >
        <X size={13} />
      </button>
    </div>
  )
}
