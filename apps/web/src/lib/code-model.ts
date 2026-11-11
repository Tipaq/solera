import type {
  AgentKind,
  CardDto,
  GitSummaryDto,
  ProjectPullRequestListDto,
  PullRequestBadgeState,
  WorktreeState,
  WorktreeStatusListDto,
} from '@solera/protocol'

/**
 * Le modèle « Code » d'un projet : ses arbres (la racine et les worktrees), ce que chacun
 * attend de toi (son verdict), les branches qu'aucun arbre n'a extraites, et ce qui
 * rattache une ligne du fil à un arbre. L'Aperçu, Travail et le portefeuille le lisent.
 *
 * Pur, et sans texte : les raisons sont des identifiants que l'interface traduit
 * (`code.reason.*`). `lib/code-data.ts` l'alimente des requêtes ; les tests le lisent seul.
 *
 * Ce que le serveur ne dit pas encore (taille d'un arbre, date et avance d'une branche
 * sans arbre, ses derniers commits, les branches distantes) vaut `null` ou vide : rien
 * n'est simulé, et l'interface écrit « — » plutôt qu'un chiffre inventé.
 */

const DAY = 86_400_000

/** Au-delà, un arbre ou une branche sans activité est soupçonné d'abandon. */
export const STALE_DAYS = 14

/** Au-delà, un arbre est « lourd » : sa taille s'écrit à l'encre forte. */
export const HEAVY_BYTES = 400 * 1024 * 1024

/* ------------------------------------------------------------------ les arbres */

/** Ce qu'on vient lire d'un arbre : faut-il y toucher, et que perdrait-on. */
export type TreeVerdict =
  | 'root'
  | 'waiting'
  | 'active'
  | 'review'
  | 'merged-dirty'
  | 'stale'
  | 'wip'
  | 'empty'
  | 'clean'
  | 'missing'

/** L'ordre d'affichage, et celui des pastilles de T-10.2. */
export const VERDICT_ORDER: TreeVerdict[] = ['root', 'waiting', 'active', 'review', 'merged-dirty', 'stale', 'wip', 'empty', 'clean', 'missing']

/** L'état vivant d'une session, tel que le résume `threadState`. */
export type SessionTone = 'running' | 'awaiting' | 'broken'

/** Une session vivante d'un arbre. */
export interface TreeSession {
  id: string
  title: string
  agent: AgentKind
  tone: SessionTone
}

/**
 * La carte d'un arbre ou d'une branche. `name` : devinée du nom de la branche
 * (`feat/153-titre` → #153), en attendant que le serveur la rende (#168).
 */
export interface CodeCard {
  id: string
  number: number
  title: string
  milestone: { id: string; number: number; title: string } | null
  source: 'session' | 'name'
}

/** La PR d'une branche. `url` nul : une PR fusionnée que seul le statut de l'arbre connaît. */
export interface CodePr {
  number: number
  url: string | null
  state: PullRequestBadgeState
}

export interface TreeFields {
  /** Le chemin, ou `root` : stable d'une lecture à l'autre, et porté par l'adresse. */
  key: string
  root: boolean
  /** Null pour la racine et les arbres créés au shell : rien à nettoyer par Solera. */
  id: string | null
  name: string
  /** La branche extraite ; pour la racine, celle du dossier du projet, pas la base. */
  branch: string | null
  path: string
  external: boolean
  state: WorktreeState | 'root'
  /** Les sessions vivantes. */
  sessions: TreeSession[]
  /** La plus récente de toutes ses sessions, vivante ou non. */
  anySessionId: string | null
  card: CodeCard | null
  pr: CodePr | null
  ahead: number
  behind: number
  uncommitted: number
  conflicts: boolean
  unmergedCommits: boolean
  /** Null tant que le serveur ne le mesure pas (#166). */
  sizeBytes: number | null
  lastUsedAt: number | null
}

/** Pourquoi l'arbre est encore là : une phrase de `code.reason.*`, et son compte. */
export interface VerdictReason {
  id:
    | 'root'
    | 'rootDirty'
    | 'missing'
    | 'unreadable'
    | 'waiting'
    | 'active'
    | 'mergedDirty'
    | 'clean'
    | 'review'
    | 'draft'
    | 'stale'
    | 'empty'
    | 'wip'
  /** Fichiers non commités, ou jours sans activité. */
  count?: number
}

export interface TreeRow extends TreeFields {
  verdict: TreeVerdict
  reason: VerdictReason
}

const merged = (row: TreeFields) => row.state === 'merged' || row.pr?.state === 'merged'

