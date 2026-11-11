import type { ReactNode } from 'react'
import { Lock, Undo2 } from 'lucide-react'
import type { GitLockDto, GitUndoDto, GitUndoKind } from '@solera/protocol'
import { useTranslate, type MessageKey } from '../../../lib/i18n'
import { PanelNotice, cx, panelGestureClass } from '@solera/ui'
import { useGitActions } from './actions'

/**
 * Les trois choses que la vue dit au-dessus de tout le reste : qui tient le dépôt, ce
 * qui vient d'être fait et peut être défait, et ce qui a échoué.
 *
 * Les deux premiers sont les deux moitiés d'une même promesse (planches
 * `tour-1/clair/04` et T13) : on n'écrit pas à deux, et on ne promet pas une
 * annulation qu'on ne peut pas tenir.
 *
 * Tous trois sont des bandes de retour du cadre commun (`PanelNotice`) : sous la ligne
 * d'outils, au même endroit que dans les autres onglets du panneau.
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
  'branches-delete': 'git.undo.branchesDelete',
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
    <PanelNotice>
      <Notice
        icon={<Lock size={14} />}
        title={t('git.lock.title', { title: lock.title })}
        hint={t('git.lock.hint')}
        action={
          <button type="button" onClick={() => onOpenThread(lock.threadId)} className={cx(panelGestureClass, 'shrink-0')}>
            {t('git.lock.open')}
          </button>
        }
      />
    </PanelNotice>
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
    <PanelNotice>
      <Notice
        icon={<Undo2 size={14} />}
        title={t(UNDO_LABELS[undo.kind], { subject: undo.subject })}
        hint={
          <>
            {undo.target ? t('git.undo.back', { target: undo.target }) : t('git.undo.backNowhere')}
            {' '}
            {undo.pushed ? t('git.undo.pushed') : t('git.undo.notPushed')}
          </>
        }
        action={
          <button type="button" onClick={run} disabled={pending || !!lock} className={cx(panelGestureClass, 'shrink-0')}>
            <Undo2 size={13} aria-hidden />
            {t('git.toolbar.undo')}
          </button>
        }
      />
    </PanelNotice>
  )
}

/** Ce que git a répondu quand il a refusé. Sa phrase, pas une reformulation. */
export function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <PanelNotice tone="critical" onClose={onClose}>
      <span className="break-words">{message}</span>
    </PanelNotice>
  )
}

/** Une bande à deux lignes — ce qui se passe, ce que ça veut dire — et son geste. */
function Notice({ icon, title, hint, action }: { icon: ReactNode; title: ReactNode; hint: ReactNode; action: ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="shrink-0 text-ink-faint">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ink">{title}</span>
        <span className="truncate text-ink-faint">{hint}</span>
      </span>
      {action}
    </span>
  )
}
