import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  GraphNodeDto,
  GraphNodeKind,
  GraphQuery,
  GraphRefDto,
  RefLineDto,
  RefSectionDto,
} from '@solera/protocol'
import { readGitStatus, type GitStatus } from './git.js'

/**
 * Le graphe du dépôt, ses références et ses remises : ce que lit la vue Git du panneau.
 *
 * À part de `git.ts`, qui porte les lectures d'un répertoire de travail — statut, diff,
 * derniers commits — et que toute l'application utilise. Ici c'est l'histoire du dépôt
 * *entier* qu'on lit, couloirs compris, pour une seule vue : mélanger les deux aurait
 * fait grossir un module que la page Projets charge pour afficher « 4 non commités ».
 *
 * Deux choses à garder en tête en y touchant :
 *
 * - **La fenêtre est bornée.** Le graphe se paie à chaque ouverture du panneau, et un
 *   dépôt a des milliers de commits. Rien ici ne lit l'histoire entière : `--max-count`
 *   partout, un commit de plus que demandé pour savoir s'il en reste.
 * - **Les couloirs se calculent ici.** Le client n'a pas les parents des commits qu'il
 *   n'a pas reçus, donc il ne peut pas refaire ce calcul ; et le refaire à chaque rendu
 *   coûterait plus cher que de le transporter.
 */

const run = promisify(execFile)

/**
 * Plus long que celui de `git.ts` : `git log --all` sur un dépôt de plusieurs milliers
 * de commits avec un filtre de chemin dépasse la seconde, et le filtre de chemin est
 * précisément ce que la destination *Recherche* fait le plus.
 */
const GIT_TIMEOUT_MS = 15_000

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout
}

/**
 * Séparateurs : octet nul entre les champs, RS entre les enregistrements.
 *
 * Écrits en échappement git (`%x00`) dans les formats et non en octet littéral :
 * `execFile` refuse un argument qui contient un octet nul, et c'est git qui les pose.
 * Les deux syntaxes diffèrent d'une commande à l'autre — `%x00` pour `log`, `%00` pour
 * `for-each-ref` — d'où deux constantes.
 */
const FIELD = '\x00'
const RECORD = '\x1e'
const TRAILER = '\x02'
const LOG_FIELD = '%x00'
const LOG_RECORD = '%x1e'
const REF_FIELD = '%00'

/**
 * Un commit tel que `git log` le rend, avant mise en couloirs.
 *
 * `%(trailers:key=Co-authored-by)` est le seul signe fiable qu'un agent a écrit le
 * commit : le CLI commite sous l'identité git de l'utilisateur, donc `%an` dit « Tim »
 * dans les deux cas.
 */
export interface LogEntry {
  hash: string
  shortHash: string
  parents: string[]
  ts: number
  author: string
  email: string
  /** Contenu de `%D`, la décoration des refs, à analyser avec `parseDecoration`. */
  decoration: string
  coAuthors: string[]
  subject: string
}

const LOG_FORMAT = [
  '%H',
  '%h',
  '%P',
  '%ct',
  '%an',
  '%ae',
  '%D',
  '%(trailers:key=Co-authored-by,valueonly,separator=%x02,unfold)',
  '%s',
].join(LOG_FIELD)

export function parseLog(raw: string): LogEntry[] {
  return raw
    .split(RECORD)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, shortHash, parents, ts, author, email, decoration, trailers, subject] =
        record.split(FIELD)
      return {
        hash: hash ?? '',
        shortHash: shortHash ?? '',
        parents: (parents ?? '').split(' ').filter(Boolean),
        ts: Number(ts) * 1000 || 0,
        author: author ?? '',
        email: email ?? '',
        decoration: decoration ?? '',
        coAuthors: (trailers ?? '')
          .split(TRAILER)
          .map((value) => value.trim())
          .filter(Boolean),
        subject: subject ?? '',
      }
    })
    .filter((entry) => entry.hash.length > 0)
}

/**
 * `HEAD -> main, origin/main, tag: v0.7.0` tel que `%D` le rend.
 *
 * `HEAD ->` n'est pas une ref de plus mais une marque sur celle qui suit : la garder
 * comme étiquette poserait deux pastilles pour une seule branche.
 */
