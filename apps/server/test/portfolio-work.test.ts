import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { JournalEntryDto } from '@solera/protocol'
import type { BranchInfo, TreeFields, TreeRow } from '../../web/src/lib/code-model.js'

const { verdictOf } = await import('../../web/src/lib/code-model.js')
const { workLayout, readWorkFilters, workEvents, inboxInProjects, NO_WORK_FILTERS } = await import('../../web/src/lib/portfolio-work.js')

/*
 * Travail du portefeuille (#238, `coque.md` PF-14 à PF-21) : les arbres de tous les
 * projets, filtrés par projet, par état et par la recherche ; les fusionnés repliés ; un
 * « Nettoyer » par projet ; le fil de tous les projets.
 */

const NOW = 1_800_000_000_000
const DAY = 86_400_000

const project = (id: string, name = id) => ({ id, name })

const tree = (over: Partial<TreeFields> = {}): TreeRow => {
  const base: TreeFields = {
    key: '/w/feat',
    root: false,
    id: 'w1',
    name: 'feat',
    branch: 'feat',
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
    sizeBytes: 1_000,
    lastUsedAt: NOW - DAY,
    ...over,
  }
  return { ...base, ...verdictOf(base, NOW) }
}

const root = (over: Partial<TreeFields> = {}) => tree({ key: 'root', root: true, id: null, name: 'main', branch: 'main', state: 'root', ...over })
const merged = (key: string, over: Partial<TreeFields> = {}) => tree({ key, id: key, branch: key, path: key, state: 'merged', unmergedCommits: false, ...over })
const waiting = [{ id: 's', title: 's', agent: 'claude' as const, tone: 'awaiting' as const }]
const running = [{ id: 's', title: 's', agent: 'claude' as const, tone: 'running' as const }]

const branch = (name: string, over: Partial<BranchInfo> = {}): BranchInfo => ({
  key: `branche:${name}`,
  name,
  kind: 'unmerged',
  merged: false,
  remoteOnly: false,
  lastCommitAt: NOW - DAY,
  ahead: 1,
  behind: 0,
  commits: [],
  pr: null,
  card: null,
  ...over,
})

const reasonOf = (row: TreeRow) => row.reason.id

const layout = (over: Partial<Parameters<typeof workLayout>[0]> = {}) =>
  workLayout({
    projects: [
      {
        project: project('a', 'Atelier'),
        base: 'main',
        trees: [root(), tree({ key: 'wip', branch: 'feat/12-export', card: { id: 'c', number: 12, title: 'Export PDF', milestone: null, source: 'branch' } }), merged('vieux')],
        branches: [branch('orpheline'), branch('fini', { kind: 'merged', merged: true })],
      },
      {
        project: project('b', 'Vitrine'),
        base: 'main',
        trees: [root(), tree({ key: 'attend', branch: 'fix/attend', sessions: waiting }), tree({ key: 'tourne', branch: 'feat/tourne', sessions: running })],
        branches: [],
      },
    ],
    filters: NO_WORK_FILTERS,
    query: '',
    showMerged: false,
    reasonOf,
    ...over,
  })

/* ------------------------------------------------------------------ PF-14 */

test('le compte de chaque projet dans Filtrer : ses worktrees, sans la racine', () => {
  const { counts } = layout()
  assert.deepEqual([...counts], [['a', 2], ['b', 2]])
})

test('la méta : les arbres des projets filtrés et leur place, sans taille si une manque', () => {
  assert.deepEqual(layout().summary, { count: 4, bytes: 6_000 })
  assert.deepEqual(layout({ filters: { projects: ['b'], states: [] } }).summary, { count: 2, bytes: 3_000 })
  const unmeasured = layout({ projects: [{ project: project('a'), base: 'main', trees: [root({ sizeBytes: null }), tree()], branches: [] }] })
  assert.deepEqual(unmeasured.summary, { count: 1, bytes: null })
})

test('le filtre Projet ne garde que les groupes et les lignes des projets cochés', () => {
  const { groups, trees } = layout({ filters: { projects: ['b'], states: [] } })
  assert.deepEqual(groups.map((group) => group.project.id), ['b'])
  assert.ok(trees.every((row) => row.project.id === 'b'))
})

test('le filtre État : T’attend, Travaille, et À nettoyer qui montre aussi les fusionnés', () => {
  const keys = (filters: { projects: string[]; states: ('waiting' | 'active' | 'review' | 'clean')[] }) =>
    layout({ filters }).trees.map((row) => `${row.project.id}:${row.key}`)
  assert.deepEqual(keys({ projects: [], states: ['waiting'] }), ['b:attend'])
  assert.deepEqual(keys({ projects: [], states: ['waiting', 'active'] }), ['b:attend', 'b:tourne'])
  // « À nettoyer » réclame les fusionnés : ils ne sont plus repliés.
  const cleanup = layout({ filters: { projects: [], states: ['clean'] } })
  assert.deepEqual(cleanup.trees.map((row) => row.key), ['vieux'])
  assert.deepEqual(cleanup.folded, [])
})

