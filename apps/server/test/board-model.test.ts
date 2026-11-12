import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardConversationDto, CardDto, CardLinkDto } from '@solera/protocol'

const {
  DEFAULT_DISPLAY,
  NO_FILTERS,
  TINT_COUNT,
  activeFilters,
  boardModel,
  columnSlice,
  laneGroups,
  matches,
  passes,
  readDisplay,
  shortTitle,
  shownColumns,
  sortEntries,
} = await import('../../web/src/lib/board-model.js')

/* ------------------------------------------------------------------ fixtures */

const NOW = new Date(2026, 10, 12, 10).getTime()
const DAY = 86_400_000

const link = (card: Pick<CardDto, 'id' | 'number' | 'title' | 'column'>): CardLinkDto => ({
  id: card.id,
  number: card.number,
  title: card.title,
  column: card.column,
})

const session = (
  id: string,
  status: CardConversationDto['status'],
  extra: Partial<CardConversationDto> = {},
): CardConversationDto => ({
  id, title: id, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt: null, createdAt: NOW - DAY,
  ...extra,
})

const card = (number: number, extra: Partial<CardDto> = {}): CardDto =>
  ({
    id: `c-${number}`,
    projectId: 'p',
    number,
    title: `carte ${number}`,
    description: '',
    column: 'todo',
    position: number,
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
    updatedAt: NOW - 10 * DAY,
    columnSince: NOW - 10 * DAY,
    conversations: [],
    blocks: [],
    blockedBy: [],
    ...extra,
  }) as CardDto

/** `parent` reçoit `kids` comme enfants directs, liés dans les deux sens. */
function adopt(parent: CardDto, ...kids: CardDto[]) {
  for (const kid of kids) kid.parent = link(parent)
  parent.children.push(...kids.map(link))
  if (parent.parent === null) parent.milestone = true
}

const model = (cards: CardDto[]) => boardModel(cards, { now: NOW })
const entry = (cards: CardDto[], number: number) => model(cards).cards.find((item) => item.card.number === number)!

/* ------------------------------------------------------------------ B-2 données */

test('seules les feuilles sont des tuiles ; une idée de jalon n’en est pas une', () => {
  const root = card(1)
  const sub = card(2)
  const leaf = card(3)
  const loose = card(4)
  const idea = card(5, { milestone: true })
  adopt(root, sub)
  adopt(sub, leaf)
  assert.deepEqual(model([root, sub, leaf, loose, idea]).cards.map((item) => item.card.number), [3, 4])
})

test('le jalon d’une feuille est l’ancêtre de haut niveau, ses feuilles à toute profondeur', () => {
  const root = card(1)
  const sub = card(2)
  const deep = card(3, { column: 'done' })
  const direct = card(4, { column: 'abandoned' })
  const open = card(5)
  adopt(root, sub, direct, open)
  adopt(sub, deep)
  const { milestones, cards } = model([root, sub, deep, direct, open])
  assert.equal(milestones.length, 1)
  assert.deepEqual(milestones[0]!.leaves.map((leaf) => leaf.number).sort(), [3, 4, 5])
  // Closes : faites ou abandonnées.
  assert.equal(milestones[0]!.done, 2)
  assert.ok(cards.every((item) => item.milestone?.card.number === 1))
})

test('les teintes tournent sur les jalons triés par échéance, puis par numéro', () => {
  const cards: CardDto[] = []
  for (let n = 1; n <= TINT_COUNT + 1; n++) {
    const root = card(n * 10, { dueAt: n === 3 ? NOW + DAY : null })
    const kid = card(n * 10 + 1)
    adopt(root, kid)
    cards.push(root, kid)
  }
  const { milestones } = model(cards)
  assert.deepEqual(milestones.map((m) => m.card.number), [30, 10, 20, 40, 50, 60, 70])
  assert.deepEqual(milestones.map((m) => m.tint), [0, 1, 2, 3, 4, 5, 0])
})

test('par carte : sous-tâches, t’attend, sessions vivantes, en retard', () => {
  const busy = card(1, {
    description: '- [x] un\n- [ ] deux\n```\n- [ ] dans du code\n```\n- [X] trois',
    dueAt: NOW - 2 * DAY,
    conversations: [
      session('a', 'awaiting_input'),
      session('b', 'running'),
      session('c', 'idle'),
      session('d', 'awaiting_input', { archivedAt: NOW - DAY }),
    ],
  })
  const quiet = card(2, { dueAt: NOW - 2 * DAY, column: 'done' })
  const item = entry([busy, quiet], 1)
  assert.deepEqual(item.subtasks, { done: 2, total: 3 })
  assert.equal(item.waiting, true)
  assert.deepEqual(item.live.map((s) => s.id), ['a', 'b'])
  assert.equal(item.late, true)
  // Close, elle n'est plus en retard ; sans session, elle n'attend rien.
  const closed = entry([busy, quiet], 2)
  assert.equal(closed.late, false)
  assert.equal(closed.waiting, false)
})