export function parseDecoration(decoration: string, worktrees: Set<string>): GraphRefDto[] {
  const refs: GraphRefDto[] = []
  for (const part of decoration.split(',').map((value) => value.trim()).filter(Boolean)) {
    // `refs/stash` décore la remise, dont la forme du nœud dit déjà ce qu'elle est :
    // l'écrire en étiquette ajouterait un mot technique devant chaque remise.
    if (part === 'refs/stash') continue
    // `origin/HEAD` double la branche que le distant sert : une pastille de plus qui
    // ne dit rien de neuf.
    if (part.endsWith('/HEAD')) continue
    if (part === 'HEAD') {
      refs.push({ name: 'HEAD', kind: 'head' })
      continue
    }
    if (part.startsWith('HEAD -> ')) {
      const name = part.slice('HEAD -> '.length)
      refs.push({ name, kind: worktrees.has(name) ? 'worktree' : 'local' })
      continue
    }
    if (part.startsWith('tag: ')) {
      refs.push({ name: part.slice('tag: '.length), kind: 'tag' })
      continue
    }
    if (worktrees.has(part)) {
      refs.push({ name: part, kind: 'worktree' })
      continue
    }
    // Une ref distante porte toujours son remote et un `/` devant ; une locale, non.
    refs.push({ name: part, kind: part.includes('/') ? 'remote' : 'local' })
  }
  return refs
}

/** Le nom de l'agent, quand le message le nomme : « Claude Opus 5 (1M) <noreply@…> ». */
export function agentOf(coAuthors: string[]): string | null {
  for (const value of coAuthors) {
    const name = value.replace(/<[^>]*>\s*$/, '').trim()
    if (name.length > 0) return name
  }
  return null
}

/**
 * Les couloirs du graphe, en une passe du plus récent au plus ancien.
 *
 * Chaque couloir retient le hash qu'il attend plus bas. Un commit prend le couloir qui
 * l'attendait — le premier, s'ils sont plusieurs, les autres retombant dessus — ou un
 * couloir neuf s'il n'en attendait aucun : c'est alors une tête de branche, et son
 * trait ne part que du nœud vers le bas.
 *
 * Les parents supplémentaires d'une fusion ouvrent un couloir chacun, qui descend du
 * nœud. Les deux cas se dessinent par la même courbe, d'où deux listes distinctes et
 * non une seule : `collapses` arrive par le haut, `joins` repart par le bas.
 *
 * Chaque occupation d'un couloir, de son ouverture à sa libération, est une *course*,
 * numérotée : c'est elle que le survol surligne d'un bout à l'autre, et elle qui porte
 * le nom de la branche. Git ne retient pas sur quelle branche un commit a été écrit ;
 * le nom vient de la première ref croisée en descendant la course, ou, pour celle
 * qu'ouvre une fusion, du message de la fusion. Une branche fusionnée puis supprimée
 * sans message parlant reste sans nom plutôt que d'en recevoir un faux.
 */
export function assignLanes(
  entries: LogEntry[],
  kindOf: (entry: LogEntry) => GraphNodeKind,
): { rows: LaneRow[]; lanes: number; runs: (string | null)[] } {
  const expected: (string | null)[] = []
  /** La course qui occupe chaque couloir, en regard de `expected`. */
  const runOf: number[] = []
  const runs: (string | null)[] = []
  const rows: LaneRow[] = []
  let width = 0

  const open = (lane: number, name: string | null): number => {
    runs.push(name)
    runOf[lane] = runs.length - 1
    return runs.length - 1
  }

  const free = (): number => {
    const index = expected.indexOf(null)
    if (index >= 0) return index
    expected.push(null)
    return expected.length - 1
  }

  for (const entry of entries) {
    const waiting = expected
      .map((hash, index) => (hash === entry.hash ? index : -1))
      .filter((index) => index >= 0)

    const tip = waiting.length === 0
    const lane = tip ? free() : (waiting[0] as number)
    const collapses = waiting.slice(1)
    const run = tip ? open(lane, null) : (runOf[lane] as number)
    if (runs[run] === null) runs[run] = branchOf(entry.decoration)

    const through = expected
      .map((hash, index) => (hash !== null ? index : -1))
      .filter((index) => index >= 0 && index !== lane && !collapses.includes(index))
    const throughRuns = through.map((index) => runOf[index] as number)
    const collapseRuns = collapses.map((index) => runOf[index] as number)

    for (const index of collapses) expected[index] = null

    // Une remise a trois parents — le commit de base, l'index, et les fichiers non
    // suivis — dont les deux derniers n'existent que pour elle. Les suivre peuplerait
    // le graphe de commits « index on main » que personne n'a écrits.
    const parents = kindOf(entry) === 'stash' ? entry.parents.slice(0, 1) : entry.parents

    expected[lane] = parents[0] ?? null
    const joins: number[] = []
    const joinRuns: number[] = []
    for (const [index, parent] of parents.slice(1).entries()) {
      const already = expected.indexOf(parent)
      if (already >= 0 && already !== lane) {
        joins.push(already)
        joinRuns.push(runOf[already] as number)
        continue
      }
      const opened = free()
      expected[opened] = parent
      joins.push(opened)
      // Le message ne nomme que la branche fusionnée, qui est le second parent.
      joinRuns.push(open(opened, index === 0 ? mergedBranch(entry.subject) : null))
    }

    rows.push({
      entry,
      lane,
      through,
      joins,
      collapses,
      tip,
      root: parents.length === 0,
      run,
      throughRuns,
      joinRuns,
      collapseRuns,
    })
    width = Math.max(width, expected.length)
  }

  return { rows, lanes: Math.max(width, 1), runs }
}

