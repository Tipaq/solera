import { existsSync, readdirSync, readlinkSync, realpathSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

/** `path` est `root`, ou dedans. `/` contient tout. */
export function isWithin(path: string, root: string): boolean {
  return root === '/' || path === root || path.startsWith(`${root}/`)
}

export function isWithinAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => isWithin(path, root))
}

/** Le chemin réel, ou null s'il n'existe pas. */
export function realPathOf(path: string): string | null {
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

/**
 * Les dossiers entre chaque chemin protégé et le dossier inscriptible qui le contient,
 * du plus haut au plus bas : ceux qu'on ne doit pas pouvoir renommer, sinon on écarte
 * le chemin protégé en déplaçant un parent.
 */
export function anchorDirs(writable: readonly string[], protectedPaths: readonly string[]): string[] {
  const anchors = new Set<string>()
  for (const path of protectedPaths) {
    const roots = writable.filter((root) => isWithin(path, root))
    const chain: string[] = []
    let dir = dirname(path)
    while (roots.some((root) => dir !== root && isWithin(dir, root))) {
      chain.unshift(dir)
      dir = dirname(dir)
    }
    for (const anchor of chain) anchors.add(anchor)
  }
  return [...anchors]
}

/**
 * `dir` est-il la racine d'un dépôt, ou le `node_modules/.bin` d'un projet ? Rien de
 * plus haut : nvm, pyenv, asdf ou rbenv s'installent par `git clone`, et leurs
 * `versions/*\/bin` sont la chaîne d'outils qu'on veut garder.
 */
function isRepoDir(dir: string): boolean {
  if (existsSync(join(dir, '.git'))) return true
  return dir.endsWith('/node_modules/.bin') && existsSync(join(dirname(dirname(dir)), '.git'))
}

/** Ne garde que les dossiers qui ne sont pas déjà dans un autre de la liste. */
export function outermost(dirs: readonly string[]): string[] {
  const unique = [...new Set(dirs)]
  return unique.filter((dir) => !unique.some((other) => other !== dir && isWithin(dir, other)))
}

function normalizeEntry(entry: string): string {
  const normalized = posix.normalize(entry)
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized
}

/**
 * La racine d'installation d'un exécutable : le paquet qui le contient s'il est sous un
 * `node_modules` (un CLI installé par npm a besoin de tout son paquet), sinon son seul
 * dossier. Un `package.json` hors de `node_modules` (un `npm link`, un projet) n'en est
 * pas une : le monter exposerait un dépôt. La recherche s'arrête avant le home.
 */
export function installRootOf(file: string, home: string): string {
  const fileDir = dirname(file)
  let dir = fileDir
  while (dir.split('/').includes('node_modules') && !isWithin(home, dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir
    dir = dirname(dir)
  }
  return fileDir
}

/** Ce qu'un confinement doit rendre lisible pour que la chaîne d'outils de l'hôte marche. */
export interface HostToolchain {
  /** Le `PATH` du processus confiné : les dossiers du `PATH` de l'hôte qu'il voit, dans l'ordre. */
  pathEntries: string[]
  /** Les dossiers réels à rendre lisibles, à leur propre chemin. */
  readableDirs: string[]
  /** Les dossiers du `PATH` qui sont des liens sur l'hôte, à recréer vers leur cible. */
  symlinks: Array<{ path: string; target: string }>
}

export interface ToolchainInput {
  path: string
  home: string
  /** Déjà visibles (les dossiers système) : rien de ce qu'ils contiennent n'est à monter. */
  coveredRoots: readonly string[]
  /** Toujours cachés, même nommés par le `PATH` : les lecteurs Windows sous WSL. */
  deniedRoots: readonly string[]
}

/**
 * La chaîne d'outils de l'hôte, d'après son `PATH` : chaque dossier du `PATH`, et la
 * racine d'installation de chaque exécutable qui y est un lien (un `claude` dans
 * `~/.local/bin`, un `codex` installé par nvm). Le home et ses ancêtres ne sont jamais
 * rendus lisibles, ni la racine d'un dépôt git : la chaîne d'outils n'expose ni le home
 * entier ni un projet. Repris de Sandcastle (`hostPathToolchain.ts`).
 */
export function hostToolchain(input: ToolchainInput): HostToolchain {
  const home = normalizeEntry(input.home)
  // Ni le home, ni un de ses ancêtres, ni un dépôt : un `~/bin` versionné ou le
  // `node_modules/.bin` d'un projet n'ouvrent pas ce projet.
  const refused = (path: string) => isWithin(home, path) || isWithinAny(path, input.deniedRoots) || isRepoDir(path)
  const entries = [...new Set(input.path.split(':').filter((entry) => entry.startsWith('/')).map(normalizeEntry))]
  const accepted = entries.flatMap((entry) => {
    if (refused(entry)) return []
    const real = realPathOf(entry)
    return real && !refused(real) ? [{ entry, real }] : []
  })
  const uncovered = accepted.filter((a) => !isWithinAny(a.real, input.coveredRoots))
  const installRoots = [...new Set(accepted.map((a) => a.real))].flatMap((dir) =>
    symlinkTargetsIn(dir)
      .filter((target) => !isWithin(target, dir) && !isWithinAny(target, input.coveredRoots))
      .map((target) => installRootOf(target, home))
      .filter((root) => !refused(root)),
  )
  return {
    pathEntries: accepted.map((a) => a.entry),
    readableDirs: outermost([...uncovered.map((a) => a.real), ...installRoots]),
    symlinks: uncovered
      .filter((a) => a.real !== a.entry && !isWithinAny(a.entry, input.coveredRoots))
      .map((a) => ({ path: a.entry, target: a.real })),
  }
}

/** Les fichiers réels derrière les liens symboliques posés directement dans `dir`. */
function symlinkTargetsIn(dir: string): string[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const entry = join(dir, name)
    try {
      readlinkSync(entry)
    } catch {
      return []
    }
    const real = realPathOf(entry)
    return real ? [real] : []
  })
}

/**
 * Ce qu'un exécutable lancé par chemin absolu demande en plus de la chaîne d'outils : sa
 * racine d'installation, quand il vit hors du `PATH` (un CLI installé par Solera dans
 * ses données, le binaire natif que le SDK de Claude désigne). Null pour un nom nu, un
 * fichier absent, ou une racine refusée.
 */
export function executableRoot(command: string, home: string): string | null {
  if (!command.startsWith('/')) return null
  const real = realPathOf(command)
  if (!real) return null
  const root = installRootOf(real, home)
  return isWithin(home, root) || isRepoDir(root) ? null : root
}
