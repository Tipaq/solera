import { basename, posix } from 'node:path'
import { parseDocument } from 'yaml'
import { VAULT_NOTE_EXTENSIONS } from '@solera/protocol'

/**
 * La lecture d'une note : ce qu'une passe sur le texte donne, et rien de plus.
 *
 * Tout ici est déterministe — même entrée, même sortie, sans modèle et sans réseau.
 * C'est la propriété qui rend le niveau 1 testable, et c'est pourquoi ce module ne
 * touche ni au disque ni à la base : il reçoit un texte, il rend des faits.
 */

/** Un `[[lien]]`, tel qu'il est écrit. Sa résolution est l'affaire de `resolve.ts`. */
export interface ParsedLink {
  /** La cible entre les crochets, sans alias ni ancre, telle qu'écrite. */
  target: string
  /** Le `#titre` ou `#^bloc` visé, s'il y en a un. */
  anchor: string | null
  /** Le texte après la barre verticale, s'il y en a un. */
  alias: string | null
  /** Ligne de l'occurrence, à partir de 1. */
  line: number
}

export interface ParsedNote {
  title: string | null
  tags: string[]
  words: number
  links: ParsedLink[]
}

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * `[[cible#ancre|alias]]`, et sa variante d'inclusion `![[cible]]`.
 *
 * L'inclusion compte comme un lien : elle cite la note, donc elle produit un lien
 * entrant chez elle. Les distinguer n'apporterait rien au niveau 1 — qui cite qui est
 * la même question dans les deux cas.
 */
const WIKILINK = /!?\[\[([^\][\n|#]*)(#[^\][\n|]*)?(\|[^\][\n]*)?\]\]/g

/** Un mot : un groupe non blanc qui porte au moins une lettre ou un chiffre. */
const WORD = /[^\s]*[\p{L}\p{N}][^\s]*/gu

export function isVaultNotePath(path: string): boolean {
  const lower = path.toLowerCase()
  return VAULT_NOTE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Le dossier parent d'une note. `''` pour une ébauche, posée à la racine du vault. */
export function folderOf(path: string): string {
  const dir = posix.dirname(path)
  return dir === '.' || dir === '/' ? '' : dir
}

/** Le nom du fichier sans son extension, titre de repli d'une note sans en-tête. */
export function noteBasename(path: string): string {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

export function parseNote(text: string): ParsedNote {
  const front = FRONTMATTER.exec(text)
  const body = front ? text.slice(front[0].length) : text
  // Les lignes du frontmatter sont comptées et non oubliées : la ligne d'un lien doit
  // désigner la même ligne dans le fichier ouvert à la main.
  const offsetLines = front ? countLines(front[0]) : 0

  const data = front ? readFrontmatter(front[1] ?? '') : {}
  // Le code est blanchi une fois pour les deux lectures qui en dépendent : un `# titre`
  // de script shell dans un bloc n'est pas le titre de la note, et un `[[exemple]]` au
  // même endroit n'est pas un lien.
  const prose = blankCode(body)

  return {
    title: readTitle(data, prose),
    tags: readTags(data),
    words: countWords(body),
    links: readLinks(prose, offsetLines),
  }
}

function countLines(text: string): number {
  let lines = 0
  for (const char of text) if (char === '\n') lines += 1
  return lines
}

/**
 * Un frontmatter illisible n'est pas une erreur d'indexation.
 *
 * Le vault s'édite depuis n'importe quel éditeur, et une note en cours d'écriture peut
 * porter un YAML à moitié tapé. Elle garde alors ses liens et son compte de mots : un
 * fait du texte ne doit pas disparaître parce qu'un autre est douteux.
 */
function readFrontmatter(source: string): Record<string, unknown> {
  try {
    const document = parseDocument(source)
    if (document.errors.length > 0) return {}
    const data = document.toJS()
    return data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** `title:` du frontmatter, sinon le premier titre de niveau 1. Sinon rien, et c'est le nom du fichier qui servira. */
function readTitle(data: Record<string, unknown>, body: string): string | null {
  const declared = data['title']
  if (typeof declared === 'string' && declared.trim().length > 0) return declared.trim()

  // Le premier titre de niveau 1, où qu'il soit : une note peut commencer par une
  // phrase d'accroche. Les niveaux suivants ne sont pas des titres de note.
  for (const line of body.split('\n')) {
    const heading = /^#[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(line)
    if (heading) return heading[1]!.trim()
  }
  return null
}

/**
 * `tags` du frontmatter, en liste ou en chaîne séparée par des virgules — les deux
 * graphies existent dans les vaults, et celle qu'on refuserait serait silencieusement
 * perdue. Le `#` de tête est retiré : `#idée` et `idée` sont le même tag.
 */
function readTags(data: Record<string, unknown>): string[] {
  const raw = data['tags'] ?? data['tag']
  const values =
    typeof raw === 'string'
      ? raw.split(',')
      : Array.isArray(raw)
        ? raw.map((entry) => (typeof entry === 'string' || typeof entry === 'number' ? String(entry) : ''))
        : []

  const seen = new Set<string>()
  for (const value of values) {
    const tag = value.trim().replace(/^#/, '')
    if (tag.length > 0) seen.add(tag)
  }
  return [...seen]
}

function countWords(body: string): number {
  return (body.match(WORD) ?? []).length
}

/**
 * Les liens du corps, le code exclu.
 *
 * Un `[[exemple]]` dans un bloc de code n'est pas un lien : c'est une note *qui parle*
 * de la syntaxe, et l'indexer produirait un lien entrant que l'auteur n'a pas écrit.
 * Le code est donc blanchi avant extraction — remplacé caractère pour caractère, pour
 * que les numéros de ligne restent ceux du fichier.
 */
function readLinks(text: string, offsetLines: number): ParsedLink[] {
  const links: ParsedLink[] = []

  for (const match of text.matchAll(WIKILINK)) {
    const target = (match[1] ?? '').trim()
    // `[[|alias]]` ou `[[#ancre]]` ne visent aucune note : une ancre seule renvoie à
    // la note courante, ce qui n'est pas un lien sortant.
    if (target.length === 0) continue

    links.push({
      target,
      anchor: match[2] ? match[2].slice(1).trim() || null : null,
      alias: match[3] ? match[3].slice(1).trim() || null : null,
      line: offsetLines + countLines(text.slice(0, match.index)) + 1,
    })
  }

  return links
}

/** Remplace le contenu des blocs et des portions de code par des espaces, saut de ligne compris intact. */
function blankCode(text: string): string {
  const lines = text.split('\n')
  let fence: string | null = null

  const blanked = lines.map((line) => {
    const open = /^[ \t]{0,3}(```+|~~~+)/.exec(line)
    if (fence === null && open) {
      fence = open[1]!.slice(0, 1).repeat(open[1]!.length)
      return blank(line)
    }
    if (fence !== null) {
      const close = /^[ \t]{0,3}(```+|~~~+)[ \t]*$/.exec(line)
      if (close && close[1]!.startsWith(fence[0]!) && close[1]!.length >= fence.length) fence = null
      return blank(line)
    }
    // Le code en ligne, une fois les blocs écartés : les paires de backticks de la ligne.
    return line.replace(/`+[^`]*`+/g, blank)
  })

  return blanked.join('\n')
}

const blank = (text: string): string => ' '.repeat(text.length)
