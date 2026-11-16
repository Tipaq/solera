import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { JournalEntryDto } from '@solera/protocol'
import type { BranchInfo, TreeFields, TreeRow } from '../../web/src/lib/code-model.js'
import type { TravailDisplay } from '../../web/src/lib/travail-model.js'

const { verdictOf, scopeOf } = await import('../../web/src/lib/code-model.js')
const { DEFAULT_DISPLAY } = await import('../../web/src/lib/travail-model.js')
const { LANE_ENTRIES, lanesOf, laneLayout, laneAnchor, spiedKey, shownEntries } = await import('../../web/src/lib/travail-lanes.js')

const DAY = 86_400_000
const HOUR = 3_600_000
const NOW = 1_800_000_000_000

const tree = (over: Partial<TreeFields> = {}): TreeRow => {
  const base: TreeFields = {
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
  }
  return { ...base, ...verdictOf(base, NOW) }
}
const root = (over: Partial<TreeFields> = {}) => tree({ key: 'root', root: true, id: null, name: 'main', branch: 'main', path: '/p', state: 'root', ...over })
const clean = (key: string, over: Partial<TreeFields> = {}) => tree({ key, path: key, id: key, branch: key.slice(3), state: 'merged', unmergedCommits: false, ...over })
const branch = (over: Partial<BranchInfo> = {}): BranchInfo => ({
  key: 'branche:x', name: 'x', kind: 'unmerged', merged: false, remoteOnly: false, lastCommitAt: NOW - DAY,
  ahead: 1, behind: 0, commits: [], pr: null, card: null, ...over,
})
const milestone = (number: number) => ({ id: `m${number}`, number, title: `Jalon ${number}` })
const card = (number: number, ms?: number) => ({ id: `k${number}`, number, title: `Carte ${number}`, source: 'session' as const, milestone: ms ? milestone(ms) : null })
const entry = (over: Partial<JournalEntryDto> = {}): JournalEntryDto => ({
  id: 'e1', kind: 'note', at: NOW - HOUR, title: 'Une note', projectId: 'p', cardNumber: null,
  source: null, count: null, status: null, conversationId: null, ...over,
})
const entry_ = (over: Partial<JournalEntryDto>) => entry(over)
const liveRow = (id: string, place: { root?: boolean; branch?: string | null; path?: string | null } = {}) => ({
  entry: { conversation: { id, agent: 'claude' as const } },
  group: 'running' as const,
  place: { root: place.root ?? false, branch: place.branch ?? null, path: place.path ?? null },
})
const conversation = (id: string, worktreeId: string | null, cardNumber: number | null = null) => ({ id, worktreeId, card: cardNumber === null ? null : { number: cardNumber } })
const scopes = (trees: TreeRow[], conversations: ReturnType<typeof conversation>[] = []) => new Map(trees.map((entry) => [entry.key, scopeOf(entry, conversations)]))
const display = (over: Partial<TravailDisplay> = {}): TravailDisplay => ({ ...DEFAULT_DISPLAY, ...over })

/* ------------------------------------------------------------------ T-4.2, T-4.4 les couloirs */

test('couloirs : chaque ligne du fil va à un seul arbre, un worktree avant la racine ; le reste au couloir Projet', () => {
  const r = root()
  const a = tree({ key: '/w/a', path: '/w/a', id: 'a', branch: 'feat/a' })
  const all = [r, a]
  const lanes = lanesOf({
    trees: all,
    live: [liveRow('s-a', { path: '/w/a' }), liveRow('s-root', { root: true })],
    entries: [
      entry({ id: 'by-session', conversationId: 's-a' }),
      // La carte 7 vit dans l'arbre `a` et à la racine : l'arbre de travail l'emporte.
      entry({ id: 'by-card', cardNumber: 7 }),
      entry({ id: 'root-only', conversationId: 's-root' }),
      entry({ id: 'loose', title: 'Jalon #3 livré' }),
    ],
    scopes: scopes(all, [conversation('s-a', 'a', 7), conversation('s-root', null, 7)]),
    now: NOW,
  })
  const byKey = new Map(lanes.active.map((lane) => [lane.tree.key, lane]))
  assert.deepEqual(byKey.get('/w/a')!.entries.map((item) => item.id), ['by-session', 'by-card'])
  assert.deepEqual(byKey.get('/w/a')!.live.map((row) => row.entry.conversation.id), ['s-a'])
  assert.deepEqual(byKey.get('root')!.entries.map((item) => item.id), ['root-only'])
  assert.deepEqual(byKey.get('root')!.live.map((row) => row.entry.conversation.id), ['s-root'])
  assert.deepEqual(lanes.loose.map((item) => item.id), ['loose'])
})

