import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardDto, JournalEntryDto } from '@solera/protocol'
import type { BranchInfo, TreeFields, TreeRow } from '../../web/src/lib/code-model.js'
import type { TravailFilters } from '../../web/src/lib/travail-model.js'

const { verdictOf, scopeOf } = await import('../../web/src/lib/code-model.js')
const { parseActivityFilter } = await import('../../web/src/lib/activity-groups.js')
const {
  NO_FILTERS,
  DEFAULT_DISPLAY,
  readFilters,
  readDisplay,
  periodStart,
  filterCount,
  targetOf,
  treePasses,
  branchPasses,
  rowPasses,
  entryPasses,
  entryMatches,
  inboxPasses,
  milestoneOptions,
  agentOptions,
  cardMilestones,
  clustersOf,
  indexTrees,
  treeSummary,
  legacyTravailQuery,
} = await import('../../web/src/lib/travail-model.js')

const DAY = 86_400_000
const HOUR = 3_600_000
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
const tree = (over: Partial<TreeFields> = {}): TreeRow => {
  const base = fields(over)
  return { ...base, ...verdictOf(base, NOW) }
}
const branch = (over: Partial<BranchInfo> = {}): BranchInfo => ({
  key: 'branche:x', name: 'x', kind: 'unmerged', merged: false, remoteOnly: false, lastCommitAt: NOW - DAY,
  ahead: 1, behind: 0, commits: [], pr: null, card: null, ...over,
})
const filters = (over: Partial<TravailFilters> = {}): TravailFilters => ({ ...NO_FILTERS, ...over })
const milestone = (number: number) => ({ id: `m${number}`, number, title: `Jalon ${number}` })
const card = (number: number, extra: { milestone?: number } = {}) => ({
  id: `k${number}`, number, title: `Carte ${number}`, source: 'session' as const,
  milestone: extra.milestone ? milestone(extra.milestone) : null,
})

const liveRow = (over: { id?: string; group?: 'asking' | 'review' | 'running' | 'done'; agent?: 'claude' | 'codex'; root?: boolean; branch?: string | null; path?: string | null } = {}) => ({
  entry: { conversation: { id: over.id ?? 'c1', agent: over.agent ?? 'claude' } },
  group: over.group ?? 'running',
  place: { root: over.root ?? false, branch: over.branch ?? null, path: over.path ?? null },
})

const entry = (over: Partial<JournalEntryDto> = {}): JournalEntryDto => ({
  id: 'e1', kind: 'note', at: NOW - HOUR, title: 'Une note', projectId: 'p', cardNumber: null,
  source: null, count: null, status: null, conversationId: null, ...over,
})

/* ------------------------------------------------------------------ réglages retenus */

test('filtres retenus : relus tels quels, une valeur inconnue écartée', () => {
  assert.deepEqual(readFilters(null), NO_FILTERS)
  assert.deepEqual(readFilters('pas du json'), NO_FILTERS)
  assert.deepEqual(
    readFilters(JSON.stringify({ what: ['trees', 'n/a'], states: ['waiting', 'x'], milestones: [12, 'a'], agents: ['codex', 'inconnu'], period: '7' })),
    { what: ['trees'], states: ['waiting'], milestones: [12], agents: ['codex'], period: '7' },
  )
  assert.equal(readFilters(JSON.stringify({ period: '90' })).period, null)
})

test('affichage retenu : les défauts de T-1.9, complétés de ce qui est retenu', () => {
  assert.deepEqual(DEFAULT_DISPLAY, { index: true, group: 'none', sort: 'waiting', showMerged: true, showCleanup: true, showProject: true })
  assert.deepEqual(readDisplay(JSON.stringify({ index: false, group: 'milestone', sort: 'n/a' })), { ...DEFAULT_DISPLAY, index: false, group: 'milestone' })
  assert.deepEqual(readDisplay('{'), DEFAULT_DISPLAY)
})

/* ------------------------------------------------------------------ période, compte */

