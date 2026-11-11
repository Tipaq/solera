import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardDto, LooseBranchDto, ProjectPullRequestDto, WorktreeStatusDto } from '@solera/protocol'
import type { TreeFields, TreeRow, BranchInfo, CodeSession } from '../../web/src/lib/code-model.js'

const {
  VERDICT_ORDER,
  PR_TONE,
  verdictOf,
  sortTrees,
  isCleanable,
  statusOfLine,
  liveTrees,
  orderLines,
  statesOfTree,
  statesOfBranch,
  statesOfRow,
  branchKindOf,
  sortBranches,
  scopeOf,
  rowInTree,
  entryInTree,
  inboxInTree,
  treeOf,
  shortBranch,
  cardNumberOf,
  baseLineOf,
  formatBytes,
  codeDataOf,
  branchInfosOf,
  pluralOf,
} = await import('../../web/src/lib/code-model.js')

const DAY = 86_400_000
const NOW = 1_800_000_000_000

const fields = (over: Partial<TreeFields> = {}): TreeFields => ({
  key: '/w/feat',
  root: false,
  id: 'w1',
  name: 'feat/12-truc',
  branch: 'feat/12-truc',
  path: '/w/feat',
  external: false,
  state: 'unmerged',
  sessions: [],
  anySessionId: null,
  card: null,
  pr: null,
  ahead: 2,
  behind: 0,
  uncommitted: 0,
  conflicts: false,
  unmergedCommits: true,
  sizeBytes: null,
  lastUsedAt: NOW - DAY,
  ...over,
})

const row = (over: Partial<TreeFields> = {}): TreeRow => {
  const base = fields(over)
  return { ...base, ...verdictOf(base, NOW) }
}

const session = (tone: CodeSession['tone'], id = `s-${tone}`) => ({ id, title: id, agent: 'claude' as const, tone: tone! })
const pr = (state: ProjectPullRequestDto['state'], number = 7) => ({ number, url: `https://forge/pr/${number}`, state })

/* ------------------------------------------------------------------ T-10.1 */

test('verdict : chaque cas, avec sa raison', () => {
  const cases: [string, Partial<TreeFields>, string, { id: string; count?: number }][] = [
    ['racine propre', { root: true, state: 'root', uncommitted: 0 }, 'root', { id: 'root' }],
    ['racine sale', { root: true, state: 'root', uncommitted: 3 }, 'root', { id: 'rootDirty', count: 3 }],
    ['dossier disparu', { state: 'missing' }, 'missing', { id: 'missing' }],
    ['illisible', { state: 'unreadable' }, 'missing', { id: 'unreadable' }],
    ['session qui attend', { sessions: [session('awaiting')] }, 'waiting', { id: 'waiting' }],
    ['session en erreur', { sessions: [session('broken')] }, 'waiting', { id: 'waiting' }],
    ['session qui tourne', { sessions: [session('running')] }, 'active', { id: 'active' }],
    ['fusionné avec du non commité', { state: 'dirty', pr: pr('merged'), uncommitted: 2 }, 'merged-dirty', { id: 'mergedDirty', count: 2 }],
    ['fusionné propre', { state: 'merged', unmergedCommits: false }, 'clean', { id: 'clean' }],
    ['PR fusionnée, contenu pas encore', { state: 'unmerged', pr: pr('merged') }, 'clean', { id: 'clean' }],
    ['PR ouverte', { pr: pr('checks') }, 'review', { id: 'review' }],
    ['PR en brouillon', { pr: pr('draft') }, 'review', { id: 'draft' }],
    ['abandonné', { lastUsedAt: NOW - 20 * DAY }, 'stale', { id: 'stale', count: 20 }],
    ['vide', { state: 'empty', ahead: 0, unmergedCommits: false }, 'empty', { id: 'empty' }],
    ['en suspens', {}, 'wip', { id: 'wip' }],
  ]
  for (const [label, over, verdict, reason] of cases) {
    const result = verdictOf(fields(over), NOW)
    assert.equal(result.verdict, verdict, label)
    assert.deepEqual(result.reason, reason, label)
  }
})