test('couloirs : ce qui t’attend d’abord, puis le plus récent ; vivant = maintenant ; les arbres à nettoyer à part', () => {
  const waiting = tree({ key: '/w/ask', path: '/w/ask', id: 'ask', lastUsedAt: NOW - 9 * DAY, sessions: [{ id: 's1', title: 's', agent: 'claude', tone: 'awaiting' }] })
  const old = tree({ key: '/w/old', path: '/w/old', id: 'old', branch: 'feat/old', lastUsedAt: NOW - 5 * DAY })
  // Un événement récent rajeunit un arbre au repos.
  const fresh = tree({ key: '/w/fresh', path: '/w/fresh', id: 'fresh', branch: 'feat/fresh', lastUsedAt: NOW - 8 * DAY })
  const live = tree({ key: '/w/live', path: '/w/live', id: 'live', branch: 'feat/live', lastUsedAt: NOW - 20 * DAY })
  const gone = tree({ key: '/w/gone', path: '/w/gone', id: 'gone', state: 'missing' })
  const merged = clean('/w/done')
  const all = [waiting, old, fresh, live, gone, merged]
  const lanes = lanesOf({
    trees: all,
    live: [liveRow('s-live', { path: '/w/live' })],
    entries: [entry({ id: 'f', title: 'Commit sur feat/fresh', at: NOW - HOUR })],
    scopes: scopes(all),
    now: NOW,
  })
  assert.deepEqual(lanes.active.map((lane) => lane.tree.key), ['/w/ask', '/w/live', '/w/fresh', '/w/old'])
  assert.deepEqual(lanes.cleanup.map((lane) => lane.tree.key), ['/w/gone', '/w/done'])
})

test('un couloir montre 3 événements, puis 20 au plus une fois déplié', () => {
  const many = Array.from({ length: 25 }, (_, index) => entry({ id: `e${index}` }))
  assert.equal(LANE_ENTRIES, 3)
  assert.equal(shownEntries(many, false).length, 3)
  assert.equal(shownEntries(many, true).length, 20)
  assert.equal(shownEntries(many.slice(0, 2), false).length, 2)
})

/* ------------------------------------------------------------------ T-4.1 la disposition */

const layoutOf = ({ fresh = false, ...over }: Partial<Parameters<typeof laneLayout>[0]> & { fresh?: boolean } = {}) => {
  const a = tree({ key: '/w/a', path: '/w/a', id: 'a', branch: 'feat/a', card: card(5, 2), sizeBytes: 10, lastUsedAt: NOW - 3 * DAY })
  const b = tree({ key: '/w/b', path: '/w/b', id: 'b', branch: 'feat/b', sizeBytes: 300, lastUsedAt: NOW - DAY })
  const c = tree({ key: '/w/c', path: '/w/c', id: 'c', branch: 'feat/c', card: card(6, 2), sizeBytes: null, lastUsedAt: NOW - 2 * DAY, sessions: [{ id: 's', title: 's', agent: 'claude', tone: 'awaiting' }] })
  const lanes = { active: [c, b, a].map((entry) => ({ tree: entry, live: [], entries: fresh && entry === a ? [entry_({ at: NOW - 10 * 60_000 })] : [] })), cleanup: [{ tree: clean('/w/done', { sizeBytes: 50 }), live: [], entries: [] }], loose: [entry()] }
  return laneLayout({
    lanes,
    branches: [
      branch({ key: 'branche:pr', name: 'pr', kind: 'pr', lastCommitAt: NOW - 4 * DAY, card: card(9, 2) }),
      branch({ key: 'branche:wip', name: 'wip', lastCommitAt: NOW - HOUR }),
      branch({ key: 'branche:old', name: 'old', kind: 'merged', merged: true }),
    ],
    display: display(),
    forced: false,
    targeted: false,
    now: NOW,
    ...over,
  })
}

test('sans regroupement : les arbres, puis les branches sans worktree ; fusionnées, à nettoyer et Projet à part', () => {
  const layout = layoutOf()
  assert.equal(layout.groups, null)
  assert.deepEqual(layout.trees.map((lane) => lane.tree.key), ['/w/c', '/w/b', '/w/a'])
  assert.deepEqual(layout.branches.map((entry) => entry.name), ['pr', 'wip'])
  assert.deepEqual(layout.cleanup?.lanes.map((lane) => lane.tree.key), ['/w/done'])
  assert.equal(layout.cleanup?.open, false)
  assert.deepEqual(layout.merged?.branches.map((entry) => entry.name), ['old'])
  assert.equal(layout.project?.length, 1)
  // L'index suit l'ordre de la vue, la ligne Projet en dernier.
  assert.deepEqual(layout.index.trees.map((entry) => entry.key), ['/w/c', '/w/b', '/w/a'])
  assert.deepEqual(layout.index.branches.map((entry) => entry.name), ['pr', 'wip'])
  assert.equal(layout.index.project, true)
})

