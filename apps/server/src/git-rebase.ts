import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { GitRebaseDto, RebaseStep } from '@solera/protocol'
import { GitError } from './git.js'

/**
 * Le rebase interactif, mené sans éditeur (planche T9).
 *
 * `git rebase -i` est bâti autour d'un humain devant `vim` : il ouvre un éditeur pour
 * la liste des commits, puis un autre pour chaque message à réécrire. Il faut donc le
 * conduire autrement, et il y a deux façons de s'y prendre :
 *
 * 1. **refaire le rebase à la main**, en `cherry-pick` successifs. Tentant, et faux :
 *    on réécrirait les cas limites de git (fusions, commits vides, `rerere`, reprise
 *    après conflit) moins bien que lui, dans le module qui peut perdre du travail ;
 * 2. **lui fournir ses éditeurs**, ce que fait ce module. `GIT_SEQUENCE_EDITOR` reçoit
 *    un `cp` du todo qu'on a écrit, et les messages passent par des `exec git commit
 *    --amend -F <fichier>` que git exécute à la bonne place dans sa propre séquence.
 *    Git fait tout le travail, et nous rien de ce qu'il sait déjà faire.
 *
 * **Aucun message ne voyage sur une ligne de commande.** Le todo est relu par un
 * shell : un message de commit contient des apostrophes, des `$` et des retours à la
 * ligne. Seuls des chemins que nous fabriquons y figurent, et ils sont vérifiés.
 *
 * Les fichiers de messages vivent **dans le dossier git du dépôt** et non dans
 * `/tmp` : un rebase s'interrompt sur un conflit et reprend dans une autre requête,
 * parfois une heure plus tard. Un dossier temporaire nettoyé en fin de requête
 * laisserait la reprise sans ses messages.
 */

const run = promisify(execFile)

const TIMEOUT_MS = 120_000

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  try {
    const { stdout } = await run('git', args, {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    })
    return stdout
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr
    const stdout = (err as { stdout?: string }).stdout
    throw new GitError(
      (stderr?.trim() || stdout?.trim() || String(err)).split('\n').filter(Boolean).slice(0, 4).join(' '),
    )
  }
}

/** Où git range l'état d'un rebase : deux dossiers selon le moteur employé. */
async function rebaseDirs(cwd: string): Promise<string[]> {
  const gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
  return [join(gitDir, 'rebase-merge'), join(gitDir, 'rebase-apply')]
}

const readOr = async (path: string, fallback = ''): Promise<string> =>
  readFile(path, 'utf8').catch(() => fallback)

/**
 * Un rebase est-il en cours dans ce répertoire ?
 *
 * C'est **la question qui suspend les tours** (écart assumé n° 3 de la carte #10) :
 * un rebase à moitié fait n'est pas un dépôt qu'un agent sait lire — ni l'arbre, ni
 * `HEAD`, ni la branche ne veulent dire ce qu'ils veulent dire d'habitude. Un process
 * git de plus avant de lancer un tour, ce qui ne pèse rien à côté d'un CLI qui démarre.
 */
export async function rebaseInProgress(cwd: string): Promise<boolean> {
  const dirs = await rebaseDirs(cwd).catch(() => null)
  if (!dirs) return false
  for (const dir of dirs) {
    if (await readFile(join(dir, 'head-name'), 'utf8').then(() => true, () => false)) return true
    // `rebase-apply` d'un `git am` n'a pas de `head-name` ; `next` y est toujours.
    if (await readFile(join(dir, 'next'), 'utf8').then(() => true, () => false)) return true
  }
  return false
}

/** Où en est le rebase : ce que l'écran affiche, et ce qui explique l'attente. */
export async function readRebaseState(
  cwd: string,
  conflicted: string[],
): Promise<GitRebaseDto | null> {
  const dirs = await rebaseDirs(cwd).catch(() => null)
  if (!dirs) return null

  for (const dir of dirs) {
    const next = (await readOr(join(dir, 'next'))).trim()
    const head = (await readOr(join(dir, 'head-name'))).trim()
    if (!next && !head) continue

    const total = Number((await readOr(join(dir, 'end'))).trim()) || 0
    const done = Number(next) || 0
    const onto = (await readOr(join(dir, 'onto'))).trim()
    const stoppedHash = (await readOr(join(dir, 'stopped-sha'))).trim()
    const subject = stoppedHash
      ? (await git(cwd, ['log', '-1', '--format=%s', stoppedHash]).catch(() => '')).trim()
      : ''

    return {
      onto: onto ? onto.slice(0, 7) : null,
      stopped: stoppedHash ? { shortHash: stoppedHash.slice(0, 7), subject } : null,
      // `next` est le rang du prochain à jouer : les terminés sont ceux d'avant.
      done: Math.max(0, done - 1),
      total,
      conflicted,
    }
  }
  return null
}

/** Le dossier où vivent les messages préparés, à côté de l'état du rebase. */
async function messageDir(cwd: string): Promise<string> {
  const gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
  return join(gitDir, 'solera-rebase')
}