test('le statut vivant du socket l’emporte sur celui du chargement', () => {
  const one = card(1, { conversations: [session('a', 'running')] })
  const { cards } = boardModel([one], { now: NOW, statusOf: () => 'awaiting_input' })
  assert.equal(cards[0]!.waiting, true)
  assert.equal(cards[0]!.live[0]!.status, 'awaiting_input')
})

/* ------------------------------------------------------------------ B-1 recherche et filtres */

test('la recherche : #12 vise un numéro par préfixe, sinon numéro, titre et titre du jalon', () => {
  const root = card(1, { title: 'Jalon — Environnements' })
  const kid = card(12, { title: 'Brancher le conteneur' })
  const other = card(120, { title: 'Autre chose' })
  adopt(root, kid)
  const { cards } = model([root, kid, other])
  const found = (query: string) => cards.filter((item) => matches(item, query)).map((item) => item.card.number)
  assert.deepEqual(found(''), [12, 120])
  assert.deepEqual(found('#12'), [12, 120])
  assert.deepEqual(found('#120'), [120])
  assert.deepEqual(found('conteneur'), [12])
  assert.deepEqual(found('ENVIRONNEMENTS'), [12])
  assert.deepEqual(found('120'), [120])
})

test('les filtres : jalon et « sans jalon », états en « ou », échéance, agent, colonne', () => {
  const root = card(1)
  const a = card(2, { conversations: [session('s', 'awaiting_input', { agent: 'codex' })] })
  const b = card(3, { toClarifySince: NOW - DAY, dueAt: NOW + 3 * DAY })
  const c = card(4, { acceptedAt: null, dueAt: NOW - 3 * DAY })
  const d = card(5, { column: 'done', dueAt: NOW + 30 * DAY })
  adopt(root, a, b)
  const { cards } = model([root, a, b, c, d])
  const kept = (patch: Partial<typeof NO_FILTERS>) =>
    cards.filter((item) => passes(item, { ...NO_FILTERS, ...patch }, NOW)).map((item) => item.card.number)

  assert.deepEqual(kept({}), [2, 3, 4, 5])
  assert.deepEqual(kept({ milestones: ['c-1'] }), [2, 3])
  assert.deepEqual(kept({ milestones: ['none'] }), [4, 5])
  assert.deepEqual(kept({ milestones: ['c-1', 'none'] }), [2, 3, 4, 5])
  assert.deepEqual(kept({ waiting: true }), [2])
  assert.deepEqual(kept({ waiting: true, clarify: true }), [2, 3])
  assert.deepEqual(kept({ accept: true }), [4])
  assert.deepEqual(kept({ due: 'late' }), [4])
  // Cette semaine : l'échéance tombe dans les sept jours, retard compris.
  assert.deepEqual(kept({ due: 'week' }), [3, 4])
  assert.deepEqual(kept({ agents: ['codex'] }), [2])
  assert.deepEqual(kept({ agents: ['claude'] }), [])
  assert.deepEqual(kept({ column: 'done' }), [5])
  // Les familles se cumulent en « et ».
  assert.deepEqual(kept({ milestones: ['c-1'], clarify: true }), [3])
})

test('le compte des filtres actifs est celui des puces', () => {
  assert.equal(activeFilters(NO_FILTERS), 0)
  assert.equal(activeFilters({ ...NO_FILTERS, milestones: ['a', 'none'], waiting: true, due: 'week', agents: ['claude'], column: 'done' }), 6)
})

/* ------------------------------------------------------------------ B-4 Kanban */

test('« Ce qui t’attend » : attend d’abord, puis non acceptées, puis en retard, puis entrées récentes', () => {
  const cards = [
    card(1, { columnSince: NOW - 1 * DAY }),
    card(2, { columnSince: NOW - 5 * DAY, dueAt: NOW - 2 * DAY }),
    card(3, { columnSince: NOW - 9 * DAY, acceptedAt: null }),
    card(4, { columnSince: NOW - 9 * DAY, conversations: [session('w', 'awaiting_input')] }),
    card(5, { columnSince: NOW - 2 * DAY }),
  ]
  const order = (sort: Parameters<typeof sortEntries>[1]) => sortEntries(model(cards).cards, sort).map((item) => item.card.number)
  assert.deepEqual(order('waiting'), [4, 3, 2, 1, 5])
})