test('période : minuit local pour aujourd’hui, N jours sinon, rien pour tout', () => {
  const midnight = new Date(NOW)
  midnight.setHours(0, 0, 0, 0)
  assert.equal(periodStart('today', NOW), midnight.getTime())
  assert.equal(periodStart('7', NOW), NOW - 7 * DAY)
  assert.equal(periodStart('30', NOW), NOW - 30 * DAY)
  assert.equal(periodStart(null, NOW), null)
})

test('compte des filtres : une puce par valeur, l’arbre choisi compris', () => {
  assert.equal(filterCount(NO_FILTERS, false), 0)
  assert.equal(filterCount(filters({ what: ['trees', 'events'], states: ['waiting'], period: 'today' }), false), 4)
  assert.equal(filterCount(filters({ milestones: [3], agents: ['codex'] }), true), 3)
})

/* ------------------------------------------------------------------ la cible */

test('cible : un arbre par sa clé, une branche par la sienne, rien d’inconnu', () => {
  const trees = [tree({ key: 'root', root: true, state: 'root', id: null, branch: 'main' }), tree()]
  const branches = [branch({ key: 'branche:x' })]
  const scopes = new Map(trees.map((entry) => [entry.key, scopeOf(entry, [])]))
  assert.equal(targetOf('/w/feat', trees, branches, scopes)?.kind, 'tree')
  assert.equal(targetOf('branche:x', trees, branches, scopes)?.kind, 'branch')
  assert.equal(targetOf('/disparu', trees, branches, scopes), null)
  assert.equal(targetOf(null, trees, branches, scopes), null)
})

/* ------------------------------------------------------------------ arbres et branches */

test('arbre : Quoi, État, Jalon, Agent, et la cible qui l’emporte', () => {
  const waiting = tree({ sessions: [{ id: 's', title: 's', agent: 'codex', tone: 'awaiting' }], card: card(5, { milestone: 3 }) })
  assert.equal(treePasses(waiting, NO_FILTERS, null), true)
  assert.equal(treePasses(waiting, filters({ what: ['sessions'] }), null), false)
  assert.equal(treePasses(waiting, filters({ what: ['trees'] }), null), true)
  assert.equal(treePasses(waiting, filters({ states: ['waiting', 'merged'] }), null), true)
  assert.equal(treePasses(waiting, filters({ states: ['merged'] }), null), false)
  assert.equal(treePasses(waiting, filters({ milestones: [3] }), null), true)
  assert.equal(treePasses(waiting, filters({ milestones: [4] }), null), false)
  assert.equal(treePasses(waiting, filters({ agents: ['codex'] }), null), true)
  assert.equal(treePasses(waiting, filters({ agents: ['claude'] }), null), false)

  const other = tree({ key: '/w/autre', id: 'w2' })
  const target = { kind: 'tree' as const, tree: waiting, scope: scopeOf(waiting, []) }
  assert.equal(treePasses(waiting, filters({ what: ['events'] }), target), true)
  assert.equal(treePasses(other, NO_FILTERS, target), false)
  assert.equal(treePasses(waiting, NO_FILTERS, { kind: 'branch', branch: branch() }), false)
})

test('branche : un filtre d’agent l’écarte, son jalon par sa carte', () => {
  assert.equal(branchPasses(branch(), NO_FILTERS, null, NOW), true)
  assert.equal(branchPasses(branch(), filters({ agents: ['claude'] }), null, NOW), false)
  assert.equal(branchPasses(branch({ card: card(9, { milestone: 3 }) }), filters({ milestones: [3] }), null, NOW), true)
  assert.equal(branchPasses(branch({ kind: 'merged', merged: true }), filters({ states: ['cleanup'] }), null, NOW), true)
  assert.equal(branchPasses(branch(), filters({ what: ['trees'] }), null, NOW), false)
  assert.equal(branchPasses(branch(), NO_FILTERS, { kind: 'branch', branch: branch() }, NOW), true)
  assert.equal(branchPasses(branch({ key: 'branche:y', name: 'y' }), NO_FILTERS, { kind: 'branch', branch: branch() }, NOW), false)
})

/* ------------------------------------------------------------------ le vivant */

