import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  CardConversationDto,
  CardDto,
  CardLinkDto,
  MilestoneRunCardDto,
  MilestoneRunDto,
  ProjectEnvironmentsDto,
} from '@solera/protocol'

const { horizonOf } = await import('../../web/src/lib/milestone-model.js')
const { canConfine, prStage, runConfined, runMergeLabel, runRowsOf, runTitle } = await import('../../web/src/lib/milestone-run.js')

/*
 * Le suivi d'un jalon lancé (#198, spec jalons RUN-1..12) : ce que dit chaque ligne, quand
 * « Lancer » s'offre à la main, le titre, le confinement et la PR finale.
 */

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

const runCard = (card: CardDto, extra: Partial<MilestoneRunCardDto> = {}): MilestoneRunCardDto => ({
  cardId: card.id,
  number: card.number,
  title: card.title,
  layer: 0,
  status: 'queued',
  blockReason: null,
  blockedBy: [],
  conversationId: null,
  conversationTitle: null,
  conversationStatus: null,
  worktreeName: null,
  agent: null,
  model: null,
  error: null,
  ...extra,
})

const run = (cardId: string, extra: Partial<MilestoneRunDto> = {}): MilestoneRunDto => ({
  id: `run-${cardId}`,
  cardId,
  cardNumber: 1,
  cardTitle: 'jalon',
  state: 'running',
  mode: 'auto',
  concurrency: 3,
  confined: null,
  agent: 'claude',
  model: 'opus',
  branch: 'jalon/1-jalon',
  busy: 0,
  cards: [],
  createdAt: NOW - DAY,
  endedAt: null,
  ...extra,
})

function only(cards: CardDto[], runs: MilestoneRunDto[] = []) {
  const entries = horizonOf({ cards, runs, requests: new Map() })
  assert.equal(entries.length, 1)
  return entries[0]!
}

const environments = (extra: Partial<ProjectEnvironmentsDto> = {}): ProjectEnvironmentsDto => ({
  default: { where: 'host', confined: false },
  choices: [
    { where: 'host', confined: false },
    { where: 'host', confined: true },
    { where: 'devcontainer', confined: false },
  ],
  suggested: null,
  autonomousConfined: true,
  ...extra,
})

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')})` : key

/* ------------------------------------------------------------------ RUN-1 */

test('RUN-1 : en pause, lancé en autonome, ou lancé à la main', () => {
  assert.equal(runTitle(run('c-1', { state: 'paused', mode: 'auto' })), 'paused', 'la pause l’emporte sur le mode')
  assert.equal(runTitle(run('c-1', { mode: 'auto' })), 'auto')
  assert.equal(runTitle(run('c-1', { mode: 'manual' })), 'manual')
})

/* ------------------------------------------------------------------ RUN-5 */

test('RUN-5 : le statut de pilotage de chaque carte, dans les mots du suivi', () => {
  const kids = [card(2), card(3), card(4), card(5), card(6), card(7), card(8), card(9), card(10), card(11)]
  const cards = milestone(1, kids)
  const statuses = ['waiting', 'queued', 'launching', 'working', 'reviewing', 'merging', 'blocked', 'done', 'abandoned', 'failed'] as const
  const pilot = run('c-1', { cards: kids.map((kid, index) => runCard(kid, { status: statuses[index] })) })
  assert.deepEqual(
    runRowsOf(only(cards, [pilot]), pilot).map((row) => [row.card.number, row.status]),
    [
      [2, 'waiting'],
      [3, 'queued'],
      [4, 'working'],
      [5, 'working'],
      [6, 'review'],
      [7, 'review'],
      [8, 'blocked'],
      [9, 'merged'],
      [10, 'abandoned'],
      [11, 'failed'],
    ],
  )
})

test('RUN-5 : une carte bloquée garde sa raison et son erreur, pour l’infobulle', () => {
  const kid = card(2)
  const pilot = run('c-1', { cards: [runCard(kid, { status: 'blocked', blockReason: 'escalated', error: null })] })
  const [row] = runRowsOf(only(milestone(1, [kid]), [pilot]), pilot)
  assert.equal(row!.status, 'blocked')
  assert.equal(row!.blockReason, 'escalated')
})