test('verdict : le plus urgent l’emporte, dans l’ordre de T-10.1', () => {
  // La racine reste la racine, même quand une session y attend.
  assert.equal(verdictOf(fields({ root: true, state: 'root', sessions: [session('awaiting')] }), NOW).verdict, 'root')
  // Un dossier disparu prime sur la session qui y attendait.
  assert.equal(verdictOf(fields({ state: 'missing', sessions: [session('awaiting')] }), NOW).verdict, 'missing')
  // Attendre prime sur tourner.
  assert.equal(verdictOf(fields({ sessions: [session('running'), session('awaiting')] }), NOW).verdict, 'waiting')
  // Une session qui tourne prime sur la fusion.
  assert.equal(verdictOf(fields({ state: 'merged', sessions: [session('running')] }), NOW).verdict, 'active')
  // Fusionné prime sur la PR ouverte et sur l'abandon.
  assert.equal(verdictOf(fields({ state: 'merged', lastUsedAt: NOW - 90 * DAY }), NOW).verdict, 'clean')
  // Une PR ouverte prime sur l'abandon.
  assert.equal(verdictOf(fields({ pr: pr('ready'), lastUsedAt: NOW - 90 * DAY }), NOW).verdict, 'review')
  // L'abandon prime sur le vide.
  assert.equal(verdictOf(fields({ state: 'empty', lastUsedAt: NOW - 90 * DAY }), NOW).verdict, 'stale')
})

test('verdict : abandonné au-delà de 14 jours seulement, jamais sans date', () => {
  assert.equal(verdictOf(fields({ lastUsedAt: NOW - 14 * DAY }), NOW).verdict, 'wip')
  assert.equal(verdictOf(fields({ lastUsedAt: NOW - 14 * DAY - 1 }), NOW).verdict, 'stale')
  assert.equal(verdictOf(fields({ lastUsedAt: null }), NOW).verdict, 'wip')
})

test('arbres : triés dans l’ordre d’affichage, puis le plus récent d’abord', () => {
  const trees = [
    row({ key: 'clean', state: 'merged' }),
    row({ key: 'wip-old', lastUsedAt: NOW - 3 * DAY }),
    row({ key: 'root', root: true, state: 'root' }),
    row({ key: 'wip-new', lastUsedAt: NOW - DAY }),
    row({ key: 'missing', state: 'missing' }),
    row({ key: 'waiting', sessions: [session('awaiting')] }),
  ]
  assert.deepEqual(sortTrees(trees).map((tree) => tree.key), ['root', 'waiting', 'wip-new', 'wip-old', 'clean', 'missing'])
  assert.deepEqual(VERDICT_ORDER, ['root', 'waiting', 'active', 'review', 'merged-dirty', 'stale', 'wip', 'empty', 'clean', 'missing'])
})

test('nettoyable : fusionné sans rien à perdre, jamais la racine', () => {
  assert.equal(isCleanable(row({ state: 'merged' })), true)
  assert.equal(isCleanable(row({ state: 'dirty', pr: pr('merged'), uncommitted: 1 })), false)
  assert.equal(isCleanable(row({ state: 'empty' })), false)
})

/* ------------------------------------------------------------------ T-10.3, T-10.4 */

test('genre d’une branche sans arbre, et leur ordre', () => {
  assert.equal(branchKindOf({ merged: true, remoteOnly: false, pr: pr('ready') }), 'merged')
  assert.equal(branchKindOf({ merged: false, remoteOnly: true, pr: pr('draft') }), 'pr')
  assert.equal(branchKindOf({ merged: false, remoteOnly: false, pr: pr('merged') }), 'unmerged')
  assert.equal(branchKindOf({ merged: false, remoteOnly: true, pr: null }), 'remote')
  assert.equal(branchKindOf({ merged: false, remoteOnly: false, pr: null }), 'unmerged')

  const branch = (name: string, kind: BranchInfo['kind'], lastCommitAt: number | null): BranchInfo => ({
    key: `branche:${name}`, name, kind, merged: kind === 'merged', remoteOnly: kind === 'remote', lastCommitAt, ahead: null, behind: null, commits: [], pr: null, card: null,
  })
  const sorted = sortBranches([
    branch('m', 'merged', NOW),
    branch('r', 'remote', NOW),
    branch('u-old', 'unmerged', NOW - 5 * DAY),
    branch('u-unknown', 'unmerged', null),
    branch('u-new', 'unmerged', NOW - DAY),
    branch('p', 'pr', NOW - 9 * DAY),
  ])
  assert.deepEqual(sorted.map((entry) => entry.name), ['p', 'u-new', 'u-old', 'u-unknown', 'r', 'm'])
})

