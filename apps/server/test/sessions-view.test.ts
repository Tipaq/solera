import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardColumn, ConversationDto, ProjectDto } from '@solera/protocol'
import type { SessionRow } from '../../web/src/lib/sessions-view.js'

const {
  activeFilterCount,
  bucketOf,
  byDay,
  byProject,
  byState,
  filterSessions,
  readSessionQuery,
  sessionRows,
  sessionState,
  sortSessions,
  writeSessionQuery,
} = await import('../../web/src/lib/sessions-view.js')

const project = (id: string, name = id) => ({ id, name, git: { branch: 'main' } }) as ProjectDto
const nimbus = project('p1', 'Nimbus')
const atlas = project('p2', 'Atlas')

/** Mardi 10 novembre 2026, 15 h, heure locale. */
const NOW = new Date(2026, 10, 10, 15, 0, 0).getTime()
const at = (day: number, hour = 12) => new Date(2026, 10, day, hour, 0, 0).getTime()

function row(id: string, fields: Partial<SessionRow> = {}): SessionRow {
  return {
    id,
    title: id,
    agent: 'claude',
    project: nimbus,
    state: 'done',
    branch: null,
    cardNumber: null,
    pinned: false,
    archived: false,
    at: NOW - 1000,
    path: `/p/p1/c/${id}`,
    ...fields,
  }
}

const ids = (rows: SessionRow[]) => rows.map((entry) => entry.id)
const query = (fields: Partial<ReturnType<typeof readSessionQuery>> = {}) => ({ ...readSessionQuery(new URLSearchParams()), ...fields })
const filters = (fields: Partial<ReturnType<typeof readSessionQuery>['filters']> = {}) => ({ ...readSessionQuery(new URLSearchParams()).filters, ...fields })

// ─── SES-3 : l'état d'une session ────────────────────────────────────────────

test("l'attente prime sur tout : la session réclame une réponse", () => {
  assert.equal(sessionState({ status: 'awaiting_input', busy: true, cardColumn: 'review' }), 'awaiting')
})

test('une erreur ou une interruption est une session en erreur', () => {
  assert.equal(sessionState({ status: 'error', busy: false, cardColumn: null }), 'error')
  assert.equal(sessionState({ status: 'interrupted', busy: false, cardColumn: 'review' }), 'error')
})

test('une session qui travaille travaille, même si sa carte est à relire', () => {
  assert.equal(sessionState({ status: 'running', busy: false, cardColumn: 'review' }), 'running')
  assert.equal(sessionState({ status: 'idle', busy: true, cardColumn: null }), 'running')
})

test('au repos, une carte en colonne « à vérifier » met la session à relire', () => {
  assert.equal(sessionState({ status: 'idle', busy: false, cardColumn: 'review' }), 'review')
  for (const column of ['todo', 'in_progress', 'done'] as CardColumn[]) {
    assert.equal(sessionState({ status: 'idle', busy: false, cardColumn: column }), 'done')
  }
  assert.equal(sessionState({ status: 'idle', busy: false, cardColumn: null }), 'done')
})

// ─── SES-2 : les lignes ──────────────────────────────────────────────────────

function conversation(id: string, fields: Partial<ConversationDto> = {}): ConversationDto {
  return {
    id,
    projectId: 'p1',
    worktreeId: null,
    title: id,
    agent: 'claude',
    status: 'idle',
    card: null,
    pinned: false,
    archivedAt: null,
    updatedAt: 500,
    scheduleId: null,
    ...fields,
  } as ConversationDto
}

test('les lignes : sans les fils des tâches planifiées, avec leur projet, leur chemin et leur branche', () => {
  const rows = sessionRows({
    conversations: [
      conversation('a', { worktreeId: 'w1', card: { id: 'k', number: 12, title: 'Carte', column: 'review' } }),
      conversation('b', { projectId: null }),
      conversation('c', { scheduleId: 's1' }),
      conversation('d', { archivedAt: 42, pinned: true }),
      conversation('e', { worktreeId: 'w-gone' }),
    ],
    live: new Map([['a', { status: 'running', busy: false }]]),
    projects: new Map([[nimbus.id, nimbus]]),
    branches: new Map([['w1', 'feat/12-carte']]),
  })
  assert.deepEqual(ids(rows), ['a', 'b', 'd', 'e'])
  const [a, b, d, e] = rows as [SessionRow, SessionRow, SessionRow, SessionRow]
  assert.equal(a.state, 'running', 'le statut vivant prime sur celui de la liste')
  assert.equal(a.branch, 'feat/12-carte')
  assert.equal(a.cardNumber, 12)
  assert.equal(a.path, '/p/p1/c/a')
  assert.equal(b.project, null)
  assert.equal(b.path, '/c/b')
  assert.equal(b.branch, null)
  assert.equal(d.archived, true)
  assert.equal(d.pinned, true)
  assert.equal(d.branch, 'main', 'à la racine du projet, la branche du projet')
  assert.equal(e.branch, null, "un arbre qu'on ne connaît plus n'a pas de branche")
})

