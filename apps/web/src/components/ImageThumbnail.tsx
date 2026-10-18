import { useState } from 'react'
import { cx } from '@solera/ui'
import { useTranslate } from '../lib/i18n'
import * as Dialog from '@radix-ui/react-dialog'
import { LightboxContent } from './panel/ImageView'

/**
 * Une image du fil qui s'ouvre dans la visionneuse au clic.
 *
 * La lecture d'image d'un outil, une pièce jointe : la vignette suffit à reconnaître,
 * jamais à lire. Elle s'ouvre dans la visionneuse du panneau — zoom, glissement,
 * pincement, mêmes raccourcis — et non plus dans un onglet du navigateur, qui sortait
 * de Solera et, dans la PWA, de l'application entière.
 */
export function ImageThumbnail({ src, name, alt, className, loading }: {
  src: string
  /** Le nom que la visionneuse affiche. */
  name: string
  alt: string
  className?: string
  loading?: 'lazy'
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" title={t('editor.image.open')} className="block max-w-full cursor-zoom-in rounded-md">
          <img src={src} alt={alt} loading={loading} className={cx('rounded-md border border-line object-contain', className)} />
        </button>
      </Dialog.Trigger>
      {open ? <LightboxContent src={src} name={name} onClose={() => setOpen(false)} /> : null}
    </Dialog.Root>
  )
}