test('tons des états de PR', () => {
  assert.deepEqual(PR_TONE, { draft: 'neutral', checks: 'accent', failing: 'critical', ready: 'positive', merged: 'neutral' })
})

/* ------------------------------------------------------------------ A-4.3, A-4.5, A-4.6 */

test('statut d’une ligne du graphe : le plus urgent l’emporte', () => {
  const cases: [Partial<TreeFields>, string][] = [
    [{ sessions: [session('awaiting'), session('broken')], conflicts: true }, 'broken'],
    [{ sessions: [session('running'), session('awaiting')], conflicts: true }, 'awaiting'],
    [{ sessions: [session('running')], conflicts: true }, 'conflict'],
    [{ sessions: [session('running')], pr: pr('failing') }, 'running'],
    [{ pr: pr('failing') }, 'ciRed'],
    [{ pr: pr('ready') }, 'ready'],
    [{ pr: pr('merged') }, 'toClean'],
    [{ root: true, state: 'root' }, 'default'],
    [{}, 'idle'],
  ]
  for (const [over, status] of cases) assert.equal(statusOfLine(row(over)), status, JSON.stringify(over))
})

test('lignes vivantes : fusionnés, vides et introuvables sans session comptés à part', () => {
  const trees = [
    row({ key: 'root', root: true, state: 'root' }),
    row({ key: 'clean', state: 'merged' }),
    row({ key: 'empty', state: 'empty', lastUsedAt: NOW }),
    row({ key: 'gone', state: 'missing' }),
    row({ key: 'gone-busy', state: 'missing', sessions: [session('awaiting')] }),
    row({ key: 'merged-busy', state: 'merged', sessions: [session('running')] }),
    row({ key: 'merged-dirty', state: 'dirty', pr: pr('merged'), uncommitted: 2 }),
    row({ key: 'wip' }),
  ]
  const { live, settled } = liveTrees(trees)
  assert.deepEqual(live.map((tree) => tree.key), ['root', 'gone-busy', 'merged-busy', 'merged-dirty', 'wip'])
  assert.equal(settled, 3)
})

test('lignes : la racine, puis les arbres avec session, puis le plus récent', () => {
  const lines = [
    row({ key: 'old', lastUsedAt: NOW - 5 * DAY }),
    row({ key: 'busy-old', lastUsedAt: NOW - 9 * DAY, sessions: [session('running')] }),
    row({ key: 'new', lastUsedAt: NOW - DAY }),
    row({ key: 'root', root: true, state: 'root', lastUsedAt: null }),
    row({ key: 'never', lastUsedAt: null }),
  ]
  assert.deepEqual(orderLines(lines).map((line) => line.key), ['root', 'busy-old', 'new', 'old', 'never'])
})

/* ------------------------------------------------------------------ T-1.2 */

test('états filtrables d’un arbre', () => {
  const states = (over: Partial<TreeFields>) => [...statesOfTree(row(over))].sort()
  assert.deepEqual(states({ sessions: [session('awaiting')] }), ['waiting'])
  assert.deepEqual(states({ sessions: [session('running')], conflicts: true }), ['ciRed', 'working'])
  assert.deepEqual(states({ pr: pr('ready') }), ['prReady', 'review'])
  assert.deepEqual(states({ pr: pr('failing') }), ['ciRed', 'review'])
  assert.deepEqual(states({ lastUsedAt: NOW - 30 * DAY }), ['stale'])
  assert.deepEqual(states({ state: 'merged' }), ['cleanup', 'merged'])
  assert.deepEqual(states({ state: 'missing' }), ['cleanup'])
  assert.deepEqual(states({ state: 'dirty', pr: pr('merged'), uncommitted: 1 }), ['merged'])
  assert.deepEqual(states({}), [])
})

