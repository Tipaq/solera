import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorktreeCleanupPlanDto } from '@solera/protocol'
import type { BranchInfo, TreeFields, TreeRow } from '../../web/src/lib/code-model.js'

const { verdictOf } = await import('../../web/src/lib/code-model.js')
const { cleanOffer, cleanSummary } = await import('../../web/src/lib/travail-clean.js')

const DAY = 86_400_000
const NOW = 1_800_000_000_000
const MB = 1024 * 1024

const tree = (over: Partial<TreeFields> = {}): TreeRow => {
  const base: TreeFields = {
    key: '/w/feat',
    root: false,
    id: 'w1',
    name: 'feat',
    branch: 'feat/12-truc',
    path: '/w/feat',
    external: false,
    state: 'merged',
    sessions: [],
    anySessionId: null,
    card: null,
    pr: null,
    ahead: 0,
    behind: 0,
    uncommitted: 0,
    conflicts: false,
    unmergedCommits: false,
    sizeBytes: 10 * MB,
    lastUsedAt: NOW - DAY,
    ...over,
  }
  return { ...base, ...verdictOf(base, NOW) }
}
const at = (path: string, over: Partial<TreeFields> = {}) => tree({ key: path, path, id: path, branch: `feat${path}`, ...over })
const branch = (name: string, over: Partial<BranchInfo> = {}): BranchInfo => ({
  key: `branche:${name}`, name, kind: 'merged', merged: true, remoteOnly: false, lastCommitAt: NOW - DAY,
  ahead: 0, behind: 3, commits: [], pr: null, card: null, ...over,
})
const plan = (path: string, over: Partial<WorktreeCleanupPlanDto> = {}): WorktreeCleanupPlanDto => ({
  path, name: path.slice(3), branch: `feat${path}`, state: 'merged', modified: 0, untracked: 0, ahead: 0,
  unmergedCommits: false, branchDeletable: true, conversations: [], busy: [], restarted: [], services: [], terminals: 0, card: null, ...over,
})
const plansOf = (...list: WorktreeCleanupPlanDto[]) => (path: string) => list.find((entry) => entry.path === path)

/* ------------------------------------------------------------------ T-1.5 ce que « Nettoyer · N » propose */

test('« Nettoyer · N » : les arbres fusionnés que Solera connaît et les branches fusionnées locales, comptés ensemble', () => {
  const offer = cleanOffer(
    [
      tree({ key: 'root', root: true, id: null, state: 'root', path: '/p' }),
      at('/w/a'),
      // Créé au shell : Solera n'a pas de quoi le retirer.
      at('/w/shell', { id: null, external: true }),
      // Du travail non fusionné : pas à nettoyer.
      at('/w/wip', { state: 'unmerged', unmergedCommits: true, ahead: 2 }),
      // Fusionné mais sale : ne se nettoie pas sans perte, il ne part pas d'office.
      at('/w/dirty', { uncommitted: 3 }),
    ],
    [branch('old'), branch('far', { remoteOnly: true }), branch('open', { kind: 'pr', merged: false })],
  )
  assert.deepEqual(offer.trees.map((entry) => entry.key), ['/w/a'])
  assert.deepEqual(offer.branches, ['old'])
  assert.equal(offer.count, 2)
})

test('« Nettoyer · N » : rien à proposer, compte nul', () => {
  assert.equal(cleanOffer([at('/w/wip', { state: 'unmerged', unmergedCommits: true })], []).count, 0)
})

/* ------------------------------------------------------------------ T-12 le dialogue, adossé aux plans */

test('dialogue : tout coché, ce qui part, ce qui se libère, rien ne se perd', () => {
  const trees = [at('/w/a'), at('/w/b', { sizeBytes: 30 * MB })]
  const summary = cleanSummary({
    trees,
    branches: ['old'],
    withTrees: true,
    withBranches: true,
    plans: plansOf(
      plan('/w/a', { conversations: [{ id: 's1', title: 'Une session' }], services: [{ id: 'v', label: 'vite', kind: 'app' }], terminals: 1 }),
      plan('/w/b', { card: { id: 'k', number: 12, title: 'Carte' } }),
    ),
  })
  assert.equal(summary.ready, true)
  assert.deepEqual(summary.removed.map((entry) => entry.key), ['/w/a', '/w/b'])
  assert.deepEqual(summary.jobs, [
    { path: '/w/a', deleteBranch: true, stopServices: true },
    { path: '/w/b', deleteBranch: true, stopServices: true },
  ])
  assert.deepEqual(summary.branches, ['old'])
  assert.equal(summary.count, 3)
  assert.equal(summary.bytes, 40 * MB)
  assert.deepEqual(summary.losing, [])
  assert.deepEqual(summary.archived.map((entry) => entry.title), ['Une session'])
  assert.deepEqual(summary.services, ['vite'])
  assert.equal(summary.terminals, 1)
  assert.deepEqual(summary.cards.map((entry) => entry.number), [12])
})

