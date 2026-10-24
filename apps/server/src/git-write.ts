import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  DiffFileDto,
  GitAction,
  GitImpactDto,
  GitLossDto,
  GitRebaseDto,
  GitUndoDto,
  GitUndoKind,
  StashDto,
} from '@solera/protocol'
import { refuseMarkers } from './git-conflicts.js'
import { partialPatch } from './git-lines.js'
import {
  forgetMessages,
  readRebaseState,
  readSubjects,
  rebaseEnv,
  writeTodo,
} from './git-rebase.js'
import { fromPrefix, GitError, PATCH_FLAGS, readPrefix, relativePatch } from './git.js'

/**
 * Ce que la vue Git **écrit** dans le dépôt, et ce qu'elle doit savoir avant d'écrire.
 *
 * Séparé de `git.ts`, qui porte les lectures d'état et le clone : ici chaque fonction
 * peut abîmer un dépôt, et trois choses en découlent qui n'existent nulle part
 * ailleurs dans le serveur —
 *
 * 1. **Le coût d'un geste se calcule avant de le faire** (`impactOf`), depuis les
 *    mêmes lectures que le geste lui-même. C'est le garde-fou de la planche T13 : il
 *    ne dit pas « attention » mais « 5 fichiers modifiés, 4 commits dont 2 écrits par
 *    un agent ». Un garde-fou qui se trompe de chiffre ne sert à rien.
 * 2. **Ce qui est annulable l'est nommément** (`perform` rend un `UndoRecord`), et
 *    l'offre est retirée dès que le dépôt a bougé : un « Annuler » qui échoue une fois
 *    sur dix est pire que pas de bouton.
 * 3. **Rien n'est interpolé dans un shell.** Tout passe en arguments d'`execFile`, et
 *    les noms de références sont filtrés côté protocole avant d'arriver ici.
 *
 * Le verrou de concurrence, lui, n'est pas ici mais dans la route : il tient à la base
 * (quel fil travaille dans ce répertoire) et pas au dépôt.
 * Ici, seulement la file (`serialized`) qui empêche deux écritures du serveur de se
 * croiser.
 */

const run = promisify(execFile)

const queues = new Map<string, Promise<unknown>>()

/**
 * Une écriture à la fois par dépôt.
 *
 * Le verrou de la route refuse un geste pendant qu'un fil travaille ; il ne voit pas
 * deux écritures du serveur lui-même qui se croisent — un geste de l'onglet Git et la
 * restauration d'un tour, par exemple, qui réécrivent tous deux l'index et l'arbre.
 */
export function serialized<T>(cwd: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(cwd) ?? Promise.resolve()
  const next = previous.then(task, task)
  const settled = next.catch(() => {})
  queues.set(cwd, settled)
  // La file se vide derrière elle : un dépôt ouvert une fois ne garde pas d'entrée.
  void settled.then(() => {
    if (queues.get(cwd) === settled) queues.delete(cwd)
  })
  return next
}

/** Les lectures d'état sont courtes ; un `log` sur un gros dépôt peut traîner. */
const READ_TIMEOUT_MS = 15_000

/**
 * Les gestes qui parlent au réseau n'ont pas le même ordre de grandeur : un `push` sur
 * une ligne lente met légitimement une minute, et l'interrompre à quinze secondes
 * laisserait l'utilisateur sans réponse devant un dépôt dont il ne sait plus l'état.
 */
const NETWORK_TIMEOUT_MS = 120_000

async function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  timeout = READ_TIMEOUT_MS,
): Promise<string> {
  try {
    // Un chemin accentué reste lisible : sans ce réglage, `--numstat` et les en-têtes de
    // patch l'écrivent entre guillemets, en octets échappés.
    const { stdout } = await run('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      ...(env ? { env: { ...process.env, ...env } } : {}),
    })
    return stdout
  } catch (err) {
    throw new GitError(gitMessage(err))
  }
}

/**
 * Le message de git, pas celui de Node.
 *
 * `execFile` rend « Command failed with exit code 1 », qui n'apprend rien ; git écrit
 * sur sa sortie d'erreur la phrase qui dit quoi faire — « Your local changes would be
 * overwritten », « not something we can merge ». C'est elle qu'on remonte à l'écran.
 */
function gitMessage(err: unknown): string {
  const stderr = (err as { stderr?: string }).stderr
  const stdout = (err as { stdout?: string }).stdout
  const text = stderr?.trim() || stdout?.trim() || (err instanceof Error ? err.message : String(err))
  return text.split('\n').filter(Boolean).slice(0, 4).join(' ').trim()
}

/** Un diff de plusieurs mégaoctets ne s'affiche pas et ne se transporte pas utilement. */
const MAX_DIFF_BYTES = 512 * 1024

function parseNumstat(numstat: string, prefix = ''): DiffFileDto[] {
  return numstat
    .split('\0')
    .flatMap((chunk) => chunk.split('\n'))
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [added, removed, path] = line.split('\t')
      return { path: path ?? '', added: Number(added) || 0, removed: Number(removed) || 0 }
    })
    .filter((file) => file.path.length > 0)
    .map((file) => ({ ...file, path: fromPrefix(prefix, file.path) }))
}

export interface WriteState {
  branch: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  detached: boolean
  staged: DiffFileDto[]
  unstaged: DiffFileDto[]
  stagedPatch: string
  unstagedPatch: string
  truncated: boolean
  head: { hash: string; shortHash: string; subject: string } | null
  conflicted: string[]
  rebase: GitRebaseDto | null
}