// ─── L'adresse est la source ────────────────────────────────────────────────

test("sans paramètre : actives, récentes, aucun filtre, aucune recherche", () => {
  const read = readSessionQuery(new URLSearchParams())
  assert.equal(read.scope, 'actives')
  assert.equal(read.sort, 'recent')
  assert.equal(read.search, '')
  assert.equal(activeFilterCount(read.filters), 0)
})

test("l'adresse se lit : projet, recherche, état, portée, agent, période, épinglées, tri", () => {
  const read = readSessionQuery(
    new URLSearchParams('projet=p1,none&q=radar&etat=attend,erreur&portee=archivees&agent=codex&periode=semaine&epinglees=1&tri=nom'),
  )
  assert.deepEqual([...read.filters.projects], ['p1', 'none'])
  assert.deepEqual([...read.filters.states], ['awaiting', 'error'])
  assert.deepEqual([...read.filters.agents], ['codex'])
  assert.equal(read.filters.period, 'week')
  assert.equal(read.filters.pinned, true)
  assert.equal(read.search, 'radar')
  assert.equal(read.scope, 'archivees')
  assert.equal(read.sort, 'nom')
  assert.equal(activeFilterCount(read.filters), 7)
})

test('une valeur inconnue est ignorée, pas reportée en filtre vide', () => {
  const read = readSessionQuery(new URLSearchParams('etat=perdue,relire&agent=gpt&periode=siecle&portee=corbeille&tri=taille'))
  assert.deepEqual([...read.filters.states], ['review'])
  assert.equal(read.filters.agents.size, 0)
  assert.equal(read.filters.period, 'all')
  assert.equal(read.scope, 'actives')
  assert.equal(read.sort, 'recent')
})

test("l'écriture garde les autres paramètres et tait les valeurs par défaut", () => {
  const written = writeSessionQuery(
    new URLSearchParams('vue=projet&q=ancien'),
    query({ search: '', filters: filters({ projects: new Set(['p2']), states: new Set(['running']) }) }),
  )
  assert.equal(written.get('vue'), 'projet')
  assert.equal(written.get('projet'), 'p2')
  assert.equal(written.get('etat'), 'travaille')
  for (const key of ['q', 'portee', 'tri', 'agent', 'periode', 'epinglees']) assert.equal(written.has(key), false, key)
})

test("ce qui s'écrit se relit à l'identique", () => {
  const original = query({
    search: '#12',
    scope: 'archivees',
    sort: 'attente',
    filters: filters({
      projects: new Set(['none', 'p1']),
      states: new Set(['done', 'review']),
      agents: new Set(['grok']),
      period: 'month',
      pinned: true,
    }),
  })
  assert.deepEqual(readSessionQuery(writeSessionQuery(new URLSearchParams(), original)), original)
})

// ─── SES-5/6 : recherche et filtres ──────────────────────────────────────────

const sample = [
  row('radar', { title: 'Radar tile prefetching', branch: 'feat/radar-prefetch', cardNumber: 4, state: 'review' }),
  row('icons', { title: 'Migrate icons', project: atlas, agent: 'codex', at: at(1) }),
  row('loose', { title: 'Idées en vrac', project: null, path: '/c/loose', pinned: true, at: at(9) }),
  row('waiting', { title: 'Refactor settings', state: 'awaiting', at: at(10, 9) }),
  row('old', { title: 'Ancienne', archived: true, at: at(1) }),
]

test('la portée sépare les actives des archivées', () => {
  assert.deepEqual(ids(filterSessions(sample, query(), NOW)), ['radar', 'icons', 'loose', 'waiting'])
  assert.deepEqual(ids(filterSessions(sample, query({ scope: 'archivees' }), NOW)), ['old'])
})

test('la recherche lit le titre, le projet, la branche et le numéro de carte, sans casse', () => {
  const search = (text: string) => ids(filterSessions(sample, query({ search: text }), NOW))
  assert.deepEqual(search('RADAR'), ['radar'])
  assert.deepEqual(search('atlas'), ['icons'])
  assert.deepEqual(search('prefetch'), ['radar'])
  assert.deepEqual(search('#4'), ['radar'])
  assert.deepEqual(search('  '), ['radar', 'icons', 'loose', 'waiting'])
})

test('les filtres : projet ou « sans projet », état, agent, épinglées', () => {
  const kept = (fields: Parameters<typeof filters>[0]) => ids(filterSessions(sample, query({ filters: filters(fields) }), NOW))
  assert.deepEqual(kept({ projects: new Set(['p2', 'none']) }), ['icons', 'loose'])
  assert.deepEqual(kept({ states: new Set(['awaiting', 'review']) }), ['radar', 'waiting'])
  assert.deepEqual(kept({ agents: new Set(['codex']) }), ['icons'])
  assert.deepEqual(kept({ pinned: true }), ['loose'])
})

