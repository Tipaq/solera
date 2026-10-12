import { execFile } from 'node:child_process'
import { realpath as fsRealpath } from 'node:fs/promises'
import { promisify } from 'node:util'
import { isVaultNotePath } from './notes.js'

/**
 * Ce que git sait dire du vault, et c'est peu : le commit courant, et ce qui a bougé
 * depuis un autre. Rien de plus — l'indexation **lit**, elle n'écrit jamais dans le
 * vault.
 *
 * Module à part de `../git.ts`, qui sert les répertoires de travail des projets : la
 * durée d'exécution n'y est pas la même. Un `git diff` de rattrapage peut porter sur
 * trois semaines d'écriture depuis le téléphone, là où cinq secondes suffisent à lire
 * le statut d'un dépôt de travail.
 */

const run = promisify(execFile)

/** Un rattrapage de plusieurs semaines reste une opération de démarrage, pas une requête. */
const GIT_TIMEOUT_MS = 30_000

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
  })
  return stdout
}

/**
 * Le commit de `HEAD`, ou `null` si le vault n'est pas un dépôt git — ce qui reste un
 * vault valide, seulement privé du rattrapage borné et de l'historique par note.
 *
 * `null` aussi sur un dépôt sans aucun commit : il n'y a alors rien à refléter.
 */
export async function headCommit(root: string): Promise<string | null> {
  try {
    const inside = (await git(root, ['rev-parse', '--is-inside-work-tree'])).trim()
    if (inside !== 'true') return null

    /**
     * Le vault doit être la **racine** du dépôt, pas un dossier dedans : `diff` et
     * `status` nomment les fichiers depuis la racine du dépôt, et un vault enfoui dans
     * un projet verrait donc des chemins qui ne sont pas les siens. Plutôt que de
     * rogner les préfixes, on renonce au rattrapage git et on refait des passes
     * complètes — ce qui reste correct, et ne coûte qu'une seconde.
     */
    const toplevel = (await git(root, ['rev-parse', '--show-toplevel'])).trim()
    if ((await realpath(toplevel)) !== (await realpath(root))) return null

    return (await git(root, ['rev-parse', 'HEAD'])).trim() || null
  } catch {
    return null
  }
}

/** Les deux chemins passent par le même filtre : l'un vient de git, l'autre des réglages. */
async function realpath(path: string): Promise<string> {
  try {
    return await fsRealpath(path)
  } catch {
    return path
  }
}

export interface VaultChanges {
  /** Chemins à relire : ajoutés ou modifiés. */
  changed: string[]
  /** Chemins à retirer de l'index. */
  removed: string[]
}

/**
 * Ce qui a bougé entre le commit que l'index reflète et maintenant.
 *
 * Deux sources, et il faut les deux. Le `diff` entre les deux commits rattrape ce qui a
 * été **committé** ailleurs — c'est le cas que `indexation.md` décrit, et il est exact.
 * Le `status` ajoute ce qui n'est **pas encore committé** : un vault s'édite dans
 * n'importe quel éditeur, et rien n'oblige à committer avant de rouvrir Solera. Sans
 * cette seconde passe, une note écrite hors de Solera et laissée en travail resterait
 * invisible jusqu'à son commit.
 *
 * Rend `null` quand git ne sait pas répondre — un commit inconnu après une réécriture
 * d'historique, par exemple. L'appelant refait alors une passe complète, qui ne peut
 * pas se tromper.
 */
export async function changesSince(root: string, since: string): Promise<VaultChanges | null> {
  const changed = new Set<string>()
  const removed = new Set<string>()

  try {
    const diff = await git(root, ['diff', '--name-status', '-z', '--no-renames', since, 'HEAD'])
    collectNameStatus(diff, changed, removed)
  } catch {
    return null
  }

  try {
    const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
    collectStatus(status, changed, removed)
  } catch {
    // Le statut est un supplément : son échec ne doit pas déclencher une passe complète
    // alors que le diff, lui, a répondu.
  }

  return { changed: [...changed], removed: [...removed] }
}