/**
 * Les deux moitiés de la destination *En cours* : l'index contre `HEAD`, et le
 * répertoire de travail contre l'index.
 *
 * Les non-suivis comptent comme non indexés, sans quoi la vue mentirait : un fichier
 * qu'un agent vient de créer est du travail en cours comme un autre. Ils arrivent par
 * un **index temporaire** (`GIT_INDEX_FILE`) et un `--intent-to-add`, qui est ce qui
 * rend la lecture réellement sans effet — toucher le vrai index juste pour afficher un
 * onglet indexerait sous les pieds de l'utilisateur ce qu'il n'a pas coché.
 */
export async function readWriteState(cwd: string): Promise<WriteState | null> {
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree']).catch(() => '')
  if (inside.trim() !== 'true') return null

  const branchRaw = (await git(cwd, ['branch', '--show-current']).catch(() => '')).trim()
  const branch = branchRaw.length > 0 ? branchRaw : null

  const head = await readHead(cwd)
  const upstream = branch
    ? (await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']).catch(
        () => '',
      )).trim() || null
    : null

  let ahead: number | null = null
  let behind: number | null = null
  if (upstream) {
    const counts = (await git(cwd, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]).catch(
      () => '',
    )).trim()
    const [behindRaw, aheadRaw] = counts.split(/\s+/)
    behind = Number(behindRaw) || 0
    ahead = Number(aheadRaw) || 0
  }

  // `--no-relative` : un `diff.relative` de l'utilisateur ne doit pas faire parler une
  // commande depuis le sous-dossier et sa voisine depuis la racine. Tout part de la
  // racine, puis revient au dossier du projet, qui est celui des gestes.
  const prefix = await readPrefix(cwd)
  const [staged, rawStagedPatch] = await Promise.all([
    git(cwd, ['diff', '--cached', '--numstat', '--no-relative']).catch(() => ''),
    git(cwd, ['diff', '--cached', ...PATCH_FLAGS]).catch(() => ''),
  ])
  const stagedPatch = relativePatch(prefix, rawStagedPatch)
  const unstaged = await readUnstaged(cwd, prefix)
  const conflicted = (await git(cwd, ['diff', '--name-only', '--no-relative', '--diff-filter=U']).catch(() => ''))
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => fromPrefix(prefix, path))

  const truncated =
    Buffer.byteLength(stagedPatch) > MAX_DIFF_BYTES ||
    Buffer.byteLength(unstaged.patch) > MAX_DIFF_BYTES

  return {
    branch,
    upstream,
    ahead,
    behind,
    detached: branch === null && head !== null,
    staged: parseNumstat(staged, prefix),
    unstaged: unstaged.files,
    stagedPatch: stagedPatch.slice(0, MAX_DIFF_BYTES),
    unstagedPatch: unstaged.patch.slice(0, MAX_DIFF_BYTES),
    truncated,
    head,
    conflicted,
    // Lu avec le reste et non par une requête à part : c'est lui qui suspend les
    // tours, donc il change ce que la vue entière a le droit de faire.
    rebase: await readRebaseState(cwd, conflicted),
  }
}

async function readHead(cwd: string): Promise<WriteState['head']> {
  const raw = (await git(cwd, ['log', '-1', '--format=%H%x00%h%x00%s']).catch(() => '')).trim()
  const [hash, shortHash, subject] = raw.split('\0')
  if (!hash) return null
  return { hash, shortHash: shortHash ?? hash.slice(0, 7), subject: subject ?? '' }
}

/** Le répertoire de travail contre l'index, non-suivis compris. Voir `readWriteState`. */
async function readUnstaged(cwd: string, prefix: string): Promise<{ files: DiffFileDto[]; patch: string }> {
  const gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
  const scratch = join(tmpdir(), `solera-index-${randomUUID()}`)
  try {
    await copyFile(join(gitDir, 'index'), scratch).catch(() => {})
    const env = { GIT_INDEX_FILE: scratch }
    await git(cwd, ['add', '--intent-to-add', '--all'], env)
    const [numstat, patch] = await Promise.all([
      git(cwd, ['diff', '--numstat', '--no-relative'], env).catch(() => ''),
      git(cwd, ['diff', ...PATCH_FLAGS], env).catch(() => ''),
    ])
    return { files: parseNumstat(numstat, prefix), patch: relativePatch(prefix, patch) }
  } finally {
    await rm(scratch, { force: true }).catch(() => {})
  }
}

/** Au-delà, l'aperçu d'une remise ne se lit plus et n'apprend rien de plus. */
const STASH_PREVIEW_FILES = 20

/**
 * Les remises, **avec l'aperçu de leur contenu** (planche T8).
 *
 * L'aperçu n'est pas un ornement : sans lui on n'ose plus dépiler, parce qu'une remise
 * nommée « WIP on main » ne dit rien de ce qu'elle rendrait à l'arbre.
 */
