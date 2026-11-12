import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cardNumberOfBranch, type CardDto, type LooseBranchDto, type ProjectPullRequestDto, type WorktreeStatusDto } from '@solera/protocol'
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
  lineGestures,
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

/* ------------------------------------------------------------------ A-4.7 */

test('gestes d’une ligne : la session, le diff, la PR, le rebase, le nettoyage, dans cet ordre', () => {
  const kinds = (over: Partial<TreeFields>) => lineGestures(row(over)).map((gesture) => gesture.kind)
  assert.deepEqual(kinds({ sessions: [session('running')], pr: pr('checks'), behind: 3 }), ['session', 'diff', 'pr', 'rebase'])
  assert.deepEqual(kinds({ pr: pr('merged'), sessions: [session('running')] }), ['session', 'diff', 'pr', 'clean'])
  assert.deepEqual(kinds({}), ['launch', 'diff', 'clean'])
})

test('gestes : répondre à la session qui attend, ouvrir sinon, lancer ici sans session', () => {
  const first = (over: Partial<TreeFields>) => lineGestures(row(over))[0]
  assert.deepEqual(first({ sessions: [session('running'), session('awaiting')] }), { kind: 'session', sessionId: 's-awaiting', reply: true })
  assert.deepEqual(first({ sessions: [session('broken')] }), { kind: 'session', sessionId: 's-broken', reply: false })
  assert.deepEqual(first({ sessions: [session('running')] }), { kind: 'session', sessionId: 's-running', reply: false })
  // Une session close se rouvre : rien ne tourne, mais l'arbre a son fil.
  assert.deepEqual(first({ anySessionId: 'old' }), { kind: 'session', sessionId: 'old', reply: false })
  assert.deepEqual(first({ id: 'w9' }), { kind: 'launch', treeId: 'w9' })
})

test('gestes de la racine : sa session et son diff, rien d’autre', () => {
  const root = { root: true, state: 'root' as const, id: null, behind: 4, pr: pr('ready') }
  assert.deepEqual(lineGestures(row(root)).map((gesture) => gesture.kind), ['diff'])
  assert.deepEqual(lineGestures(row({ ...root, anySessionId: 'r1' })).map((gesture) => gesture.kind), ['session', 'diff'])
})

test('gestes : le diff compte les fichiers non commités', () => {
  const diff = lineGestures(row({ uncommitted: 4 })).find((gesture) => gesture.kind === 'diff')
  assert.deepEqual(diff, { kind: 'diff', count: 4 })
})

test('gestes : la PR se fusionne prête, montre sa CI rouge, s’ouvre sinon', () => {
  const prOf = (state: ProjectPullRequestDto['state']) => lineGestures(row({ pr: pr(state, 12) })).find((gesture) => gesture.kind === 'pr')
  assert.deepEqual(prOf('ready'), { kind: 'pr', action: 'merge', number: 12, url: 'https://forge/pr/12' })
  assert.deepEqual(prOf('failing'), { kind: 'pr', action: 'ci', number: 12, url: 'https://forge/pr/12' })
  assert.deepEqual(prOf('draft'), { kind: 'pr', action: 'open', number: 12, url: 'https://forge/pr/12' })
  assert.deepEqual(prOf('checks'), { kind: 'pr', action: 'open', number: 12, url: 'https://forge/pr/12' })
  // Une PR fusionnée que seul le statut de l'arbre connaît n'a pas d'adresse : pas de geste.
  const known = lineGestures(row({ pr: { number: 3, url: null, state: 'merged' } }))
  assert.equal(known.some((gesture) => gesture.kind === 'pr'), false)
})

test('gestes : rebaser seulement en retard, et sur un arbre que Solera sait atteindre', () => {
  const rebase = (over: Partial<TreeFields>) => lineGestures(row(over)).find((gesture) => gesture.kind === 'rebase')
  assert.deepEqual(rebase({ behind: 5 }), { kind: 'rebase', behind: 5 })
  assert.equal(rebase({ behind: 0 }), undefined)
  // Créé au shell, sans session : ni identifiant ni session à qui demander.
  assert.equal(rebase({ behind: 5, id: null }), undefined)
  assert.deepEqual(rebase({ behind: 5, id: null, sessions: [session('running')] }), { kind: 'rebase', behind: 5 })
})

