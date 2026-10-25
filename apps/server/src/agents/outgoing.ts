import type { ContentBlock } from '@solera/protocol'
import type { OutgoingAttachment } from './types.js'

/**
 * La part commune d'un message sortant : les blocs journalisés, qui décrivent ce que
 * l'utilisateur a envoyé, et le texte réellement transmis au modèle, complété de la
 * liste des fichiers joints non affichables en ligne.
 *
 * Chaque runner traduit ensuite vers son protocole natif : images en base64 côté
 * Claude, chemins `localImage` et mentions à part côté Codex. Le journal, lui, doit
 * rester identique quel que soit le CLI, et c'est cette fonction qui le garantit.
 *
 * `referenceContext` : ce que Solera dit des sessions que le message cite (voir
 * `conversations/references.ts`). Il part au modèle, pas au journal.
 */
export function describeOutgoingMessage(
  text: string,
  attachments: OutgoingAttachment[],
  referenceContext?: string | null,
): { blocks: ContentBlock[]; promptText: string } {
  const blocks: ContentBlock[] = []

  const files = attachments.filter((entry) => !entry.inlineImage)
  const attachmentText = files.length
    ? [
        text,
        '',
        'Fichiers joints à ce message :',
        ...files.map((file) => `- ${file.filename} : ${file.path}`),
      ]
        .join('\n')
        .trim()
    : text
  const promptText = referenceContext ? `${attachmentText}\n\n${referenceContext}` : attachmentText

  if (attachmentText) {
    blocks.push({ type: 'text', text })
  }

  for (const attachment of attachments) {
    if (attachment.inlineImage) {
      blocks.push({
        type: 'image',
        mimeType: attachment.mimeType,
        url: `/api/attachments/${attachment.id}`,
      })
    } else {
      blocks.push({
        type: 'file',
        name: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        url: `/api/attachments/${attachment.id}`,
      })
    }
  }

  return { blocks, promptText }
}
