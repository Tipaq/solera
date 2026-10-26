import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import type { WorktreeState } from '@solera/protocol'

/**
 * L'avancement d'un worktree par rapport à la branche par défaut du dépôt.
 *
 * La question n'est pas « la branche est-elle un ancêtre de main » mais « reste-t-il
 * ici quelque chose que la base n'a pas » : un squash, un cherry-pick ou une copie à
 * la main laissent la branche hors de l'ancestralité alors que tout son contenu est
 * déjà fusionné, et un arbre jamais commité passe pour fusionné alors qu'il porte tout
 * le travail. On compare donc des contenus, par `git merge-tree`, qui calcule une
 * fusion sans toucher ni à l'arbre ni aux refs.
 *
 * Tout est lecture : aucune commande ici n'écrit dans le dépôt, hors les objets
 * temporaires que `merge-tree` et `stash create` déposent dans la base d'objets, que
 * `gc` ramasse.
 */

/** Lectures d'état, larges pour un gros dépôt à froid. */
const READ_TIMEOUT_MS = 15_000

/** Au-delà, comparer les fichiers non suivis à la base coûte plus qu'il ne renseigne. */
const MAX_UNTRACKED_COMPARED = 500

/** Nombre de fichiers dont on lit la date pour dater la dernière modification. */
const MAX_FILES_STATTED = 200

interface GitResult {
  code: number
  stdout: string
}

/**
 * Un git qui rend aussi le code de sortie : `merge-tree` répond 1 en cas de conflit en
 * produisant quand même son arbre, ce qu'une exception masquerait.
 */
function git(cwd: string, args: string[], input?: string): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      args,
      { cwd, timeout: READ_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: process.env },
      (err, stdout) => {
        const code = (err as { code?: unknown } | null)?.code
        if (err && typeof code !== 'number') return reject(err)
        resolve({ code: typeof code === 'number' ? code : 0, stdout })
      },
    )
    if (input !== undefined) child.stdin?.end(input)
    else child.stdin?.end()
  })
}

async function out(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args)
  if (result.code !== 0) throw new Error(`git ${args[0]} a répondu ${result.code}`)
  return result.stdout
}

const line = async (cwd: string, args: string[]): Promise<string> => (await out(cwd, args)).trim()

export interface WorktreeEntry {
  path: string
  head: string | null
  /** Nom court de la branche ; null en HEAD détachée. */
  branch: string | null
  /** Vrai pour l'arbre principal, celui du dépôt lui-même. */
  main: boolean
  /** Git sait déjà le dossier disparu : l'entrée n'attend qu'un `prune`. */
  prunable: boolean
}

/** Les arbres que git connaît, l'arbre principal en tête. Vide hors dépôt. */
export async function listWorktrees(repo: string): Promise<WorktreeEntry[]> {
  let raw: string
  try {
    raw = await out(repo, ['worktree', 'list', '--porcelain', '-z'])
  } catch {
    return []
  }

  return parseWorktreeList(raw)
}

/**
 * Le mode NUL garde intacts les accents et les retours à la ligne des chemins. Git écrit
 * des slashs même sous Windows, alors que les chemins enregistrés par Solera viennent de
 * node:path : on les ramène au format natif avant toute comparaison.
 */