test('session vivante : Quoi, État, Jalon, Agent, arbre choisi ; aucune sur une branche', () => {
  const row = liveRow({ id: 'c-tree', group: 'asking', agent: 'codex' })
  assert.equal(rowPasses(row, NO_FILTERS, null, null), true)
  assert.equal(rowPasses(row, filters({ what: ['events'] }), null, null), false)
  assert.equal(rowPasses(row, filters({ states: ['waiting'] }), null, null), true)
  assert.equal(rowPasses(row, filters({ states: ['working'] }), null, null), false)
  assert.equal(rowPasses(row, filters({ milestones: [3] }), null, 3), true)
  assert.equal(rowPasses(row, filters({ milestones: [3] }), null, null), false)
  assert.equal(rowPasses(row, filters({ agents: ['claude'] }), null, null), false)

  const mine = tree({ id: 'w1' })
  const target = { kind: 'tree' as const, tree: mine, scope: scopeOf(mine, [{ id: 'c-tree', worktreeId: 'w1', card: null }]) }
  assert.equal(rowPasses(row, NO_FILTERS, target, null), true)
  assert.equal(rowPasses(liveRow({ id: 'ailleurs', root: true }), NO_FILTERS, target, null), false)
  assert.equal(rowPasses(row, NO_FILTERS, { kind: 'branch', branch: branch() }, null), false)
})

test('demande : sur un arbre par session ou carte ; celles d’un jalon tombent avec un arbre ou un agent', () => {
  const ask = { kind: 'session' as const, conversationId: 'c-tree', cardNumber: null, agent: 'claude' as const, milestone: null }
  const refine = { kind: 'refine' as const, milestone: { number: 3 } }
  assert.equal(inboxPasses(ask, NO_FILTERS, null), true)
  assert.equal(inboxPasses(ask, filters({ what: ['trees'] }), null), false)
  assert.equal(inboxPasses(ask, filters({ states: ['working'] }), null), false)
  assert.equal(inboxPasses(ask, filters({ states: ['waiting'] }), null), true)
  assert.equal(inboxPasses(refine, filters({ milestones: [3] }), null), true)
  assert.equal(inboxPasses(refine, filters({ agents: ['claude'] }), null), false)
  assert.equal(inboxPasses(ask, filters({ agents: ['claude'] }), null), true)

  const mine = tree({ id: 'w1' })
  const target = { kind: 'tree' as const, tree: mine, scope: scopeOf(mine, [{ id: 'c-tree', worktreeId: 'w1', card: null }]) }
  assert.equal(inboxPasses(ask, NO_FILTERS, target), true)
  assert.equal(inboxPasses(refine, NO_FILTERS, target), false)
  assert.equal(inboxPasses(ask, NO_FILTERS, { kind: 'branch', branch: branch() }), false)
})

/* ------------------------------------------------------------------ l'historique */

test('événement : période, jalon, agent, état de son arbre, arbre ou branche choisis', () => {
  const facts = { milestone: null, agent: null, tree: null, from: null }
  const note = entry()
  assert.equal(entryPasses(note, NO_FILTERS, null, facts), true)
  assert.equal(entryPasses(note, filters({ what: ['sessions'] }), null, facts), false)
  assert.equal(entryPasses(note, filters({ what: ['events'] }), null, facts), true)
  assert.equal(entryPasses(note, NO_FILTERS, null, { ...facts, from: NOW - 30 * 60_000 }), false)
  assert.equal(entryPasses(note, filters({ milestones: [3] }), null, { ...facts, milestone: 3 }), true)
  assert.equal(entryPasses(note, filters({ milestones: [3] }), null, facts), false)
  assert.equal(entryPasses(note, filters({ agents: ['codex'] }), null, { ...facts, agent: 'codex' }), true)
  assert.equal(entryPasses(note, filters({ agents: ['codex'] }), null, facts), false)
  // Un événement suit l'état de l'arbre qui le porte ; sans arbre, aucun état ne le garde.
  const waiting = tree({ sessions: [{ id: 's', title: 's', agent: 'claude', tone: 'awaiting' }] })
  assert.equal(entryPasses(note, filters({ states: ['waiting'] }), null, { ...facts, tree: waiting }), true)
  assert.equal(entryPasses(note, filters({ states: ['waiting'] }), null, facts), false)

  const mine = tree({ id: 'w1', branch: 'feat/12-truc' })
  const target = { kind: 'tree' as const, tree: mine, scope: scopeOf(mine, []) }
  assert.equal(entryPasses(entry({ title: 'feat/12-truc fusionnée' }), NO_FILTERS, target, facts), true)
  assert.equal(entryPasses(note, NO_FILTERS, target, facts), false)
  const onBranch = { kind: 'branch' as const, branch: branch({ name: 'fix/x' }) }
  assert.equal(entryPasses(entry({ title: 'fix/x poussée' }), NO_FILTERS, onBranch, facts), true)
  assert.equal(entryPasses(note, NO_FILTERS, onBranch, facts), false)
})

