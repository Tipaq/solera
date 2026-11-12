import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardDto, CardLinkDto, JournalEntryDto, ProjectDto } from '@solera/protocol'
import type { TreeFields, TreeRow } from '../../web/src/lib/code-model.js'

const { verdictOf } = await import('../../web/src/lib/code-model.js')
const { projectSummaries, activeTrees, recentEvents } = await import('../../web/src/lib/portfolio-overview.js')

/*
 * L'Aperçu du portefeuille (#237, `coque.md` PF-8 à PF-13) : ce que chaque projet
 * résume dans sa carte, les arbres du code en cours de tous les projets, et les derniers
 * événements, chacun avec son projet.
 */

const NOW = 1_800_000_000_000
const DAY = 86_400_000

const project = (id: string, name = id): ProjectDto => ({ id, name, image: null, color: null, archivedAt: null }) as ProjectDto

const link = (card: Pick<CardDto, 'id' | 'number' | 'title' | 'column'>): CardLinkDto => ({
  id: card.id,
  number: card.number,
  title: card.title,
  column: card.column,
})

const card = (projectId: string, number: number, extra: Partial<CardDto> = {}): CardDto =>
  ({
    id: `${projectId}-${number}`,
    projectId,
    number,
    title: `carte ${number}`,
    column: 'todo',
    dueAt: null,
    parent: null,
    milestone: false,
    children: [],
    branch: null,
    branchPr: null,
    refinement: null,
    acceptedAt: NOW - 10 * DAY,
    toClarifySince: null,
    createdAt: NOW - 10 * DAY,
    conversations: [],
    blocks: [],
    blockedBy: [],
    ...extra,
  }) as CardDto

/** Un jalon et ses enfants, rattachés dans les deux sens. */
function milestone(projectId: string, number: number, kids: CardDto[], extra: Partial<CardDto> = {}): CardDto[] {
  const parent = card(projectId, number, { milestone: true, ...extra })
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

const event = (projectId: string, at: number, id = `${projectId}-${at}`): JournalEntryDto =>
  ({ id, kind: 'note', at, title: id, projectId, cardNumber: null, source: null }) as JournalEntryDto

/* ------------------------------------------------------------------ PF-10 */

test('une carte par projet : ce qui attend, les sessions vivantes, les cartes ouvertes, le dernier événement', () => {
  const [summary] = projectSummaries({
    projects: [project('a')],
    cards: [
      card('a', 1),
      card('a', 2, { column: 'in_progress' }),
      card('a', 3, { column: 'done' }),
      card('a', 4, { column: 'abandoned' }),
      card('b', 5),
    ],
    sessions: [
      { projectId: 'a', tone: 'awaiting' },
      { projectId: 'a', tone: 'broken' },
      { projectId: 'a', tone: 'running' },
      { projectId: 'a', tone: null },
      { projectId: 'b', tone: 'awaiting' },
    ],
    events: [event('a', NOW - 3 * DAY), event('a', NOW - DAY), event('b', NOW)],
  })
  assert.equal(summary?.waiting, 2, 'en attente ou en erreur : les deux te réclament')
  assert.equal(summary?.live, 3, 'une session au repos ne compte pas')
  assert.equal(summary?.open, 2, 'ni les faites ni les abandonnées, ni les cartes d’un autre projet')
  assert.equal(summary?.lastAt, NOW - DAY)
})

test('une parente ne compte pas dans les cartes ouvertes : ses enfants portent le travail', () => {
  const [summary] = projectSummaries({
    projects: [project('a')],
    cards: milestone('a', 1, [card('a', 2), card('a', 3)]),
    sessions: [],
    events: [],
  })
  assert.equal(summary?.open, 2)
})

test('le jalon en cours : le premier non livré du phare, avec son avancement et son échéance', () => {
  const due = NOW + 5 * DAY
  const done = card('a', 11, { column: 'done' })
  const cards = [
    // Livré : toutes ses enfants sont faites.
    ...milestone('a', 1, [card('a', 2, { column: 'done' })], { column: 'done' }),
    ...milestone('a', 10, [done, card('a', 12), card('a', 13, { column: 'abandoned' })], { dueAt: due }),
  ]
  const [summary] = projectSummaries({ projects: [project('a')], cards, sessions: [], events: [] })
  assert.deepEqual(summary?.milestone, { number: 10, title: 'carte 10', done: 1, total: 2, dueAt: due })
})

test('sans jalon ouvert, la carte le dit', () => {
  const [summary] = projectSummaries({ projects: [project('a')], cards: [card('a', 1)], sessions: [], events: [] })
  assert.equal(summary?.milestone, null)
  assert.equal(summary?.lastAt, null)
})

test('l’ordre des cartes : ce qui attend, puis ce qui tourne, puis l’activité, puis le nom', () => {
  const order = projectSummaries({
    projects: [project('calme', 'Calme'), project('vieux', 'Vieux'), project('tourne'), project('attend'), project('aube', 'Aube')],
    cards: [],
    sessions: [
      { projectId: 'tourne', tone: 'running' },
      { projectId: 'tourne', tone: 'running' },
      { projectId: 'attend', tone: 'awaiting' },
    ],
    events: [event('vieux', NOW - 9 * DAY), event('calme', NOW - DAY)],
  }).map((entry) => entry.project.id)
  assert.deepEqual(order, ['attend', 'tourne', 'calme', 'vieux', 'aube'])
})

/* ------------------------------------------------------------------ PF-11 */

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
    sizeBytes: null,
    lastUsedAt: NOW - DAY,
    ...over,
  }
  return { ...base, ...verdictOf(base, NOW) }
}

