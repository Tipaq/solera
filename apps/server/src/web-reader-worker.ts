import { extractArticle } from './web-article.js'

/**
 * Un processus jetable par page lue : voir `parseApart` dans `web-reader.ts`.
 *
 * Il reçoit les octets de la page, rend l'article ou l'erreur, et s'en va.
 */
process.once('message', (message: { bytes: Uint8Array; url: string }) => {
  let reply: { article: ReturnType<typeof extractArticle> } | { error: string }
  try {
    reply = { article: extractArticle(new TextDecoder().decode(message.bytes), message.url) }
  } catch (err) {
    reply = { error: err instanceof Error ? err.message : String(err) }
  }
  process.send?.(reply, () => process.exit(0))
})
