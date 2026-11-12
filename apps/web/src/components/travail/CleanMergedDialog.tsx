import { useState } from 'react'
import type { WorktreeStatusDto } from '@solera/protocol'
import { Banner, ConfirmDialog } from '@solera/ui'
import { useTranslate } from '../../lib/i18n'
import { useCleanWorktree } from '../../lib/worktrees'
import { plural } from '../WorktreeCleanupDialog'
import { errorText } from './TravailNotice'

/**
 * « Nettoyer les N fusionnés » : un seul geste pour tous les arbres fusionnés sans
 * session, chacun retiré avec sa branche. Un arbre fusionné ne garde rien que la base
 * n'ait déjà, et le serveur refait ses vérifications au moment d'agir : un arbre où une
 * session s'est mise à travailler entre-temps est laissé, et dit.
 *
 * Le geste de la section « À nettoyer » de « Par arbre », en attendant le dialogue
 * unique de Travail, qui réunira arbres et branches (`projet.md` T-12, #177).
 */
export function CleanMergedDialog({
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
        failed.push(t('travail.cleanup.failed', { name: tree.name, error: errorText(err) }))
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
          <li key={tree.path} className="truncate font-mono text-code text-ink-soft" title={tree.path}>
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
