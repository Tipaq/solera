import { MAX_ATTACHMENT_BYTES, type AttachmentDto } from '@solera/protocol'
import { ApiRequestError, api } from './api'
import { locale, translate } from './i18n'
import { sizeParts } from './writing'

/**
 * Téléverse un fichier et retourne sa fiche.
 *
 * Passe par `fetch` directement plutôt que par le client JSON : un envoi multipart
 * doit laisser le navigateur composer lui-même son en-tête `content-type`, frontière
 * comprise.
 */
export async function uploadAttachment(file: File, endpoint = '/api/attachments'): Promise<AttachmentDto> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new ApiRequestError(
      413,
      'file_too_large',
      translate('attachments.tooLarge', {
        name: file.name,
        max: Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024),
      }),
    )
  }

  const body = new FormData()
  body.append('file', file, file.name)

  const response = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    body,
  })

  const text = await response.text()
  const parsed: unknown = text ? JSON.parse(text) : null

  if (!response.ok) {
    const payload = parsed as { error?: { code: string; message: string } } | null
    throw new ApiRequestError(
      response.status,
      payload?.error?.code ?? 'upload_failed',
      payload?.error?.message ?? `Envoi de « ${file.name} » impossible.`,
    )
  }
  return parsed as AttachmentDto
}

/** Retire une pièce jointe qui n'a pas encore été envoyée. */
export function discardAttachment(id: string): Promise<void> {
  return api.delete<void>(`/api/attachments/${id}`)
}

/** « 21,5 Mo », « 21.5 MB » : le nombre et l'unité dans la langue de l'interface (#274). */
export function formatBytes(bytes: number): string {
  const { unit, value } = sizeParts(bytes)
  return translate(`attachments.size.${unit}`, { value: new Intl.NumberFormat(locale()).format(value) })
}
