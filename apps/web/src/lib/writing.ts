import type { CardColumn } from '@solera/protocol'

/**
 * La logique pure du champ d'écriture (`components/writing/BriefField.tsx`) : les
 * mentions `#N` de cartes, les liens collés, la taille d'un fichier. Rien ici ne touche
 * au DOM : le composant passe le texte et le curseur, et reçoit le texte suivant.
 */

/** Ce qu'une carte doit dire d'elle pour être proposée après un `#`. */
export interface MentionableCard {
  number: number
  title: string
  column: CardColumn
}

/**
 * Une mention ouvre un mot : ni après une lettre (`mot#12`, l'ancre d'une URL), ni après
 * `&` (l'entité `&#38;`).
 */
const MENTION_RE = /(?<![\w&])#(\d+)\b/g
/** Une URL, sans la ponctuation qui la suit dans une phrase. */
const URL_RE = /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"»]/g
const SUGGESTION_LIMIT = 6

/** Les cartes citées dans un texte, une fois chacune, dans l'ordre du texte. */
export function mentionedNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(MENTION_RE)].map((match) => Number(match[1])))]
}

/** Retire toutes les mentions d'une carte, et l'espace qui suivait chacune. */
export function removeMention(text: string, number: number): string {
  return text.replace(new RegExp(`(?<![\\w&])#${number}\\b ?`, 'g'), '').replace(/[ \t]+\n/g, '\n')
}

export interface MentionQuery {
  /** Position du `#`. */
  start: number
  /** Ce qui suit le `#` jusqu'au curseur, en minuscules. */
  query: string
}

/** Le mot `#…` juste avant le curseur, ou null. */
export function mentionQuery(text: string, caret: number): MentionQuery | null {
  const match = /(?<![\w&/])#([\p{L}\p{N}-]*)$/u.exec(text.slice(0, caret))
  if (!match) return null
  const typed = match[1]!
  return { start: caret - typed.length - 1, query: typed.toLocaleLowerCase() }
}

/**
 * Les cartes proposées pour une recherche : non abandonnées, dont le numéro commence par
 * la saisie ou dont le titre la contient ; ouvertes d'abord, numéro décroissant.
 */
export function suggestCards<T extends MentionableCard>(cards: readonly T[], query: string): T[] {
  return cards
    .filter((card) => card.column !== 'abandoned')
    .filter((card) => !query || String(card.number).startsWith(query) || card.title.toLocaleLowerCase().includes(query))
    .sort((a, b) => Number(a.column === 'done') - Number(b.column === 'done') || b.number - a.number)
    .slice(0, SUGGESTION_LIMIT)
}

export interface Edit {
  text: string
  caret: number
}

/** Remplace la recherche `#…` (de `start` au curseur) par `#N `, curseur après l'espace. */
export function insertMention(text: string, start: number, caret: number, number: number): Edit {
  const before = text.slice(0, start)
  const after = text.slice(caret)
  const mention = `#${number}`
  return after.startsWith(' ')
    ? { text: before + mention + after, caret: before.length + mention.length + 1 }
    : { text: `${before}${mention} ${after}`, caret: before.length + mention.length + 1 }
}

/** Insère `#` au curseur, précédé d'une espace s'il collerait au mot d'avant. */
export function startMention(text: string, caret: number): Edit {
  const before = text.slice(0, caret)
  const glue = before && !/\s$/.test(before) ? ' ' : ''
  return { text: `${before}${glue}#${text.slice(caret)}`, caret: caret + glue.length + 1 }
}

/**
 * Fermer l'autocomplétion sans choisir : un `#` resté seul est retiré (rend le texte
 * suivant) ; une recherche entamée reste (rend null).
 */
export function dismissMention(text: string, caret: number, mention: MentionQuery): Edit | null {
  if (mention.query) return null
  return { text: text.slice(0, mention.start) + text.slice(caret), caret: mention.start }
}

export type Segment = { kind: 'text' | 'card' | 'unknown' | 'url'; text: string }

/** Le texte découpé pour le surlignage : mentions connues ou non, URL, le reste. */
export function highlightSegments(text: string, known: ReadonlySet<number>): Segment[] {
  const segments: Segment[] = []
  const tokens = new RegExp(`(${URL_RE.source})|${MENTION_RE.source}`, 'g')
  let last = 0
  for (const match of text.matchAll(tokens)) {
    const at = match.index
    if (at > last) segments.push({ kind: 'text', text: text.slice(last, at) })
    const token = match[0]
    segments.push({ kind: match[1] ? 'url' : known.has(Number(match[2])) ? 'card' : 'unknown', text: token })
    last = at + token.length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}

/** Les URL d'un texte, dans l'ordre. */
export function urlsIn(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((match) => match[0])
}

/** Une URL seule, collée telle quelle. */
export function isSingleUrl(text: string): boolean {
  const trimmed = text.trim()
  return /^https?:\/\/\S+$/.test(trimmed)
}

/** Une adresse tapée dans le champ de lien, avec son `https://` si elle n'en a pas. */
export function normalizeUrl(input: string): string | null {
  const url = input.trim()
  if (!url) return null
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

/**
 * Ce qu'une URL donne à lire. Une PR ou une issue GitHub rend son numéro, que le
 * composant met dans sa langue (« PR #212 ») ; un autre lien, un titre tiré du chemin.
 */
export type LinkPiece =
  | { url: string; kind: 'pr' | 'issue'; number: string; /** `owner/repo`. */ detail: string }
  | { url: string; kind: 'web'; label: string; /** L'hôte, vide s'il sert déjà de libellé. */ detail: string }

const LINK_LABEL_MAX = 48

export function linkPiece(url: string): LinkPiece {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { url, kind: 'web', label: url, detail: '' }
  }
  const host = parsed.hostname.replace(/^www\./, '')
  const parts = parsed.pathname.split('/').filter(Boolean)
  if (host === 'github.com' && parts.length >= 4 && (parts[2] === 'pull' || parts[2] === 'issues')) {
    return { url, kind: parts[2] === 'pull' ? 'pr' : 'issue', number: parts[3]!, detail: `${parts[0]}/${parts[1]}` }
  }
  let last = parts.at(-1) ?? ''
  try {
    last = decodeURIComponent(last)
  } catch {
    // Un `%` isolé : le segment se lit tel quel.
  }
  last = last.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[-_+]+/g, ' ').trim()
  if (!last || /^\d+$/.test(last) || last.length <= 2) return { url, kind: 'web', label: host, detail: '' }
  const label = last.charAt(0).toUpperCase() + last.slice(1)
  return { url, kind: 'web', label: label.length > LINK_LABEL_MAX ? `${label.slice(0, LINK_LABEL_MAX - 3)}…` : label, detail: host }
}

/** La taille d'un fichier en unité lisible ; le composant la met en forme dans sa langue. */
export function sizeParts(bytes: number): { unit: 'bytes' | 'kb' | 'mb'; value: number } {
  if (bytes < 1024) return { unit: 'bytes', value: bytes }
  if (bytes < 1024 * 1024) return { unit: 'kb', value: Math.round(bytes / 1024) }
  return { unit: 'mb', value: Math.round((bytes / 1024 / 1024) * 10) / 10 }
}