test('états filtrables d’une branche et d’une session', () => {
  const branch = (over: Partial<BranchInfo>): BranchInfo => ({
    key: 'branche:x', name: 'x', kind: 'unmerged', merged: false, remoteOnly: false, lastCommitAt: NOW - DAY, ahead: null, behind: null, commits: [], pr: null, card: null, ...over,
  })
  assert.deepEqual([...statesOfBranch(branch({ kind: 'pr', pr: pr('ready') }), NOW)], ['prReady'])
  assert.deepEqual([...statesOfBranch(branch({ kind: 'pr', pr: pr('failing') }), NOW)], ['ciRed'])
  assert.deepEqual([...statesOfBranch(branch({ lastCommitAt: NOW - 20 * DAY }), NOW)], ['stale'])
  // Sans date (la carte serveur n'est pas livrée), on ne soupçonne pas l'abandon.
  assert.deepEqual([...statesOfBranch(branch({ lastCommitAt: null }), NOW)], [])
  assert.deepEqual([...statesOfBranch(branch({ kind: 'merged', merged: true }), NOW)].sort(), ['cleanup', 'merged'])

  assert.deepEqual([...statesOfRow({ group: 'asking' })], ['waiting'])
  assert.deepEqual([...statesOfRow({ group: 'running' })], ['working'])
  assert.deepEqual([...statesOfRow({ group: 'review' })], ['review'])
  assert.deepEqual([...statesOfRow({ group: 'done' })], [])
})

/* ------------------------------------------------------------------ rattachement au fil */

const conversations = [
  { id: 'c-root', worktreeId: null, card: null },
  { id: 'c-tree', worktreeId: 'w1', card: { number: 40 } },
  { id: 'c-other', worktreeId: 'w2', card: { number: 41 } },
]

test('portée d’un arbre : ses sessions par worktreeId, la racine prend celles sans arbre', () => {
  const tree = row({ id: 'w1', anySessionId: 'c-old', card: { id: 'k', number: 12, title: 't', milestone: null, source: 'name' } })
  const scope = scopeOf(tree, conversations)
  assert.deepEqual([...scope.sessionIds].sort(), ['c-old', 'c-tree'])
  assert.deepEqual([...scope.cardNumbers].sort(), [12, 40])

  const root = scopeOf(row({ root: true, state: 'root', id: null }), conversations)
  assert.deepEqual([...root.sessionIds], ['c-root'])
})

test('une entrée du journal : par session, par carte, par branche — jamais la racine par son nom', () => {
  const tree = row({ id: 'w1', branch: 'feat/12-truc' })
  const scope = scopeOf(tree, conversations)
  const entry = (over: { conversationId?: string | null; cardNumber?: number | null; title?: string }) => ({
    conversationId: null, cardNumber: null, title: 'rien', ...over,
  })
  assert.equal(entryInTree(entry({ conversationId: 'c-tree' }), tree, scope), true)
  assert.equal(entryInTree(entry({ cardNumber: 40 }), tree, scope), true)
  assert.equal(entryInTree(entry({ title: 'feat/12-truc fusionnée dans main' }), tree, scope), true)
  assert.equal(entryInTree(entry({ conversationId: 'c-other' }), tree, scope), false)

  const root = row({ root: true, state: 'root', id: null, branch: 'main' })
  const rootScope = scopeOf(root, conversations)
  assert.equal(entryInTree(entry({ title: 'feat/x fusionnée dans main' }), root, rootScope), false)
  assert.equal(entryInTree(entry({ conversationId: 'c-root' }), root, rootScope), true)
})

test('une session vivante : par identifiant, sinon par chemin ou branche ; la racine par sa place', () => {
  const tree = row({ id: 'w1', path: '/w/feat', branch: 'feat/12-truc' })
  const scope = scopeOf(tree, conversations)
  const live = (id: string, place: { root: boolean; branch: string | null; path: string | null }) => ({ entry: { conversation: { id } }, place })
  assert.equal(rowInTree(live('c-tree', { root: false, branch: null, path: null }), tree, scope), true)
  assert.equal(rowInTree(live('neuve', { root: false, branch: null, path: '/w/feat' }), tree, scope), true)
  assert.equal(rowInTree(live('neuve', { root: false, branch: 'feat/12-truc', path: null }), tree, scope), true)
  assert.equal(rowInTree(live('neuve', { root: true, branch: 'main', path: null }), tree, scope), false)

  const root = row({ root: true, state: 'root', id: null, branch: 'main' })
  assert.equal(rowInTree(live('neuve', { root: true, branch: 'main', path: null }), root, scopeOf(root, conversations)), true)
})

