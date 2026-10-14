import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, posix, relative, resolve, sep } from 'node:path'
import { VAULT_NOTE_EXTENSIONS } from '@solera/protocol'
import { isVaultNotePath, noteBasename } from './notes.js'

/**
 * Lire et écrire une note sur le disque.
 *
 * Les fichiers sont la vérité : cette lecture ne passe pas par l'index, et cette
 * écriture ne lui demande pas la permission. L'index suit, il ne commande pas.
 *
 * Aucun commit n'est fait ici. L'historique par note est ce que git en dit, et décider
 * quand committer appartient à la boîte des agents — une écriture d'agent est un commit
 * révocable, une frappe de Tim n'a pas à en être un. Une note enregistrée et pas encore
 * committée est rattrapée par le `git status` du démarrage, donc rien ne se perd.
 */

/** Au-delà, ce n'est plus une note qu'on écrit à la main. */
export const MAX_NOTE_BYTES = 2 * 1024 * 1024

export class VaultPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VaultPathError'
  }
}

/**
 * Le chemin absolu d'une note, ou une erreur.
 *
 * Deux vérifications, et la seconde n'est pas la première : la forme du chemin d'abord
 * — relatif, en séparateurs `/`, sans remontée, et avec une extension de note — puis la
 * **résolution**, qui seule ferme le cas des chemins exotiques (liens, encodages) qui
 * passeraient la forme et sortiraient quand même du vault.
 */
export function noteFile(root: string, path: string): string {
  if (path.length === 0 || path.startsWith('/') || path.includes('\0')) {
    throw new VaultPathError('Expected a relative path.')
  }
  if (!isVaultNotePath(path)) {
    throw new VaultPathError(`Expected one of ${VAULT_NOTE_EXTENSIONS.join(', ')}.`)
  }
  if (path.split(posix.sep).some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new VaultPathError('Expected a path without empty or relative segments.')
  }

  const absolute = resolve(root, ...path.split(posix.sep))
  const inside = relative(resolve(root), absolute)
  if (inside.startsWith('..') || inside.startsWith(`..${sep}`)) {
    throw new VaultPathError('This path leaves the vault.')
  }
  return absolute
}

/** Empreinte du fichier : taille et date de modification, ce que le disque donne sans relire. */
export function fingerprintOf(size: number, mtimeMs: number): string {
  return `${size}:${Math.round(mtimeMs)}`
}

export interface NoteText {
  content: string
  fingerprint: string
}

/** `null` quand la note n'est pas sur le disque, ce qui est un cas normal et pas une panne. */
export async function readNoteText(root: string, path: string): Promise<NoteText | null> {
  const absolute = noteFile(root, path)

  const info = await stat(absolute).catch(() => null)
  if (!info?.isFile() || info.size > MAX_NOTE_BYTES) return null

  return {
    content: await readFile(absolute, 'utf8'),
    fingerprint: fingerprintOf(info.size, info.mtimeMs),
  }
}

export class StaleNoteError extends Error {
  constructor() {
    super('The note changed on disk since it was opened.')
    this.name = 'StaleNoteError'
  }
}

/**
 * Écrit une note, l'empreinte à l'appui.
 *
 * `fingerprint: null` force l'écriture — le choix explicite d'écraser, pris après qu'un
 * conflit a été montré. Sinon, une empreinte qui ne correspond plus arrête l'écriture :
 * le vault s'édite ailleurs, et écraser en silence ce qui a été écrit entre-temps est
 * la seule perte que cette couche puisse causer.
 */
export async function writeNoteText(
  root: string,
  path: string,
  content: string,
  fingerprint: string | null,
): Promise<string> {
  const absolute = noteFile(root, path)

  const info = await stat(absolute).catch(() => null)
  if (info && !info.isFile()) throw new VaultPathError('This path is not a file.')

  if (fingerprint !== null) {
    const current = info ? fingerprintOf(info.size, info.mtimeMs) : null
    if (current !== fingerprint) throw new StaleNoteError()
  }

  await mkdir(join(absolute, '..'), { recursive: true })
  await writeFile(absolute, content, 'utf8')

  const written = await stat(absolute)
  return fingerprintOf(written.size, written.mtimeMs)
}

/**
 * Le chemin d'une note neuve, depuis un dossier et un titre.
 *
 * Le titre **est** le nom du fichier, comme dans n'importe quel vault qu'on ouvre
 * ailleurs : une note dont le fichier s'appelle autrement que son titre se retrouve mal
 * hors de Solera, et `[[Titre]]` ne la viserait pas. Les caractères qu'un système de
 * fichiers refuse sont remplacés, pas rejetés — sinon un titre qui porte un `/` ferait
 * échouer une création au lieu de produire la note attendue.
 */
export function notePathFor(folder: string, title: string): string {
  const name = title
    .trim()
    .replace(/[/\\:*?"<>|\0]/g, '-')
    // Un nom qui commence par un point serait caché, donc hors du parcours d'indexation.
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    .trim()

  if (name.length === 0) throw new VaultPathError('This title leaves no file name.')

  const cleanFolder = folder
    .split(posix.sep)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .join(posix.sep)

  return cleanFolder.length > 0 ? `${cleanFolder}/${name}.md` : `${name}.md`
}

/**
 * Un chemin libre, en numérotant si besoin.
 *
 * Deux notes du même titre dans le même dossier ne peuvent pas être le même fichier, et
 * refuser la création renverrait l'utilisateur à un formulaire pour une question que le
 * programme sait trancher.
 */
export async function freeNotePath(root: string, path: string): Promise<string> {
  const folder = posix.dirname(path) === '.' ? '' : posix.dirname(path)
  const base = noteBasename(path)

  for (let suffix = 0; suffix < 100; suffix += 1) {
    const candidate = notePathFor(folder, suffix === 0 ? base : `${base} ${suffix + 1}`)
    const exists = await stat(noteFile(root, candidate))
      .then(() => true)
      .catch(() => false)
    if (!exists) return candidate
  }

  throw new VaultPathError('Too many notes with this title.')
}
