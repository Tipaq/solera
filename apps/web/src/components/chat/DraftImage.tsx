import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import type { AttachmentDto } from '@solera/protocol'
import { useTranslate } from '../../lib/i18n'
import { LightboxContent } from '../panel/ImageView'

/**
 * La vignette d'une image du brouillon, qui s'ouvre dans la visionneuse du fil : une
 * capture se relit avant de partir, pas seulement après.
 */
export function DraftImage({ attachment }: { attachment: AttachmentDto }) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const src = `/api/attachments/${attachment.id}`
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" title={t('editor.image.open')} className="shrink-0 cursor-zoom-in rounded">
          <img src={src} alt={attachment.filename} className="block size-8 rounded object-cover" />
        </button>
      </Dialog.Trigger>
      {open ? <LightboxContent src={src} name={attachment.filename} onClose={() => setOpen(false)} /> : null}
    </Dialog.Root>
  )
}
