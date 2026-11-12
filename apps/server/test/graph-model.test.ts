import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GraphNodeDto, GraphRefDto } from '@solera/protocol'
import type { BranchInfo, TreeFields, TreeRow } from '../../web/src/lib/code-model.js'

const { verdictOf } = await import('../../web/src/lib/code-model.js')
const {
  knownBranches,
  knownOfNode,
  knownKey,
  knownName,
  isMergedKnown,
  withoutMergedRefs,
  isDimmed,
  commitHome,
  linkedSessions,
  sessionStateOf,
} = await import('../../web/src/lib/graph-model.js')

/*
 * La vue « Graphe » de Travail (carte #178, `projet.md` T-7) : ce que Solera sait des
 * branches du graphe, la mise en retrait hors de la cible, les étiquettes des fusionnées,
 * et les sessions du tiroir d'un commit.
 */

const NOW = 1_800_000_000_000
const DAY = 86_400_000

const fields = (over: Partial<TreeFields> = {}): TreeFields => ({
  key: '/w/feat',
  root: false,
  id: 'w1',
  name: 'feat-12',
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
const ref = (name: string, kind: GraphRefDto['kind'] = 'local'): GraphRefDto => ({ name, kind })
const node = (over: Partial<GraphNodeDto> = {}): GraphNodeDto => ({
  kind: 'commit', hash: 'h1', shortHash: 'h1', subject: 's', author: 'Tim', agent: null, ts: NOW, parents: [],
  refs: [], thread: null, lane: 0, through: [], joins: [], collapses: [], tip: false, root: false, run: 0,
  aboveRun: 0, throughRuns: [], joinRuns: [], collapseRuns: [], working: null, ...over,
})

/* ------------------------------------------------------------------ les branches connues */

test('branches connues : un arbre l’emporte sur la branche du même nom', () => {
  const feat = tree()
  const known = knownBranches([feat], [branch({ key: 'branche:feat/12-truc', name: 'feat/12-truc' }), branch({ key: 'branche:fix/9', name: 'fix/9' })])
  assert.equal(known.get('feat/12-truc')?.kind, 'tree')
  assert.equal(known.get('fix/9')?.kind, 'branch')
  // Un arbre sans branche (HEAD détachée) ne se range sous aucun nom.
  assert.equal(knownBranches([tree({ branch: null })], []).size, 0)
})

test('une rangée : ses branches connues, locale et distante confondues, étiquettes et tags ignorés', () => {
  const feat = tree()
  const known = knownBranches([feat], [branch({ key: 'branche:fix/9', name: 'fix/9' })])
  const entries = knownOfNode(
    node({ refs: [ref('HEAD', 'head'), ref('feat/12-truc', 'worktree'), ref('origin/feat/12-truc', 'remote'), ref('v1.0', 'tag'), ref('origin/fix/9', 'remote')] }),
    known,
  )
  assert.deepEqual(entries.map(knownName), ['feat/12-truc', 'fix/9'])
  assert.deepEqual(entries.map(knownKey), ['/w/feat', 'branche:fix/9'])
  // Une branche que Solera ne connaît pas ne donne rien.
  assert.deepEqual(knownOfNode(node({ refs: [ref('origin/inconnue', 'remote')] }), known), [])
})

test('fusionnée : un arbre fusionné ou propre, une branche fusionnée', () => {
  assert.equal(isMergedKnown({ kind: 'tree', tree: tree({ state: 'merged', unmergedCommits: false }) }), true)
  assert.equal(isMergedKnown({ kind: 'tree', tree: tree() }), false)
  assert.equal(isMergedKnown({ kind: 'branch', branch: branch({ merged: true, kind: 'merged' }) }), true)
  assert.equal(isMergedKnown({ kind: 'branch', branch: branch() }), false)
})

test('T-7.4 : les fusionnées perdent leurs étiquettes, leurs commits restent', () => {
  const known = knownBranches([], [branch({ key: 'branche:old', name: 'old', merged: true, kind: 'merged' }), branch({ key: 'branche:live', name: 'live' })])
  const nodes = [
    node({ hash: 'a', refs: [ref('old'), ref('origin/old', 'remote'), ref('main'), ref('v2', 'tag')] }),
    node({ hash: 'b', refs: [ref('live')] }),
    node({ hash: 'c' }),
  ]
  const out = withoutMergedRefs(nodes, known)
  assert.deepEqual(out.map((entry) => entry.hash), ['a', 'b', 'c'])
  assert.deepEqual(out[0]!.refs.map((entry) => entry.name), ['main', 'v2'])
  assert.deepEqual(out[1]!.refs.map((entry) => entry.name), ['live'])
  // Rien à retirer : la rangée est rendue telle quelle.
  assert.equal(out[1], nodes[1])
})

/* ------------------------------------------------------------------ T-7.3 la mise en retrait */

test('T-7.3 : hors cible, une rangée s’estompe ; sur la course ou la tête de la cible, non', () => {
  const runs = ['main', 'feat/12-truc', 'origin/fix/9', null]
  assert.equal(isDimmed(node({ run: 0 }), runs, null), false, 'sans cible, rien ne s’estompe')
  assert.equal(isDimmed(node({ run: 1 }), runs, 'feat/12-truc'), false)
  assert.equal(isDimmed(node({ run: 0 }), runs, 'feat/12-truc'), true)
  // La course nommée par sa distante est celle de la branche.
  assert.equal(isDimmed(node({ run: 2 }), runs, 'fix/9'), false)
  // Une course sans nom, mais la tête de la cible sur la rangée.
  assert.equal(isDimmed(node({ run: 3, refs: [ref('origin/feat/12-truc', 'remote')] }), runs, 'feat/12-truc'), false)
  assert.equal(isDimmed(node({ run: 3 }), runs, 'feat/12-truc'), true)
  // Un préfixe de plus n'est pas un remote : `a/feat/12-truc` n'est pas la cible.
  assert.equal(isDimmed(node({ run: 0 }), ['team/a/feat/12-truc'], 'feat/12-truc'), true)
})

/* ------------------------------------------------------------------ le tiroir d'un commit */

test('l’endroit d’un commit : la course d’abord, puis les branches qui le contiennent', () => {
  const feat = tree()
  const known = knownBranches([feat], [branch({ key: 'branche:fix/9', name: 'fix/9' })])
  assert.equal(knownKey(commitHome(['feat/12-truc', 'fix/9'], known)!), '/w/feat')
  assert.equal(knownKey(commitHome([null, 'origin/fix/9'], known)!), 'branche:fix/9')
  // Un arbre l'emporte sur une branche sans arbre plus haut dans la liste.
  assert.equal(knownKey(commitHome(['fix/9', 'origin/feat/12-truc'], known)!), '/w/feat')
  assert.equal(commitHome(['main'], known), null)
})

test('T-7.7 : celle qui l’a écrit, puis l’arbre, puis la carte, sans doublon', () => {
  const sessions = linkedSessions({
    turn: null,
    thread: { id: 's1', title: 'Écrit', sure: true },
    candidates: [],
    tree: [{ id: 's2', at: 10 }, { id: 's1', at: 30 }, { id: 's3', at: 20 }],
    card: [{ id: 's3', at: 20 }, { id: 's4', at: 5 }],
  })
  assert.deepEqual(sessions.map((entry) => [entry.id, entry.provenance]), [
    ['s1', 'sure'],
    ['s3', 'branch'],
    ['s2', 'branch'],
    ['s4', 'card'],
  ])
  assert.equal(sessions[0]!.title, 'Écrit')
})

test('T-7.7 : le tour remplace le fil ; sans lui, le fil déduit des dates, puis les candidats', () => {
  const turn = { conversationId: 's9', title: 'Le tour', turn: 4, message: 'Corrige le test', key: 'k' }
  const withTurn = linkedSessions({ turn, thread: { id: 's1', title: 'Fil', sure: false }, candidates: [], tree: [], card: [] })
  // Un seul « a écrit ce commit » : le fil n'est qu'un repli du tour.
  assert.deepEqual(withTurn.map((entry) => [entry.id, entry.provenance]), [['s9', 'turn']])
  assert.deepEqual(withTurn[0]!.turn, { number: 4, message: 'Corrige le test' })

  const guessed = linkedSessions({ turn: null, thread: { id: 's1', title: 'Fil', sure: false }, candidates: [], tree: [], card: [] })
  assert.deepEqual(guessed.map((entry) => entry.provenance), ['dates'])

  const candidates = linkedSessions({
    turn: null,
    thread: null,
    candidates: [{ id: 'a', title: 'A', sure: false }, { id: 'b', title: 'B', sure: false }],
    tree: [{ id: 'b', at: 1 }],
    card: [],
  })
  assert.deepEqual(candidates.map((entry) => [entry.id, entry.provenance]), [['a', 'dates'], ['b', 'dates']])
  assert.deepEqual(linkedSessions({ turn: null, thread: null, candidates: [], tree: [], card: [] }), [])
})

test('T-7.7 : l’état d’une session en cinq mots', () => {
  assert.equal(sessionStateOf('awaiting_input'), 'waiting')
  assert.equal(sessionStateOf('error'), 'error')
  assert.equal(sessionStateOf('interrupted'), 'error')
  assert.equal(sessionStateOf('running'), 'working')
  assert.equal(sessionStateOf('idle'), 'done')
  assert.equal(sessionStateOf(null), 'unknown')
})
