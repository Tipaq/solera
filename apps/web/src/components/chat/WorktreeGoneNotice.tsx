import { FolderX } from 'lucide-react'
import { Button } from '@solera/ui'
import { RESUMES_FROM_OTHER_DIRECTORY, type AgentKind } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'

/**
 * À la place du composer, quand le worktree de la conversation a disparu (carte #61).
 *
 * Le cas courant est un merge avec `--delete-branch` : le travail est livré, d'où
 * *Archiver* en geste principal. *Continuer à la racine* rattache le fil au dossier du
 * projet, et dit avant le clic si le CLI y garde sa session ou repart sur une neuve :
 * rien ne bascule sans qu'on l'ait choisi. Pas de « recréer le worktree » : après un
 * `--delete-branch`, la branche n'existe plus.
 */
export function WorktreeGoneNotice({
  agent,
  canAct,
  pending,
  error,
  onArchive,
  onContinue,
}: {
  agent: AgentKind
  /** Faux pour qui lit un fil partagé sans en être le propriétaire. */
  canAct: boolean
  pending: boolean
  error?: string
  onArchive: () => void
  onContinue: () => void
}) {
  const t = useTranslate()
  const keepsSession = RESUMES_FROM_OTHER_DIRECTORY[agent]

  return (
    <div
      role="status"
      data-worktree-gone
      className="surface flex flex-col gap-3 rounded-xl border border-caution/35 bg-caution/10 p-3"
    >
      <div className="flex items-start gap-2 text-sm">
        <FolderX size={16} className="mt-0.5 shrink-0 text-caution" />
        <div className="min-w-0">
          <p className="font-medium text-ink">{t('conversation.worktreeGone.title')}</p>
          <p className="text-ink-soft">{t('conversation.worktreeGone.body')}</p>
          {canAct ? (
            <p className="mt-1 text-xs text-ink-faint">
              {keepsSession
                ? t('conversation.worktreeGone.keepsSession')
                : t('conversation.worktreeGone.newSession')}
            </p>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-xs text-critical">{error}</p> : null}
      {canAct ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={pending} onClick={onContinue}>
            {t('conversation.worktreeGone.continue')}
          </Button>
          <Button size="sm" disabled={pending} onClick={onArchive}>
            {t('conversation.worktreeGone.archive')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
