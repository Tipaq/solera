import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardConversationDto, CardDto, CardLinkDto, CardRefinementDto, MilestoneRunDto } from '@solera/protocol'

const { horizonOf } = await import('../../web/src/lib/milestone-model.js')
const { beaconOf, beaconSessions, beaconWaves, concurrencyOf, currentWave, MATURITY_RANK } = await import(
  '../../web/src/lib/milestone-beacon.js'
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

const session = (id: string, status: CardConversationDto['status'], archivedAt: number | null = null): CardConversationDto => ({
  id, title: id, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt, createdAt: NOW - DAY,
})

const card = (number: number, extra: Partial<CardDto> = {}): CardDto =>
  ({
    id: `c-${number}`,
    projectId: 'p',
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

function milestone(number: number, kids: CardDto[], extra: Partial<CardDto> = {}): CardDto[] {
  const parent = card(number, { milestone: true, ...extra })
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

function depend(blocked: CardDto, ...blockers: CardDto[]) {
  for (const blocker of blockers) {
    blocked.blockedBy.push(link(blocker))
    blocker.blocks.push(link(blocked))
  }
}

const refining: CardRefinementDto = {
  conversationId: 'split-1', title: 'Affinage', status: 'running', mode: 'questions', createdAt: NOW - DAY, draft: null, change: null,
}

const run = (cardId: string, extra: Partial<MilestoneRunDto> = {}) =>
  ({ id: `run-${cardId}`, cardId, state: 'running', mode: 'auto', concurrency: 2, createdAt: NOW - 3 * DAY, cards: [], ...extra }) as MilestoneRunDto

/** Un jalon de chaque étape, numérotés à rebours de leur rang pour que le tri se voie. */
function horizon() {
  const cards = [
    ...milestone(10, []), // idée
    ...milestone(11, [], { refinement: refining }), // à affiner
    ...milestone(12, [card(120, { toClarifySince: NOW - DAY })]), // à régler
    ...milestone(13, [card(130)]), // prêt
    ...milestone(14, [card(140)]), // lancé
    ...milestone(15, [card(150)]), // lancé, après le 14
    ...milestone(16, [card(160, { column: 'done' })]), // livré
    ...milestone(17, [card(170, { column: 'done' })]), // livré
  ]
  return horizonOf({ cards, runs: [run('c-15'), run('c-14')], requests: new Map() })
}

const numbers = (entries: { card: CardDto }[]) => entries.map((entry) => entry.card.number)

/* ------------------------------------------------------------------ A-3.3, A-3.9 */

test('A-3.3 : le rang suit la maturité, du lancé à l’idée', () => {
  const order = (['launched', 'ready', 'split', 'refine', 'idea'] as const).map((maturity) => MATURITY_RANK[maturity])
  assert.deepEqual(order, [...order].sort((a, b) => a - b))
  assert.equal(new Set(order).size, order.length)
})

test('A-3.3 : le jalon courant est le premier non livré par rang, puis par numéro', () => {
  const { current } = beaconOf(horizon())
  assert.equal(current?.card.number, 14)
})

test('A-3.9 : Ensuite prend le lancé au-delà du premier, le prêt et l’à régler ; Plus tard l’à affiner et l’idée', () => {
  const { next, later, delivered } = beaconOf(horizon())
  assert.deepEqual(numbers(next), [15, 13, 12])
  assert.deepEqual(numbers(later), [11, 10])
  assert.equal(delivered, 2)
})

test('A-3.1 : sans jalon ouvert, pas de jalon courant ; les livrés se comptent quand même', () => {
  const cards = milestone(16, [card(160, { column: 'done' })])
  const beacon = beaconOf(horizonOf({ cards, runs: [], requests: new Map() }))
  assert.equal(beacon.current, null)
  assert.deepEqual(beacon.next, [])
  assert.deepEqual(beacon.later, [])
  assert.equal(beacon.delivered, 1)
})

/* ------------------------------------------------------------------ A-3.7 */

test('A-3.7 : une vague par étage, ses faites comptées, les abandonnées écartées', () => {
  const a = card(21, { column: 'done' })
  const b = card(22, { column: 'in_progress' })
  const c = card(23)
  const gone = card(24, { column: 'abandoned' })
  depend(c, a, b)
  const [entry] = horizonOf({ cards: milestone(20, [a, b, c, gone]), runs: [], requests: new Map() })
  const waves = beaconWaves(entry!)
  assert.deepEqual(
    waves.map((wave) => ({ cards: wave.cards.map((item) => item.card.number), done: wave.done, total: wave.cards.length })),
    [
      { cards: [22, 21], done: 1, total: 2 },
      { cards: [23], done: 0, total: 1 },
    ],
  )
  assert.deepEqual(
    waves[0]!.cards.map((item) => item.state),
    ['running', 'done'],
  )
  assert.equal(currentWave(waves), 0)
})

test('A-3.7 : la vague courante est la première qui a encore du travail', () => {
  const a = card(31, { column: 'done' })
  const b = card(32)
  depend(b, a)
  const [entry] = horizonOf({ cards: milestone(30, [a, b]), runs: [], requests: new Map() })
  const waves = beaconWaves(entry!)
  assert.equal(currentWave(waves), 1)
  assert.equal(waves[0]!.open, 0)
})

test('A-3.7 : sans carte, pas de vague', () => {
  const [entry] = horizonOf({ cards: milestone(40, []), runs: [], requests: new Map() })
  assert.deepEqual(beaconWaves(entry!), [])
  assert.equal(currentWave([]), -1)
})

test('A-3.7 : la concurrence est celle du pilotage, 3 sans pilotage', () => {
  const cards = [...milestone(50, [card(500)]), ...milestone(51, [card(510)])]
  const entries = horizonOf({ cards, runs: [run('c-50', { concurrency: 5 })], requests: new Map() })
  const byNumber = new Map(entries.map((entry) => [entry.card.number, entry]))
  assert.equal(concurrencyOf(byNumber.get(50)!), 5)
  assert.equal(concurrencyOf(byNumber.get(51)!), 3)
})

/* ------------------------------------------------------------------ A-3.6 */

test('A-3.6 : les sessions vivantes des cartes du jalon, celles qui attendent marquées', () => {
  const a = card(61, { conversations: [session('s-run', 'running'), session('s-idle', 'idle')] })
  const b = card(62, { conversations: [session('s-wait', 'awaiting_input'), session('s-old', 'running', NOW - DAY)] })
  const [entry] = horizonOf({ cards: milestone(60, [a, b]), runs: [], requests: new Map() })
  assert.deepEqual(beaconSessions(entry!), [
    { id: 's-run', agent: 'claude', tone: 'running', cardNumber: 61, title: 'carte 61' },
    { id: 's-wait', agent: 'claude', tone: 'awaiting', cardNumber: 62, title: 'carte 62' },
  ])
})

test('A-3.6 : le statut vivant l’emporte sur celui du chargement', () => {
  const a = card(71, { conversations: [session('s-1', 'running')] })
  const [entry] = horizonOf({ cards: milestone(70, [a]), runs: [], requests: new Map() })
  const sessions = beaconSessions(entry!, (conversation) => (conversation.id === 's-1' ? 'awaiting_input' : conversation.status))
  assert.equal(sessions[0]?.tone, 'awaiting')
})