/** Le verdict d'un arbre : le plus urgent l'emporte, dans l'ordre de T-10.1. */
export function verdictOf(row: TreeFields, now: number): { verdict: TreeVerdict; reason: VerdictReason } {
  if (row.root) {
    return { verdict: 'root', reason: row.uncommitted > 0 ? { id: 'rootDirty', count: row.uncommitted } : { id: 'root' } }
  }
  if (row.state === 'missing' || row.state === 'unreadable') {
    return { verdict: 'missing', reason: { id: row.state } }
  }
  if (row.sessions.some((session) => session.tone !== 'running')) return { verdict: 'waiting', reason: { id: 'waiting' } }
  if (row.sessions.length > 0) return { verdict: 'active', reason: { id: 'active' } }
  if (merged(row)) {
    return row.uncommitted > 0
      ? { verdict: 'merged-dirty', reason: { id: 'mergedDirty', count: row.uncommitted } }
      : { verdict: 'clean', reason: { id: 'clean' } }
  }
  if (row.pr) return { verdict: 'review', reason: { id: row.pr.state === 'draft' ? 'draft' : 'review' } }
  const idle = row.lastUsedAt === null ? null : now - row.lastUsedAt
  if (idle !== null && idle > STALE_DAYS * DAY) {
    return { verdict: 'stale', reason: { id: 'stale', count: Math.round(idle / DAY) } }
  }
  if (row.state === 'empty') return { verdict: 'empty', reason: { id: 'empty' } }
  return { verdict: 'wip', reason: { id: 'wip' } }
}

/** Ce que « Nettoyer » emporterait sans rien perdre. */
export function isCleanable(row: TreeRow): boolean {
  return row.verdict === 'clean' && !row.root
}