test('une demande : les siennes par session ou par carte, jamais celles d’un jalon', () => {
  const tree = row({ id: 'w1' })
  const scope = scopeOf(tree, conversations)
  assert.equal(inboxInTree({ sessionId: 'c-tree', cardNumber: null }, scope), true)
  assert.equal(inboxInTree({ sessionId: 'autre', cardNumber: 40 }, scope), true)
  assert.equal(inboxInTree({ sessionId: null, cardNumber: 40 }, scope), false)
  assert.equal(inboxInTree({ sessionId: 'autre', cardNumber: 99 }, scope), false)
})

test('l’arbre d’une ligne : un arbre de travail avant la racine', () => {
  const root = row({ key: 'root', root: true, state: 'root', id: null, branch: 'main' })
  const tree = row({ key: '/w/feat', id: 'w1' })
  const trees = [root, tree]
  const scopes = new Map(trees.map((entry) => [entry.key, scopeOf(entry, conversations)]))
  // `c-tree` est dans le worktree ; une carte que la racine porterait aussi ne la lui donne pas.
  scopes.get('root')!.cardNumbers.add(40)
  const entry = { conversationId: null, cardNumber: 40, title: '' }
  assert.equal(treeOf(trees, (candidate) => entryInTree(entry, candidate, scopes.get(candidate.key)!))?.key, '/w/feat')
  const orphan = { conversationId: 'c-root', cardNumber: null, title: '' }
  assert.equal(treeOf(trees, (candidate) => entryInTree(orphan, candidate, scopes.get(candidate.key)!))?.key, 'root')
  assert.equal(treeOf(trees, () => false), null)
})

/* ------------------------------------------------------------------ petites fonctions */

test('nom court, carte devinée du nom', () => {
  assert.equal(shortBranch('feat/12-truc'), '12-truc')
  assert.equal(shortBranch('jalon/164-page'), '164-page')
  assert.equal(shortBranch('main'), 'main')
  assert.equal(cardNumberOf('feat/153-titre'), 153)
  assert.equal(cardNumberOf('jalon/164-page-projet'), 164)
  assert.equal(cardNumberOf('spike/terminal-wasm'), null)
  assert.equal(cardNumberOf('153-titre'), null)
})

test('pluriel : un seul, sinon plusieurs (zéro compris)', () => {
  assert.deepEqual([0, 1, 2, 40].map(pluralOf), ['other', 'one', 'other', 'other'])
})

test('formatBytes en français et en anglais', () => {
  const MB = 1024 * 1024
  const nbsp = (text: string) => text.replace(/[  ]/g, ' ')
  assert.equal(nbsp(formatBytes(512, 'fr')), '1 ko')
  assert.equal(nbsp(formatBytes(300 * 1024, 'fr')), '300 ko')
  assert.equal(nbsp(formatBytes(740 * MB, 'fr')), '740 Mo')
  assert.equal(nbsp(formatBytes(1023.6 * MB, 'fr')), '1 024 Mo')
  assert.equal(nbsp(formatBytes(1480 * MB, 'fr')), '1,4 Go')
  assert.equal(nbsp(formatBytes(1024 * MB, 'fr')), '1 Go')
  assert.equal(nbsp(formatBytes(740 * MB, 'en')), '740 MB')
  assert.equal(nbsp(formatBytes(1480 * MB, 'en')), '1.4 GB')
  assert.equal(nbsp(formatBytes(300 * 1024, 'en')), '300 kB')
})

/* ------------------------------------------------------------------ T-2 */

