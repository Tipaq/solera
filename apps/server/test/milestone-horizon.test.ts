import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardConversationDto, CardDto, CardLinkDto, MilestoneRunDto } from '@solera/protocol'

const { horizonOf } = await import('../../web/src/lib/milestone-model.js')
const {
  NO_MILESTONE_FILTERS,
  horizonSections,
  isMilestoneLate,
  keepMilestone,
  livesOf,
  maturityCounts,
  milestoneBar,
  milestoneFilterCount,
  milestoneMatches,
} = await import('../../web/src/lib/milestone-horizon.js')

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

const run = (cardId: string, extra: Partial<MilestoneRunDto> = {}) =>
  ({ id: `run-${cardId}`, cardId, state: 'running', mode: 'auto', concurrency: 2, createdAt: NOW - 3 * DAY, cards: [], ...extra }) as MilestoneRunDto

function entries(cards: CardDto[], runs: MilestoneRunDto[] = []) {
  return horizonOf({ cards, runs, requests: new Map() })
}

const numbers = (list: { card: CardDto }[]) => list.map((entry) => entry.card.number)

/* ------------------------------------------------------------------ BAR-2 */

test('BAR-2 : la recherche lit « numéro titre » en minuscules, le # de tête ignoré', () => {
  const [entry] = entries([card(901, { milestone: true, title: 'Page Projet v2' })])
  for (const query of ['901', '#901', 'page projet', 'PROJET V2', '  901 page  ', '']) {
    assert.equal(milestoneMatches(entry!, query), true, query)
  }
  for (const query of ['902', '##901', 'gantt']) assert.equal(milestoneMatches(entry!, query), false, query)
})

/* ------------------------------------------------------------------ BAR-3 */

test('BAR-3 : un jalon est en retard au lendemain de son échéance, jamais une fois livré', () => {
  const today = new Date(2026, 10, 12).getTime()
  const [due] = entries([card(1, { milestone: true, dueAt: today })])
  assert.equal(isMilestoneLate(due!, NOW), false, 'le jour même, pas encore')
  assert.equal(isMilestoneLate(due!, NOW + DAY), true)
  const [undated] = entries([card(2, { milestone: true })])
  assert.equal(isMilestoneLate(undated!, NOW + 100 * DAY), false)
  const [delivered] = entries(milestone(3, [card(4, { column: 'done' })], { dueAt: today - 5 * DAY }))
  assert.equal(delivered!.maturity, 'delivered')
  assert.equal(isMilestoneLate(delivered!, NOW), false)
})

test('BAR-3 : maturités cochées et « en retard » se cumulent avec la recherche', () => {
  const list = entries([
    card(1, { milestone: true, title: 'Idée datée', dueAt: NOW - 3 * DAY }),
    card(2, { milestone: true, title: 'Idée libre' }),
    ...milestone(3, [card(4)], { title: 'Prêt en retard', dueAt: NOW - 3 * DAY }),
  ])
  const keep = (query: string, filters = NO_MILESTONE_FILTERS) => numbers(list.filter((entry) => keepMilestone(entry, query, filters, NOW)))
  assert.deepEqual(keep(''), [1, 3, 2])
  assert.deepEqual(keep('', { maturities: ['idea'], late: false }), [1, 2])
  assert.deepEqual(keep('', { maturities: ['idea', 'ready'], late: true }), [1, 3])
  assert.deepEqual(keep('libre', { maturities: ['idea'], late: false }), [2])
  assert.deepEqual(keep('', { maturities: [], late: true }), [1, 3])
})

test('BAR-3 : le bouton compte les maturités cochées et le retard', () => {
  assert.equal(milestoneFilterCount(NO_MILESTONE_FILTERS), 0)
  assert.equal(milestoneFilterCount({ maturities: ['idea', 'ready'], late: true }), 3)
})

/* ------------------------------------------------------------------ HOR-1 */

test('HOR-1 : un compte par étape, zéro compris', () => {
  const counts = maturityCounts(entries([card(1, { milestone: true }), card(2, { milestone: true }), ...milestone(3, [card(4)])]))
  assert.deepEqual(counts, { idea: 2, refine: 0, split: 0, ready: 1, launched: 0, delivered: 0 })
})

/* ------------------------------------------------------------------ HOR-2, HOR-9, HOR-10 */