/**
 * `--name-status -z` écrit un statut puis un chemin, séparés par des NUL.
 *
 * `--no-renames` est demandé exprès : un renommage lu comme tel donnerait un seul
 * enregistrement à trois champs, et il n'y a rien à gagner à le distinguer d'une
 * suppression suivie d'un ajout — c'est exactement ce que l'index doit faire des deux.
 */
function collectNameStatus(output: string, changed: Set<string>, removed: Set<string>): void {
  const fields = output.split('\0').filter((field) => field.length > 0)

  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i]!
    const path = fields[i + 1]!
    if (!isVaultNotePath(path)) continue

    if (status.startsWith('D')) {
      removed.add(path)
      changed.delete(path)
    } else {
      changed.add(path)
      removed.delete(path)
    }
  }
}

/**
 * `status --porcelain=v1 -z` écrit deux lettres de statut, une espace, puis le chemin.
 *
 * Un chemin qui apparaît ici est à relire quel que soit son statut, sauf s'il a
 * disparu du disque : indexé ou non, c'est le fichier présent qui fait foi.
 */
function collectStatus(output: string, changed: Set<string>, removed: Set<string>): void {
  const entries = output.split('\0')

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!
    if (entry.length < 4 || entry[2] !== ' ') continue

    const code = entry.slice(0, 2)
    const path = entry.slice(3)

    // Un renommage occupe deux champs : le nouveau chemin dans l'entrée, l'ancien dans
    // le champ suivant. Le sauter n'est pas une option — sans ça, l'ancien chemin se
    // relirait comme une entrée dont les deux premières lettres sont un statut.
    if (code.includes('R') || code.includes('C')) {
      const previous = entries[i + 1]
      i += 1
      if (previous !== undefined && isVaultNotePath(previous)) {
        removed.add(previous)
        changed.delete(previous)
      }
    }

    if (!isVaultNotePath(path)) continue

    // `D` dans l'une des deux colonnes : supprimé de l'index ou de l'arbre de travail.
    if (code.includes('D')) {
      removed.add(path)
      changed.delete(path)
    } else {
      changed.add(path)
      removed.delete(path)
    }
  }
}

/** Une révision d'une note : ce que `git log` dit d'un commit qui l'a touchée. */
export interface NoteRevision {
  hash: string
  subject: string
  author: string
  at: number
}

/** Au-delà, on ne relit plus un historique, on l'explore — et ce n'est pas cette vue. */
const MAX_REVISIONS = 50

/**
 * L'historique d'une note.
 *
 * `--follow` plutôt qu'un simple `log` : une note renommée garde son histoire, et c'est
 * précisément ce qu'on vient chercher. Le prix est connu — `--follow` ne suit qu'un seul
 * chemin à la fois — et il est juste ici, où l'on regarde une note.
 */
export async function noteHistory(root: string, path: string): Promise<NoteRevision[]> {
  try {
    const stdout = await git(root, [
      'log',
      `--max-count=${MAX_REVISIONS}`,
      '--follow',
      // Séparateurs improbables dans un sujet de commit, et `-z` pour borner les
      // enregistrements : un sujet sur plusieurs lignes ne doit pas décaler la lecture.
      '--format=%H%x1f%s%x1f%an%x1f%at',
      '-z',
      '--',
      path,
    ])

    return stdout
      .split('\0')
      .filter((record) => record.length > 0)
      .map((record) => record.split('\x1f'))
      .filter((fields) => fields.length === 4)
      .map((fields) => ({
        hash: fields[0]!,
        subject: fields[1]!,
        author: fields[2]!,
        at: Number(fields[3]) * 1000,
      }))
  } catch {
    // Pas un dépôt, ou une note qu'aucun commit ne connaît : pas d'historique, et ce
    // n'est pas une erreur.
    return []
  }
}

/** Vrai quand le fichier porte des modifications qu'aucun commit ne connaît encore. */
export async function isUncommitted(root: string, path: string): Promise<boolean> {
  try {
    const stdout = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', path])
    return stdout.split('\0').some((entry) => entry.length > 0 && entry[2] === ' ')
  } catch {
    return false
  }
}
