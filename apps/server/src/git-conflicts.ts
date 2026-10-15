import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  ConflictFileDto,
  ConflictOrigin,
  ConflictSegmentDto,
  ConflictsDto,
} from '@solera/protocol'
import { GitError } from './git.js'

/**
 * Les conflits, découpés pour l'éditeur de la planche T10.
 *
 * Le fichier arrive **déjà analysé** — une suite de morceaux de contexte et de
 * morceaux en conflit — plutôt qu'en vrac avec ses marqueurs. Deux raisons, et la
 * seconde est la vraie :
 *
 * 1. l'écran empile les trois versions *par bloc*, chacune avec son « prendre » ;
 * 2. le résultat que l'interface renvoie est **le fichier entier recomposé**. Si le
 *    client recoupait lui-même les marqueurs, l'analyseur existerait en deux
 *    exemplaires, et c'est précisément celui qui se trompe qui écrirait sur le disque.
 *
 * « Les miens » et « les leurs » ne vont pas de soi : pendant un rebase ils
 * s'inversent par rapport à l'intuition — `ours` est le commit sur lequel on rejoue,
 * `theirs` le travail qu'on rejoue. Les étiquettes partent donc du serveur.
 */

const run = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run('git', args, { cwd, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr
    throw new GitError((stderr?.trim() || String(err)).split('\n').slice(0, 3).join(' '))
  }
}

/** Au-delà, l'éditeur ne se lit plus, et le transport coûte plus qu'il n'apprend. */
const MAX_LINES = 4000

const MARKERS = {
  ours: '<<<<<<<',
  base: '|||||||',
  split: '=======',
  theirs: '>>>>>>>',
}

/**
 * Un fichier conflictuel découpé en morceaux.
 *
 * L'analyseur accepte le style `diff3` (avec sa section d'ancêtre commun) sans la
 * rendre : l'écran de T10 montre les miens, les leurs et le résultat, et une
 * quatrième version dans un panneau de 40 rem ne se lirait plus. La section est donc
 * lue pour être sautée, et non ignorée — la confondre avec « les miens » donnerait un
 * résultat faux.
 */
export function parseConflict(content: string): { segments: ConflictSegmentDto[]; truncated: boolean } {
  const all = content.split('\n')
  const truncated = all.length > MAX_LINES
  const lines = truncated ? all.slice(0, MAX_LINES) : all

  const segments: ConflictSegmentDto[] = []
  let context: string[] = []
  let ours: string[] | null = null
  let theirs: string[] | null = null
  let side: 'ours' | 'base' | 'theirs' | null = null

  const closeContext = (): void => {
    if (context.length > 0) segments.push({ kind: 'context', lines: context })
    context = []
  }

  for (const line of lines) {
    if (line.startsWith(MARKERS.ours)) {
      closeContext()
      ours = []
      theirs = []
      side = 'ours'
      continue
    }
    if (side !== null && line.startsWith(MARKERS.base)) {
      side = 'base'
      continue
    }
    if (side !== null && line.startsWith(MARKERS.split)) {
      side = 'theirs'
      continue
    }
    if (side !== null && line.startsWith(MARKERS.theirs)) {
      segments.push({ kind: 'conflict', ours: ours ?? [], theirs: theirs ?? [] })
      ours = null
      theirs = null
      side = null
      continue
    }

    if (side === 'ours') ours?.push(line)
    else if (side === 'theirs') theirs?.push(line)
    else if (side === 'base') continue
    else context.push(line)
  }

  // Un fichier dont le dernier marqueur manque est un fichier qu'on a déjà édité à
  // moitié : ce qui reste ouvert redevient du contexte, pour ne rien perdre.
  if (ours !== null) context.push(...ours, ...(theirs ?? []))
  closeContext()
  return { segments, truncated }
}

/** D'où vient le conflit : la phrase de l'en-tête et les étiquettes en dépendent. */
async function originOf(cwd: string): Promise<{ origin: ConflictOrigin | null; theirs: string }> {
  const gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
  const read = (name: string): Promise<string> =>
    readFile(join(gitDir, name), 'utf8').then((text) => text.trim(), () => '')

  const [mergeHead, cherry, revert, rebaseHead] = await Promise.all([
    read('MERGE_HEAD'),
    read('CHERRY_PICK_HEAD'),
    read('REVERT_HEAD'),
    read('rebase-merge/stopped-sha'),
  ])

  // L'ordre compte : pendant un rebase, `CHERRY_PICK_HEAD` peut exister aussi, et
  // c'est le rebase qui explique l'état du dépôt.
  if (rebaseHead) return { origin: 'rebase', theirs: await describe(cwd, rebaseHead) }
  if (mergeHead) return { origin: 'merge', theirs: await mergeName(cwd, mergeHead) }
  if (cherry) return { origin: 'cherry-pick', theirs: await describe(cwd, cherry) }
  if (revert) return { origin: 'revert', theirs: await describe(cwd, revert) }
  return { origin: null, theirs: '' }
}

const describe = async (cwd: string, hash: string): Promise<string> =>
  (await git(cwd, ['log', '-1', '--format=%h %s', hash]).catch(() => hash)).trim()

/**
 * Le nom de ce qu'on fusionne, pris là où git l'a écrit.
 *
 * `MERGE_MSG` porte « Merge branch 'audit/bundle-web' », qui est le nom qu'on a tapé ;
 * le sha seul ne dirait rien à l'écran.
 */
async function mergeName(cwd: string, hash: string): Promise<string> {
  const gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
  const msg = await readFile(join(gitDir, 'MERGE_MSG'), 'utf8').catch(() => '')
  const quoted = /'([^']+)'/.exec(msg.split('\n')[0] ?? '')
  return quoted?.[1] ?? (await describe(cwd, hash))
}

export async function readConflicts(cwd: string, paths: string[]): Promise<ConflictsDto> {
  const { origin, theirs } = await originOf(cwd)
  const branch = (await git(cwd, ['branch', '--show-current']).catch(() => '')).trim()

  const files: ConflictFileDto[] = []
  for (const path of paths) {
    const raw = await readFile(join(cwd, path), 'utf8').catch(() => null)
    if (raw === null) {
      // Illisible en texte : un conflit binaire, ou un fichier supprimé d'un côté.
      // *Prendre les miens / les leurs* reste possible, l'éditeur non.
      files.push({ path, binary: true, segments: [], truncated: false })
      continue
    }
    const { segments, truncated } = parseConflict(raw)
    files.push({ path, binary: false, segments, truncated })
  }

  return {
    origin,
    // Pendant un rebase, « les miens » est le commit sur lequel on rejoue, et il n'a
    // pas de nom de branche : on dit alors sur quoi on rebase plutôt que de mentir.
    oursLabel: branch || 'HEAD',
    theirsLabel: theirs,
    files,
  }
}

/**
 * Le fichier recomposé, refusé s'il porte encore un marqueur.
 *
 * Commiter un `<<<<<<<` est l'accident que cet écran existe pour empêcher, et il ne
 * se voit qu'à la relecture, parfois des jours plus tard. Le refus est donc ici, du
 * côté qui écrit sur le disque, et pas seulement dans l'interface qui compose.
 */
export function refuseMarkers(content: string): void {
  const offending = content
    .split('\n')
    .findIndex((line) => line.startsWith(MARKERS.ours) || line.startsWith(MARKERS.theirs))
  if (offending !== -1) {
    throw new GitError(
      `Il reste un marqueur de conflit ligne ${offending + 1} : résous-le avant de marquer le fichier résolu.`,
    )
  }
}