test('HOR-2 : Maintenant prend les lancés, les livrés et ceux dont une carte avance ; non livrés d’abord, puis par création', () => {
  const list = entries(
    [
      ...milestone(1, [card(2, { column: 'done' })], { createdAt: NOW - 30 * DAY }),
      ...milestone(3, [card(4)], { createdAt: NOW - 5 * DAY }),
      ...milestone(5, [card(6, { column: 'in_progress' })], { createdAt: NOW - 8 * DAY }),
      ...milestone(7, [card(8, { column: 'review' })], { createdAt: NOW - 2 * DAY }),
      ...milestone(9, [card(10)], { createdAt: NOW - 20 * DAY }),
    ],
    [run('c-3')],
  )
  const { now } = horizonSections(list)
  assert.deepEqual(numbers(now), [5, 3, 7, 1], 'livré (1) en dernier, le reste du plus ancien au plus récent')
  assert.equal(now.some((entry) => entry.card.number === 9), false, 'prêt sans carte en mouvement : hors de l’axe')
})

test('HOR-9 / HOR-10 : Ensuite (À régler, Prêt) et Plus tard (Idée, À affiner), dans l’ordre du tableau', () => {
  const list = entries([
    card(1, { milestone: true, position: 30 }),
    card(2, { milestone: true, position: 10, refinement: { conversationId: 's', title: 's', status: 'running', mode: 'questions', createdAt: NOW, draft: null, change: null } }),
    ...milestone(3, [card(4)], { position: 50 }),
    ...milestone(5, [card(6, { toClarifySince: NOW })], { position: 20 }),
  ])
  const { now, next, later } = horizonSections(list)
  assert.deepEqual(numbers(now), [])
  assert.deepEqual(numbers(next), [5, 3])
  assert.deepEqual(numbers(later), [2, 1])
})

test('HOR-12 : une carte cochée « C’est un jalon » arrive comme idée sous Plus tard', () => {
  const { later } = horizonSections(entries([card(240, { milestone: true })]))
  assert.deepEqual(numbers(later), [240])
  assert.equal(later[0]!.maturity, 'idea')
})

/* ------------------------------------------------------------------ HOR-5, HOR-7 */

test('HOR-5 : la barre court de la plus ancienne création à l’échéance, remplie de la part faite', () => {
  const [entry] = entries(
    milestone(1, [card(2, { column: 'done', createdAt: NOW - 12 * DAY }), card(3, { column: 'in_progress' }), card(4, { column: 'abandoned' })], {
      createdAt: NOW - 6 * DAY,
      dueAt: NOW + 4 * DAY,
    }),
  )
  const bar = milestoneBar(entry!, NOW)
  assert.equal(bar.start, NOW - 12 * DAY, 'une carte plus ancienne que son jalon tire le début')
  assert.equal(bar.end, NOW + 4 * DAY)
  assert.equal(bar.loose, false)
  assert.equal(bar.total, 2, 'les abandonnées ne comptent pas')
  assert.equal(bar.done, 1)
  assert.equal(bar.share, 0.5)
  assert.equal(bar.lateDays, 0)
})

test('HOR-5 : sans échéance, la barre va jusqu’à aujourd’hui (au moins un jour) en pointillé', () => {
  const [old] = entries(milestone(1, [card(2)], { createdAt: NOW - 6 * DAY }))
  assert.deepEqual([milestoneBar(old!, NOW).end, milestoneBar(old!, NOW).loose], [NOW, true])
  const [fresh] = entries(milestone(3, [card(4, { createdAt: NOW - 1000 })], { createdAt: NOW - 1000 }))
  assert.equal(milestoneBar(fresh!, NOW).end, NOW - 1000 + DAY)
})

test('HOR-5 : sans carte comptée, la part est nulle et non une division par zéro', () => {
  const [entry] = entries(milestone(1, [card(2, { column: 'abandoned' })]), [run('c-1')])
  const bar = milestoneBar(entry!, NOW)
  assert.deepEqual([bar.done, bar.total, bar.share], [0, 0, 0])
})

test('HOR-7 : en retard, les jours se comptent au calendrier ; livré, jamais', () => {
  const due = new Date(2026, 10, 9).getTime()
  const [late] = entries(milestone(1, [card(2, { column: 'in_progress' })], { dueAt: due }))
  assert.equal(milestoneBar(late!, NOW).lateDays, 3)
  const [delivered] = entries(milestone(3, [card(4, { column: 'done' })], { dueAt: due }))
  assert.equal(milestoneBar(delivered!, NOW).lateDays, 0)
})

test('HOR-5 : les sessions vivantes des cartes, archivées exclues, au statut du socket', () => {
  const [entry] = entries(
    milestone(1, [
      card(2, { conversations: [session('a', 'running'), session('b', 'idle'), session('c', 'running', NOW)] }),
      card(3, { conversations: [session('d', 'awaiting_input')] }),
    ]),
  )
  assert.equal(livesOf(entry!), 2)
  assert.equal(livesOf(entry!, (entry) => (entry.id === 'b' ? 'running' : entry.status)), 3)
})