export function parseWorktreeList(raw: string, platform: NodeJS.Platform = process.platform): WorktreeEntry[] {
  const paths = platform === 'win32' ? win32 : posix
  const entries: WorktreeEntry[] = []
  for (const block of raw.split('\0\0')) {
    const fields = new Map<string, string>()
    for (const field of block.split('\0')) {
      if (!field) continue
      const space = field.indexOf(' ')
      if (space === -1) fields.set(field, '')
      else fields.set(field.slice(0, space), field.slice(space + 1))
    }
    const path = fields.get('worktree')
    if (!path) continue
    entries.push({
      path: paths.normalize(path),
      head: fields.get('HEAD') ?? null,
      branch: fields.get('branch')?.replace(/^refs\/heads\//, '') ?? null,
      main: entries.length === 0,
      prunable: fields.has('prunable'),
    })
  }
  return entries
}

/**
 * La branche à laquelle on compare les chantiers.
 *
 * `origin/HEAD` dit laquelle le dépôt tient pour principale ; mais c'est la branche
 * locale du même nom qu'on retient quand elle existe, parce que l'utilisateur fusionne
 * en local et pousse ensuite : comparer à `origin/main` dirait « à fusionner » d'une
 * branche déjà fusionnée mais pas encore poussée. Sans remote, `main` ou `master`,
 * puis la branche de l'arbre principal.
 */
export async function defaultBase(repo: string): Promise<string | null> {
  const exists = (ref: string) => git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).then((r) => r.code === 0)

  const remoteHead = await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (remoteHead.code === 0) {
    const remote = remoteHead.stdout.trim()
    const local = remote.replace(/^origin\//, '')
    if (await exists(`refs/heads/${local}`)) return local
    if (await exists(`refs/remotes/${remote}`)) return remote
  }
  for (const name of ['main', 'master']) {
    if (await exists(`refs/heads/${name}`)) return name
  }
  const head = await git(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const current = head.stdout.trim()
  return head.code === 0 && current && current !== 'HEAD' ? current : null
}

/**
 * `merge-tree --merge-base` n'existe qu'à partir de git 2.40. Debian 12, donc l'image
 * Docker, en est à 2.39, comme les Command Line Tools d'Apple depuis longtemps. Lu une
 * fois par process : la version ne change pas sans redémarrage.
 */
let mergeBaseSupport: Promise<boolean> | null = null

function supportsMergeBase(cwd: string): Promise<boolean> {
  mergeBaseSupport ??= git(cwd, ['version']).then(
    (result) => {
      const match = /(\d+)\.(\d+)/.exec(result.stdout)
      if (!match) return false
      const [major, minor] = [Number(match[1]), Number(match[2])]
      return major > 2 || (major === 2 && minor >= 40)
    },
    () => false,
  )
  return mergeBaseSupport
}

export interface WorktreeAssessment {
  state: WorktreeState
  ahead: number
  behind: number
  modified: number
  untracked: number
  conflicts: boolean
  unmergedCommits: boolean
  lastCommitAt: number | null
  lastEditAt: number | null
}

const MISSING: WorktreeAssessment = {
  state: 'missing',
  ahead: 0,
  behind: 0,
  modified: 0,
  untracked: 0,
  conflicts: false,
  unmergedCommits: false,
  lastCommitAt: null,
  lastEditAt: null,
}

/** Un arbre que git n'a pas su juger (gitdir cassé, objet manquant) : ni sûr ni perdu. */
export const UNREADABLE: WorktreeAssessment = { ...MISSING, state: 'unreadable' }

/**
 * Vrai si la branche a déjà porté un commit à elle : son reflog garde une entrée de
 * commit, de fusion, de cherry-pick ou de rebase, au-delà de sa création.
 *
 * C'est ce qui sépare un arbre fusionné par fast-forward ou par merge (rien en avance,
 * mais du travail livré) d'un arbre qu'on vient de créer (rien en avance non plus, et
 * aucun travail encore). Un arbre qui porte des modifications, même déjà dans la base,
 * a travaillé : la question ne se pose que pour un arbre sans commit propre ni fichier
 * touché. Sans reflog, expiré ou désactivé, on ne sait pas : on répond
 * non, et l'arbre reste « sans travail », qu'on peut nettoyer mais qu'on ne propose pas.
 */
async function branchHasWorked(repo: string, branch: string | null): Promise<boolean> {
  if (!branch) return false
  const result = await git(repo, ['reflog', 'show', '--format=%gs', `refs/heads/${branch}`, '--'])
  if (result.code !== 0) return false
  return result.stdout
    .split('\n')
    .some((entry) => /^(commit|merge|cherry-pick|rebase|pull|am|revert)\b/.test(entry.trim()))
}

/**
 * L'arbre qu'aurait la base après avoir reçu `ref`, et si la fusion passerait.
 *
 * Avec `mergeBase`, on fusionne une différence précise (de `mergeBase` à `ref`)
 * plutôt que l'historique entier : c'est ce qui permet de juger un stash, dont le
 * commit n'a que HEAD pour parent.
 */
async function mergedTree(
  repo: string,
  base: string,
  ref: string,
  mergeBase?: string,
): Promise<{ tree: string; conflicts: boolean } | null> {
  const result = await git(repo, [
    'merge-tree',
    '--write-tree',
    ...(mergeBase ? [`--merge-base=${mergeBase}`] : []),
    base,
    ref,
  ])
  const tree = result.stdout.split('\n')[0]?.trim() ?? ''
  if (!/^[0-9a-f]{40,64}$/.test(tree)) return null
  return { tree, conflicts: result.code !== 0 }
}

interface StatusEntry {
  path: string
  untracked: boolean
}

function parseStatus(raw: string): StatusEntry[] {
  const entries: StatusEntry[] = []
  const fields = raw.split('\0')
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]
    if (!field || field.length < 4) continue
    const code = field.slice(0, 2)
    // Un renommage occupe deux champs : le nouveau nom, puis l'ancien.
    if (code[0] === 'R' || code[0] === 'C') i += 1
    if (code === '!!') continue
    entries.push({ path: field.slice(3), untracked: code === '??' })
  }
  return entries
}

