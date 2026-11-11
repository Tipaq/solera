import { execFile } from 'node:child_process'
import { sep } from 'node:path'
import { promisify } from 'node:util'
import type { ActionServedVersion } from '@solera/protocol'
import { defaultBase } from '../worktrees/assess.js'

/**
 * Ce qu'un service en marche sert (AC-05) : l'arbre qui contient son dossier, et l'état
 * git de ce dossier. Lu dans le dossier de l'unité et non dans l'arbre d'où on l'a
 * lancé : c'est ce que le serveur de dev a sous les yeux.
 *
 * Un seul calcul pour la racine et les worktrees : la racine n'a pas de carte d'arbre
 * qui donnerait son commit.
 */

export interface ProjectTree {
  path: string
  worktreeId: string | null
  root: boolean
}

/** L'arbre le plus profond qui contient `cwd`, un sous-dossier compris ; null hors du projet. */
export function treeOf(cwd: string, trees: readonly ProjectTree[]): ProjectTree | null {
  let found: ProjectTree | null = null
  for (const tree of trees) {
    const inside = cwd === tree.path || cwd.startsWith(tree.path.endsWith(sep) ? tree.path : tree.path + sep)
    if (inside && (!found || tree.path.length > found.path.length)) found = tree
  }
  return found
}

/** La liste est relue toutes les dix secondes par chaque onglet : git ne l'est pas à chaque fois. */
const SERVED_TTL_MS = 5_000
const GIT_TIMEOUT_MS = 5_000

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await promisify(execFile)('git', args, { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 })
    return stdout.trim()
  } catch {
    return null
  }
}

/** L'état git d'un dossier : branche, commit court, écart à la base, fichiers non commités. */
async function readGit(cwd: string): Promise<Omit<ActionServedVersion, 'path' | 'worktreeId' | 'root'>> {
  const [branch, head, status, base] = await Promise.all([
    git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
    git(cwd, ['rev-parse', '--short', 'HEAD']),
    git(cwd, ['status', '--porcelain', '--untracked-files=all']),
    defaultBase(cwd).catch(() => null),
  ])
  const counts = base && head ? await git(cwd, ['rev-list', '--left-right', '--count', `${base}...HEAD`]) : null
  const [behind, ahead] = counts ? counts.split(/\s+/).map((n) => Number(n) || 0) : [null, null]
  return {
    branch: branch || null,
    head: head || null,
    ahead: ahead ?? null,
    behind: behind ?? null,
    // Une ligne par fichier, renommage compris ; un nom à retour à la ligne est cité.
    dirtyFiles: status === null ? null : status.split('\n').filter(Boolean).length,
  }
}

/** Lectures gardées quelques secondes par dossier, et partagées tant qu'elles courent. */
export class ServedReader {
  private readonly cache = new Map<string, { at: number; value: Promise<Omit<ActionServedVersion, 'path' | 'worktreeId' | 'root'>> }>()

  async read(cwd: string, tree: ProjectTree | null): Promise<ActionServedVersion> {
    const now = Date.now()
    let entry = this.cache.get(cwd)
    if (!entry || now - entry.at > SERVED_TTL_MS) {
      for (const [key, old] of this.cache) if (now - old.at > SERVED_TTL_MS) this.cache.delete(key)
      entry = { at: now, value: readGit(cwd) }
      this.cache.set(cwd, entry)
    }
    return {
      path: tree?.path ?? null,
      worktreeId: tree?.worktreeId ?? null,
      root: tree?.root ?? false,
      ...(await entry.value),
    }
  }
}