test('RUN-5 : une session qui attend se voit tout de suite, avant que le pilotage la relise', () => {
  const kid = card(2, { column: 'in_progress', conversations: [session('s2', 'running')] })
  const pilot = run('c-1', { cards: [runCard(kid, { status: 'working' })] })
  const entry = only(milestone(1, [kid]), [pilot])
  const [row] = runRowsOf(entry, pilot, (conversation) => (conversation.id === 's2' ? 'awaiting_input' : conversation.status))
  assert.equal(row!.status, 'blocked', 'le statut vivant du socket')
  assert.equal(row!.blockReason, 'awaiting_input')
})

test('RUN-11 : une carte ajoutée que le pilotage n’a pas encore adoptée a quand même sa ligne', () => {
  const blocker = card(2)
  const added = card(3, { createdAt: NOW })
  depend(added, blocker)
  const fresh = card(4, { createdAt: NOW })
  const closed = card(5, { column: 'done' })
  const pilot = run('c-1', { cards: [runCard(blocker, { status: 'working' })] })
  assert.deepEqual(
    runRowsOf(only(milestone(1, [blocker, added, fresh, closed]), [pilot]), pilot).map((row) => [row.card.number, row.status]),
    [
      [2, 'working'],
      [3, 'waiting'],
      [4, 'queued'],
      [5, 'merged'],
    ],
  )
})

test('RUN-5 : à la main, « Lancer » sur une carte en file et acceptée, jamais en autonome', () => {
  const ready = card(2)
  const refused = card(3, { acceptedAt: null })
  const waiting = card(4)
  const cards = milestone(1, [ready, refused, waiting])
  const pilotCards = [runCard(ready), runCard(refused), runCard(waiting, { status: 'waiting' })]

  const manual = run('c-1', { mode: 'manual', cards: pilotCards })
  assert.deepEqual(runRowsOf(only(cards, [manual]), manual).map((row) => row.launch), [true, false, false])

  const auto = run('c-1', { mode: 'auto', cards: pilotCards })
  assert.deepEqual(runRowsOf(only(cards, [auto]), auto).map((row) => row.launch), [false, false, false])
})

/* ------------------------------------------------------------------ RUN-4 */

test('RUN-4 : le confinement du pilotage, ou celui des sessions autonomes du projet', () => {
  assert.equal(runConfined(run('c-1', { confined: false }), environments()), false)
  assert.equal(runConfined(run('c-1', { confined: true }), environments({ autonomousConfined: false })), true)
  assert.equal(runConfined(run('c-1', { confined: null }), environments({ autonomousConfined: true })), true)
  assert.equal(runConfined(run('c-1', { confined: null }), environments({ autonomousConfined: false })), false)
  assert.equal(runConfined(run('c-1', { confined: null }), undefined), null, 'pas encore lus')
})

test('RUN-4 : confiner n’est offert que si l’emplacement du projet le permet', () => {
  assert.equal(canConfine(environments()), true)
  assert.equal(
    canConfine(environments({ choices: [{ where: 'host', confined: false }, { where: 'devcontainer', confined: true }] })),
    false,
    'l’emplacement suit le projet : le dev container ne compte pas pour un projet sur l’hôte',
  )
})

/* ------------------------------------------------------------------ RUN-9, RUN-12 */

test('RUN-9 : la PR finale, ouverte ou fermée sans fusion ; rien sans PR', () => {
  const pr = { number: 7, url: 'https://forge/pr/7', base: 'main', mergedAt: null, closedAt: null }
  const done = [card(2, { column: 'done' })]
  assert.equal(prStage(only(milestone(1, done, { branch: 'jalon/1', branchPr: pr }))), 'open')
  assert.equal(prStage(only(milestone(1, done, { branch: 'jalon/1', branchPr: { ...pr, closedAt: NOW } }))), 'closed')
  assert.equal(prStage(only(milestone(1, [card(2)]), [run('c-1')])), null)
})

test('RUN-12 : « Fusionner dans {base} », la base relevée sur la forge, sinon la branche par défaut', () => {
  const pr = { number: 7, url: 'u', base: 'trunk', mergedAt: null, closedAt: null }
  assert.equal(runMergeLabel(pr, t), 'milestone.run.merge(base=trunk)')
  assert.equal(runMergeLabel({ ...pr, base: null }, t), 'milestone.run.mergeDefault')
})