test('recherche dans l’historique : tous les mots, #n, la source', () => {
  const merge = entry({ title: 'feat/12-truc fusionnée dans main', cardNumber: 12, source: 'Codex' })
  assert.equal(entryMatches(parseActivityFilter(''), merge), true)
  assert.equal(entryMatches(parseActivityFilter('truc main'), merge), true)
  assert.equal(entryMatches(parseActivityFilter('truc absent'), merge), false)
  assert.equal(entryMatches(parseActivityFilter('#12'), merge), true)
  assert.equal(entryMatches(parseActivityFilter('#13'), merge), false)
  assert.equal(entryMatches(parseActivityFilter('codex'), merge), true)
})

/* ------------------------------------------------------------------ jalons et agents du menu */

const cardDto = (over: Partial<CardDto>): CardDto => ({
  id: `k${over.number}`, projectId: 'p', number: 1, title: 't', description: '', column: 'todo', position: 0, dueAt: null,
  parent: null, milestone: false, children: [], branch: null, branchPr: null, acceptedAt: 1, toClarifySince: null,
  createdBy: 'u', createdByName: 'u', createdAt: 0, updatedAt: 0, ...over,
} as CardDto)

test('jalons du menu : ceux des arbres et des branches, puis les cartes ouvertes qui ont des enfants', () => {
  const cards = [
    cardDto({ number: 3, title: 'Trois', milestone: true, children: [{ id: 'k4', number: 4, title: 'q' }, { id: 'k5', number: 5, title: 'c' }] }),
    cardDto({ number: 4, column: 'done', parent: { id: 'k3', number: 3, title: 'Trois' } }),
    cardDto({ number: 5, parent: { id: 'k3', number: 3, title: 'Trois' } }),
    cardDto({ number: 8, title: 'Huit fermé', column: 'done', children: [{ id: 'k9', number: 9, title: 'n' }] }),
    cardDto({ number: 10, title: 'Idée', milestone: true }),
  ]
  const options = milestoneOptions([tree({ card: card(5, { milestone: 3 }) })], [branch({ card: card(7, { milestone: 6 }) })], cards)
  assert.deepEqual(options, [
    { number: 3, title: 'Jalon 3', progress: { done: 1, total: 2 } },
    { number: 6, title: 'Jalon 6', progress: null },
  ])
  assert.deepEqual(milestoneOptions([], [], cards).map((option) => option.number), [3])
})

test('agents du menu : ceux des arbres et des sessions vivantes, une fois chacun', () => {
  const trees = [tree({ sessions: [{ id: 's', title: 's', agent: 'codex', tone: 'running' }] })]
  assert.deepEqual(agentOptions(trees, [liveRow({ agent: 'claude' }), liveRow({ agent: 'codex' })]), ['codex', 'claude'])
})

test('jalon d’une carte : sa parente ; une carte-jalon se reconnaît', () => {
  const cards = [
    cardDto({ number: 3, title: 'Trois', milestone: true, children: [{ id: 'k5', number: 5, title: 'c' }] }),
    cardDto({ number: 5, parent: { id: 'k3', number: 3, title: 'Trois' } }),
  ]
  const index = cardMilestones(cards)
  assert.deepEqual(index.ofCard(5), { number: 3, title: 'Trois' })
  assert.equal(index.ofCard(3), null)
  assert.equal(index.ofCard(null), null)
  assert.equal(index.isMilestone(3), true)
  assert.equal(index.isMilestone(5), false)
  assert.equal(index.isMilestone(null), false)
})

/* ------------------------------------------------------------------ T-5.5 le regroupement */