test('ligne de base : la racine sur la base, ou sortie ailleurs', () => {
  const root = (branch: string, uncommitted = 0) => row({ key: 'root', root: true, state: 'root', id: null, branch, uncommitted })
  assert.deepEqual(baseLineOf({ base: 'main', trees: [root('main', 4)] }), { base: 'main', rootBranch: 'main', off: false, uncommitted: 4 })
  assert.deepEqual(baseLineOf({ base: 'main', trees: [root('feat/x', 2)] }), { base: 'main', rootBranch: 'feat/x', off: true, uncommitted: 2 })
  assert.equal(baseLineOf({ base: null, trees: [root('main')] }), null)
  assert.deepEqual(baseLineOf({ base: 'main', trees: [] }), { base: 'main', rootBranch: null, off: false, uncommitted: 0 })
})

/* ------------------------------------------------------------------ l'assemblage */

const status = (over: Partial<WorktreeStatusDto>): WorktreeStatusDto => ({
  id: 'w1', name: 'feat/12-truc', path: '/w/feat', branch: 'feat/12-truc', external: false, state: 'unmerged',
  ahead: 1, behind: 2, modified: 1, untracked: 2, conflicts: false, unmergedCommits: true, mergedPullRequest: null,
  head: 'abc', lastCommitAt: NOW - 3 * DAY, lastEditAt: NOW - 2 * DAY, conversations: [], sizeBytes: null, ...over,
})

const card = (number: number, over: Partial<CardDto> = {}): CardDto =>
  ({ id: `k${number}`, number, title: `Carte ${number}`, parent: null, children: [], column: 'in_progress', ...over }) as CardDto

test('assemblage : la racine sur sa vraie branche, les arbres jugés, les tailles mesurées, rien de simulé', () => {
  const cards = [card(164), card(12, { parent: { id: 'k164', number: 164, title: 'Carte 164', column: 'in_progress' } }), card(30)]
  const sessions: CodeSession[] = [
    { id: 's-root', title: 'r', agent: 'claude', worktreeId: null, cardId: null, tone: 'running', at: NOW - 1000 },
    { id: 's-old', title: 'o', agent: 'codex', worktreeId: 'w1', cardId: 'k30', tone: null, at: NOW - 5 * DAY },
    { id: 's-new', title: 'n', agent: 'claude', worktreeId: 'w1', cardId: 'k12', tone: 'awaiting', at: NOW - DAY },
  ]
  const data = codeDataOf({
    project: { workspacePath: '/p', git: { branch: 'feat/repointage', changedFiles: 3 } },
    statuses: {
      base: 'main', computedAt: NOW, fresh: true, rootSizeBytes: 2_000_000_000, sizesPending: true,
      worktrees: [
        status({ sizeBytes: 450_000_000 }),
        status({ id: null, name: 'jalon/164-x', path: '/w/j', branch: 'jalon/164-x', external: true, state: 'merged', mergedPullRequest: 9, unmergedCommits: false, modified: 0, untracked: 0 }),
      ],
      branches: [loose('feat/77-y', false)],
      branchesPending: false,
    },
    pullRequests: { available: true, fetchedAt: NOW, pullRequests: [{ number: 5, url: 'u5', title: 't', branch: 'feat/12-truc', base: 'main', state: 'ready', checks: { passed: 1, pending: 0, failed: [] }, review: null, updatedAt: NOW }] },
    cards,
    sessions,
    now: NOW,
  })

  assert.equal(data.base, 'main')
  assert.equal(data.forge, true)
  const [root, tree, jalon] = data.trees
  assert.equal(root!.root, true)
  assert.equal(root!.branch, 'feat/repointage')
  assert.equal(root!.uncommitted, 3)
  assert.equal(root!.sizeBytes, 2_000_000_000)
  assert.deepEqual(root!.sessions.map((entry) => entry.id), ['s-root'])

  assert.equal(tree!.verdict, 'waiting')
  assert.deepEqual(tree!.sessions.map((entry) => entry.id), ['s-new'])
  assert.equal(tree!.anySessionId, 's-new')
  assert.deepEqual(tree!.card, { id: 'k12', number: 12, title: 'Carte 12', milestone: { id: 'k164', number: 164, title: 'Carte 164' }, source: 'session' })
  assert.deepEqual(tree!.pr, { number: 5, url: 'u5', state: 'ready' })
  assert.equal(tree!.uncommitted, 3)
  assert.equal(tree!.lastUsedAt, NOW - DAY)
  assert.equal(tree!.sizeBytes, 450_000_000)

  assert.equal(jalon!.verdict, 'clean')
  assert.equal(jalon!.key, '/w/j')
  assert.deepEqual(jalon!.pr, { number: 9, url: null, state: 'merged' })
  assert.deepEqual(jalon!.card, { id: 'k164', number: 164, title: 'Carte 164', milestone: null, source: 'name' })
  assert.equal(jalon!.sizeBytes, null, 'pas encore mesuré')

  assert.deepEqual(data.branches, [loose('feat/77-y', false)])
})

