import { MEMORY_INDEX_FILE, foldForMatch, memoryFileSchema } from '@solera/protocol'

/*
 * La mémoire d'un projet lue comme un tout : les notes, et l'index `MEMORY.md` qui les
 * annonce aux agents. Pur, sans React : ce que la page montre de l'index (indexées,
 * absentes, orphelines) et ce que « Réparer l'index » écrit se décident ici.
 *
 * L'index est un fichier comme un autre pour le serveur : une note absente de l'index
 * n'est jamais chargée par Claude au démarrage, et une ligne qui pointe vers une note
 * disparue l'envoie lire un fichier qui n'existe pas.
 */

/** Les types que la mémoire automatique de Claude Code donne à ses notes. */
export const NOTE_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type NoteType = (typeof NOTE_TYPES)[number] | 'none'
export type NoteFilter = NoteType | 'all'

export interface MemoryNote {
  file: string
  /** Le nom du fichier sans `.md` : ce que les liens `[[…]]` citent le plus souvent. */
  slug: string
  /** Le `name` de l'en-tête, à défaut le slug. */
  name: string
  description: string | null
  type: NoteType
  /** La note sans son en-tête. */
  body: string
  /** Les `[[liens]]` du corps, sans doublon, dans l'ordre. */
  links: string[]
  content: string
  updatedAt: number
}

export interface IndexEntry {
  file: string
  line: string
}

export interface MemoryState {
  /** Les notes, plus récentes d'abord. */
  notes: MemoryNote[]
  index: string
  /** Les notes qui ont leur ligne dans l'index. */
  indexed: Set<string>
  unindexed: MemoryNote[]
  /** Les lignes de l'index qui pointent vers une note absente. */
  orphans: IndexEntry[]
}

const HEADER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
const LINK = /\[\[([^\]]+)\]\]/g

/**
 * Une note : son en-tête (`name`, `description`, `type`, au premier niveau ou sous
 * `metadata:`) et son corps. Un type inconnu vaut « sans type » plutôt qu'une erreur :
 * les agents écrivent ces fichiers à la main.
 */
export function parseNote(file: string, content: string, updatedAt: number): MemoryNote {
  const header = HEADER.exec(content)
  const lines = (header?.[1] ?? '').split(/\r?\n/)
  const field = (key: string) => {
    const line = lines.find((candidate) => candidate.trim().startsWith(`${key}:`))
    if (!line) return null
    const value = line.slice(line.indexOf(':') + 1).trim().replace(/^["']|["']$/g, '')
    return value || null
  }
  const rawType = field('type')
  const type = (NOTE_TYPES as readonly string[]).includes(rawType ?? '') ? (rawType as NoteType) : 'none'
  const body = header ? content.slice(header[0].length) : content
  const slug = file.replace(/\.md$/, '')
  const links = [...new Set([...body.matchAll(LINK)].map((match) => match[1]!.trim()))]
  return { file, slug, name: field('name') ?? slug, description: field('description'), type, body, links, content, updatedAt }
}

/** Le corps à afficher : un `[[lien]]` devient du code, la page le rend à part. */
export const linksAsCode = (body: string) => body.replace(LINK, '`$1`')

/**
 * Les lignes de `MEMORY.md` qui pointent vers une note : `- [Titre](fichier.md) — accroche`.
 * La même règle que le serveur quand il retire la ligne d'une note supprimée
 * (`](fichier.md)`) : un chemin, même `./fichier.md`, ne désigne pas une note.
 */
export function indexEntries(index: string): IndexEntry[] {
  return index.split('\n').flatMap((line) => {
    const file = /\]\(([^)/]+\.md)\)/.exec(line)?.[1]
    return file ? [{ file, line }] : []
  })
}

export function memoryState(files: { file: string; content: string; updatedAt: number }[]): MemoryState {
  const index = files.find((entry) => entry.file === MEMORY_INDEX_FILE)?.content ?? ''
  const notes = files
    .filter((entry) => entry.file !== MEMORY_INDEX_FILE)
    .map((entry) => parseNote(entry.file, entry.content, entry.updatedAt))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const present = new Set(notes.map((note) => note.file))
  const entries = indexEntries(index)
  const indexed = new Set(entries.map((entry) => entry.file).filter((file) => present.has(file)))
  return {
    notes,
    index,
    indexed,
    unindexed: notes.filter((note) => !indexed.has(note.file)),
    orphans: entries.filter((entry) => !present.has(entry.file)),
  }
}

/** La ligne d'index d'une note, au format de la mémoire de Claude Code. */
export const indexLine = (note: MemoryNote) =>
  note.description ? `- [${note.name}](${note.file}) — ${note.description}` : `- [${note.name}](${note.file})`

const appendLines = (index: string, lines: string[]) => {
  const head = index.trimEnd()
  if (lines.length === 0) return head ? `${head}\n` : ''
  return `${head ? `${head}\n` : ''}${lines.join('\n')}\n`
}

/** L'index réparé : sans ses lignes orphelines, avec une ligne pour chaque note qui n'en avait pas. */
export function repairIndex(state: MemoryState): string {
  const orphans = new Set(state.orphans.map((entry) => entry.line))
  const kept = state.index.split('\n').filter((line) => !orphans.has(line)).join('\n')
  return appendLines(kept, state.unindexed.map(indexLine))
}

export const withIndexLine = (index: string, note: MemoryNote) => appendLines(index, [indexLine(note)])

/** Un nom de note que le serveur accepte : un `.md` à plat, et pas l'index. */
export const isNoteFileName = (name: string) =>
  name !== MEMORY_INDEX_FILE && memoryFileSchema.safeParse(name).success

export function filterNotes(notes: MemoryNote[], type: NoteFilter, query: string): MemoryNote[] {
  const words = foldForMatch(query).split(/\s+/).filter(Boolean)
  return notes.filter((note) => {
    if (type !== 'all' && note.type !== type) return false
    const text = foldForMatch(`${note.name} ${note.description ?? ''} ${note.body}`)
    return words.every((word) => text.includes(word))
  })
}

export function typeCounts(notes: MemoryNote[]): Record<NoteFilter, number> {
  const counts: Record<NoteFilter, number> = { all: notes.length, user: 0, feedback: 0, project: 0, reference: 0, none: 0 }
  for (const note of notes) counts[note.type] += 1
  return counts
}

/** La note qu'un `[[lien]]` désigne : par son nom de fichier, à défaut par son `name`. */
export function resolveLink(link: string, notes: MemoryNote[]): MemoryNote | null {
  return notes.find((note) => note.slug === link) ?? notes.find((note) => note.name === link) ?? null
}