/**
 * Un chemin à faire relire par un shell, entre apostrophes.
 *
 * Les chemins qui arrivent ici sont les nôtres — le dossier git du dépôt et un nom de
 * fichier numéroté — mais le dossier git vient de la machine : un dépôt posé dans un
 * dossier contenant une apostrophe est rare et parfaitement légal. On refuse plutôt
 * que d'échapper à moitié.
 */
function shellPath(path: string): string {
  if (path.includes("'")) {
    throw new GitError('Le chemin de ce dépôt contient une apostrophe : le rebase interactif n’y marche pas.')
  }
  return `'${path}'`
}

/**
 * Le todo du rebase, et les messages que ses `exec` iront chercher.
 *
 * La traduction des quatre verbes de T9 vers ce que git sait faire sans éditeur :
 *
 * - *reprendre* → `pick`, tel quel ;
 * - *jeter* → `drop` ;
 * - *réécrire* → `pick`, suivi d'un `exec git commit --amend -F` qui pose le message
 *   réécrit. `reword` ouvrirait l'éditeur, ce qu'on ne peut pas offrir ;
 * - *fondre* → `fixup`, qui **n'ouvre pas** l'éditeur, suivi — à la fin d'une suite de
 *   fondus — d'un `exec` qui repose le message combiné. `squash` ouvrirait l'éditeur,
 *   et `fixup` seul perdrait en silence le message du commit fondu, ce qui est une
 *   perte qu'on n'a pas annoncée.
 */
export async function writeTodo(
  cwd: string,
  plan: RebaseStep[],
  subjects: Map<string, string>,
): Promise<{ todo: string; dir: string }> {
  if (plan[0]?.verb === 'squash') {
    throw new GitError('Le premier commit ne peut pas être fondu : il n’a rien au-dessus de lui.')
  }
  if (plan.every((step) => step.verb === 'drop')) {
    throw new GitError('Un rebase qui jette tout ne laisse rien à rebaser.')
  }

  const dir = await messageDir(cwd)
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const lines: string[] = []
  const files: { name: string; body: string }[] = []
  /**
   * Le message du dernier commit retenu, et s'il a changé.
   *
   * `changed` décide de l'`exec` : un `pick` que personne n'a réécrit et dans lequel
   * rien n'a été fondu garde son message, et n'a donc aucune raison d'être amendé.
   */
  let held: { body: string; changed: boolean } | null = null

  const flush = (): void => {
    if (held?.changed) {
      const name = String(files.length)
      files.push({ name, body: held.body })
      // L'`exec` se pose après le dernier commit de la suite : à ce moment-là, `HEAD`
      // est le commit retenu, fondus compris.
      lines.push(`exec git commit --amend --allow-empty -F ${shellPath(join(dir, name))}`)
    }
    held = null
  }

  for (const step of plan) {
    if (step.verb === 'drop') {
      flush()
      lines.push(`drop ${step.hash}`)
      continue
    }
    if (step.verb === 'squash') {
      // Pas de `flush` : on prolonge la suite en cours, et le message s'accumule.
      lines.push(`fixup ${step.hash}`)
      const folded = subjects.get(step.hash)?.trim() ?? ''
      if (held && folded) held = { body: `${held.body}\n\n${folded}`, changed: true }
      continue
    }

    flush()
    lines.push(`pick ${step.hash}`)
    const original = subjects.get(step.hash)?.trim() ?? ''
    held =
      step.verb === 'reword'
        ? { body: step.message.trim() || original, changed: step.message.trim() !== original }
        : { body: original, changed: false }
  }
  flush()

  const todo = join(dir, 'todo')
  await Promise.all(files.map((file) => writeFile(join(dir, file.name), `${file.body}\n`)))
  await writeFile(todo, `${lines.join('\n')}\n`)
  return { todo, dir }
}

/**
 * L'environnement qui remplace les deux éditeurs de git.
 *
 * `GIT_EDITOR=true` n'est pas un détail : sans lui, la reprise après conflit
 * (`rebase --continue`) ouvrirait un éditeur pour le message du commit, et le process
 * resterait là à attendre quelqu'un qui ne viendra jamais.
 */
export function rebaseEnv(todo: string | null): NodeJS.ProcessEnv {
  return {
    GIT_EDITOR: 'true',
    ...(todo ? { GIT_SEQUENCE_EDITOR: `cp ${shellPath(todo)}` } : {}),
  }
}

/** Les sujets des commits du plan, pour composer les messages fondus. */
export async function readSubjects(cwd: string, hashes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const hash of hashes) {
    const body = await git(cwd, ['log', '-1', '--format=%B', hash]).catch(() => '')
    out.set(hash, body.trim())
  }
  return out
}

/** Le dossier des messages, une fois le rebase fini ou abandonné. */
export async function forgetMessages(cwd: string): Promise<void> {
  const dir = await messageDir(cwd).catch(() => null)
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
}
