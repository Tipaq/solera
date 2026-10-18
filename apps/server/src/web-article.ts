import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { sanitizeReaderTree, type ReaderElement } from '@solera/protocol'

/**
 * L'extraction de l'article d'une page, pour le mode *Lecture* de la vue *Web*.
 *
 * Coûteuse : linkedom et Readability demandent quelques centaines de Mo pour un Mo de
 * balisage dense. Elle ne tourne donc jamais sur le fil principal du serveur, mais
 * dans `web-reader-worker.ts`, au tas borné : voir `web-reader.ts`.
 */

export interface WebArticle {
  title: string
  siteName: string | null
  byline: string | null
  html: string
}

/** Nettoie un fragment HTML par liste blanche, adresses résolues sur `base`. */
export function sanitizeHtml(html: string, base: string): string {
  const { document } = parseHTML(`<!doctype html><html><body><div id="root">${html}</div></body></html>`)
  const root = document.getElementById('root')
  if (!root) return ''
  // L'arbre de linkedom répond aux types structurels du nettoyage, sans en porter le nom.
  sanitizeReaderTree(root as unknown as ReaderElement, base)
  return root.innerHTML
}

export function extractArticle(source: string, url: string): WebArticle {
  // linkedom ne donne pas de racine à du texte nu servi en `text/html`, et Readability
  // comme `body` lèvent alors : on l'enveloppe, c'est ce qu'en ferait un navigateur.
  const { document } = parseHTML(/<html[\s>]/i.test(source) ? source : `<html><body>${source}</body></html>`)
  const fallbackTitle = document.querySelector('title')?.textContent?.trim() || url
  const article = new Readability(document as never).parse()
  const content = article?.content ?? document.body?.innerHTML ?? ''
  return {
    title: article?.title?.trim() || fallbackTitle,
    siteName: article?.siteName?.trim() || null,
    byline: article?.byline?.trim() || null,
    html: sanitizeHtml(content, url),
  }
}