test('assemblage : hors dépôt, ni racine ni arbres', () => {
  const data = codeDataOf({ project: { workspacePath: '/p', git: null }, statuses: undefined, pullRequests: undefined, cards: [], sessions: [], now: NOW })
  assert.deepEqual(data.trees, [])
  assert.equal(data.base, null)
  assert.equal(data.forge, false)
})

function loose(name: string, merged: boolean, extra: Partial<LooseBranchDto> = {}): LooseBranchDto {
  return {
    name, merged, remoteOnly: false, head: 'h', subject: null, lastCommitAt: null, ahead: null, behind: null, recentCommits: [],
    ...extra,
  }
}

test('branches sans arbre : PR, carte devinée, et ce que le serveur ne dit pas encore à null', () => {
  const infos = branchInfosOf({
    branches: [loose('feat/12-truc', false), loose('feat/old', true), loose('spike/z', false)],
    pullRequests: { available: true, fetchedAt: NOW, pullRequests: [{ number: 5, url: 'u5', title: 'Le titre', branch: 'feat/12-truc', base: 'main', state: 'draft', checks: { passed: 0, pending: 0, failed: [] }, review: null, updatedAt: NOW }] },
    cards: [card(12)],
  })
  assert.deepEqual(infos.map((entry) => [entry.name, entry.kind]), [['feat/12-truc', 'pr'], ['spike/z', 'unmerged'], ['feat/old', 'merged']])
  const first = infos[0]!
  assert.deepEqual(first.pr, { number: 5, url: 'u5', state: 'draft', title: 'Le titre' })
  assert.deepEqual(first.card, { id: 'k12', number: 12, title: 'Carte 12', milestone: null, source: 'name' })
  assert.equal(first.lastCommitAt, null)
  assert.equal(first.ahead, null)
  assert.equal(first.behind, null)
  assert.deepEqual(first.commits, [])
  assert.equal(first.remoteOnly, false)
  assert.equal(first.key, 'branche:feat/12-truc')
})

test('branches sans arbre : la date, l\'avance et les commits lus par le serveur ; distantes ; abandonnée après 14 jours', () => {
  const infos = branchInfosOf({
    branches: [
      loose('spike/vieille', false, { lastCommitAt: NOW - 20 * DAY, ahead: 2, behind: 7 }),
      loose('fix/distante', false, {
        remoteOnly: true, lastCommitAt: NOW - DAY, ahead: 1, behind: 0, subject: 'd',
        recentCommits: [{ hash: 'abc123', shortHash: 'abc', subject: 'd', ts: NOW - DAY }],
      }),
      loose('spike/recente', false, { lastCommitAt: NOW - DAY, ahead: 1, behind: 0 }),
    ],
    pullRequests: undefined,
    cards: [],
  })
  assert.deepEqual(infos.map((entry) => [entry.name, entry.kind]), [['spike/recente', 'unmerged'], ['spike/vieille', 'unmerged'], ['fix/distante', 'remote']])
  const remote = infos[2]!
  assert.deepEqual([remote.lastCommitAt, remote.ahead, remote.behind, remote.remoteOnly], [NOW - DAY, 1, 0, true])
  assert.deepEqual(remote.commits, [{ hash: 'abc123', shortHash: 'abc', title: 'd', at: NOW - DAY }])
  assert.deepEqual([...statesOfBranch(infos[1]!, NOW)], ['stale'])
  assert.deepEqual([...statesOfBranch(infos[0]!, NOW)], [])
})
