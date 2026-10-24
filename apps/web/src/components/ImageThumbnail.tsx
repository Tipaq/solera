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
export function ImageThumbnail({ src, name, alt, className, loading, width, height, maxHeight }: {
  src: string
  /** Le nom que la visionneuse affiche. */
  name: string
  alt: string
  className?: string
  loading?: 'lazy'
  /**
   * Dimensions connues avant le chargement (lues par le serveur dans l'en-tête d'une
   * image qu'il garde) : la place est réservée, et le fil ne saute pas à l'arrivée.
   */
  width?: number
  height?: number
  /** La hauteur maximale de la vignette, en pixels, pour calculer la place réservée. */
  maxHeight?: number
}) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  if (failed) return <span role="alert" className="block p-3 text-xs text-critical">{t('image.loadError')}</span>
  const reserved =
    width && height && maxHeight
      ? { width: Math.min(width, (maxHeight * width) / height), height: 'auto', aspectRatio: `${width} / ${height}` }
      : undefined
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" title={t('editor.image.open')} className="block max-w-full cursor-zoom-in rounded-md">
          <img
            src={src}
            alt={alt}
            loading={loading}
            width={width}
            height={height}
            style={reserved}
            onError={() => setFailed(true)}
            className={cx('rounded-md border border-line object-contain', className)}
          />
        </button>
      </Dialog.Trigger>
      {open ? <LightboxContent src={src} name={name} onClose={() => setOpen(false)} /> : null}
    </Dialog.Root>
  )
}
