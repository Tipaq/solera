import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardDto, CardLinkDto } from '@solera/protocol'

const { horizonOf } = await import('../../web/src/lib/milestone-model.js')
const { GANTT_HEAD, GANTT_ROW, deliveredIds, ganttGroups, ganttRows, looseCards, milestoneSpan, plottedCards, stateMix } = await import(
  '../../web/src/lib/milestone-gantt.js'
)

/* ------------------------------------------------------------------ fixtures */

const NOW = new Date(2026, 10, 12, 10).getTime()
const DAY = 86_400_000

const link = (card: Pick<CardDto, 'id' | 'number' | 'title' | 'column'>): CardLinkDto => ({
  id: card.id,
  number: card.number,
  title: card.title,
  column: card.column,
})

const card = (number: number, extra: Partial<CardDto> = {}): CardDto =>
  ({
    id: `c-${number}`,
    projectId: 'p',
    number,
    title: `carte ${number}`,
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
    conversations: [],
    blocks: [],
    blockedBy: [],
    ...extra,
  }) as CardDto

function milestone(number: number, kids: CardDto[], extra: Partial<CardDto> = {}): CardDto[] {
  const parent = card(number, { milestone: true, ...extra })
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

const entriesOf = (cards: CardDto[]) => horizonOf({ cards, runs: [], requests: new Map() })
const numbers = (list: readonly { number: number }[]) => list.map((entry) => entry.number)
const keys = (groups: readonly { key: string }[]) => groups.map((group) => group.key)

/* ------------------------------------------------------------------ GNT-5 */

test('GNT-5 : un groupe par jalon qui a des cartes, dans l’ordre d’échéance, sans date à la fin', () => {
  const cards = [
    ...milestone(10, [card(11)]),
    ...milestone(20, [card(21)], { dueAt: NOW + 9 * DAY }),
    ...milestone(30, [card(31)], { dueAt: NOW + 2 * DAY }),
    card(40, { milestone: true, dueAt: NOW + DAY }),
  ]
  const groups = ganttGroups(entriesOf(cards), cards, new Set(), NOW)
  assert.deepEqual(keys(groups), ['c-30', 'c-20', 'c-10'], 'l’idée datée #40 n’y est pas')
})

test('GNT-5 : un jalon dont toutes les cartes sont abandonnées n’a pas de groupe', () => {
  const cards = milestone(10, [card(11, { column: 'abandoned' })])
  assert.deepEqual(ganttGroups(entriesOf(cards), cards, new Set(), NOW), [])
})

test('GNT-5 : « Hors jalon » garde les cartes datées sans parente, ni abandonnées, ni jalons', () => {
  const cards = [
    ...milestone(10, [card(11, { dueAt: NOW })]),
    card(1, { dueAt: NOW + DAY }),
    card(2, { dueAt: NOW + DAY, column: 'done' }),
    card(3, { dueAt: NOW + DAY, column: 'abandoned' }),
    card(4),
    card(5, { milestone: true, dueAt: NOW + DAY }),
  ]
  assert.deepEqual(numbers(looseCards(cards)), [1, 2])
  const groups = ganttGroups(entriesOf(cards), cards, new Set(), NOW)
  assert.deepEqual(keys(groups), ['c-10', 'loose'])
  assert.equal(groups[1]!.entry, null)
  assert.deepEqual(numbers(groups[1]!.cards), [1, 2])
})

test('GNT-5 : sans carte datée libre, pas de groupe « Hors jalon »', () => {
  const cards = milestone(10, [card(11)])
  assert.deepEqual(keys(ganttGroups(entriesOf(cards), cards, new Set(), NOW)), ['c-10'])
})

test('GNT-5 : les jalons arrivent filtrés par la barre, « Hors jalon » reste', () => {
  const cards = [...milestone(10, [card(11)]), ...milestone(20, [card(21)]), card(1, { dueAt: NOW })]
  const kept = entriesOf(cards).filter((entry) => entry.card.number === 20)
  assert.deepEqual(keys(ganttGroups(kept, cards, new Set(), NOW)), ['c-20', 'loose'])
})

/* ------------------------------------------------------------------ GNT-7 */

test('GNT-7 : les jalons livrés sont repliés au départ', () => {
  const cards = [...milestone(10, [card(11, { column: 'done' })]), ...milestone(20, [card(21, { column: 'done' }), card(22)])]
  assert.deepEqual([...deliveredIds(entriesOf(cards))], ['c-10'])
})

test('GNT-7 : un groupe replié garde son en-tête et ne montre plus ses cartes', () => {
  const cards = [...milestone(10, [card(11), card(12)]), ...milestone(20, [card(21)])]
  const groups = ganttGroups(entriesOf(cards), cards, new Set(['c-10']), NOW)
  assert.deepEqual(keys(groups), ['c-10', 'c-20'])
  assert.deepEqual(groups[0]!.cards, [])
  assert.deepEqual(numbers(groups[1]!.cards), [21])
})

/* ------------------------------------------------------------------ GNT-9 */

test('GNT-9 : les cartes d’un groupe, abandonnées exclues, triées par début de barre', () => {
  const cards = milestone(10, [
    card(11, { createdAt: NOW - 2 * DAY }),
    card(12, { createdAt: NOW - 8 * DAY }),
    card(13, { column: 'abandoned', createdAt: NOW - 9 * DAY }),
    // Créée tard, mais son échéance tire sa barre la veille : elle commence avant #11.
    card(14, { createdAt: NOW - DAY, dueAt: NOW - 4 * DAY }),
  ])
  const [group] = ganttGroups(entriesOf(cards), cards, new Set(), NOW)
  assert.deepEqual(numbers(group!.cards), [12, 14, 11])
})

/* ------------------------------------------------------------------ alignement */

test('lignes : un en-tête de 40 px par groupe, une ligne de 32 px par carte, au pixel', () => {
  const cards = [...milestone(10, [card(11), card(12)]), ...milestone(20, [card(21)])]
  const groups = ganttGroups(entriesOf(cards), cards, new Set(['c-20']), NOW)
  const { centers, height } = ganttRows(groups)
  assert.equal(GANTT_HEAD, 40)
  assert.equal(GANTT_ROW, 32)
  assert.equal(centers.get('c-11'), 40 + 16)
  assert.equal(centers.get('c-12'), 40 + 32 + 16)
  assert.equal(centers.has('c-21'), false, 'repliée, pas de ligne')
  assert.equal(height, 40 + 32 * 2 + 40)
})

test('échelle : les jalons, leurs cartes (repliées comprises) et les cartes libres ; pas les abandonnées', () => {
  const cards = [
    ...milestone(10, [card(11), card(12, { column: 'abandoned' })]),
    ...milestone(20, [card(21)]),
    card(1, { dueAt: NOW }),
  ]
  const groups = ganttGroups(entriesOf(cards), cards, new Set(['c-20']), NOW)
  assert.deepEqual(numbers(plottedCards(groups)).sort((a, b) => a - b), [1, 10, 11, 20, 21])
})

/* ------------------------------------------------------------------ GNT-8 */

test('GNT-8 : la jauge suit l’ordre faites, à relire, en cours, bloquées, à faire', () => {
  const blocker = card(1)
  const mix = stateMix([
    card(11),
    card(12, { column: 'in_progress', blockedBy: [link(blocker)] }),
    card(13, { column: 'in_progress' }),
    card(14, { column: 'done' }),
    card(15, { column: 'review' }),
    card(16, { column: 'done' }),
    card(17, { column: 'abandoned' }),
  ])
  assert.deepEqual(mix, [
    { state: 'done', count: 2 },
    { state: 'review', count: 1 },
    { state: 'running', count: 1 },
    { state: 'blocked', count: 1 },
    { state: 'todo', count: 1 },
  ])
})

test('GNT-8 : la barre va de la plus ancienne création à l’échéance', () => {
  const [entry] = entriesOf(milestone(10, [card(11, { createdAt: NOW - 20 * DAY })], { createdAt: NOW - 5 * DAY, dueAt: NOW + 3 * DAY }))
  assert.deepEqual(milestoneSpan(entry!, NOW), { start: NOW - 20 * DAY, end: NOW + 3 * DAY })
})

test('GNT-8 : sans échéance, jusqu’à la fin de sa dernière carte, aujourd’hui au moins', () => {
  const [ahead] = entriesOf(milestone(10, [card(11, { dueAt: NOW + 6 * DAY }), card(12)]))
  assert.equal(milestoneSpan(ahead!, NOW).end, NOW + 6 * DAY)
  const [past] = entriesOf(milestone(20, [card(21, { dueAt: NOW - 6 * DAY })]))
  assert.equal(milestoneSpan(past!, NOW).end, NOW)
})
