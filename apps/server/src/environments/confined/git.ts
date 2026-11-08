import { lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { realPathOf } from './paths.js'

/** Ce que git demande au confinement pour un dépôt ou un worktree. */
export interface GitMounts {
  /**
   * Le dossier commun d'un worktree lié (le `.git` du dépôt principal) : git y écrit ses
   * objets, ses refs et l'état du worktree. Rien pour un dépôt simple, dont le `.git` est
   * déjà dans le dossier de travail.
   */
  writable: string[]
  /** Les fichiers qui décident de ce que git exécute sur l'hôte, en lecture seule. */
  protected: string[]
}

const GITDIR_LINE = /^gitdir: (?<path>.+)$/u

/**
 * Le montage de git pour le dossier de travail `dir`, repris de Sandcastle
 * (`protectGitMounts.ts`).
 *
 * L'agent doit pouvoir commiter, donc écrire dans le `.git`. Mais `config`, `hooks` et
 * `info`, le fichier `.git` d'un worktree et son `commondir` décident de ce que git lit
 * et lance sur l'hôte, pour Solera comme pour l'utilisateur : un agent piégé qui y
 * écrirait un hook ou un `core.fsmonitor` ferait exécuter son code hors du confinement.
 * Ils restent lisibles et ne sont plus inscriptibles.
 *
 * `hooks` et `info` sont créés s'ils manquent : sinon l'agent pourrait les créer.
 * Des métadonnées absentes ou illisibles sont ignorées, git ne les lirait pas non plus.
 */
export function gitMounts(dir: string): GitMounts {
  const dotGit = join(dir, '.git')
  let isDirectory: boolean
  try {
    isDirectory = lstatSync(dotGit).isDirectory()
  } catch {
    return { writable: [], protected: [] }
  }
  if (isDirectory) {
    const real = realPathOf(dotGit)
    return { writable: [], protected: real ? controlPaths(real) : [] }
  }
  let gitdir: string | undefined
  try {
    gitdir = GITDIR_LINE.exec(readFileSync(dotGit, 'utf8').trim())?.groups?.path
  } catch {
    return { writable: [], protected: [] }
  }
  const pointer = realPathOf(dotGit)
  const adminDir = gitdir ? realPathOf(resolve(dir, gitdir)) : null
  if (!pointer || !adminDir) return { writable: [], protected: [] }
  const commondirFile = join(adminDir, 'commondir')
  let commonDir: string | null = null
  try {
    commonDir = realPathOf(resolve(adminDir, readFileSync(commondirFile, 'utf8').trim()))
  } catch {
    return { writable: [adminDir], protected: [pointer] }
  }
  if (!commonDir) return { writable: [adminDir], protected: [pointer, commondirFile] }
  return { writable: [commonDir], protected: [pointer, commondirFile, ...controlPaths(commonDir)] }
}

function controlPaths(commonDir: string): string[] {
  for (const name of ['hooks', 'info']) {
    try {
      mkdirSync(join(commonDir, name), { recursive: true })
    } catch {
      // Un dépôt en lecture seule : le confinement ne l'ouvrira pas davantage.
    }
  }
  return ['config', 'hooks', 'info'].map((name) => join(commonDir, name))
}