export async function readStashDetails(cwd: string): Promise<StashDto[]> {
  const raw = await git(cwd, [
    'stash',
    'list',
    '--format=%H%x00%gd%x00%gs%x00%ct',
  ]).catch(() => '')

  const entries = raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      const [hash, ref, subject, ts] = line.split('\0')
      return {
        index,
        hash: hash ?? '',
        ref: ref ?? `stash@{${index}}`,
        subject: subject ?? '',
        ts: Number(ts) * 1000 || 0,
      }
    })
    .filter((entry) => entry.hash.length > 0)

  return Promise.all(
    entries.map(async (entry) => {
      const numstat = await git(cwd, [
        'stash',
        'show',
        '--numstat',
        '--include-untracked',
        entry.hash,
      ]).catch(() => '')
      const files = parseNumstat(numstat)
      // `WIP on main: 3dbd749 Un message` → le sujet seul, la branche à part : les deux
      // sont déjà affichés séparément, et la ligne entière déborderait de la colonne.
      const match = /^(?:WIP on|On) ([^:]+): (?:[0-9a-f]{7,40} )?(.*)$/.exec(entry.subject)
      return {
        index: entry.index,
        hash: entry.hash,
        ref: entry.ref,
        message: match?.[2] ?? entry.subject,
        branch: match?.[1] ?? null,
        ts: entry.ts,
        files: files.slice(0, STASH_PREVIEW_FILES),
        truncated: files.length > STASH_PREVIEW_FILES,
      }
    }),
  )
}

/**
 * Ce que `git` sait du commit qu'on s'apprête à perdre : combien, et combien d'un agent.
 *
 * `%B` et non `%s` : c'est dans le corps que vit le `Co-Authored-By`, seul endroit où
 * un agent est nommé — le CLI commite sous l'identité git de l'utilisateur.
 */
async function commitLoss(cwd: string, range: string[]): Promise<GitLossDto | null> {
  const raw = await git(cwd, ['log', '--format=%H%x00%B%x1e', ...range]).catch(() => '')
  const records = raw.split('\x1e').map((record) => record.trim()).filter(Boolean)
  if (records.length === 0) return null
  const byAgent = records.filter((record) => /co-authored-by:/i.test(record)).length
  return { kind: 'commits', count: records.length, byAgent }
}

/**
 * Ce que le répertoire de travail perdrait : les fichiers sales, et leur volume.
 *
 * `untracked` n'est pas un détail de confort : `git reset --dur` **ne touche pas** aux
 * fichiers non suivis, alors que *jeter les modifications* les efface. Les compter
 * dans le premier cas ferait annoncer une perte qui n'aurait pas lieu — et un
 * garde-fou qui exagère se fait ignorer aussi sûrement qu'un garde-fou qui minimise.
 */
async function workingLoss(
  cwd: string,
  paths?: string[],
  untrackedToo = true,
): Promise<GitLossDto | null> {
  const scope = paths && paths.length > 0 ? ['--', ...paths] : []
  const [tracked, untracked] = await Promise.all([
    git(cwd, ['diff', 'HEAD', '--numstat', ...scope]).catch(() => ''),
    untrackedToo
      ? git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', ...scope]).catch(() => '')
      : Promise.resolve(''),
  ])
  const files = parseNumstat(tracked)
  const others = untracked.split('\0').filter(Boolean)
  const count = files.length + others.length
  if (count === 0) return null
  return {
    kind: 'working',
    count,
    added: files.reduce((sum, file) => sum + file.added, 0),
    removed: files.reduce((sum, file) => sum + file.removed, 0),
  }
}

async function stagedLoss(cwd: string): Promise<GitLossDto | null> {
  const numstat = await git(cwd, ['diff', '--cached', '--numstat']).catch(() => '')
  const files = parseNumstat(numstat)
  return files.length > 0 ? { kind: 'staged', count: files.length } : null
}

/**
 * Ce que coûte un geste, **avant** de le faire.
 *
 * Deux sortes de gestes seulement : ceux qu'`Annuler` rattrape, et ceux qui passent
 * par un garde-fou nommant la perte. Un geste qui ne figure pas ici n'abîme rien —
 * indexer, retirer, remiser, créer une branche — et part sans rien demander.
 *
 * Les chiffres rendus sont ceux-là mêmes que le geste détruirait : ils viennent des
 * mêmes commandes git, au même moment. C'est ce que le test du garde-fou vérifie.
 */