test('le code en cours : la racine si elle a du non commité ou une session, et les arbres vivants', () => {
  const running = [{ id: 's', title: 's', agent: 'claude' as const, tone: 'running' as const }]
  const rows = activeTrees([
    {
      project: project('a'),
      trees: [
        tree({ key: 'root', root: true, state: 'root', uncommitted: 0 }),
        tree({ key: 'wip' }),
        tree({ key: 'merged', state: 'merged', unmergedCommits: false }),
        tree({ key: 'empty', state: 'empty', unmergedCommits: false }),
        tree({ key: 'missing', state: 'missing' }),
        // Fusionné, mais une session y vit encore : il reste.
        tree({ key: 'merged-busy', state: 'merged', unmergedCommits: false, sessions: running }),
      ],
    },
    { project: project('b'), trees: [tree({ key: 'root', root: true, state: 'root', uncommitted: 2 })] },
    { project: project('c'), trees: [tree({ key: 'root', root: true, state: 'root', sessions: running })] },
  ])
  assert.deepEqual(
    rows.map((row) => `${row.project.id}:${row.key}`).sort(),
    ['a:merged-busy', 'a:wip', 'b:root', 'c:root'],
  )
})

test('le code en cours de tous les projets : ce qui tourne d’abord, puis le plus récent', () => {
  const running = [{ id: 's', title: 's', agent: 'claude' as const, tone: 'running' as const }]
  const rows = activeTrees([
    { project: project('a'), trees: [tree({ key: 'vieux', lastUsedAt: NOW - 5 * DAY }), tree({ key: 'frais', lastUsedAt: NOW - DAY })] },
    { project: project('b'), trees: [tree({ key: 'occupé', lastUsedAt: NOW - 9 * DAY, sessions: running })] },
  ])
  assert.deepEqual(rows.map((row) => row.key), ['occupé', 'frais', 'vieux'])
})

/* ------------------------------------------------------------------ PF-12 */

test('les derniers événements : un projet inconnu est écarté avant de compter', () => {
  const projects = new Map([['a', project('a')], ['b', project('b')]])
  const rows = recentEvents(
    [event('a', NOW), event('archivé', NOW - 1), event('b', NOW - 2), event('a', NOW - 3)],
    projects,
    2,
  )
  assert.deepEqual(rows.map((row) => row.projectId), ['a', 'b'])
})
