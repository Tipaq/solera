import { Loader, Undo2, X } from 'lucide-react'
import { useMemo } from 'react'
import type { CheckpointFile } from '@solera/protocol'
import type { EditedFile, TurnCheckpoint } from '../../../lib/chat-fold'
import { openerLabel, sumLines, useCheckpointFileDiff } from '../../../lib/checkpoints'
import { parseUnifiedDiff } from '../../../lib/diff'
import { useTranslate } from '../../../lib/i18n'
import { Banner, Button, IconButton } from '@solera/ui'
import { FileDiffBody, FileRow, SectionTitle } from '../diff-parts'

/**
 * Les changements d'un seul tour, dans la vue Git.
 *
 * Le pendant de `CommitDetail` pour un tour : la même question, « qu'est-ce qui a
 * changé ? », posée entre les deux captures du tour plutôt qu'entre un commit et son
 * parent. Il prend la colonne le temps qu'on le lit, et la croix ramène au dépôt.
 *
 * Les diffs viennent des captures et non du disque, que le tour suivant a pu réécrire.
 * Chacun se lit au dépliage : un tour peut toucher des centaines de fichiers, et la
 * liste, elle, est déjà dans le journal.
 */
export function TurnChangesView({
  conversationId,
  checkpoint,
  canRestore,
  onRestore,
  onClose,
  onOpenFile,
}: {
  conversationId: string
  checkpoint: TurnCheckpoint
  canRestore: boolean
  onRestore: (checkpoint: TurnCheckpoint) => void
  onClose: () => void
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const { added, removed } = sumLines(checkpoint)
  const label = openerLabel(checkpoint)
  const count = checkpoint.files.length

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto pb-safe">
      <div className="flex items-start gap-1.5 border-b border-line px-2 py-1.5">
        <IconButton size="sm" label={t('checkpoint.view.close')} onClick={onClose}>
          <X size={15} />
        </IconButton>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink">{t('checkpoint.view.title')}</p>
          {label ? (
            <p className="mt-0.5 truncate text-micro text-ink-faint" title={label}>
              {label}
            </p>
          ) : null}
          {checkpoint.restored ? (
            <p className="mt-0.5 text-micro text-ink-faint italic">{t('checkpoint.restored.badge')}</p>
          ) : null}
        </div>

        {canRestore ? (
          <Button size="sm" variant="secondary" icon={<Undo2 size={14} />} onClick={() => onRestore(checkpoint)}>
            {t('checkpoint.restore.short')}
          </Button>
        ) : null}
      </div>

      <SectionTitle>
        {t(count > 1 ? 'git.commit.files' : 'git.commit.filesOne', { count, added, removed })}
      </SectionTitle>

      {checkpoint.excluded > 0 || checkpoint.truncated ? (
        <p className="border-b border-line/60 px-2.5 py-1.5 text-meta text-ink-faint">
          {checkpoint.excluded > 0 ? (
            <span title={t('checkpoint.view.excluded.hint')}>
              {t('checkpoint.view.excluded', { count: checkpoint.excluded })}
            </span>
          ) : null}
          {checkpoint.excluded > 0 && checkpoint.truncated ? ' · ' : null}
          {checkpoint.truncated ? t('checkpoint.summary.truncated') : null}
        </p>
      ) : null}

      {count === 0 ? <p className="px-2.5 py-2 text-xs text-ink-faint">{t('checkpoint.view.empty')}</p> : null}

      {checkpoint.files.map((file) => (
        <FileRow
          key={`${file.path}\0${file.oldPath ?? ''}`}
          path={file.path}
          action={ACTIONS[file.kind]}
          added={file.added ?? 0}
          removed={file.removed ?? 0}
          detail={file.oldPath ? t('checkpoint.view.renamedFrom', { path: file.oldPath }) : undefined}
        >
          {() => (
            <CheckpointFileBody
              conversationId={conversationId}
              checkpointKey={checkpoint.key}
              file={file}
              onOpenFile={onOpenFile}
            />
          )}
        </FileRow>
      ))}
    </div>
  )
}

/** Les natures de git ramenées aux trois actions du journal, comme le reste du panneau. */
const ACTIONS: Record<CheckpointFile['kind'], EditedFile['action']> = {
  added: 'created',
  deleted: 'deleted',
  modified: 'modified',
  renamed: 'modified',
  copied: 'created',
  typechange: 'modified',
}

function CheckpointFileBody({
  conversationId,
  checkpointKey,
  file,
  onOpenFile,
}: {
  conversationId: string
  checkpointKey: string
  file: CheckpointFile
  onOpenFile: (path: string) => void
}) {
  const t = useTranslate()
  const { data, error, isPending } = useCheckpointFileDiff(conversationId, checkpointKey, file.path, file.oldPath)
  const parsed = useMemo(() => (data ? (parseUnifiedDiff(data.patch)[0] ?? null) : null), [data])

  if (isPending) {
    return (
      <p className="flex items-center gap-1.5 px-2.5 py-1.5 text-meta text-ink-faint">
        <Loader size={11} className="animate-spin" />
        {t('changes.commits.diffLoading')}
      </p>
    )
  }
  if (error) {
    return (
      <div className="p-2">
        <Banner>{error instanceof Error ? error.message : t('changes.diff.error')}</Banner>
      </div>
    )
  }
  return (
    <>
      {parsed ? (
        <FileDiffBody file={parsed} onOpenFile={onOpenFile} />
      ) : (
        <p className="px-2.5 py-2 text-xs text-ink-faint">{t('checkpoint.view.diffEmpty')}</p>
      )}
      {data?.truncated ? <p className="px-2.5 py-1.5 text-meta text-caution">{t('changes.diff.truncated')}</p> : null}
    </>
  )
}