/**
 * Vrai si chaque fichier non suivi existe déjà à l'identique dans la base.
 *
 * Deux processus quel que soit le nombre de fichiers : les empreintes des fichiers
 * d'un côté, les blobs de la base de l'autre, comparés en mémoire.
 */
async function untrackedInBase(path: string, base: string, files: string[]): Promise<boolean> {
  if (files.length === 0) return true
  if (files.length > MAX_UNTRACKED_COMPARED) return false

  const [local, known] = await Promise.all([
    git(path, ['hash-object', '--stdin-paths'], files.join('\n') + '\n'),
    git(path, ['cat-file', '--batch-check=%(objectname)'], files.map((f) => `${base}:${f}`).join('\n') + '\n'),
  ])
  if (local.code !== 0 || known.code !== 0) return false

  const ours = local.stdout.split('\n').filter(Boolean)
  const theirs = known.stdout.split('\n').filter(Boolean)
  if (ours.length !== files.length || theirs.length !== files.length) return false
  return ours.every((oid, i) => theirs[i] === oid)
}

/** Date du fichier modifié le plus récemment, parmi les premiers listés. */
async function lastEdit(path: string, files: string[]): Promise<number | null> {
  let latest: number | null = null
  await Promise.all(
    files.slice(0, MAX_FILES_STATTED).map(async (file) => {
      const info = await stat(join(path, file)).catch(() => null)
      if (info && (latest === null || info.mtimeMs > latest)) latest = info.mtimeMs
    }),
  )
  return latest === null ? null : Math.round(latest)
}

/**
 * Juge un arbre : ce qu'il a que la base n'a pas, en commits et en modifications.
 *
 * `base` est un nom de branche résolu par `defaultBase`. `entry.path` peut ne plus
 * exister : c'est l'état `missing`, qui prime sur tout le reste.
 */