test('la recherche : la branche, la raison, la carte et son numéro, le nom du projet', () => {
  const keys = (query: string) => layout({ query }).trees.map((row) => `${row.project.id}:${row.key}`)
  assert.deepEqual(keys('export'), ['a:wip'])
  assert.deepEqual(keys('#12'), ['a:wip'])
  assert.deepEqual(keys('pdf'), ['a:wip'])
  assert.deepEqual(keys('VITRINE'), ['b:root', 'b:attend', 'b:tourne'])
  assert.deepEqual(keys('waiting'), ['b:attend'])
})

/* ------------------------------------------------------------------ PF-15, PF-17 */

test('les fusionnés se replient sous leur projet, sauf « Montrer les fusionnés »', () => {
  const folded = layout()
  const atelier = folded.groups.find((group) => group.project.id === 'a')!
  assert.deepEqual(atelier.trees.map((row) => row.key), ['root', 'wip'])
  assert.deepEqual(atelier.folded.map((row) => row.key), ['vieux'])
  assert.equal(atelier.count, 1)
  assert.deepEqual(folded.folded.map((row) => row.key), ['vieux'])

  const shown = layout({ showMerged: true })
  assert.deepEqual(shown.groups.find((group) => group.project.id === 'a')!.trees.map((row) => row.key), ['root', 'wip', 'vieux'])
  assert.deepEqual(shown.folded, [])
})

test('« N branches sans arbre » : celles qui ne sont pas fusionnées', () => {
  const atelier = layout().groups.find((group) => group.project.id === 'a')!
  assert.equal(atelier.branches, 1)
})

test('un projet dont rien ne passe les filtres n’a pas de groupe', () => {
  assert.deepEqual(layout({ query: 'export' }).groups.map((group) => group.project.id), ['a'])
})

/* ------------------------------------------------------------------ PF-20 */

test('« Nettoyer » se propose par projet : ses arbres fusionnés et ses branches fusionnées locales', () => {
  const { offers, cleanCount } = layout()
  assert.deepEqual(
    offers.map((offer) => ({ project: offer.project.id, base: offer.base, trees: offer.request.trees.map((row) => row.key), branches: offer.request.branches })),
    [{ project: 'a', base: 'main', trees: ['vieux'], branches: ['fini'] }],
  )
  assert.equal(cleanCount, 2)
})

test('« Nettoyer » suit le filtre Projet, pas la recherche ni l’état', () => {
  assert.deepEqual(layout({ filters: { projects: ['b'], states: [] } }).offers, [])
  assert.equal(layout({ query: 'tourne', filters: { projects: [], states: ['waiting'] } }).cleanCount, 2)
})

/* ------------------------------------------------------------------ PF-16, PF-19 */

const entry = (projectId: string, title: string, at = NOW): JournalEntryDto =>
  ({ id: `${projectId}-${title}`, kind: 'note', at, title, projectId, cardNumber: null, source: null }) as JournalEntryDto

test('Par moment : les événements des projets connus et cochés, que la recherche garde', () => {
  const projects = new Map([
    ['a', project('a', 'Atelier')],
    ['b', project('b', 'Vitrine')],
  ])
  const entries = [entry('a', 'Export livré'), entry('b', 'Bannière'), entry('archivé', 'Ancien')]
  const titles = (selected: string[], query: string) => workEvents(entries, { projects, selected, query }).map((row) => row.title)
  assert.deepEqual(titles([], ''), ['Export livré', 'Bannière'])
  assert.deepEqual(titles(['b'], ''), ['Bannière'])
  assert.deepEqual(titles([], 'atelier'), ['Export livré'])
})

test('« Ce qui t’attend » suit le filtre Projet ; ce qui n’a pas de projet reste', () => {
  const items = [{ projectId: 'a' }, { projectId: 'b' }, { projectId: null }, {}]
  assert.deepEqual(inboxInProjects(items, []), items)
  assert.deepEqual(inboxInProjects(items, ['b']), [{ projectId: 'b' }, { projectId: null }, {}])
})

/* ------------------------------------------------------------------ mémoire */

test('les filtres retenus : ce qui n’a plus cours est écarté', () => {
  assert.deepEqual(readWorkFilters(null), NO_WORK_FILTERS)
  assert.deepEqual(readWorkFilters('pas du json'), NO_WORK_FILTERS)
  assert.deepEqual(readWorkFilters(JSON.stringify({ projects: ['a', 3], states: ['waiting', 'inconnu'] })), { projects: ['a'], states: ['waiting'] })
})