export function sortTrees(trees: TreeRow[]): TreeRow[] {
  return [...trees].sort(
    (a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
  )
}

/* ------------------------------------------------------------------ les PR */

export type CodeTone = 'neutral' | 'accent' | 'positive' | 'caution' | 'critical'

/** Le ton d'un état de PR (T-10.4). */
export const PR_TONE: Record<PullRequestBadgeState, CodeTone> = {
  draft: 'neutral',
  checks: 'accent',
  failing: 'critical',
  ready: 'positive',
  merged: 'neutral',
}

/* ------------------------------------------------------------------ le graphe de l'Aperçu */

/** Le mot d'une ligne du graphe des branches (A-4.3), du plus urgent au plus calme. */
export type LineStatus = 'broken' | 'awaiting' | 'conflict' | 'running' | 'ciRed' | 'ready' | 'toClean' | 'default' | 'idle'

export function statusOfLine(tree: TreeRow): LineStatus {
  const tones = new Set(tree.sessions.map((session) => session.tone))
  if (tones.has('broken')) return 'broken'
  if (tones.has('awaiting')) return 'awaiting'
  if (tree.conflicts) return 'conflict'
  if (tones.has('running')) return 'running'
  if (tree.pr?.state === 'failing') return 'ciRed'
  if (tree.pr?.state === 'ready') return 'ready'
  if (tree.pr?.state === 'merged' || tree.verdict === 'clean') return 'toClean'
  return tree.root ? 'default' : 'idle'
}

/**
 * Les arbres que le graphe montre (A-4.6) : un arbre fusionné, vide ou introuvable n'a
 * plus rien à faire que d'être nettoyé ; sans session, il est seulement compté.
 */
export function liveTrees(trees: TreeRow[]): { live: TreeRow[]; settled: number } {
  const live: TreeRow[] = []
  let settled = 0
  for (const tree of trees) {
    const done = !tree.root && tree.sessions.length === 0 && ['clean', 'empty', 'missing'].includes(tree.verdict)
    if (done) settled += 1
    else live.push(tree)
  }
  return { live, settled }
}

/** L'ordre du graphe (A-4.5) : la racine, puis les arbres où ça bouge, puis le plus récent. */
export function orderLines(trees: TreeRow[]): TreeRow[] {
  return [...trees].sort((a, b) => {
    if (a.root !== b.root) return a.root ? -1 : 1
    const busy = Number(b.sessions.length > 0) - Number(a.sessions.length > 0)
    return busy || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
  })
}

/* ------------------------------------------------------------------ les branches sans arbre */

export type BranchKind = 'pr' | 'unmerged' | 'remote' | 'merged'

const BRANCH_ORDER: BranchKind[] = ['pr', 'unmerged', 'remote', 'merged']

export interface BranchInfo {
  /** `branche:<nom>` : ne se confond pas avec la clé d'un arbre, son chemin. */
  key: string
  name: string
  kind: BranchKind
  merged: boolean
  remoteOnly: boolean
  /** Null, comme l'avance, le retard et les commits, tant que #167 n'est pas livrée. */
  lastCommitAt: number | null
  ahead: number | null
  behind: number | null
  commits: { hash: string; title: string; at: number }[]
  pr: { number: number; url: string; state: PullRequestBadgeState; title: string } | null
  card: CodeCard | null
}

/** Le genre d'une branche (T-10.3) : une PR fusionnée ne dit plus rien, la branche si. */
export function branchKindOf(branch: { merged: boolean; remoteOnly: boolean; pr: { state: PullRequestBadgeState } | null }): BranchKind {
  if (branch.merged) return 'merged'
  if (branch.pr && branch.pr.state !== 'merged') return 'pr'
  return branch.remoteOnly ? 'remote' : 'unmerged'
}

/** PR, travail non fusionné récent, distantes, fusionnées ; une date inconnue en dernier. */
export function sortBranches(branches: BranchInfo[]): BranchInfo[] {
  return [...branches].sort(
    (a, b) => BRANCH_ORDER.indexOf(a.kind) - BRANCH_ORDER.indexOf(b.kind) || (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0),
  )
}

/* ------------------------------------------------------------------ les filtres d'état (T-1.2) */

export type StateKey = 'waiting' | 'working' | 'review' | 'prReady' | 'ciRed' | 'stale' | 'cleanup' | 'merged'

export function statesOfTree(tree: TreeRow): Set<StateKey> {
  const out = new Set<StateKey>()
  if (tree.verdict === 'waiting') out.add('waiting')
  if (tree.verdict === 'active') out.add('working')
  if (tree.verdict === 'review') out.add('review')
  if (tree.pr?.state === 'ready') out.add('prReady')
  if (tree.pr?.state === 'failing' || tree.conflicts) out.add('ciRed')
  if (tree.verdict === 'stale') out.add('stale')
  if (isCleanable(tree) || tree.verdict === 'missing') out.add('cleanup')
  if (tree.verdict === 'clean' || tree.verdict === 'merged-dirty') out.add('merged')
  return out
}

export function statesOfBranch(branch: BranchInfo, now: number): Set<StateKey> {
  const out = new Set<StateKey>()
  if (branch.pr?.state === 'ready') out.add('prReady')
  if (branch.pr?.state === 'failing') out.add('ciRed')
  if (branch.kind === 'unmerged' && branch.lastCommitAt !== null && now - branch.lastCommitAt > STALE_DAYS * DAY) out.add('stale')
  if (branch.kind === 'merged') {
    out.add('cleanup')
    out.add('merged')
  }
  return out
}

/** Une session du fil, par le groupe de l'Activité. */
export function statesOfRow(row: { group: 'asking' | 'review' | 'running' | 'done' }): Set<StateKey> {
  const out = new Set<StateKey>()
  if (row.group === 'asking') out.add('waiting')
  if (row.group === 'running') out.add('working')
  if (row.group === 'review') out.add('review')
  return out
}

/* ------------------------------------------------------------------ le rattachement au fil */

/** Ce qui relie un arbre à son travail : ses sessions, et leurs cartes. */
export interface TreeScope {
  sessionIds: Set<string>
  cardNumbers: Set<number>
}

/**
 * Les sessions d'un arbre par `worktreeId` (la racine prend celles sans arbre), vivantes
 * ou passées, et les cartes de ces sessions.
 */
export function scopeOf(
  tree: TreeRow,
  conversations: { id: string; worktreeId: string | null; card: { number: number } | null }[],
): TreeScope {
  const mine = conversations.filter((entry) => (tree.root ? entry.worktreeId === null : entry.worktreeId !== null && entry.worktreeId === tree.id))
  const sessionIds = new Set(mine.map((entry) => entry.id))
  for (const session of tree.sessions) sessionIds.add(session.id)
  if (tree.anySessionId) sessionIds.add(tree.anySessionId)
  const cardNumbers = new Set<number>()
  for (const entry of mine) if (entry.card) cardNumbers.add(entry.card.number)
  if (tree.card) cardNumbers.add(tree.card.number)
  return { sessionIds, cardNumbers }
}

/** Une session vivante du fil : par son identifiant, sinon par l'endroit où elle travaille. */
export function rowInTree(
  row: { entry: { conversation: { id: string } }; place: { root: boolean; branch: string | null; path: string | null } },
  tree: TreeRow,
  scope: TreeScope,
): boolean {
  if (scope.sessionIds.has(row.entry.conversation.id)) return true
  if (tree.root) return row.place.root
  return !row.place.root && (row.place.path === tree.path || (tree.branch !== null && row.place.branch === tree.branch))
}

/** Une ligne du journal : par sa session, sa carte, ou la branche dans son titre. */
export function entryInTree(
  entry: { conversationId: string | null; cardNumber: number | null; title: string },
  tree: TreeRow,
  scope: TreeScope,
): boolean {
  if (entry.conversationId && scope.sessionIds.has(entry.conversationId)) return true
  if (entry.cardNumber !== null && scope.cardNumbers.has(entry.cardNumber)) return true
  // La racine ne se cherche pas par son nom : « main » figure dans presque toute fusion.
  return !tree.root && tree.branch !== null && entry.title.includes(tree.branch)
}

/**
 * Une demande de « Ce qui t'attend ». Celles d'un jalon (sans session) ne vivent dans
 * aucun arbre.
 */
export function inboxInTree(item: { sessionId: string | null; cardNumber: number | null }, scope: TreeScope): boolean {
  if (item.sessionId === null) return false
  return scope.sessionIds.has(item.sessionId) || (item.cardNumber !== null && scope.cardNumbers.has(item.cardNumber))
}

/** L'arbre qui porte une ligne : un arbre de travail d'abord, la racine seulement à défaut. */
export function treeOf(trees: TreeRow[], matches: (tree: TreeRow) => boolean): TreeRow | null {
  return trees.find((tree) => !tree.root && matches(tree)) ?? trees.find((tree) => tree.root && matches(tree)) ?? null
}

/* ------------------------------------------------------------------ petites fonctions */

/** Le nom court d'une branche : le préfixe `feat/` ne dit rien qu'on ne voie déjà. */
export function shortBranch(name: string): string {
  return name.replace(/^(feat|fix|spike|chore|jalon)\//, '')
}

/** `feat/153-titre` → 153 : le numéro de carte que Solera met dans ses branches. */
export function cardNumberOf(name: string): number | null {
  const match = name.match(/\/(\d+)-/)
  return match ? Number(match[1]) : null
}

/** Une taille sur disque, dans la langue de l'interface : « 740 Mo », « 1,4 Go ». */
export function formatBytes(bytes: number, locale: string): string {
  const format = (value: number, unit: 'kilobyte' | 'megabyte' | 'gigabyte', digits: number) =>
    new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: digits }).format(value)
  if (bytes >= 1024 ** 3) return format(bytes / 1024 ** 3, 'gigabyte', 1)
  if (bytes >= 1024 ** 2) return format(Math.round(bytes / 1024 ** 2), 'megabyte', 0)
  return format(Math.max(1, Math.round(bytes / 1024)), 'kilobyte', 0)
}