export async function impactOf(cwd: string, action: GitAction): Promise<GitImpactDto> {
  const losses: GitLossDto[] = []
  const add = (loss: GitLossDto | null): void => {
    if (loss) losses.push(loss)
  }

  switch (action.kind) {
    case 'discard': {
      add(await workingLoss(cwd, action.paths))
      return { undoable: false, losses, offerStash: losses.length > 0 }
    }
    case 'commit-reset': {
      if (action.mode === 'hard') {
        // Sans les non-suivis : `--dur` les laisse en place, voir `workingLoss`.
        add(await workingLoss(cwd, undefined, false))
        add(await stagedLoss(cwd))
      }
      add(await commitLoss(cwd, [`${action.hash}..HEAD`]))
      // Les trois modes ne perdent pas la même chose : `--soft` et `--mixed` laissent
      // le travail sur le disque, donc ils s'annulent ; `--dur` le jette, et aucun
      // `reflog` ne le rend.
      return {
        undoable: action.mode !== 'hard',
        losses,
        offerStash: action.mode === 'hard' && losses.some((loss) => loss.kind === 'working'),
      }
    }
    case 'stash-drop': {
      const stashes = await readStashDetails(cwd)
      const stash = action.hash
        ? stashes.find((entry) => entry.hash === action.hash)
        : stashes[action.index]
      if (stash) losses.push({ kind: 'stash', count: stash.files.length })
      return { undoable: false, losses, offerStash: false }
    }
    case 'branch-delete': {
      // Ce que la branche porte et que rien d'autre ne porte, soit exactement ce que
      // `git branch -d` refuse de jeter et que `-D` jetterait sans le dire.
      add(await commitLoss(cwd, [action.name, '--not', '--all', `--exclude=${action.name}`]))
      return { undoable: true, losses, offerStash: false }
    }
    case 'push': {
      if (!action.force) return { undoable: false, losses, offerStash: false }
      const branch = action.branch ?? (await git(cwd, ['branch', '--show-current'])).trim()
      const upstream = (
        await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${branch}@{upstream}`]).catch(
          () => '',
        )
      ).trim()
      if (upstream) {
        const loss = await commitLoss(cwd, [`${branch}..${upstream}`])
        if (loss) losses.push({ ...loss, kind: 'remote' })
      }
      return { undoable: false, losses, offerStash: false }
    }
    case 'branch-switch':
    case 'commit-switch':
    case 'commit-rebase':
    case 'branch-rebase':
      // Git refuse lui-même de marcher sur un arbre sale, donc rien ne se perd ; le
      // garde-fou ne sert qu'à dire pourquoi ça va échouer, et à proposer de remiser.
      return {
        undoable: action.kind === 'branch-switch' || action.kind === 'commit-switch',
        losses,
        offerStash: (await workingLoss(cwd)) !== null,
      }
    case 'rebase-abort': {
      // Ce qu'un abandon emporte : les commits déjà rejoués, et le travail de
      // résolution de conflits qui a été indexé pour y arriver. Le dépôt revient où
      // il était, donc rien d'autre ne se perd — et le dire exactement est ce qui
      // distingue ce garde-fou d'un « êtes-vous sûr ? ».
      const state = await readWriteState(cwd)
      const done = state?.rebase?.done ?? 0
      if (done > 0) losses.push({ kind: 'commits', count: done, byAgent: 0 })
      add(await stagedLoss(cwd))
      return { undoable: false, losses, offerStash: false }
    }
    case 'conflict-take': {
      // Prendre un côté écrase ce que l'autre portait, et ce qu'on avait déjà résolu
      // à la main dans ces fichiers-là.
      const conflicted = (await readWriteState(cwd))?.conflicted ?? []
      const count = action.path ? 1 : conflicted.length
      if (count > 0) losses.push({ kind: 'working', count })
      return { undoable: false, losses, offerStash: false }
    }
    default:
      return { undoable: isUndoable(action), losses, offerStash: false }
  }
}

const UNDOABLE: ReadonlySet<GitAction['kind']> = new Set([
  'commit',
  'branch-create',
  'branch-switch',
  'branch-merge',
  'branch-rebase',
  'branch-rename',
  'branch-delete',
  'branch-track',
  'commit-switch',
  'commit-branch',
  'commit-merge',
  'commit-rebase',
  'commit-cherry-pick',
  'commit-revert',
  'commit-tag',
  'stash-push',
  // Un rebase interactif qui va au bout se défait d'un `reset --dur` sur le `HEAD`
  // d'avant, tant que l'arbre est resté propre. Un rebase **interrompu**, lui, n'en
  // rend aucun : il n'a pas encore de `HEAD` d'arrivée, et c'est *Abandonner* qui le
  // défait, avec son garde-fou.
  'rebase-start',
])

function isUndoable(action: GitAction): boolean {
  if (action.kind === 'commit-reset') return action.mode !== 'hard'
  return UNDOABLE.has(action.kind)
}

/**
 * De quoi défaire un geste, retenu le temps que ce soit encore vrai.
 *
 * `head` et `requiresClean` sont les deux conditions de validité : on ne défait un
 * geste que si le dépôt est resté où le geste l'a laissé. Un agent qui commite
 * derrière, un `git` tapé dans un terminal, une autre session — et l'offre disparaît
 * d'elle-même au lieu de promettre ce qu'elle ne peut plus tenir.
 */
export interface UndoRecord {
  kind: GitUndoKind
  subject: string
  target: string | null
  /** Commandes de l'annulation, dans l'ordre. `STASH` y est remplacé par l'index du jour. */
  steps: string[][]
  head: string | null
  requiresClean: boolean
  /** Sha de la remise à retrouver, quand l'annulation en vise une. */
  stashHash: string | null
  /** Le geste d'origine, pour *Refaire*. */
  redo: GitAction
}

/** Jeton remplacé par `stash@{n}` au moment de l'annulation : l'index a pu glisser. */
const STASH_TOKEN = '@solera:stash'

export interface ActionOutcome {
  undo: UndoRecord | null
  /** Ce que git a dit, quand ça vaut d'être lu : « Already up to date. » */
  message: string
}

/**
 * Exécute le geste.
 *
 * Un `switch` et pas une table : chaque branche porte ses deux ou trois commandes et
 * la façon dont elle se défait, et les tenir ensemble est ce qui empêche qu'une
 * annulation reste en arrière quand un geste change.
 *
 * `env` porte les identifiants (`credentialEnv`) : c'est la **même porte** que le
 * clone, pas une seconde — le helper déclaré va chercher le jeton dans la base au
 * moment où git le réclame, et `GIT_TERMINAL_PROMPT=0` fait échouer franchement un
 * dépôt sans jeton plutôt que de bloquer sur une invite que personne ne verra.
 */
export async function perform(
  cwd: string,
  action: GitAction,
  env: NodeJS.ProcessEnv,
): Promise<ActionOutcome> {
  const before = await readHead(cwd)
  const beforeBranch = (await git(cwd, ['branch', '--show-current']).catch(() => '')).trim() || null
  const net = (args: string[]): Promise<string> => git(cwd, args, env, NETWORK_TIMEOUT_MS)

  const after = async (): Promise<string | null> => (await readHead(cwd))?.hash ?? null

  switch (action.kind) {
    case 'stage': {
      // `--` isole les chemins des options : un fichier nommé `-f` existe.
      await git(cwd, ['add', '--', ...action.paths])
      return { undo: null, message: '' }
    }
    case 'unstage': {
      // `restore --staged` et non `reset`, qui sur un dépôt sans commit échoue.
      await git(cwd, ['restore', '--staged', '--', ...action.paths])
      return { undo: null, message: '' }
    }
    case 'discard': {
      // Deux passes : les suivis reviennent à l'index, les autres n'y sont pas et il
      // faut les retirer du disque. `git restore` ne connaît pas les non-suivis.
      await git(cwd, ['restore', '--worktree', '--staged', '--', ...action.paths]).catch(() => {})
      await git(cwd, ['clean', '-fd', '--', ...action.paths]).catch(() => {})
      return { undo: null, message: '' }
    }
    case 'commit': {
      const message = [action.summary, action.description.trim(), action.coAuthor ?? '']
        .filter((part) => part.length > 0)
        .join('\n\n')
      await git(cwd, ['commit', ...(action.amend ? ['--amend'] : []), '-m', message])
      if (action.push) await net(['push'])

      const parent = action.amend ? before?.hash ?? null : before?.hash ?? null
      return {
        undo: parent
          ? {
              kind: action.amend ? 'amend' : 'commit',
              subject: action.summary,
              target: parent.slice(0, 7),
              // `--soft` : le commit est défait, ce qu'il portait revient à l'index, et
              // rien de ce qui est sur le disque ne bouge.
              steps: [['reset', '--soft', parent]],
              head: await after(),
              requiresClean: false,
              stashHash: null,
              redo: action,
            }
          : null,
        message: '',
      }
    }
    case 'fetch': {
      const out = await net(['fetch', '--all', '--prune'])
      return { undo: null, message: out.trim() }
    }
    case 'pull': {
      // `--ff-only` : une fusion automatique derrière un bouton « Tirer » fabrique un
      // commit de fusion que personne n'a demandé, et parfois un conflit à résoudre.
      const out = await net(['pull', '--ff-only'])
      return { undo: null, message: out.trim() }
    }
    case 'push': {
      const args = ['push']
      // `--force-with-lease` et jamais `--force` : il refuse d'écraser ce qu'on n'a pas
      // vu, ce qui est exactement la perte qu'on cherche à éviter.
      if (action.force) args.push('--force-with-lease')
      if (action.branch) args.push('origin', action.branch)
      else args.push('--set-upstream', 'origin', 'HEAD')
      const out = await net(args)
      return { undo: null, message: out.trim() }
    }
    case 'branch-create': {
      const from = action.from ?? 'HEAD'
      if (action.checkout) await git(cwd, ['switch', '-c', action.name, from])
      else await git(cwd, ['branch', action.name, from])
      return {
        undo: {
          kind: 'branch-create',
          subject: action.name,
          target: beforeBranch,
          steps: [
            ...(action.checkout && beforeBranch ? [['switch', beforeBranch]] : []),
            ['branch', '-D', action.name],
          ],
          head: await after(),
          requiresClean: false,
          stashHash: null,
          redo: action,
        },
        message: '',
      }
    }
    case 'branch-switch':
    case 'commit-switch': {
      const target = action.kind === 'branch-switch' ? action.name : action.hash
      // `--detach` sur un sha : sans lui, git refuse ; avec, il dit clairement qu'on
      // est hors branche, ce que la vue affiche.
      await git(cwd, action.kind === 'branch-switch' ? ['switch', target] : ['switch', '--detach', target])
      return {
        undo: beforeBranch
          ? {
              kind: 'switch',
              subject: target,
              target: beforeBranch,
              steps: [['switch', beforeBranch]],
              head: await after(),
              requiresClean: false,
              stashHash: null,
              redo: action,
            }
          : null,
        message: '',
      }
    }
    case 'branch-merge':
    case 'commit-merge': {
      const target = action.kind === 'branch-merge' ? action.name : action.hash
      const out = await git(cwd, ['merge', '--no-edit', target])
      return {
        undo: before
          ? {
              kind: 'merge',
              subject: target,
              target: before.shortHash,
              steps: [['reset', '--hard', before.hash]],
              head: await after(),
              // L'annulation écrase l'arbre : elle n'est offerte que tant qu'il n'y a
              // rien à écraser.
              requiresClean: true,
              stashHash: null,
              redo: action,
            }
          : null,
        message: out.trim(),
      }
    }
    case 'branch-rebase':
    case 'commit-rebase': {
      const target = action.kind === 'branch-rebase' ? action.name : action.hash
      const out = await git(cwd, ['rebase', target])
      return {
        undo: before
          ? {
              kind: 'rebase',
              subject: beforeBranch ?? before.shortHash,
              target: before.shortHash,
              steps: [['reset', '--hard', before.hash]],
              head: await after(),
              requiresClean: true,
              stashHash: null,
              redo: action,
            }
          : null,
        message: out.trim(),
      }
    }
    case 'branch-rename': {
      await git(cwd, ['branch', '-m', action.name, action.to])
      return {
        undo: {
          kind: 'branch-rename',
          subject: action.to,
          target: action.name,
          steps: [['branch', '-m', action.to, action.name]],
          head: await after(),
          requiresClean: false,
          stashHash: null,
          redo: action,
        },
        message: '',
      }
    }
    case 'branch-delete': {
      const hash = (await git(cwd, ['rev-parse', action.name])).trim()
      await git(cwd, ['branch', action.force ? '-D' : '-d', action.name])
      return {
        undo: {
          kind: 'branch-delete',
          subject: action.name,
          target: hash.slice(0, 7),
          // Une branche n'est qu'un nom sur un sha : le remettre la ressuscite entière.
          steps: [['branch', action.name, hash]],
          head: await after(),
          requiresClean: false,
          stashHash: null,
          redo: action,
        },
        message: '',
      }
    }
    case 'branch-track': {
      const previous = (
        await git(cwd, [
          'rev-parse',
          '--abbrev-ref',
          '--symbolic-full-name',
          `${action.name}@{upstream}`,
        ]).catch(() => '')
      ).trim()
      await git(cwd, ['branch', `--set-upstream-to=${action.upstream}`, action.name])
      return {
        undo: {
          kind: 'track',
          subject: action.name,
          target: previous || null,
          steps: [
            previous
              ? ['branch', `--set-upstream-to=${previous}`, action.name]
              : ['branch', '--unset-upstream', action.name],
          ],
          head: await after(),
          requiresClean: false,
          stashHash: null,
          redo: action,
        },
        message: '',
      }
    }
    case 'commit-branch': {
      await git(cwd, ['branch', action.name, action.hash])
      return {
        undo: {
          kind: 'branch-create',
          subject: action.name,
          target: action.hash.slice(0, 7),
          steps: [['branch', '-D', action.name]],
          head: await after(),
          requiresClean: false,
          stashHash: null,
          redo: action,
        },
        message: '',
      }
    }
    case 'commit-cherry-pick': {
      const out = await git(cwd, ['cherry-pick', action.hash])
      return {
        undo: before
          ? {
              kind: 'cherry-pick',
              subject: action.hash.slice(0, 7),
              target: before.shortHash,
              steps: [['reset', '--hard', before.hash]],
              head: await after(),
              requiresClean: true,
              stashHash: null,
              redo: action,
            }
          : null,
        message: out.trim(),
      }
    }
    case 'commit-revert': {
      const out = await git(cwd, ['revert', '--no-edit', action.hash])
      return {
        undo: before
          ? {
              kind: 'revert',
              subject: action.hash.slice(0, 7),
              target: before.shortHash,
              steps: [['reset', '--hard', before.hash]],
              head: await after(),
              requiresClean: true,
              stashHash: null,
              redo: action,
            }
          : null,
        message: out.trim(),
      }
    }
    case 'commit-reset': {
      await git(cwd, ['reset', `--${action.mode}`, action.hash])
      return {
        undo:
          before && action.mode !== 'hard'
            ? {
                kind: 'reset',
                subject: beforeBranch ?? before.shortHash,
                target: before.shortHash,
                // Le même mode à l'envers : `--soft` n'a pas touché à l'index ni au
                // disque, `--mixed` n'a touché qu'à l'index.
                steps: [['reset', `--${action.mode}`, before.hash]],
                head: await after(),
                requiresClean: false,
                stashHash: null,
                redo: action,
              }
            : null,
        message: '',
      }
    }
    case 'commit-tag': {
      await git(cwd, ['tag', action.name, action.hash])
      return {
        undo: {
          kind: 'tag',
          subject: action.name,
          target: action.hash.slice(0, 7),
          steps: [['tag', '-d', action.name]],
          head: await after(),
          requiresClean: false,
          stashHash: null,
          redo: action,
        },
        message: '',
      }
    }
    case 'stash-push': {
      // `-u` : une remise qui laisse les non-suivis derrière elle ne rend pas l'arbre
      // propre, et c'est pourtant ce qu'on vient chercher avant de lancer un tour.
      await git(cwd, ['stash', 'push', '-u', ...(action.message ? ['-m', action.message] : [])])
      const top = (await readStashDetails(cwd))[0]
      return {
        undo: top
          ? {
              kind: 'stash-push',
              subject: action.message || top.message,
              target: null,
              steps: [['stash', 'pop', STASH_TOKEN]],
              head: await after(),
              requiresClean: false,
              stashHash: top.hash,
              redo: action,
            }
          : null,
        message: '',
      }
    }
    case 'stash-pop':
    case 'stash-apply':
    case 'stash-drop':
    case 'stash-branch': {
      const ref = await stashRef(cwd, action.index, action.hash)
      if (action.kind === 'stash-pop') await git(cwd, ['stash', 'pop', ref])
      else if (action.kind === 'stash-apply') await git(cwd, ['stash', 'apply', ref])
      else if (action.kind === 'stash-drop') await git(cwd, ['stash', 'drop', ref])
      else await git(cwd, ['stash', 'branch', action.name, ref])
      // Aucune de ces quatre ne s'annule honnêtement : dépiler et appliquer versent
      // dans l'arbre, où l'annulation serait un `checkout` qui jetterait aussi ce qui
      // s'y trouvait déjà. *Supprimer* passe donc par le garde-fou, et pas par une
      // promesse d'annulation.
      return { undo: null, message: '' }
    }

    // ─── Lot 3 ────────────────────────────────────────────────────────────────
    case 'stage-lines':
    case 'unstage-lines': {
      const reverse = action.kind === 'unstage-lines'
      // Le diff est **relu ici**, et c'est ce qui rend le geste sûr : celui que le
      // client affichait a pu vieillir, et `partialPatch` compare les en-têtes de
      // blocs avant de retenir quoi que ce soit.
      const patch = reverse
        ? await git(cwd, ['diff', '--cached', ...PATCH_FLAGS, '--', action.path])
        : await readUnstagedPatch(cwd, action.path)
      const partial = partialPatch(patch, action.selections, reverse)
      if (!partial) return { undo: null, message: '' }
      await applyToIndex(cwd, partial, reverse)
      return { undo: null, message: '' }
    }

    case 'rebase-start': {
      const hashes = action.plan.map((step) => step.hash)
      const { todo } = await writeTodo(cwd, action.plan, await readSubjects(cwd, hashes))
      // `--no-autosquash` : un message qui commence par `fixup!` réordonnerait le todo
      // dans le dos de ce que l'écran a montré, et la planche T9 promet l'inverse.
      const out = await interrupted(cwd, ['rebase', '-i', '--no-autosquash', action.onto], rebaseEnv(todo))
      // Un rebase qui s'est arrêté en chemin n'a pas de point d'arrivée, donc rien à
      // annuler : c'est *Abandonner*, avec son garde-fou, qui le défait. Promettre un
      // « Annuler » ici serait promettre un `reset --dur` au beau milieu d'un rebase.
      const stopped = (await readRebaseState(cwd, [])) !== null
      return {
        undo: !stopped && before && beforeBranch
          ? {
              kind: 'rebase-interactive',
              subject: beforeBranch,
              target: before.shortHash,
              steps: [['reset', '--hard', before.hash]],
              head: await after(),
              requiresClean: true,
              stashHash: null,
              redo: action,
            }
          : null,
        message: out,
      }
    }
    case 'rebase-continue':
    case 'rebase-skip': {
      const verb = action.kind === 'rebase-continue' ? '--continue' : '--skip'
      const out = await interrupted(cwd, ['rebase', verb], rebaseEnv(null))
      return { undo: null, message: out }
    }
    case 'rebase-abort': {
      await git(cwd, ['rebase', '--abort'])
      await forgetMessages(cwd)
      // Un abandon remet le dépôt où le rebase l'a trouvé : il n'y a rien à annuler,
      // et c'est le garde-fou qui a nommé ce qu'il emportait.
      return { undo: null, message: '' }
    }
    case 'conflict-take': {
      const side = action.side === 'ours' ? '--ours' : '--theirs'
      const paths = action.path ? [action.path] : (await readWriteState(cwd))?.conflicted ?? []
      if (paths.length === 0) return { undo: null, message: '' }
      await git(cwd, ['checkout', side, '--', ...paths])
      // `add` marque résolu : sans lui le fichier reste en conflit dans l'index, et
      // l'écran dirait qu'il reste à faire ce qu'on vient de faire.
      await git(cwd, ['add', '--', ...paths])
      return { undo: null, message: '' }
    }
    case 'conflict-resolve': {
      refuseMarkers(action.content)
      await writeFile(join(cwd, action.path), action.content)
      await git(cwd, ['add', '--', action.path])
      return { undo: null, message: '' }
    }
  }
}

/**
 * Le patch des non-indexés d'un fichier, **sans toucher à l'index réel**.
 *
 * Même tour que `readUnstaged` : un fichier non suivi n'a pas de diff tant que git ne
 * le connaît pas, et le lui faire connaître dans le vrai index indexerait ce que
 * personne n'a coché — ce qui est précisément ce que l'indexation par ligne existe
 * pour éviter.
 */
async function readUnstagedPatch(cwd: string, path: string): Promise<string> {
  const gitDir = (await git(cwd, ['rev-parse', '--absolute-git-dir'])).trim()
  const scratch = join(tmpdir(), `solera-index-${randomUUID()}`)
  try {
    await copyFile(join(gitDir, 'index'), scratch).catch(() => {})
    const env = { GIT_INDEX_FILE: scratch }
    await git(cwd, ['add', '--intent-to-add', '--', path], env).catch(() => {})
    return await git(cwd, ['diff', ...PATCH_FLAGS, '--', path], env)
  } finally {
    await rm(scratch, { force: true }).catch(() => {})
  }
}

/**
 * Applique un patch à l'index seul.
 *
 * `--cached` et pas `--index` : le répertoire de travail ne doit pas bouger. Indexer
 * deux lignes sur cinq laisse les trois autres exactement où elles étaient, et c'est
 * tout l'intérêt du geste.
 *
 * Le patch passe par l'entrée standard et non par un fichier : il n'a pas à exister
 * sur le disque, et un fichier temporaire serait un fichier de plus à nettoyer dans un
 * module où une sortie ratée laisse des traces.
 */
async function applyToIndex(cwd: string, patch: string, reverse: boolean): Promise<void> {
  const args = ['apply', '--cached', ...(reverse ? ['--reverse'] : []), '-']
  // Depuis la racine : les chemins du patch en partent, et lancé d'un sous-dossier,
  // `git apply` ignorerait sans rien dire tout ce qui n'y est pas relatif.
  const top = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim()
  await new Promise<void>((resolve, reject) => {
    const child = execFile('git', args, { cwd: top, timeout: READ_TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (err) reject(new GitError(gitMessage({ stderr, message: err.message })))
      else resolve()
    })
    child.stdin?.end(patch)
  })
}

/**
 * Une commande qui a le droit de s'arrêter en chemin.
 *
 * Un rebase qui bute sur un conflit **échoue** au sens d'`execFile` : code de sortie
 * non nul, message sur la sortie d'erreur. Ce n'est pourtant pas une panne mais l'état
 * normal d'un rebase interrompu, et le remonter en erreur enverrait l'écran afficher
 * « ça n'a pas marché » devant un dépôt qui attend exactement qu'on le finisse. On
 * distingue donc les deux en relisant l'état du dépôt après coup.
 */
async function interrupted(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const out = (await git(cwd, args, env, NETWORK_TIMEOUT_MS)).trim()
    await finishedRebase(cwd)
    return out
  } catch (err) {
    const state = await readRebaseState(cwd, []).catch(() => null)
    if (!state) {
      // Vraie panne : le rebase n'a pas commencé, ou s'est défait tout seul. On
      // nettoie les messages préparés plutôt que de les laisser traîner dans le dépôt.
      await forgetMessages(cwd)
      throw err
    }
    return err instanceof Error ? err.message : String(err)
  }
}

/** Le rebase est allé au bout : ses messages préparés n'ont plus de raison d'être. */
async function finishedRebase(cwd: string): Promise<void> {
  if ((await readRebaseState(cwd, []).catch(() => null)) === null) await forgetMessages(cwd)
}

/**
 * `stash@{n}`, vérifié par son sha.
 *
 * La pile des remises est **partagée par tous les worktrees** d'un dépôt : une autre
 * session qui dépile fait glisser les index d'un cran, et `stash@{1}` ne désigne alors
 * plus ce qu'on regardait. Refuser vaut mieux que supprimer la mauvaise.
 */
async function stashRef(cwd: string, index: number, hash: string | null): Promise<string> {
  const ref = `stash@{${index}}`
  // Sans sha, on prend ce que l'index désigne : c'est le *Dépiler* de la barre
  // d'outils, qui ne désigne aucune remise en particulier.
  if (!hash) return ref
  const actual = (await git(cwd, ['rev-parse', ref]).catch(() => '')).trim()
  if (actual !== hash) {
    const moved = (await readStashDetails(cwd)).find((entry) => entry.hash === hash)
    if (!moved) throw new GitError('Cette remise n’est plus dans la pile.')
    return moved.ref
  }
  return ref
}

/**
 * Le journal d'annulation, un geste par répertoire.
 *
 * En mémoire et non en base : une annulation n'a de sens que tant que le dépôt est
 * resté où le geste l'a laissé, et un redémarrage du serveur est précisément le moment
 * où plus rien ne le garantit. Un seul cran, comme GitKraken : au-delà, « annuler »
 * devient une machine à remonter le temps qui ne peut pas tenir sa promesse.
 */
export class UndoJournal {
  private readonly undos = new Map<string, UndoRecord>()
  private readonly redos = new Map<string, UndoRecord>()

  record(cwd: string, record: UndoRecord | null): void {
    if (record) this.undos.set(cwd, record)
    else this.undos.delete(cwd)
    this.redos.delete(cwd)
  }

  /** Ce qui est annulable *maintenant* : revérifié contre le dépôt, pas supposé. */
  async undoable(cwd: string): Promise<GitUndoDto | null> {
    return describe(cwd, this.undos.get(cwd))
  }

  async redoable(cwd: string): Promise<GitUndoDto | null> {
    return describe(cwd, this.redos.get(cwd))
  }

  async undo(cwd: string): Promise<void> {
    const record = this.undos.get(cwd)
    if (!record || !(await stillTrue(cwd, record))) {
      throw new GitError('Ce geste ne peut plus être annulé : le dépôt a changé depuis.')
    }
    await apply(cwd, record)
    this.undos.delete(cwd)
    // Le geste d'origine devient le *Refaire*, valable tant qu'on est revenu là.
    this.redos.set(cwd, {
      ...record,
      head: (await readHead(cwd))?.hash ?? null,
      steps: [],
    })
  }

  /** *Refaire* rejoue le geste d'origine, qui réarme son propre *Annuler*. */
  async redo(cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    const record = this.redos.get(cwd)
    if (!record || !(await stillTrue(cwd, record))) {
      throw new GitError('Ce geste ne peut plus être refait : le dépôt a changé depuis.')
    }
    this.redos.delete(cwd)
    const outcome = await perform(cwd, record.redo, env)
    this.record(cwd, outcome.undo)
  }

  forget(cwd: string): void {
    this.undos.delete(cwd)
    this.redos.delete(cwd)
  }
}

async function describe(cwd: string, record: UndoRecord | undefined): Promise<GitUndoDto | null> {
  if (!record || !(await stillTrue(cwd, record))) return null
  return {
    kind: record.kind,
    subject: record.subject,
    target: record.target,
    pushed: await isPushed(cwd, record.head),
  }
}

/** Le geste tient-il toujours ? HEAD là où on l'a laissé, et l'arbre propre si besoin. */
async function stillTrue(cwd: string, record: UndoRecord): Promise<boolean> {
  const head = (await readHead(cwd))?.hash ?? null
  if (record.head !== head) return false
  if (!record.requiresClean) return true
  const porcelain = await git(cwd, ['status', '--porcelain']).catch(() => 'x')
  return porcelain.trim().length === 0
}

/**
 * Ce qu'on annulerait est-il déjà sur un distant ?
 *
 * La phrase du bandeau n'est pas la même : défaire un commit qu'on est seul à avoir
 * est sans conséquence, défaire un commit déjà poussé demande ensuite un `push
 * --force` que personne n'avait prévu.
 */
async function isPushed(cwd: string, head: string | null): Promise<boolean> {
  if (!head) return false
  const remotes = await git(cwd, ['branch', '-r', '--contains', head]).catch(() => '')
  return remotes.trim().length > 0
}

async function apply(cwd: string, record: UndoRecord): Promise<void> {
  for (const step of record.steps) {
    const args = await Promise.all(
      step.map(async (arg) =>
        arg === STASH_TOKEN && record.stashHash
          ? (await readStashDetails(cwd)).find((entry) => entry.hash === record.stashHash)?.ref ??
            arg
          : arg,
      ),
    )
    await git(cwd, args)
  }
}