/**
 * La branche qu'une décoration nomme, pour baptiser une course.
 *
 * `HEAD ->` d'abord : c'est la branche extraite. Sinon la plus courte des refs, ce qui
 * préfère `feat/x` à `origin/feat/x` sans avoir à connaître les remotes — `%D` ne dit
 * pas lequel des deux est local. Les étiquettes ne nomment pas une branche.
 */
export function branchOf(decoration: string): string | null {
  const parts = decoration.split(',').map((value) => value.trim()).filter(Boolean)
  const head = parts.find((part) => part.startsWith('HEAD -> '))
  if (head) return head.slice('HEAD -> '.length)
  const names = parts.filter(
    (part) => part !== 'HEAD' && part !== 'refs/stash' && !part.startsWith('tag: ') && !part.endsWith('/HEAD'),
  )
  if (names.length === 0) return null
  return names.reduce((best, name) => (name.length < best.length ? name : best))
}

/** La branche qu'une fusion nomme dans son message, quand git ou GitHub l'a écrit. */
export function mergedBranch(subject: string): string | null {
  const match =
    /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(subject)
    ?? /^Merge pull request #\d+ from [^/\s]+\/(\S+)/.exec(subject)
  return match?.[1] ?? null
}

export interface LaneRow {
  entry: LogEntry
  lane: number
  through: number[]
  joins: number[]
  collapses: number[]
  tip: boolean
  root: boolean
  /** La course du nœud, et celle de chaque trait, dans l'ordre des listes ci-dessus. */
  run: number
  throughRuns: number[]
  joinRuns: number[]
  collapseRuns: number[]
}

/**
 * À quelle tête de ref chaque commit appartient *en propre*.
 *
 * Un commit atteint depuis une seule tête n'existe que par elle : c'est le travail de
 * cette branche, donc du fil qui l'occupe. Atteint depuis plusieurs, il est de
 * l'histoire commune, et l'attribuer à l'une d'elles serait un mensonge — on rend
 * alors `null`, et le rattachement se cherche autrement.
 *
 * Une seule passe suffit : `git log` ne montre jamais un parent avant son enfant.
 */
export function uniqueOwners(
  rows: { hash: string; parents: string[] }[],
  tips: { hash: string; key: string }[],
): Map<string, string | null> {
  // Une seule clé par commit, plus un drapeau « plusieurs » : retenir l'ensemble des
  // têtes qui atteignent chaque commit coûterait, sur un dépôt à quarante branches,
  // quarante entrées par commit pour une information qu'on jette aussitôt.
  const owner = new Map<string, string>()
  const shared = new Set<string>()

  const markShared = (hash: string): void => {
    owner.delete(hash)
    shared.add(hash)
  }

  const add = (hash: string, key: string): void => {
    if (shared.has(hash)) return
    const current = owner.get(hash)
    if (current === undefined) owner.set(hash, key)
    else if (current !== key) markShared(hash)
  }

  for (const tip of tips) add(tip.hash, tip.key)

  for (const row of rows) {
    const key = owner.get(row.hash)
    for (const parent of row.parents) {
      if (key === undefined) {
        // Commun, ou hors de toute tête connue : ses parents le sont aussi.
        if (shared.has(row.hash)) markShared(parent)
        continue
      }
      add(parent, key)
    }
  }

  return new Map(rows.map((row) => [row.hash, owner.get(row.hash) ?? null]))
}

