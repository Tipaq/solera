import { readdir, readFile, stat } from 'node:fs/promises'
import { join, posix, relative, sep } from 'node:path'
import { folderOf, isVaultNotePath, noteBasename, parseNote, type ParsedLink } from './notes.js'

/**
 * La lecture du vault sur le disque : un chemin, un texte, les faits qu'il porte.
 *
 * Gratuit à l'échelle d'un vault personnel — lire mille fichiers texte est l'affaire
 * d'une seconde — et c'est ce qui autorise à ne jamais ruser : quand on doute de
 * l'index, on refait la passe entière.
 */

/** Ce qu'une note donne à l'index. `null` signifie « ce fichier n'est plus là ». */
export interface NoteRecord {
  path: string
  folder: string
  title: string
  words: number
  bytes: number
  tags: string[]
  modifiedAt: number
  links: ParsedLink[]
}

/**
 * Dossiers que le parcours ne descend pas.
 *
 * `.git` en premier, qui porte l'historique et non des notes ; et les dossiers cachés
 * en général, où les éditeurs posent leurs états — `.obsidian`, `.trash`. Un vault
 * n'a pas de `node_modules`, mais un dossier de notes *sur* un projet peut en recevoir
 * un par maladresse, et il noierait l'index.
 */
const SKIPPED = new Set(['node_modules'])

/** Garde-fou : au-delà, ce n'est plus un vault, et le parcours doit s'arrêter plutôt que ramer. */
const MAX_ENTRIES = 100_000

/** Un fichier plus gros que ça n'est pas une note qu'on écrit à la main. */
const MAX_NOTE_BYTES = 2 * 1024 * 1024

/** Les chemins de notes du vault, relatifs à sa racine, séparateur `/`. */
export async function listNotePaths(root: string): Promise<string[]> {
  const found: string[] = []
  const queue: string[] = [root]
  let scanned = 0

  while (queue.length > 0 && scanned < MAX_ENTRIES) {
    const dir = queue.shift()
    if (dir === undefined) break

    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      // Dossier illisible : il est sauté, pas le vault entier. Un index partiel vaut
      // mieux qu'une indexation qui échoue sur un dossier de permissions douteuses.
      continue
    }

    for (const entry of entries) {
      scanned += 1
      if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue

      const full = join(dir, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (entry.isFile() && isVaultNotePath(entry.name)) found.push(toVaultPath(root, full))
    }
  }

  return found
}

/** Le chemin d'une note tel que l'index le nomme : relatif, en séparateurs posix. */
export function toVaultPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join(posix.sep)
}

/**
 * Lit une note. Rend `null` si le fichier a disparu entre le parcours et la lecture, ce
 * qui est le cas normal d'un vault qu'on édite ailleurs pendant que l'index tourne.
 */
export async function readNote(root: string, path: string): Promise<NoteRecord | null> {
  const absolute = join(root, ...path.split(posix.sep))

  try {
    const info = await stat(absolute)
    if (!info.isFile() || info.size > MAX_NOTE_BYTES) return null

    const text = await readFile(absolute, 'utf8')
    const parsed = parseNote(text)

    return {
      path,
      folder: folderOf(path),
      title: parsed.title ?? noteBasename(path),
      words: parsed.words,
      bytes: info.size,
      tags: parsed.tags,
      modifiedAt: Math.round(info.mtimeMs),
      links: parsed.links,
    }
  } catch {
    return null
  }
}

/** Le vault entier. Les notes illisibles sont absentes, pas en erreur. */
export async function readNotes(root: string, paths: string[]): Promise<NoteRecord[]> {
  const records: NoteRecord[] = []
  for (const path of paths) {
    const record = await readNote(root, path)
    if (record) records.push(record)
  }
  return records
}