test("la période : aujourd'hui depuis minuit, 7 et 30 jours glissants", () => {
  const rows = [
    row('ce-matin', { at: at(10, 0) }),
    row('hier-soir', { at: at(9, 23) }),
    row('il-y-a-6-jours', { at: at(4, 16) }),
    row('il-y-a-8-jours', { at: at(2, 14) }),
    row('octobre', { at: new Date(2026, 9, 5).getTime() }),
  ]
  const period = (value: 'day' | 'week' | 'month') => ids(filterSessions(rows, query({ filters: filters({ period: value }) }), NOW))
  assert.deepEqual(period('day'), ['ce-matin'])
  assert.deepEqual(period('week'), ['ce-matin', 'hier-soir', 'il-y-a-6-jours'])
  assert.deepEqual(period('month'), ['ce-matin', 'hier-soir', 'il-y-a-6-jours', 'il-y-a-8-jours'])
})

// ─── SES-8 : les tris ────────────────────────────────────────────────────────

test('Récentes : les épinglées d’abord, puis la plus récente', () => {
  const rows = [row('a', { at: 3 }), row('b', { at: 1, pinned: true }), row('c', { at: 2 })]
  assert.deepEqual(ids(sortSessions(rows, 'recent')), ['b', 'a', 'c'])
})

test("Ce qui t'attend : le rang de l'état, puis la date", () => {
  const rows = [
    row('fini', { state: 'done', at: 9 }),
    row('travaille', { state: 'running', at: 8 }),
    row('attend-vieux', { state: 'awaiting', at: 1 }),
    row('relire', { state: 'review', at: 7 }),
    row('erreur', { state: 'error', at: 6 }),
    row('attend', { state: 'awaiting', at: 5 }),
  ]
  assert.deepEqual(ids(sortSessions(rows, 'attente')), ['attend', 'attend-vieux', 'erreur', 'relire', 'travaille', 'fini'])
})

test('Nom : l’ordre alphabétique, accents compris', () => {
  const rows = [row('z', { title: 'Zèbre' }), row('e', { title: 'école' }), row('b', { title: 'Bilan' })]
  assert.deepEqual(ids(sortSessions(rows, 'nom')), ['b', 'e', 'z'])
})

test('le tri ne modifie pas la liste reçue', () => {
  const rows = [row('a', { at: 1 }), row('b', { at: 2 })]
  sortSessions(rows, 'recent')
  assert.deepEqual(ids(rows), ['a', 'b'])
})

// ─── SES-9 : les tranches datées ─────────────────────────────────────────────

test('les tranches tombent aux minuits locaux', () => {
  assert.equal(bucketOf(at(10, 0), NOW), 'today')
  assert.equal(bucketOf(at(9, 23), NOW), 'yesterday')
  assert.equal(bucketOf(at(9, 0), NOW), 'yesterday')
  assert.equal(bucketOf(at(8, 23), NOW), 'week')
  assert.equal(bucketOf(at(3, 0), NOW), 'week')
  assert.equal(bucketOf(at(2, 23), NOW), 'older')
})

test('la Liste par Récentes : les épinglées en tête, puis chaque tranche avec ses lignes', () => {
  const rows = sortSessions(
    [
      row('ancien', { at: at(1) }),
      row('epingle', { at: at(1), pinned: true }),
      row('auj', { at: at(10, 10) }),
      row('auj2', { at: at(10, 8) }),
      row('hier', { at: at(9) }),
    ],
    'recent',
  )
  const groups = byDay(rows, 'recent', NOW)
  assert.deepEqual(
    groups.map((group) => [group.key, ids(group.rows)]),
    [
      ['pinned', ['epingle']],
      ['today', ['auj', 'auj2']],
      ['yesterday', ['hier']],
      ['older', ['ancien']],
    ],
  )
})

test('un autre tri donne une seule liste, sans tranches', () => {
  const rows = [row('a', { at: at(1) }), row('b', { at: at(10) })]
  const groups = byDay(rows, 'nom', NOW)
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.key, 'all')
  assert.deepEqual(ids(groups[0]!.rows), ['a', 'b'])
})

// ─── SES-10 / SES-11 : par projet, par état ─────────────────────────────────

test('Par projet : un groupe par projet dans l’ordre des lignes, « Sans projet » en dernier', () => {
  const groups = byProject([row('loose', { project: null }), row('a', { project: atlas }), row('n', { project: nimbus }), row('a2', { project: atlas })])
  assert.deepEqual(
    groups.map((group) => [group.key, group.project?.name ?? null, ids(group.rows)]),
    [
      ['p2', 'Atlas', ['a', 'a2']],
      ['p1', 'Nimbus', ['n']],
      ['none', null, ['loose']],
    ],
  )
})

test("Par état : quatre colonnes, l'erreur rangée avec ce qui t'attend", () => {
  const columns = byState([
    row('a', { state: 'awaiting' }),
    row('e', { state: 'error' }),
    row('r', { state: 'running' }),
    row('v', { state: 'review' }),
    row('d', { state: 'done' }),
  ])
  assert.deepEqual(
    columns.map((column) => [column.key, ids(column.rows)]),
    [
      ['waiting', ['a', 'e']],
      ['running', ['r']],
      ['review', ['v']],
      ['done', ['d']],
    ],
  )
})