/** Une remise, telle que `git stash list` la rend. */
export interface Stash {
  ref: string
  hash: string
  subject: string
}

export async function readStashes(cwd: string): Promise<Stash[]> {
  try {
    const raw = await git(cwd, ['stash', 'list', `--format=%H${LOG_FIELD}%gd${LOG_FIELD}%gs`])
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [hash, ref, subject] = line.split(FIELD)
        return { hash: hash ?? '', ref: ref ?? '', subject: subject ?? '' }
      })
      .filter((stash) => stash.hash.length > 0)
  } catch {
    return []
  }
}

/**
 * Les arguments de `git log` pour une fenêtre de graphe.
 *
 * Seuls les filtres que git connaît passent ici. Le fil et « à la main / par un agent »
 * n'existent que chez nous et se posent après, sur la fenêtre chargée : git ne sait
 * pas les lire, et les simuler en `--grep` donnerait des faux sur les deux bords.
 */
export function logArgs(query: GraphQuery, stashes: Stash[]): string[] {
  const args = [
    'log',
    `--max-count=${query.limit + 1}`,
    `--skip=${query.skip}`,
    '--date-order',
    '--parents',
    `--format=${LOG_FORMAT}${LOG_RECORD}`,
  ]

  // `--all` embarque `refs/stash`, donc les remises sont dans le graphe sans qu'on ait
  // à les nommer ; les y ajouter quand même garde le graphe juste si une version de git
  // change d'avis. Une branche demandée, elle, se lit seule.
  if (query.branch) args.push(query.branch)
  else {
    args.push('--all')
    for (const stash of stashes) args.push(stash.hash)
  }

  if (query.q) args.push('--fixed-strings', '--regexp-ignore-case', `--grep=${query.q}`)
  if (query.since) args.push(`--since=${query.since}`)
  if (query.until) args.push(`--until=${query.until}`)
  if (query.file) args.push('--', query.file)
  return args
}

/**
 * Les parents d'une remise qui n'appartiennent qu'à elle : l'index, et les non-suivis.
 *
 * Retirés de la fenêtre après lecture, et non par un `^<sha>` passé à `git log` : une
 * exclusion emporte les ancêtres, et le parent du commit d'index est le commit sur
 * lequel la remise a été faite — l'histoire entière disparaissait avec lui.
 */
export async function stashInternals(cwd: string, stashes: Stash[]): Promise<string[]> {
  const internals: string[] = []
  for (const stash of stashes) {
    try {
      const raw = await git(cwd, ['rev-parse', `${stash.hash}^@`])
      internals.push(...raw.split('\n').map((line) => line.trim()).filter(Boolean).slice(1))
    } catch {
      // Une remise illisible n'empêche pas de dessiner le reste du graphe.
    }
  }
  return internals
}

/**
 * Les branches sorties dans un worktree *annexe*, par nom court : elles ont leur section.
 *
 * Le dépôt principal est lui aussi un « worktree » pour git, et il arrive en tête de
 * la liste : le compter ferait quitter *Local* à `main`, qui n'est pas un chantier
 * ouvert mais la branche du dépôt.
 */
export async function worktreeBranches(cwd: string): Promise<Map<string, string>> {
  const byBranch = new Map<string, string>()
  try {
    const raw = await git(cwd, ['worktree', 'list', '--porcelain'])
    let path: string | null = null
    let seen = 0
    for (const line of raw.split('\n')) {
      if (line.startsWith('worktree ')) {
        seen += 1
        // Le premier bloc est le dépôt principal : on le laisse de côté.
        path = seen === 1 ? null : line.slice('worktree '.length)
      } else if (line.startsWith('branch ') && path) {
        byBranch.set(line.slice('branch refs/heads/'.length), path)
      }
    }
  } catch {
    // Pas de worktree, ou un git trop vieux : la section reste vide, pas absente.
  }
  return byBranch
}

export interface GraphWindow {
  rows: LaneRow[]
  /** Le nom de chaque course, par son numéro. */
  runs: (string | null)[]
  status: GitStatus
  lanes: number
  hasMore: boolean
  branch: string | null
  head: string | null
  stashes: Map<string, string>
  worktrees: Map<string, string>
}

