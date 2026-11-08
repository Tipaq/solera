import { execFile } from 'node:child_process'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { hostPathOf } from './paths.js'

const run = promisify(execFile)

/**
 * Les liens d'un worktree, rendus relatifs (#151).
 *
 * Git les écrit en chemins absolus de l'hôte : le fichier `.git` du worktree (`gitdir:
 * C:/…/.git/worktrees/x`) et le lien retour `gitdir` dans le dépôt. Sous Windows natif,
 * un conteneur Linux voit ces dossiers sous `/mnt/c/…`, où `C:/…` ne mène nulle part :
 * le worktree n'y est plus un dépôt. Relatifs, les deux liens restent valides des deux
 * côtés, tant que le dépôt et le worktree sont sur le même lecteur.
 *
 * Pas de `git worktree add --relative-paths` : il inscrit `extensions.relativeWorktrees`
 * dans la configuration du dépôt, et un git antérieur à 2.48 (celui de Debian bookworm,
 * de `node:20`) refuse alors le dépôt tout entier. Écrits à la main, sans l'extension,
 * les liens restent lisibles par tout git : un git ancien lit le `.git` relatif, et ne
 * se trompe que sur le lien retour, qu'il croit périmé (`worktree list` le dit
 * « prunable »). Ce lien retour relatif, git ne le lit côté hôte qu'à partir de 2.48 :
 * en deçà, on le laisse absolu.
 */

/**
 * Rend relatifs les liens de chaque worktree du dépôt. Ceux d'un worktree sur un autre
 * lecteur que le dépôt restent absolus : `hasAbsoluteGitLink` le dit ensuite.
 */
export async function relativizeWorktreeLinks(repo: string): Promise<void> {
  const common = await commonDir(repo)
  if (!common) return
  const admin = join(common, 'worktrees')
  const entries = await readdir(admin, { withFileTypes: true }).catch(() => [])
  const backLinks = await readsRelativeBackLinks()
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const adminDir = join(admin, entry.name)
    const backLink = onHost((await readFile(join(adminDir, 'gitdir'), 'utf8').catch(() => '')).trim())
    if (!backLink) continue
    const gitFile = resolve(adminDir, backLink)
    const worktree = parse(gitFile).dir
    if (!(await isFile(gitFile))) continue
    if (!sameRoot(adminDir, gitFile)) continue
    const link = await readGitFile(gitFile)
    const toAdmin = slashes(relative(worktree, adminDir))
    if (link !== toAdmin && link !== null && samePath(resolve(worktree, link), adminDir)) {
      await overwrite(gitFile, `gitdir: ${toAdmin}\n`)
    }
    if (backLinks && isAbsolute(backLink)) {
      await overwrite(join(adminDir, 'gitdir'), `${slashes(relative(adminDir, gitFile))}\n`)
    }
  }
}

/** Le `.git` du dossier est-il un lien absolu vers un dépôt ? Faux pour un dépôt ordinaire ou un lien relatif. */
export async function hasAbsoluteGitLink(dir: string): Promise<boolean> {
  const link = await readGitFile(join(dir, '.git'))
  return link !== null && isAbsolute(link)
}

/**
 * Réécrit un fichier sur place. Git for Windows cache le `.git` d'un worktree, et
 * Windows refuse de recréer un fichier caché (EPERM) ; l'ouvrir pour le modifier, lui,
 * reste permis.
 */
async function overwrite(path: string, content: string): Promise<void> {
  const file = await open(path, 'r+')
  try {
    await file.truncate(0)
    await file.write(content, 0)
  } finally {
    await file.close()
  }
}

async function readGitFile(path: string): Promise<string | null> {
  const content = await readFile(path, 'utf8').catch(() => null)
  const match = content ? /^gitdir:\s*(.+?)\s*$/m.exec(content) : null
  return match ? onHost(match[1]!) : null
}

/**
 * Un lien tel que l'hôte le lit. Un worktree créé par le git du conteneur a des liens en
 * `/mnt/c/…`, que ni l'hôte ni ce module ne sauraient suivre autrement.
 */
function onHost(link: string): string {
  return link.startsWith('/mnt/') ? (hostPathOf(link) ?? link) : link
}

async function commonDir(repo: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: repo,
      timeout: 10_000,
      windowsHide: true,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

let relativeBackLinks: Promise<boolean> | null = null

/** Git lit un lien retour relatif à partir de 2.48 ; un plus ancien croirait le worktree périmé. */
function readsRelativeBackLinks(): Promise<boolean> {
  relativeBackLinks ??= run('git', ['--version'], { timeout: 10_000, windowsHide: true })
    .then(({ stdout }) => {
      const [major = 0, minor = 0] = (/(\d+)\.(\d+)/.exec(stdout) ?? []).slice(1).map(Number)
      return major > 2 || (major === 2 && minor >= 48)
    })
    .catch(() => false)
  return relativeBackLinks
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false
}

/** Un chemin relatif ne passe pas d'un lecteur à l'autre. */
function sameRoot(a: string, b: string): boolean {
  return parse(a).root.toLowerCase() === parse(b).root.toLowerCase()
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function slashes(path: string): string {
  return path.split('\\').join('/')
}