test('les autres tris : récentes, échéance, numéro', () => {
  const cards = [
    card(1, { updatedAt: NOW - 3 * DAY, dueAt: NOW + 5 * DAY }),
    card(2, { updatedAt: NOW - 1 * DAY }),
    card(3, { updatedAt: NOW - 2 * DAY, dueAt: NOW + 1 * DAY }),
  ]
  const order = (sort: Parameters<typeof sortEntries>[1]) => sortEntries(model(cards).cards, sort).map((item) => item.card.number)
  assert.deepEqual(order('recent'), [2, 3, 1])
  assert.deepEqual(order('due'), [3, 1, 2])
  assert.deepEqual(order('number'), [3, 2, 1])
})

test('les colonnes montrées selon l’affichage', () => {
  assert.deepEqual(shownColumns(DEFAULT_DISPLAY), ['todo', 'in_progress', 'review', 'done'])
  assert.deepEqual(shownColumns({ ...DEFAULT_DISPLAY, done: 'hidden' }), ['todo', 'in_progress', 'review'])
  assert.deepEqual(shownColumns({ ...DEFAULT_DISPLAY, done: 'hidden', abandoned: true }), ['todo', 'in_progress', 'review', 'abandoned'])
})

test('une colonne : Fait par récence et limitée à 5 en « Les 5 récentes », les autres au tri choisi', () => {
  const done = Array.from({ length: 7 }, (_, index) => card(index + 1, { column: 'done', columnSince: NOW - index * DAY }))
  const todo = [card(20, { columnSince: NOW - 3 * DAY }), card(21, { columnSince: NOW - DAY, acceptedAt: null })]
  const { cards } = model([...done, ...todo])
  const recent = columnSlice(cards, 'done', DEFAULT_DISPLAY)
  assert.deepEqual(recent.shown.map((item) => item.card.number), [1, 2, 3, 4, 5])
  assert.equal(recent.total, 7)
  const all = columnSlice(cards, 'done', { ...DEFAULT_DISPLAY, done: 'all', sort: 'number' })
  assert.deepEqual(all.shown.map((item) => item.card.number), [1, 2, 3, 4, 5, 6, 7])
  const open = columnSlice(cards, 'todo', { ...DEFAULT_DISPLAY, sort: 'number' })
  assert.deepEqual(open.shown.map((item) => item.card.number), [21, 20])
  // Une limite propre aux couloirs.
  assert.equal(columnSlice(cards, 'done', DEFAULT_DISPLAY, 2).shown.length, 2)
})

test('couloirs : un par jalon ayant des feuilles ouvertes, dans l’ordre des jalons, puis « Sans jalon »', () => {
  const first = card(1, { dueAt: NOW + DAY })
  const finished = card(2)
  const second = card(3)
  const a = card(10)
  const b = card(11, { column: 'done' })
  const c = card(12)
  const loose = card(20)
  adopt(first, a)
  adopt(finished, b)
  adopt(second, c)
  const { cards, milestones } = model([first, finished, second, a, b, c, loose])
  const groups = laneGroups(cards, milestones)
  assert.deepEqual(groups.map((group) => group.milestone?.card.number ?? null), [1, 3, null])
  assert.deepEqual(groups[2]!.entries.map((item) => item.card.number), [20])
  // Sans feuille ouverte hors jalon, pas de couloir « Sans jalon ».
  assert.deepEqual(laneGroups(cards.filter((item) => item.milestone !== null), milestones).map((group) => group.milestone?.card.number ?? null), [1, 3])
})

/* ------------------------------------------------------------------ divers */

test('le titre court d’un jalon : sans préfixe « Jalon — », coupé au premier séparateur', () => {
  assert.equal(shortTitle('Jalon — Environnements d’exécution : dev container et confinement'), 'Environnements d’exécution')
  assert.equal(shortTitle('Page projet v2 · 2 — Aperçu, Travail, Tableau'), 'Page projet v2 · 2')
  assert.equal(shortTitle('Un titre bien trop long pour tenir dans une étiquette', 18), 'Un titre bien tro…')
})

test('l’affichage retenu se relit en écartant ce qui n’a plus cours', () => {
  assert.deepEqual(readDisplay(null), DEFAULT_DISPLAY)
  assert.deepEqual(readDisplay('pas du json'), DEFAULT_DISPLAY)
  assert.deepEqual(readDisplay(JSON.stringify({ lanes: true, sort: 'number' })), { ...DEFAULT_DISPLAY, lanes: true, sort: 'number' })
  assert.deepEqual(readDisplay(JSON.stringify({ lanes: 'oui', done: 'jamais', sort: 'manual', abandoned: true })), { ...DEFAULT_DISPLAY, abandoned: true })
})
