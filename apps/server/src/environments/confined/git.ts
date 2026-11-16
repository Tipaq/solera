import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { realPathOf } from './paths.js'

/** Ce que git demande au confinement pour un dépôt ou un worktree. */
export interface GitMounts {
  /** Lisibles : le dossier commun d'un worktree lié, où git lit sa config et ses refs empaquetées. */
  readable: string[]
  /** Inscriptibles : ce qu'un commit écrit, et rien qui décide de ce que git exécute. */
  writable: string[]
  /** En lecture seule à l'intérieur d'un dossier inscriptible. */
  protected: string[]
  /** Un `.git` vide posé par le confinement, à retirer à sa fermeture. */
  placeholder?: string
}

const NONE: GitMounts = { readable: [], writable: [], protected: [] }
const GITDIR_LINE = /^gitdir: (?<path>.+)$/u

/**
 * Le montage de git pour le dossier de travail `dir`.
 *
 * Un dossier git ne se protège pas fichier par fichier : `config`, `hooks`, mais aussi
 * `commondir`, `config.worktree`, `modules/*\/config` ou le `commondir` du worktree
 * d'une autre session redirigent git vers une config que l'agent écrirait, et un
 * `core.fsmonitor` y fait exécuter son code au prochain `git status` de l'hôte. Un
 * fichier absent ne se monte pas en lecture seule non plus : l'agent le créerait. On
 * monte donc en liste blanche.
 *
 * - **Worktree lié** : le dossier commun en lecture, et inscriptibles seulement
 *   `objects`, `refs` et `logs` (un commit, une branche, leur journal) et le dossier
 *   d'administration de ce worktree (son index, son `HEAD`), où `commondir`, `gitdir`
 *   et `config.worktree` restent en lecture seule. Le fichier `.git` du worktree aussi.
 *   Ce qui réécrit `packed-refs` (supprimer une branche empaquetée, `gc`) échoue.
 * - **Dépôt simple** : son `.git` est en lecture seule en entier. Un commit y prend un
 *   verrou à la racine du `.git`, qu'aucune liste blanche n'ouvre sans ouvrir le reste :
 *   une session confinée qui doit commiter travaille dans un worktree.
 *
 * - **Hors dépôt** : un `.git` vide, en lecture seule. Sans lui, l'agent ferait
 *   `git init` et poserait sa config, et le serveur, qui lance git sur ce dossier entre
 *   deux tours (les points de reprise), exécuterait son `core.fsmonitor`. Vide, il fait
 *   refuser le dossier à git, dedans comme sur l'hôte ; la fermeture le retire.
 *
 * Des métadonnées absentes ou illisibles sont ignorées, git ne les lirait pas non plus.
 */
export function gitMounts(dir: string): GitMounts {
  const dotGit = join(dir, '.git')
  let isDirectory: boolean
  try {
    isDirectory = lstatSync(dotGit).isDirectory()
  } catch {
    // Dans un dépôt, un `.git` vide ferait aussi refuser ce dossier à git sur l'hôte :
    // la portée refuse ce cas avant (`assertConfinable`).
    if (enclosingRepo(dir)) return NONE
    try {
      writeFileSync(dotGit, '', { flag: 'wx' })
    } catch {
      return NONE
    }
    const placeholder = realPathOf(dotGit)
    return placeholder ? { ...NONE, protected: [placeholder], placeholder } : NONE
  }
  if (isDirectory) {
    const real = realPathOf(dotGit)
    return real ? { ...NONE, protected: [real] } : NONE
  }
  let gitdir: string | undefined
  try {
    gitdir = GITDIR_LINE.exec(readFileSync(dotGit, 'utf8').trim())?.groups?.path
  } catch {
    return NONE
  }
  const pointer = realPathOf(dotGit)
  if (!pointer) return NONE
  const adminDir = gitdir ? realPathOf(resolve(dir, gitdir)) : null
  // Un `.git` qui ne mène nulle part (le vide d'un autre bac à sable) reste protégé.
  if (!adminDir) return { ...NONE, protected: [pointer] }
  let commonDir: string | null = null
  try {
    commonDir = realPathOf(resolve(adminDir, readFileSync(join(adminDir, 'commondir'), 'utf8').trim()))
  } catch {
    // Un worktree sans dossier commun n'est pas un worktree que git sache lire.
  }
  if (!commonDir) return { ...NONE, protected: [pointer] }
  const writable = ['objects', 'refs', 'logs'].map((name) => join(commonDir, name))
  for (const path of writable) mkdirSync(path, { recursive: true })
  // Lu seulement quand `extensions.worktreeConfig` est actif, mais l'utilisateur peut
  // l'activer plus tard : absent, l'agent l'aurait créé. Vide, il ne change rien.
  const worktreeConfig = join(adminDir, 'config.worktree')
  if (!existsSync(worktreeConfig)) writeFileSync(worktreeConfig, '')
  return {
    readable: [commonDir],
    writable: [...writable, adminDir],
    protected: [pointer, ...['commondir', 'gitdir', 'config.worktree'].map((name) => join(adminDir, name))],
  }
}

/** Le dépôt qui contient `dir` sans que `dir` en soit la racine, ou null. */
export function enclosingRepo(dir: string): string | null {
  for (let current = dirname(dir); current !== dirname(current); current = dirname(current)) {
    if (existsSync(join(current, '.git'))) return current
  }
  return null
}