test('regroupement : voisins d’une même session ou carte à moins de 3 h ; l’ordre ne bouge pas', () => {
  const a = entry({ id: 'a', at: NOW, conversationId: 'c1' })
  const b = entry({ id: 'b', at: NOW - 2 * HOUR, conversationId: 'c1' })
  const c = entry({ id: 'c', at: NOW - 6 * HOUR, conversationId: 'c1' })
  const d = entry({ id: 'd', at: NOW - 6.5 * HOUR, cardNumber: 4 })
  const e = entry({ id: 'e', at: NOW - 7 * HOUR, cardNumber: 4 })
  const f = entry({ id: 'f', at: NOW - 7.2 * HOUR })
  const g = entry({ id: 'g', at: NOW - 7.3 * HOUR })
  const clusters = clustersOf([a, b, c, d, e, f, g])
  assert.deepEqual(clusters.map((cluster) => cluster.entries.map((item) => item.id)), [['a', 'b'], ['c'], ['d', 'e'], ['f'], ['g']])
  assert.deepEqual(clusters[2]?.subject, { kind: 'card', number: 4 })
  assert.deepEqual(clusters[0]?.subject, { kind: 'session', source: null })
})

/* ------------------------------------------------------------------ T-3 l'index */

test('index : les arbres actifs, ce qui t’attend d’abord, puis le vivant, puis le plus récent ; à nettoyer si forcés', () => {
  const root = tree({ key: 'root', root: true, state: 'root', id: null, branch: 'main', lastUsedAt: NOW - 5 * DAY })
  const old = tree({ key: '/w/old', id: 'w2', lastUsedAt: NOW - 3 * DAY })
  const recent = tree({ key: '/w/new', id: 'w3', lastUsedAt: NOW - HOUR })
  const waiting = tree({ key: '/w/ask', id: 'w4', lastUsedAt: NOW - 4 * DAY, sessions: [{ id: 's', title: 's', agent: 'claude', tone: 'awaiting' }] })
  const clean = tree({ key: '/w/clean', id: 'w5', state: 'merged', ahead: 0, unmergedCommits: false })
  const gone = tree({ key: '/w/gone', id: 'w6', state: 'missing' })
  // Une session vivante vaut « maintenant » : l'arbre passe avant le plus récent.
  const busy = tree({ key: '/w/busy', id: 'w7', lastUsedAt: NOW - 6 * DAY, sessions: [{ id: 'r', title: 'r', agent: 'claude', tone: 'running' }] })
  const all = [root, old, recent, waiting, clean, gone, busy]
  assert.deepEqual(indexTrees(all, false).map((entry) => entry.key), ['/w/ask', '/w/busy', '/w/new', '/w/old', 'root'])
  assert.deepEqual(indexTrees(all, true).map((entry) => entry.key), ['/w/ask', '/w/busy', '/w/new', '/w/old', 'root', '/w/clean', '/w/gone'])
})

/* ------------------------------------------------------------------ T-1.4 le bilan */

test('bilan : les worktrees sans la racine ; la taille seulement quand tout est mesuré', () => {
  const root = tree({ key: 'root', root: true, state: 'root', id: null, sizeBytes: 100 })
  assert.deepEqual(treeSummary([root, tree({ sizeBytes: 50 }), tree({ key: '/b', sizeBytes: 25 })]), { count: 2, bytes: 175 })
  assert.deepEqual(treeSummary([root, tree({ sizeBytes: null })]), { count: 1, bytes: null })
  assert.deepEqual(treeSummary([]), { count: 0, bytes: null })
})

/* ------------------------------------------------------------------ les anciennes adresses */

test('anciennes adresses : Activité par worktree → Par arbre, Journal → Par moment, le reste gardé', () => {
  assert.equal(legacyTravailQuery('activity', ''), '')
  assert.equal(legacyTravailQuery('activity', '?groupe=worktree'), 'vue=couloirs')
  assert.equal(legacyTravailQuery('activity', '?groupe=state&q=1'), 'q=1')
  assert.equal(legacyTravailQuery('journal', ''), 'vue=fil')
  assert.equal(legacyTravailQuery('journal', '?carte=4'), 'carte=4&vue=fil')
})