/** La ligne de base (T-2) : la branche de comparaison, et la racine si elle l'a quittée. */
export interface BaseLine {
  base: string
  rootBranch: string | null
  off: boolean
  uncommitted: number
}

export function baseLineOf(code: { base: string | null; trees: TreeRow[] }): BaseLine | null {
  if (!code.base) return null
  const root = code.trees.find((tree) => tree.root) ?? null
  const rootBranch = root?.branch ?? null
  return { base: code.base, rootBranch, off: rootBranch !== null && rootBranch !== code.base, uncommitted: root?.uncommitted ?? 0 }
}

/* ------------------------------------------------------------------ l'assemblage */

/** Une session du projet, telle que l'assemblage en a besoin. */
export interface CodeSession {
  id: string
  title: string
  agent: AgentKind
  worktreeId: string | null
  cardId: string | null
  /** Null : au repos. */
  tone: SessionTone | null
  /** Sa dernière écriture. */
  at: number
}

export interface CodeData {
  base: string | null
  trees: TreeRow[]
  branches: WorktreeStatusListDto['branches']
  /** Faux : la forge n'a pas répondu, aucune PR n'est montrée. */
  forge: boolean
}

export interface CodeSources {
  project: { workspacePath: string; git: Pick<GitSummaryDto, 'branch' | 'changedFiles'> | null }
  statuses: WorktreeStatusListDto | undefined
  pullRequests: ProjectPullRequestListDto | undefined
  cards: CardDto[]
  sessions: CodeSession[]
  now: number
}

function cardIndex(cards: CardDto[]) {
  const byId = new Map(cards.map((card) => [card.id, card]))
  const byNumber = new Map(cards.map((card) => [card.number, card]))
  const link = (card: CardDto | undefined, source: CodeCard['source']): CodeCard | null => {
    if (!card) return null
    const parent = card.parent ? byId.get(card.parent.id) : undefined
    return {
      id: card.id,
      number: card.number,
      title: card.title,
      milestone: parent ? { id: parent.id, number: parent.number, title: parent.title } : null,
      source,
    }
  }
  return {
    ofSession: (id: string | null) => (id ? link(byId.get(id), 'session') : null),
    ofName: (branch: string | null) => {
      const number = branch ? cardNumberOf(branch) : null
      return number === null ? null : link(byNumber.get(number), 'name')
    },
  }
}