export async function assessWorktree(
  repo: string,
  base: string,
  entry: Pick<WorktreeEntry, 'path' | 'head' | 'prunable'> & { branch?: string | null },
  /** Force le chemin des git antérieurs à 2.40, pour les tests ; sinon lu sur la version. */
  options: { legacyGit?: boolean } = {},
): Promise<WorktreeAssessment> {
  if (entry.prunable || !entry.head) return MISSING
  const dir = await stat(entry.path).catch(() => null)
  if (!dir?.isDirectory()) return MISSING

  const [baseTree, counts, lastCommit, status] = await Promise.all([
    line(repo, ['rev-parse', `${base}^{tree}`]),
    line(repo, ['rev-list', '--left-right', '--count', `${base}...${entry.head}`]),
    line(repo, ['log', '-1', '--format=%ct', entry.head]).catch(() => ''),
    out(entry.path, ['status', '--porcelain', '-z', '--untracked-files=all']),
  ])
  const [behind = 0, ahead = 0] = counts.split('\t').map((n) => Number(n) || 0)

  // Les commits : leur contenu est-il déjà dans la base ?
  let commitsInBase = ahead === 0
  let conflicts = false
  if (ahead > 0) {
    const merged = await mergedTree(repo, base, entry.head)
    conflicts = merged?.conflicts ?? false
    commitsInBase = merged !== null && !merged.conflicts && merged.tree === baseTree
  }

  // Le non commité : `stash create` fabrique le commit sans rien ranger, puis on juge
  // sa différence à HEAD comme on jugerait une branche.
  const entries = parseStatus(status)
  const tracked = entries.filter((e) => !e.untracked)
  const untracked = entries.filter((e) => e.untracked)
  let trackedInBase = tracked.length === 0
  if (tracked.length > 0) {
    const stash = (await git(entry.path, ['stash', 'create'])).stdout.trim()
    if (stash) {
      const modern = options.legacyGit === undefined ? await supportsMergeBase(repo) : !options.legacyGit
      // Sans `--merge-base`, fusionner le stash emporte aussi les commits de la branche :
      // la réponse ne juge le non commité que si ces commits sont déjà dans la base.
      // Sinon il compte comme du travail à garder, ce qu'il est au moins en partie, et
      // l'arbre n'est jamais dit fusionné à tort.
      const merged = modern
        ? await mergedTree(repo, base, stash, entry.head)
        : commitsInBase
          ? await mergedTree(repo, base, stash)
          : null
      trackedInBase = merged !== null && !merged.conflicts && merged.tree === baseTree
      // Le non commité aussi peut coincer : c'est le cas le plus courant des arbres
      // laissés derrière, qui ont vu la base avancer sans eux.
      conflicts ||= merged?.conflicts ?? false
    }
  }
  const untrackedKnown = await untrackedInBase(entry.path, base, untracked.map((e) => e.path))

  const state: WorktreeState =
    !trackedInBase || !untrackedKnown
      ? 'dirty'
      : !commitsInBase
        ? 'unmerged'
        : ahead === 0 && entries.length === 0 && !(await branchHasWorked(repo, entry.branch ?? null))
          ? 'empty'
          : 'merged'

  return {
    state,
    ahead,
    behind,
    modified: tracked.length,
    untracked: untracked.length,
    conflicts,
    unmergedCommits: !commitsInBase,
    lastCommitAt: lastCommit ? Number(lastCommit) * 1000 : null,
    lastEditAt: await lastEdit(entry.path, entries.map((e) => e.path)),
  }
}

/** Branche locale qu'aucun arbre n'a extraite. */
export interface LooseBranch {
  name: string
  /** Rien que la base n'ait déjà : fusionnée, squash et cherry-pick compris. */
  merged: boolean
}

/** Au-delà, une branche n'est plus jugée sur son contenu : elle compte pour non fusionnée. */
const MAX_BRANCHES_JUDGED = 100

/**
 * Les branches locales qu'aucun arbre n'a extraites, la base exceptée, jugées comme un
 * arbre l'est : par leur contenu et non par leur ancestralité. L'ancestralité
 * d'abord, en une commande pour toutes ; `merge-tree` ensuite, pour les seules qui ne
 * sont pas déjà ancêtres de la base.
 */
export async function looseBranches(
  repo: string,
  base: string | null,
  checkedOut: ReadonlySet<string>,
): Promise<LooseBranch[]> {
  const listed = await git(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])
  if (listed.code !== 0) return []
  const names = listed.stdout
    .split('\n')
    .map((name) => name.trim())
    .filter((name) => name && name !== base && !checkedOut.has(name))
  if (!base || names.length === 0) return names.map((name) => ({ name, merged: false }))

  const ancestors = await git(repo, ['for-each-ref', '--format=%(refname:short)', `--merged=${base}`, 'refs/heads/'])
  const merged = new Set(ancestors.code === 0 ? ancestors.stdout.split('\n').map((name) => name.trim()) : [])
  const baseTree = await line(repo, ['rev-parse', `${base}^{tree}`]).catch(() => null)
  let judged = 0
  const result: LooseBranch[] = []
  for (const name of names) {
    if (merged.has(name)) {
      result.push({ name, merged: true })
      continue
    }
    if (!baseTree || judged >= MAX_BRANCHES_JUDGED) {
      result.push({ name, merged: false })
      continue
    }
    judged += 1
    const tree = await mergedTree(repo, base, `refs/heads/${name}`)
    result.push({ name, merged: tree !== null && !tree.conflicts && tree.tree === baseTree })
  }
  return result
}