test('dialogue : tant qu’un plan manque, rien n’est prêt', () => {
  const summary = cleanSummary({ trees: [at('/w/a'), at('/w/b')], branches: [], withTrees: true, withBranches: true, plans: plansOf(plan('/w/a')) })
  assert.equal(summary.ready, false)
})

test('dialogue : décocher une section la retire du compte et de la place libérée', () => {
  const trees = [at('/w/a')]
  const plans = plansOf(plan('/w/a'))
  const noTrees = cleanSummary({ trees, branches: ['old'], withTrees: false, withBranches: true, plans: () => undefined })
  assert.equal(noTrees.ready, true, 'les plans ne comptent plus quand les arbres sont décochés')
  assert.deepEqual(noTrees.removed, [])
  assert.equal(noTrees.count, 1)
  assert.equal(noTrees.bytes, 0)
  const noBranches = cleanSummary({ trees, branches: ['old'], withTrees: true, withBranches: false, plans })
  assert.deepEqual(noBranches.branches, [])
  assert.equal(noBranches.count, 1)
  const nothing = cleanSummary({ trees, branches: ['old'], withTrees: false, withBranches: false, plans })
  assert.equal(nothing.count, 0)
})

test('dialogue : du non commité se perdrait, et le plan le dit plutôt que la ligne', () => {
  // La ligne ne voit rien ; le plan, relu à l'ouverture, voit deux fichiers.
  const summary = cleanSummary({
    trees: [at('/w/a'), at('/w/b')],
    branches: [],
    withTrees: true,
    withBranches: true,
    plans: plansOf(plan('/w/a', { modified: 1, untracked: 1 }), plan('/w/b', { state: 'unreadable' })),
  })
  assert.deepEqual(summary.losing, ['feat/w/a', 'feat/w/b'], 'un arbre illisible ne promet pas que rien ne se perd')
})

test('dialogue : une branche qui a des commits que la base n’a pas reste, et se dit gardée', () => {
  const summary = cleanSummary({
    trees: [at('/w/a', { state: 'unmerged', unmergedCommits: true, ahead: 2 })],
    branches: [],
    withTrees: true,
    withBranches: true,
    plans: plansOf(plan('/w/a', { unmergedCommits: true, ahead: 2 })),
  })
  assert.deepEqual(summary.jobs, [{ path: '/w/a', deleteBranch: false, stopServices: true }])
  assert.deepEqual(summary.keptBranches, ['feat/w/a'])
  assert.deepEqual(summary.losing, [])
})

test('dialogue : la branche de base ne part jamais avec son arbre', () => {
  const summary = cleanSummary({ trees: [at('/w/a')], branches: [], withTrees: true, withBranches: true, plans: plansOf(plan('/w/a', { branchDeletable: false })) })
  assert.deepEqual(summary.jobs, [{ path: '/w/a', deleteBranch: false, stopServices: true }])
  assert.deepEqual(summary.keptBranches, [])
})

test('dialogue : un arbre où une session travaille attend, et ne compte pas', () => {
  const summary = cleanSummary({
    trees: [at('/w/a'), at('/w/b', { sizeBytes: 30 * MB })],
    branches: [],
    withTrees: true,
    withBranches: true,
    plans: plansOf(plan('/w/a', { busy: [{ id: 's', title: 'Au travail' }] }), plan('/w/b')),
  })
  assert.deepEqual(summary.removed.map((entry) => entry.key), ['/w/b'])
  assert.deepEqual(summary.held.map((entry) => entry.tree.key), ['/w/a'])
  assert.deepEqual(summary.held[0]!.busy, ['Au travail'])
  assert.equal(summary.count, 1)
  assert.equal(summary.bytes, 30 * MB)
})

test('dialogue : une taille pas encore mesurée ne se somme pas', () => {
  const summary = cleanSummary({ trees: [at('/w/a'), at('/w/b', { sizeBytes: null })], branches: [], withTrees: true, withBranches: true, plans: plansOf(plan('/w/a'), plan('/w/b')) })
  assert.equal(summary.bytes, null)
})

test('dialogue : une carte rattachée à deux arbres ne se propose qu’une fois', () => {
  const card = { id: 'k', number: 12, title: 'Carte' }
  const summary = cleanSummary({ trees: [at('/w/a'), at('/w/b')], branches: [], withTrees: true, withBranches: true, plans: plansOf(plan('/w/a', { card }), plan('/w/b', { card })) })
  assert.deepEqual(summary.cards.map((entry) => entry.number), [12])
})