function pullRequestOf(list: ProjectPullRequestListDto | undefined, branch: string | null) {
  if (!list?.available || !branch) return null
  return list.pullRequests.find((pr) => pr.branch === branch) ?? null
}

const latest = (values: (number | null)[]) =>
  values.reduce<number | null>((max, at) => (at !== null && (max === null || at > max) ? at : max), null)

/** Les arbres d'un projet, jugés et triés, à partir de ce que les requêtes rendent. */
export function codeDataOf({ project, statuses, pullRequests, cards, sessions, now }: CodeSources): CodeData {
  const index = cardIndex(cards)

  const sessionsOf = (worktreeId: string | null) => {
    const mine = sessions.filter((entry) => entry.worktreeId === worktreeId).sort((a, b) => b.at - a.at)
    return {
      live: mine.flatMap((entry) => (entry.tone ? [{ id: entry.id, title: entry.title, agent: entry.agent, tone: entry.tone }] : [])),
      latestId: mine[0]?.id ?? null,
      lastAt: mine[0]?.at ?? null,
      card: index.ofSession(mine.find((entry) => entry.cardId !== null)?.cardId ?? null),
    }
  }

  const trees: TreeRow[] = []
  const judge = (fields: TreeFields) => trees.push({ ...fields, ...verdictOf(fields, now) })

  if (project.git) {
    const root = sessionsOf(null)
    judge({
      key: 'root',
      root: true,
      id: null,
      name: project.git.branch,
      branch: project.git.branch,
      path: project.workspacePath,
      external: false,
      state: 'root',
      sessions: root.live,
      anySessionId: root.latestId,
      card: null,
      pr: null,
      ahead: 0,
      behind: 0,
      uncommitted: project.git.changedFiles,
      conflicts: false,
      unmergedCommits: false,
      sizeBytes: null,
      lastUsedAt: root.lastAt,
    })
  }

  for (const tree of statuses?.worktrees ?? []) {
    const mine = tree.id ? sessionsOf(tree.id) : { live: [], latestId: null, lastAt: null, card: null }
    const pr = pullRequestOf(pullRequests, tree.branch)
    judge({
      key: tree.path,
      root: false,
      id: tree.id,
      name: tree.name,
      branch: tree.branch,
      path: tree.path,
      external: tree.external,
      state: tree.state,
      sessions: mine.live,
      anySessionId: mine.latestId,
      card: mine.card ?? index.ofName(tree.branch),
      pr: pr
        ? { number: pr.number, url: pr.url, state: pr.state }
        : tree.mergedPullRequest !== null
          ? { number: tree.mergedPullRequest, url: null, state: 'merged' }
          : null,
      ahead: tree.ahead,
      behind: tree.behind,
      uncommitted: tree.modified + tree.untracked,
      conflicts: tree.conflicts,
      unmergedCommits: tree.unmergedCommits,
      sizeBytes: null,
      lastUsedAt: latest([mine.lastAt, tree.lastCommitAt, tree.lastEditAt]),
    })
  }

  return {
    base: statuses?.base ?? null,
    trees: sortTrees(trees),
    branches: statuses?.branches ?? [],
    forge: pullRequests?.available ?? false,
  }
}

/** Les branches sans arbre, avec leur PR et leur carte devinée, triées (T-10.3). */
export function branchInfosOf({
  branches,
  pullRequests,
  cards,
}: {
  branches: { name: string; merged: boolean; remoteOnly?: boolean }[]
  pullRequests: ProjectPullRequestListDto | undefined
  cards: CardDto[]
}): BranchInfo[] {
  const index = cardIndex(cards)
  return sortBranches(
    branches.map((branch) => {
      const found = pullRequestOf(pullRequests, branch.name)
      const pr = found ? { number: found.number, url: found.url, state: found.state, title: found.title } : null
      const remoteOnly = branch.remoteOnly ?? false
      return {
        key: `branche:${branch.name}`,
        name: branch.name,
        kind: branchKindOf({ merged: branch.merged, remoteOnly, pr }),
        merged: branch.merged,
        remoteOnly,
        lastCommitAt: null,
        ahead: null,
        behind: null,
        commits: [],
        pr,
        card: index.ofName(branch.name),
      }
    }),
  )
}