test('gestes : nettoyer un arbre fusionné ou sans session, connu de Solera', () => {
  const cleans = (over: Partial<TreeFields>) => lineGestures(row(over)).some((gesture) => gesture.kind === 'clean')
  assert.equal(cleans({}), true)
  assert.equal(cleans({ sessions: [session('running')] }), false)
  assert.equal(cleans({ sessions: [session('awaiting')], pr: pr('merged') }), true)
  assert.equal(cleans({ id: null }), false)
  // Un arbre créé au shell, sans session : ni diff ni nettoyage, seulement rien.
  assert.deepEqual(lineGestures(row({ id: null })).map((gesture) => gesture.kind), [])
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

test('nom court, numéro de carte du nom', () => {
  assert.equal(shortBranch('feat/12-truc'), '12-truc')
  assert.equal(shortBranch('jalon/164-page'), '164-page')
  assert.equal(shortBranch('main'), 'main')
  assert.equal(cardNumberOfBranch('feat/153-titre'), 153)
  assert.equal(cardNumberOfBranch('jalon/164-page-projet'), 164)
  // `cardBranchName` d'une carte au titre vide.
  assert.equal(cardNumberOfBranch('feat/153'), 153)
  assert.equal(cardNumberOfBranch('spike/terminal-wasm'), null)
  assert.equal(cardNumberOfBranch('fix/2fa-login'), null)
  assert.equal(cardNumberOfBranch('153-titre'), null)
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
  head: 'abc', lastCommitAt: NOW - 3 * DAY, lastEditAt: NOW - 2 * DAY, conversations: [], sizeBytes: null, card: null, cardSource: null, ...over,
})

const card = (number: number, over: Partial<CardDto> = {}): CardDto =>
  ({ id: `k${number}`, number, title: `Carte ${number}`, parent: null, children: [], column: 'in_progress', ...over }) as CardDto

test('assemblage : la racine sur sa vraie branche, les arbres jugés, les tailles mesurées, rien de simulé', () => {
  const cards = [card(164), card(12, { parent: { id: 'k164', number: 164, title: 'Carte 164', column: 'in_progress' } }), card(30)]
  const sessions: CodeSession[] = [
    { id: 's-root', title: 'r', agent: 'claude', worktreeId: null, tone: 'running', at: NOW - 1000 },
    { id: 's-old', title: 'o', agent: 'codex', worktreeId: 'w1', tone: null, at: NOW - 5 * DAY },
    { id: 's-new', title: 'n', agent: 'claude', worktreeId: 'w1', tone: 'awaiting', at: NOW - DAY },
  ]
  const data = codeDataOf({
    project: { workspacePath: '/p', git: { branch: 'feat/repointage', changedFiles: 3 } },
    statuses: {
      base: 'main', computedAt: NOW, fresh: true, rootSizeBytes: 2_000_000_000, sizesPending: true,
      worktrees: [
        // Le serveur a tranché : la carte de l'arbre est celle de sa session.
        status({ sizeBytes: 450_000_000, card: { id: 'k12', number: 12 }, cardSource: 'session' }),
        status({ id: null, name: 'jalon/164-x', path: '/w/j', branch: 'jalon/164-x', external: true, state: 'merged', mergedPullRequest: 9, unmergedCommits: false, modified: 0, untracked: 0, card: { id: 'k164', number: 164 }, cardSource: 'name' }),
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

test("assemblage : la carte d'un arbre est celle du serveur, rien n'est deviné du nom", () => {
  const data = codeDataOf({
    project: { workspacePath: '/p', git: null },
    statuses: {
      base: 'main', computedAt: NOW, fresh: true,
      worktrees: [
        status({ id: 'w1', path: '/w/a', branch: 'feat/12-truc', card: null, cardSource: null }),
        status({ id: 'w2', path: '/w/b', branch: 'feat/x', card: { id: 'k30', number: 30 }, cardSource: 'created' }),
        // Une carte que la liste du client ne connaît pas (encore) : rien plutôt qu'une carte vide.
        status({ id: 'w3', path: '/w/c', branch: 'feat/y', card: { id: 'k99', number: 99 }, cardSource: 'session' }),
      ],
      branches: [],
      branchesPending: false,
    },
    pullRequests: undefined,
    cards: [card(12), card(30)],
    sessions: [{ id: 's', title: 's', agent: 'claude', worktreeId: 'w1', tone: null, at: NOW }],
    now: NOW,
  })
  const byKey = new Map(data.trees.map((tree) => [tree.key, tree.card]))
  assert.equal(byKey.get('/w/a'), null)
  assert.deepEqual(byKey.get('/w/b'), { id: 'k30', number: 30, title: 'Carte 30', milestone: null, source: 'created' })
  assert.equal(byKey.get('/w/c'), null)
})

test('assemblage : hors dépôt, ni racine ni arbres', () => {
  const data = codeDataOf({ project: { workspacePath: '/p', git: null }, statuses: undefined, pullRequests: undefined, cards: [], sessions: [], now: NOW })
  assert.deepEqual(data.trees, [])
  assert.equal(data.base, null)
  assert.equal(data.forge, false)
})

function loose(name: string, merged: boolean, extra: Partial<LooseBranchDto> = {}): LooseBranchDto {
  return {
    name, merged, remoteOnly: false, head: 'h', subject: null, lastCommitAt: null, ahead: null, behind: null, recentCommits: [], card: null, cardSource: null,
    ...extra,
  }
}

test('branches sans arbre : PR, carte du serveur, et ce que le serveur ne dit pas encore à null', () => {
  const infos = branchInfosOf({
    branches: [
      loose('feat/12-truc', false, { card: { id: 'k12', number: 12 }, cardSource: 'name' }),
      loose('feat/old', true, { card: { id: 'k30', number: 30 }, cardSource: 'created' }),
      loose('spike/z', false),
    ],
    pullRequests: { available: true, fetchedAt: NOW, pullRequests: [{ number: 5, url: 'u5', title: 'Le titre', branch: 'feat/12-truc', base: 'main', state: 'draft', checks: { passed: 0, pending: 0, failed: [] }, review: null, updatedAt: NOW }] },
    cards: [card(12), card(30)],
  })
  assert.deepEqual(infos.map((entry) => [entry.name, entry.kind]), [['feat/12-truc', 'pr'], ['spike/z', 'unmerged'], ['feat/old', 'merged']])
  assert.equal(infos[1]!.card, null)
  assert.equal(infos[2]!.card?.source, 'created')
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