test('tri « Récent » et « Taille » : les arbres, puis les branches par dernier commit ; une taille inconnue en dernier', () => {
  // `c` a une session : elle vit maintenant ; `a` vient d'avoir un événement.
  const recent = layoutOf({ display: display({ sort: 'recent' }), fresh: true })
  assert.deepEqual(recent.trees.map((lane) => lane.tree.key), ['/w/c', '/w/a', '/w/b'])
  assert.deepEqual(recent.branches.map((entry) => entry.name), ['wip', 'pr'])
  const size = layoutOf({ display: display({ sort: 'size' }) })
  assert.deepEqual(size.trees.map((lane) => lane.tree.key), ['/w/b', '/w/a', '/w/c'])
})

test('regroupement par jalon : « Jalon #n · titre », « Sans jalon » en dernier, arbres et branches mêlés', () => {
  const layout = layoutOf({ display: display({ group: 'milestone' }) })
  assert.deepEqual(
    layout.groups?.map((group) => [group.label, group.items.map((item) => (item.kind === 'tree' ? item.lane.tree.key : item.branch.name))]),
    [
      [{ kind: 'milestone', number: 2, title: 'Jalon 2' }, ['/w/c', '/w/a', 'pr']],
      [{ kind: 'noMilestone' }, ['/w/b', 'wip']],
    ],
  )
  // L'index suit les sections.
  assert.deepEqual(layout.index.trees.map((entry) => entry.key), ['/w/c', '/w/a', '/w/b'])
})

test('regroupement par état : les verdicts dans leur ordre, puis les genres de branche', () => {
  const layout = layoutOf({ display: display({ group: 'state' }) })
  assert.deepEqual(
    layout.groups?.map((group) => [group.label, group.items.map((item) => (item.kind === 'tree' ? item.lane.tree.key : item.branch.name))]),
    [
      [{ kind: 'verdict', verdict: 'waiting' }, ['/w/c']],
      [{ kind: 'verdict', verdict: 'wip' }, ['/w/b', '/w/a']],
      [{ kind: 'branch', branchKind: 'pr' }, ['pr']],
      [{ kind: 'branch', branchKind: 'unmerged' }, ['wip']],
    ],
  )
})

test('à nettoyer et fusionnées : cachées si l’affichage le dit, dépliées d’office quand le filtre les réclame', () => {
  const hidden = layoutOf({ display: display({ showCleanup: false, showMerged: false, showProject: false }) })
  assert.equal(hidden.cleanup, null)
  assert.equal(hidden.merged, null)
  assert.equal(hidden.project, null)
  assert.equal(hidden.index.project, false)
  const forced = layoutOf({ display: display({ showCleanup: false, showMerged: false }), forced: true })
  assert.equal(forced.cleanup?.open, true)
  assert.equal(forced.merged?.open, true)
  // Forcés, les arbres à nettoyer entrent dans l'index.
  assert.deepEqual(forced.index.trees.map((entry) => entry.key).slice(-1), ['/w/done'])
  // Un arbre choisi : pas de couloir Projet.
  assert.equal(layoutOf({ targeted: true }).project, null)
})

test('le bilan d’« À nettoyer » : la taille seulement quand tout est mesuré', () => {
  assert.deepEqual(layoutOf().cleanup?.summary, { count: 1, bytes: 50 })
})

/* ------------------------------------------------------------------ T-3.5 l'index qui fait défiler */

test('ancre d’un couloir : un identifiant HTML sûr, stable', () => {
  assert.equal(laneAnchor('/home/me/.worktrees/feat__12'), 'travail-_home_me__worktrees_feat__12')
  assert.equal(laneAnchor('branche:feat/x'), 'travail-branche_feat_x')
  assert.equal(laneAnchor('root'), 'travail-root')
})

test('scroll-spy : le dernier couloir dont le haut a passé la ligne de lecture, le premier sinon', () => {
  const tops = [
    { key: 'a', top: -400 },
    { key: 'b', top: -20 },
    { key: 'c', top: 300 },
  ]
  assert.equal(spiedKey(tops, 80), 'b')
  assert.equal(spiedKey(tops.map((entry) => ({ ...entry, top: entry.top + 1000 })), 80), 'a')
  assert.equal(spiedKey([], 80), null)
})
