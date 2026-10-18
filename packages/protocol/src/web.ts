/**
 * Une page du web, lue par le serveur pour la vue *Web* du panneau.
 *
 * Le panneau ne peut pas afficher n'importe quel site dans un cadre : la plupart
 * l'interdisent (`X-Frame-Options`, `frame-ancestors`). Le serveur lit donc la page à
 * sa place et en rend le texte, nettoyé — c'est le mode *Lecture*. `embeddable` dit si
 * le mode *Direct*, le cadre, a une chance de s'afficher.
 */
export interface WebPageDto {
  /** L'adresse finale, redirections suivies : c'est elle que la barre affiche. */
  url: string
  title: string
  siteName: string | null
  byline: string | null
  /**
   * Le contenu lisible, en HTML nettoyé : ni script, ni style, ni attribut
   * d'événement, liens et images en adresses absolues. Null quand la page n'est pas
   * du HTML — une image, un PDF —, que seul le mode *Direct* sait montrer.
   */
  html: string | null
  contentType: string
  /** Faux quand la page interdit qu'on l'affiche dans un cadre. */
  embeddable: boolean
}

/**
 * Le nettoyage du mode *Lecture*, par liste blanche, commun au serveur et au panneau.
 *
 * Il tourne deux fois. Le serveur l'applique sur le DOM de linkedom, pour ne rien
 * envoyer d'inutile. Le panneau l'applique ensuite sur le DOM que son propre navigateur
 * a analysé, et insère ces nœuds-là, sans repasser par une chaîne. C'est ce second
 * passage qui protège : deux analyseurs HTML ne lisent jamais tout à fait pareil (un
 * commentaire fermé par `--!>` cachait une balise à linkedom, pas au navigateur), et le
 * seul arbre qui compte est celui du navigateur qui l'affiche.
 *
 * Les types sont structurels : le serveur n'a pas la bibliothèque DOM de TypeScript, et
 * l'arbre de linkedom comme celui du navigateur y répondent.
 */
export interface ReaderNode {
  readonly nodeType: number
  remove(): void
}

export interface ReaderElement extends ReaderNode {
  readonly tagName: string
  readonly childNodes: ArrayLike<ReaderNode>
  getAttributeNames(): string[]
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  replaceWith(...nodes: ReaderNode[]): void
}

// `URL` est global à Node comme au navigateur, mais le protocole ne compile qu'avec la
// bibliothèque ES : sa forme est déclarée ici, pour ce module seul.
declare const URL: new (url: string, base?: string) => { readonly protocol: string; readonly href: string }

const ELEMENT_NODE = 1
const TEXT_NODE = 3

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
export function readerUrl(value: string, base: string, images = false): string | null {
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

/**
 * Nettoie en place les enfants de `root`, adresses résolues sur `base`.
 *
 * Seuls le texte et les éléments de la liste survivent : un commentaire, une section
 * CDATA ou une instruction de traitement sont retirés, parce que c'est là que les
 * analyseurs divergent.
 */
export function sanitizeReaderTree(root: ReaderElement, base: string): void {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === TEXT_NODE) continue
    if (child.nodeType !== ELEMENT_NODE) {
      child.remove()
      continue
    }
    const element = child as ReaderElement
    const tag = element.tagName.toLowerCase()
    if (DROP.has(tag)) {
      element.remove()
      continue
    }
    sanitizeReaderTree(element, base)
    if (!KEEP.has(tag)) {
      element.replaceWith(...Array.from(element.childNodes))
      continue
    }

    const allowed = ATTRIBUTES[tag] ?? []
    for (const name of element.getAttributeNames()) {
      if (!allowed.includes(name)) element.removeAttribute(name)
    }
    if (tag === 'a') {
      const href = element.getAttribute('href')
      const url = href ? readerUrl(href, base) : null
      if (url) element.setAttribute('href', url)
      else element.removeAttribute('href')
      element.setAttribute('rel', 'noopener noreferrer')
    }
    if (tag === 'img') {
      // Les images paresseuses ne portent leur vraie source que dans `data-src`,
      // déjà effacé à ce stade : Readability l'a recopié dans `src` quand il le
      // savait, et une image sans source n'a plus rien à montrer.
      const src = element.getAttribute('src')
      const url = src ? readerUrl(src, base, true) : null
      if (!url) {
        element.remove()
        continue
      }
      element.setAttribute('src', url)
      // Le site n'a pas à apprendre l'adresse de Solera par l'en-tête `Referer`.
      element.setAttribute('referrerpolicy', 'no-referrer')
    }
  }
}