/**
 * La fenêtre de graphe : les commits, leurs couloirs, les remises et le worktree de
 * chaque branche. Retourne null hors dépôt git, comme les autres lectures.
 */
export async function readGraphWindow(cwd: string, query: GraphQuery): Promise<GraphWindow | null> {
  const status = await readGitStatus(cwd)
  if (!status) return null

  const [stashes, worktrees, head] = await Promise.all([
    readStashes(cwd),
    worktreeBranches(cwd),
    git(cwd, ['rev-parse', 'HEAD']).then((raw) => raw.trim()).catch(() => null),
  ])
  const internals = stashes.length > 0 ? await stashInternals(cwd, stashes) : []

  let entries: LogEntry[]
  try {
    const hidden = new Set(internals)
    entries = parseLog(await git(cwd, logArgs(query, stashes))).filter(
      (entry) => !hidden.has(entry.hash),
    )
  } catch {
    // Un dépôt sans aucun commit : `git log` y échoue faute de HEAD, ce qui est un
    // état normal et non une panne.
    entries = []
  }

  const hasMore = entries.length > query.limit
  const window = entries.slice(0, query.limit)
  const byHash = new Map(stashes.map((stash) => [stash.hash, stash.ref]))

  const { rows, lanes, runs } = assignLanes(window, (entry) =>
    byHash.has(entry.hash) ? 'stash' : entry.parents.length > 1 ? 'merge' : 'commit',
  )

  return {
    rows,
    runs,
    status,
    lanes,
    hasMore,
    branch: status.branch,
    head,
    stashes: byHash,
    worktrees,
  }
}

/** Le nœud « en cours », posé en tête quand le répertoire de travail n'est pas propre. */
export function workingNode(
  status: { changedFiles: number; added: number; removed: number },
  first: GraphNodeDto | undefined,
): GraphNodeDto {
  const lane = first?.lane ?? 0
  const through = first ? [...new Set([...first.through, ...(first.tip ? [] : [first.lane])])] : []
  const runOf = (index: number): number =>
    index === first?.lane ? first.run : (first?.throughRuns[first.through.indexOf(index)] ?? 0)
  const lines = through.filter((index) => index !== lane)
  return {
    kind: 'working',
    hash: '',
    shortHash: '',
    subject: '',
    author: '',
    agent: null,
    ts: Date.now(),
    parents: [],
    refs: [],
    thread: null,
    lane,
    through: lines,
    joins: [],
    collapses: [],
    tip: true,
    root: false,
    // Le travail en cours se pose sur la branche extraite : il en prolonge la course.
    run: first?.run ?? 0,
    throughRuns: lines.map(runOf),
    joinRuns: [],
    collapseRuns: [],
    working: {
      files: status.changedFiles,
      added: status.added,
      removed: status.removed,
    },
  }
}

/* ------------------------------------------------------------------ branches ---- */

interface RefRow {
  fullName: string
  name: string
  hash: string
  upstream: string
  track: string
  head: boolean
  subject: string
  ts: number
}

/** `[ahead 1, behind 2]`, `[gone]`, ou rien du tout quand la branche ne suit rien. */
export function parseTrack(track: string): { ahead: number | null; behind: number | null } {
  if (!track || track === '[gone]') return { ahead: null, behind: null }
  const ahead = /ahead (\d+)/.exec(track)
  const behind = /behind (\d+)/.exec(track)
  if (!ahead && !behind) return { ahead: 0, behind: 0 }
  return { ahead: Number(ahead?.[1] ?? 0), behind: Number(behind?.[1] ?? 0) }
}

async function readRefRows(cwd: string): Promise<RefRow[]> {
  const format = [
    '%(refname)',
    '%(refname:short)',
    '%(objectname)',
    '%(upstream:short)',
    '%(upstream:track)',
    '%(HEAD)',
    '%(contents:subject)',
    '%(committerdate:unix)',
  ].join(REF_FIELD)

  const raw = await git(cwd, [
    'for-each-ref',
    `--format=${format}`,
    '--sort=-committerdate',
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ])

  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [fullName, name, hash, upstream, track, head, subject, ts] = line.split(FIELD)
      return {
        fullName: fullName ?? '',
        name: name ?? '',
        hash: hash ?? '',
        upstream: upstream ?? '',
        track: track ?? '',
        head: head === '*',
        subject: subject ?? '',
        ts: Number(ts) * 1000 || 0,
      }
    })
    .filter((row) => row.fullName.length > 0)
}

