import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TreeFields, TreeRow } from '../../web/src/lib/code-model.js'

const { verdictOf } = await import('../../web/src/lib/code-model.js')
const { treeGestures, primaryGesture, treeSessionId, HEAVY_BYTES, isHeavy } = await import('../../web/src/lib/tree-actions.js')

const DAY = 86_400_000
const NOW = 1_800_000_000_000

const tree = (over: Partial<TreeFields> = {}): TreeRow => {
  const base: TreeFields = {
    key: '/w/feat',
    root: false,
    id: 'w1',
    name: 'feat',
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
const session = (id: string, tone: 'running' | 'awaiting' | 'broken' = 'running') => ({ id, title: id, agent: 'claude' as const, tone })
const pr = (state: 'draft' | 'checks' | 'failing' | 'ready' | 'merged', url: string | null = 'https://forge/pr/4') => ({ number: 4, url, state })

/* ------------------------------------------------------------------ T-13.1 les gestes d'un arbre */

test('gestes : dans l’ordre, session, diff, PR, rebaser, fusionner (PR prête), nettoyer', () => {
  const keys = treeGestures(tree({ pr: pr('ready') })).map((gesture) => gesture.key)
  assert.deepEqual(keys, ['session', 'diff', 'pr', 'rebase', 'merge', 'clean'])
})

test('gestes : une PR qui n’est pas prête ne se fusionne pas ; sans lien, elle ne s’ouvre pas', () => {
  assert.deepEqual(treeGestures(tree({ pr: pr('checks') })).map((gesture) => gesture.key), ['session', 'diff', 'pr', 'rebase', 'clean'])
  assert.deepEqual(treeGestures(tree({ pr: pr('merged', null), state: 'merged' })).map((gesture) => gesture.key), ['session', 'diff', 'rebase', 'clean'])
})

test('gestes : la racine n’a que sa session et son diff', () => {
  const root = tree({ key: 'root', root: true, id: null, state: 'root', pr: pr('ready') })
  assert.deepEqual(treeGestures(root).map((gesture) => gesture.key), ['session', 'diff'])
})

test('gestes : un arbre créé au shell, sans session, ne se diffe ni ne se rebase, et son nettoyage est éteint', () => {
  const gestures = treeGestures(tree({ id: null, external: true }))
  assert.deepEqual(gestures.map((gesture) => gesture.key), ['session', 'clean'])
  assert.equal(gestures.find((gesture) => gesture.key === 'clean')!.disabled, true)
})

test('gestes : la session à rouvrir — celle qui t’attend, sinon la première vivante, sinon la plus récente', () => {
  assert.equal(treeSessionId(tree({ sessions: [session('a'), session('b', 'awaiting')], anySessionId: 'z' })), 'b')
  assert.equal(treeSessionId(tree({ sessions: [session('a')], anySessionId: 'z' })), 'a')
  assert.equal(treeSessionId(tree({ anySessionId: 'z' })), 'z')
  assert.equal(treeSessionId(tree()), null)
  assert.equal(treeGestures(tree()).find((gesture) => gesture.key === 'session')!.launch, true)
  assert.equal(treeGestures(tree({ anySessionId: 'z' })).find((gesture) => gesture.key === 'session')!.launch, false)
})

/* ------------------------------------------------------------------ T-6.2 le geste principal d'une ligne */

test('geste principal : répondre à qui attend, nettoyer un fusionné, relire une PR ouverte, sinon rien', () => {
  assert.equal(primaryGesture(tree({ sessions: [session('a', 'awaiting')] })), 'reply')
  assert.equal(primaryGesture(tree({ state: 'merged', unmergedCommits: false, ahead: 0 })), 'clean')
  assert.equal(primaryGesture(tree({ state: 'merged', unmergedCommits: false, ahead: 0, id: null })), null, 'un arbre du shell ne se nettoie pas d’ici')
  assert.equal(primaryGesture(tree({ pr: pr('checks') })), 'review')
  assert.equal(primaryGesture(tree({ pr: pr('checks', null) })), null)
  assert.equal(primaryGesture(tree()), null)
})

/* ------------------------------------------------------------------ T-6.2 la colonne Disque */

test('disque : l’encre forte au-delà de 400 Mo', () => {
  assert.equal(HEAVY_BYTES, 400 * 1024 * 1024)
  assert.equal(isHeavy(tree({ sizeBytes: HEAVY_BYTES })), true)
  assert.equal(isHeavy(tree({ sizeBytes: HEAVY_BYTES - 1 })), false)
  assert.equal(isHeavy(tree({ sizeBytes: null })), false)
})
