import { FileText, Loader, X } from 'lucide-react'
import type { AttachmentDto } from '@solera/protocol'
import { formatBytes } from '../../lib/attachments'
import { useTranslate } from '../../lib/i18n'
import { IconButton, cx } from '@solera/ui'
import { DraftImage } from './DraftImage'

/**
 * Pièces jointes en attente d'envoi, au-dessus de la saisie.
 *
 * Les images sont montrées en vignette : reconnaître une capture d'écran à son nom de
 * fichier est impossible, et c'est le cas d'usage le plus fréquent depuis un téléphone.
 * La vignette s'ouvre dans la visionneuse du fil, pour relire une capture avant de
 * l'envoyer.
 */
export function AttachmentTray({
  attachments,
  uploading,
  onRemove,
}: {
  attachments: AttachmentDto[]
  uploading: number
  onRemove: (id: string) => void
}) {
  const t = useTranslate()
  if (attachments.length === 0 && uploading === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 px-1 pb-1.5">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className={cx(
            'group/att relative flex items-center gap-2 rounded-md border border-line',
            'bg-surface-high py-1 pr-1 pl-2 text-xs',
          )}
        >
          {attachment.inlineImage ? (
            <DraftImage attachment={attachment} />
          ) : (
            <FileText size={14} className="shrink-0 text-ink-faint" />
          )}

          <span className="min-w-0">
            <span className="block max-w-40 truncate text-ink">{attachment.filename}</span>
            <span className="block text-meta text-ink-faint">
              {formatBytes(attachment.sizeBytes)}
            </span>
          </span>

          <IconButton
            label={t('composer.attachments.remove', { name: attachment.filename })}
            size="sm"
            onClick={() => onRemove(attachment.id)}
          >
            <X size={14} />
          </IconButton>
        </div>
      ))}

      {uploading > 0 ? (
        <span className="flex items-center gap-1.5 rounded-md border border-line bg-surface-high px-2 py-2 text-xs text-ink-faint">
          <Loader size={14} className="animate-spin" />
          {t('composer.attachments.uploading', { count: uploading })}
        </span>
      ) : null}
    </div>
  )
}
