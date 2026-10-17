import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import type { WebPageDto } from '@solera/protocol'

/**
 * La lecture d'une page du web pour le mode *Lecture* de la vue *Web*.
 *
 * Readability en extrait l'article, puis tout passe par une liste blanche : le HTML
 * part ensuite tel quel dans le panneau, sur l'origine de Solera, et rien de ce qui
 * vient d'un site tiers ne doit pouvoir y exécuter quoi que ce soit.
 */

/** Au-delà, ce n'est plus une page à lire : on s'arrête de télécharger. */
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 12_000

/** Les éléments gardés. Les autres disparaissent, leur texte restant s'ils en ont un. */
const KEEP = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'dd', 'del', 'details',
  'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'picture', 'pre', 'q',
  's', 'samp', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'article',
])

/** Les éléments retirés avec tout leur contenu : il n'y a rien à y lire. */
const DROP = new Set([
  'script', 'style', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'canvas', 'template',
  'link', 'meta', 'base', 'audio', 'video', 'source', 'track', 'dialog', 'nav', 'footer',
])

const ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  time: ['datetime'],
  ol: ['start'],
}

/** Une adresse résolue sur la page, ou null si son schéma n'a rien à faire ici. */
export function safeUrl(value: string, base: string, images = false): string | null {
  try {
    const url = new URL(value, base)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href
    if (!images && url.protocol === 'mailto:') return url.href
    if (images && url.protocol === 'data:' && /^data:image\/(png|jpe?g|gif|webp|avif);/i.test(value)) {
      return value
    }
    return null
  } catch {
    return null
  }
}

// Le serveur n'a pas la bibliothèque DOM de TypeScript : les types viennent de linkedom.
type ParsedDocument = ReturnType<typeof parseHTML>['document']
type ParsedElement = NonNullable<ReturnType<ParsedDocument['getElementById']>>

/** Nettoie un fragment HTML par liste blanche, adresses résolues sur `base`. */
export function sanitizeHtml(html: string, base: string): string {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html}</div></body></html>`)
  const root = document.getElementById('root')
  if (!root) return ''

  const walk = (node: ParsedElement): void => {
    for (const child of [...node.children]) {
      const tag = child.tagName.toLowerCase()
      if (DROP.has(tag)) {
        child.remove()
        continue
      }
      walk(child)
      if (!KEEP.has(tag)) {
        child.replaceWith(...child.childNodes)
        continue
      }

      const allowed = ATTRIBUTES[tag] ?? []
      for (const name of child.getAttributeNames()) {
        if (!allowed.includes(name)) child.removeAttribute(name)
      }
      if (tag === 'a') {
        const href = child.getAttribute('href')
        const url = href ? safeUrl(href, base) : null
        if (url) child.setAttribute('href', url)
        else child.removeAttribute('href')
      }
      if (tag === 'img') {
        // Les images paresseuses ne portent leur vraie source que dans `data-src`,
        // déjà effacé à ce stade : Readability l'a recopié dans `src` quand il le
        // savait, et une image sans source n'a plus rien à montrer.
        const src = child.getAttribute('src')
        const url = src ? safeUrl(src, base, true) : null
        if (url) child.setAttribute('src', url)
        else child.remove()
      }
    }
  }
  walk(root)
  return root.innerHTML
}

/**
 * Vrai si la page accepte d'être affichée dans un cadre d'une autre origine.
 *
 * `X-Frame-Options` refuse toujours une origine tierce ; `frame-ancestors` ne
 * l'accepte que par `*` — l'origine de Solera n'y figure jamais.
 */
export function embeddable(headers: Headers): boolean {
  if (headers.get('x-frame-options')) return false
  const csp = headers.get('content-security-policy') ?? ''
  const ancestors = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(csp)?.[1]
  if (ancestors === undefined) return true
  return ancestors.split(/\s+/).includes('*')
}

export class WebReadError extends Error {}

export async function readWebPage(target: string): Promise<WebPageDto> {
  const start = safeUrl(target, 'https://invalid.example/')
  if (!start || !/^https?:/.test(start)) throw new WebReadError('Only http and https addresses can be read.')

  const response = await fetch(start, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      // Certains sites refusent un client sans navigateur ; celui-ci dit ce qu'il est.
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Solera/1.0 (reader view)',
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    },
  }).catch((err: unknown) => {
    throw new WebReadError(err instanceof Error ? err.message : String(err))
  })

  const url = response.url || start
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
  const frame = embeddable(response.headers)
  if (!response.ok) throw new WebReadError(`HTTP ${response.status}`)

  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') {
    await response.body?.cancel()
    return { url, title: url, siteName: null, byline: null, html: null, contentType, embeddable: frame }
  }

  const source = await readCapped(response)
  const { document } = parseHTML(source)
  const fallbackTitle = document.querySelector('title')?.textContent?.trim() || url
  const article = new Readability(document as never).parse()
  const content = article?.content ?? document.body?.innerHTML ?? ''

  return {
    url,
    title: article?.title?.trim() || fallbackTitle,
    siteName: article?.siteName?.trim() || null,
    byline: article?.byline?.trim() || null,
    html: sanitizeHtml(content, url),
    contentType,
    embeddable: frame,
  }
}

async function readCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      break
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}