/** Les sous-modules déclarés, lus dans `.gitmodules` : aucun appel réseau. */
async function readSubmodules(cwd: string): Promise<{ name: string; hash: string }[]> {
  try {
    const raw = await git(cwd, ['config', '--file', '.gitmodules', '--get-regexp', 'path'])
    return raw
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => ({ name: line.slice(line.indexOf(' ') + 1).trim(), hash: '' }))
  } catch {
    // Pas de `.gitmodules` : `git config` sort en 1, et la section dira qu'il n'y en a pas.
    return []
  }
}

/**
 * Les sections de la destination *Branches*.
 *
 * Une branche sortie dans un worktree quitte *Local* pour *Worktrees* : ce n'est plus
 * une branche parmi d'autres mais un chantier en cours, avec quelqu'un dedans. Les
 * sections vides restent, et disent qu'elles sont vides.
 */
export async function readRefSections(
  cwd: string,
  threadOf: (line: { worktreePath: string | null; name: string }) => RefLineDto['thread'],
): Promise<RefSectionDto[] | null> {
  const status = await readGitStatus(cwd)
  if (!status) return null

  const [rows, worktrees, submodules] = await Promise.all([
    readRefRows(cwd),
    worktreeBranches(cwd),
    readSubmodules(cwd),
  ])

  const line = (row: RefRow): RefLineDto => {
    const worktreePath = worktrees.get(row.name) ?? null
    const { ahead, behind } = parseTrack(row.track)
    return {
      name: row.name,
      fullName: row.fullName,
      hash: row.hash,
      current: row.head,
      upstream: row.upstream || null,
      ahead,
      behind,
      worktreePath,
      thread: threadOf({ worktreePath, name: row.name }),
      subject: row.subject,
      ts: row.ts,
    }
  }

  const heads = rows.filter((row) => row.fullName.startsWith('refs/heads/'))
  const sections: RefSectionDto[] = [
    {
      kind: 'local',
      remote: null,
      lines: heads.filter((row) => !worktrees.has(row.name)).map(line),
    },
    {
      kind: 'worktrees',
      remote: null,
      lines: heads.filter((row) => worktrees.has(row.name)).map(line),
    },
  ]

  const remotes = new Map<string, RefRow[]>()
  for (const row of rows) {
    if (!row.fullName.startsWith('refs/remotes/')) continue
    // `refs/remotes/origin/HEAD` est le symref qui dit quelle branche le distant sert :
    // ce n'est pas une branche de plus, et son nom court est « origin » tout court.
    if (row.fullName.endsWith('/HEAD')) continue
    const remote = row.fullName.split('/')[2] as string
    remotes.set(remote, [...(remotes.get(remote) ?? []), row])
  }
  for (const [remote, list] of [...remotes].sort(([a], [b]) => a.localeCompare(b))) {
    sections.push({ kind: 'remote', remote, lines: list.map(line) })
  }
  // Un dépôt sans remote garde sa section, vide : sans elle, rien ne dirait que le
  // dépôt n'est poussé nulle part, et la section apparaîtrait un jour sans prévenir.
  if (remotes.size === 0) sections.push({ kind: 'remote', remote: null, lines: [] })

  sections.push({
    kind: 'tags',
    remote: null,
    lines: rows.filter((row) => row.fullName.startsWith('refs/tags/')).map(line),
  })
  sections.push({
    kind: 'submodules',
    remote: null,
    lines: submodules.map((entry) => ({
      name: entry.name,
      fullName: entry.name,
      hash: '',
      current: false,
      upstream: null,
      ahead: null,
      behind: null,
      worktreePath: null,
      thread: null,
      subject: '',
      ts: 0,
    })),
  })

  return sections
}

/* ------------------------------------------------------------- un commit seul ---- */

export interface CommitFacts {
  entry: LogEntry
  body: string
  containedIn: string[]
}

/** Ce qu'on affiche d'un commit sélectionné, hors diff : lu en deux appels, pas dix. */
export async function readCommitFacts(cwd: string, hash: string): Promise<CommitFacts | null> {
  const [log, branches] = await Promise.all([
    git(cwd, ['log', '-1', `--format=${LOG_FORMAT}${LOG_RECORD}%b`, hash]),
    git(cwd, ['branch', '--all', '--contains', hash, '--format=%(refname)']).catch(() => ''),
  ])

  const [head, body] = log.split(RECORD)
  const entry = parseLog(`${head ?? ''}${RECORD}`)[0]
  if (!entry) return null

  return {
    entry,
    // Le bloc de remorques est retiré du corps : `Co-Authored-By` est déjà rendu comme
    // l'agent qui a écrit le commit, et l'afficher deux fois dirait deux choses.
    body: (body ?? '')
      .split('\n')
      .filter((line) => !line.toLowerCase().startsWith('co-authored-by:'))
      .join('\n')
      .trim(),
    // Noms complets : `origin/main` et une branche locale `origin/main` ne se
    // distinguent pas autrement, et la règle de rattachement ne regarde que les locales.
    containedIn: branches
      .split('\n')
      .map((value) => value.trim())
      .filter((value) => value.startsWith('refs/')),
  }
}

/* --------------------------------------------- l'histoire d'un fichier (T12) ---- */

/**
 * Des commits lus avec le même format que le graphe, mais choisis autrement.
 *
 * Exporté pour l'historique d'un fichier et pour le blâme, qui ont besoin des mêmes
 * champs — l'agent du `Co-Authored-By` en particulier — sans vouloir ni couloirs ni
 * remises. Le format vit ici et nulle part ailleurs : deux définitions auraient fini
 * par diverger d'un champ, et c'est l'agent qui aurait manqué.
 */
export async function readEntries(cwd: string, args: string[]): Promise<LogEntry[]> {
  const raw = await git(cwd, ['log', `--format=${LOG_FORMAT}${LOG_RECORD}`, ...args]).catch(
    () => '',
  )
  return parseLog(raw)
}

/** Une ligne de blâme, avant qu'on lui attache son fil. */
export interface BlameRow {
  hash: string
  line: number
  text: string
  author: string
  ts: number
}

/**
 * `git blame --porcelain`, qui ne répète l'en-tête d'un commit qu'une fois.
 *
 * Le format porcelaine plutôt que le format lisible : celui-ci tronque les noms à la
 * largeur d'un terminal et colle la date au sha, et le recouper à coups d'expression
 * régulière sur un fichier de mille lignes est exactement le genre de chose qui marche
 * jusqu'au premier nom d'auteur contenant une parenthèse.
 */
export function parseBlame(raw: string): BlameRow[] {
  const rows: BlameRow[] = []
  const authors = new Map<string, { author: string; ts: number }>()
  let hash = ''
  let line = 0

  for (const entry of raw.split('\n')) {
    const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(entry)
    if (header) {
      hash = header[1] as string
      line = Number(header[2])
      continue
    }
    if (entry.startsWith('author ')) {
      const current = authors.get(hash) ?? { author: '', ts: 0 }
      authors.set(hash, { ...current, author: entry.slice('author '.length) })
      continue
    }
    if (entry.startsWith('author-time ')) {
      const current = authors.get(hash) ?? { author: '', ts: 0 }
      authors.set(hash, { ...current, ts: Number(entry.slice('author-time '.length)) * 1000 || 0 })
      continue
    }
    // Le contenu de la ligne est la seule qui commence par une tabulation.
    if (entry.startsWith('\t')) {
      const known = authors.get(hash) ?? { author: '', ts: 0 }
      rows.push({ hash, line, text: entry.slice(1), author: known.author, ts: known.ts })
    }
  }

  return rows
}

/** Le blâme d'un fichier, borné : un fichier de dix mille lignes ne se lit pas. */
export async function readBlame(cwd: string, path: string, limit: number): Promise<BlameRow[]> {
  // `-L` est refusé quand le fichier a moins de lignes que la borne — ce qui est le
  // cas courant. Le repli lit tout et coupe ici : la borne sert à ne pas transporter
  // un fichier énorme, pas à faire échouer les petits.
  const raw = await git(cwd, ['blame', '--porcelain', `-L1,${limit + 1}`, 'HEAD', '--', path])
    .catch(() => git(cwd, ['blame', '--porcelain', 'HEAD', '--', path]))
  return parseBlame(raw)
}
