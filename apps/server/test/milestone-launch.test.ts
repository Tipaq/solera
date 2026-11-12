import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardConversationDto, CardDto, CardLinkDto, CardRefinementDto, MilestoneRunDto, ProjectEnvironmentsDto } from '@solera/protocol'
import type { SessionRequest } from '../../web/src/lib/session-request-summary.js'

const { horizonOf } = await import('../../web/src/lib/milestone-model.js')
const {
  environmentForMode,
  initialLaunchEnvironment,
  launchChecks,
  launchCheckText,
  launchEnvironments,
  launchReady,
  launchStage,
  manualRowOf,
  quotaWarning,
} = await import('../../web/src/lib/milestone-launch.js')

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

const refinement = (extra: Partial<CardRefinementDto> = {}): CardRefinementDto => ({
  conversationId: 'split-1', title: 'Affinage', status: 'idle', mode: 'questions', createdAt: NOW - DAY, draft: null, change: null, ...extra,
})

const run = (cardId: string) =>
  ({ id: `run-${cardId}`, cardId, state: 'running', mode: 'manual', concurrency: 2, createdAt: NOW - DAY, cards: [] }) as unknown as MilestoneRunDto

const questions = (...texts: string[]): SessionRequest =>
  ({
    kind: 'question',
    requestId: 'q-1',
    requestedAt: NOW - 1000,
    event: {
      type: 'question.requested',
      requestId: 'q-1',
      questions: texts.map((question, index) => ({ id: `q${index}`, header: 'h', question, multiSelect: false, allowOther: true, secret: false, options: [] })),
    },
  }) as SessionRequest

function only(cards: CardDto[], options: { runs?: MilestoneRunDto[]; requests?: Map<string, SessionRequest> } = {}) {
  const entries = horizonOf({ cards, runs: options.runs ?? [], requests: options.requests ?? new Map() })
  assert.equal(entries.length, 1)
  return entries[0]!
}

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')})` : key

/* ------------------------------------------------------------------ LCH-1, LCH-2 : l'étape du panneau */

test('LCH-1, LCH-2 : livré, rien à lancer, déjà lancé, ou à lancer', () => {
  assert.equal(launchStage(only(milestone(1, [card(2, { column: 'done' })]))), 'delivered')
  assert.equal(launchStage(only([card(1, { milestone: true })])), 'empty', 'une idée sans cartes')
  assert.equal(
    launchStage(only([card(1, { milestone: true, refinement: refinement({ status: 'running' }) })])),
    'empty',
    'à affiner, toujours sans cartes',
  )
  assert.equal(launchStage(only(milestone(1, [card(2)]), { runs: [run('c-1')] })), 'launched')
  assert.equal(launchStage(only(milestone(1, [card(2)]))), 'before', 'prêt')
  assert.equal(launchStage(only(milestone(1, [card(2, { toClarifySince: NOW })]))), 'before', 'à régler : on voit ce qui manque')
  assert.equal(
    launchStage(only(milestone(1, [card(2)], { refinement: refinement({ draft: { requestId: 'd', count: 2 } }) }))),
    'before',
    'à affiner avec des cartes',
  )
})

/* ------------------------------------------------------------------ LCH-11 : les vérifications */

test('LCH-11 : un jalon prêt passe toutes les vérifications, la concurrence en dernier', () => {
  const checks = launchChecks(only(milestone(1, [card(2), card(3)])), 4)
  assert.deepEqual(checks.map((check) => check.kind), ['clear', 'accepted', 'noCycle', 'startable', 'concurrency'])
  assert.equal(launchReady(checks), true)
  assert.equal(launchCheckText(checks.at(-1)!, t), 'milestone.launch.check.concurrency(count=4)')
})

test('LCH-11 : les échecs d’abord, chacun dit ce qui manque', () => {
  const a = card(2, { toClarifySince: NOW, acceptedAt: null })
  const b = card(3)
  const c = card(4)
  depend(b, c)
  depend(c, b)
  depend(a, b)
  const entry = only(milestone(1, [a, b, c]))
  const checks = launchChecks(entry, 3)
  assert.deepEqual(
    checks.map((check) => [check.kind, check.ok]),
    [['clear', false], ['accepted', false], ['noCycle', false], ['startable', false], ['concurrency', true]],
  )
  assert.equal(launchReady(checks), false)
  assert.deepEqual(
    checks.map((check) => launchCheckText(check, t)),
    [
      'milestone.launch.check.clear.fail.one(count=1)',
      'milestone.launch.check.accepted.fail.one(count=1)',
      'milestone.launch.check.noCycle.fail(cards=#3, #4)',
      'milestone.launch.check.startable.fail',
      'milestone.launch.check.concurrency(count=3)',
    ],
  )
})

test('LCH-11 : un échec remonte devant les vérifications passées, l’ordre est gardé sinon', () => {
  const entry = only(milestone(1, [card(2), card(3, { acceptedAt: null }), card(4, { acceptedAt: null })]))
  const checks = launchChecks(entry, 3)
  assert.deepEqual(checks.map((check) => check.kind), ['accepted', 'clear', 'noCycle', 'startable', 'concurrency'])
  assert.equal(launchCheckText(checks[0]!, t), 'milestone.launch.check.accepted.fail.other(count=2)')
})

test('LCH-11 : les questions et le brouillon de l’affinage comptent comme points d’affinage', () => {
  const asked = only(milestone(1, [card(2)], { refinement: refinement({ conversationId: 's' }) }), {
    requests: new Map([['s', questions('Une ?', 'Deux ?')]]),
  })
  const [first] = launchChecks(asked, 3)
  assert.equal(launchCheckText(first!, t), 'milestone.launch.check.clear.fail.other(count=2)')

  const drafted = only(milestone(1, [card(2)], { refinement: refinement({ draft: { requestId: 'd', count: 4 } }) }))
  const [draft] = launchChecks(drafted, 3)
  assert.equal(draft!.ok, false, 'un brouillon à valider n’est pas « rien à préciser »')
  assert.equal(launchCheckText(draft!, t), 'milestone.launch.check.clear.fail.one(count=1)', 'jamais « 0 point »')
})

/* ------------------------------------------------------------------ LCH-5, LCH-6 : l'environnement */

const host: ProjectEnvironmentsDto = {
  default: { where: 'host', confined: false },
  choices: [
    { where: 'host', confined: false },
    { where: 'host', confined: true },
    { where: 'devcontainer', confined: false },
    { where: 'devcontainer', confined: true },
  ],
  suggested: null,
  autonomousConfined: false,
}

test('LCH-5 : seuls les environnements à l’emplacement du projet, le libre d’abord', () => {
  assert.deepEqual(launchEnvironments(host), [
    { where: 'host', confined: false },
    { where: 'host', confined: true },
  ])
  const container = { ...host, default: { where: 'devcontainer', confined: true }, choices: [...host.choices].reverse() } as ProjectEnvironmentsDto
  assert.deepEqual(launchEnvironments(container), [
    { where: 'devcontainer', confined: false },
    { where: 'devcontainer', confined: true },
  ])
})

test('LCH-5 : on part du réglage du projet', () => {
  assert.deepEqual(initialLaunchEnvironment(host), { where: 'host', confined: false })
  const confined = { ...host, default: { where: 'host', confined: true } } as ProjectEnvironmentsDto
  assert.deepEqual(initialLaunchEnvironment(confined), { where: 'host', confined: true })
})

test('LCH-6 : passer en autonome confine d’office ; revenir à la main ne déconfine pas', () => {
  const choices = launchEnvironments(host)
  assert.deepEqual(environmentForMode('auto', { where: 'host', confined: false }, choices), { where: 'host', confined: true })
  assert.deepEqual(environmentForMode('auto', { where: 'host', confined: true }, choices), { where: 'host', confined: true })
  assert.deepEqual(environmentForMode('manual', { where: 'host', confined: true }, choices), { where: 'host', confined: true })
  assert.deepEqual(environmentForMode('manual', { where: 'host', confined: false }, choices), { where: 'host', confined: false })
})

test('LCH-6 : sans variante confinée sur cette plateforme, l’autonome garde le libre', () => {
  const bare = { ...host, choices: [{ where: 'host', confined: false }] } as ProjectEnvironmentsDto
  const choices = launchEnvironments(bare)
  assert.deepEqual(environmentForMode('auto', { where: 'host', confined: false }, choices), { where: 'host', confined: false })
})

/* ------------------------------------------------------------------ LCH-9 : quota */

test('LCH-9 : l’avertissement de quota au-delà de 3 à la fois', () => {
  assert.equal(quotaWarning(3), false)
  assert.equal(quotaWarning(4), true)
})

/* ------------------------------------------------------------------ LCH-7 : à la main */

test('LCH-7 : une carte qui travaille montre ses sessions, une prête et acceptée « Lancer », les autres « attend »', () => {
  const working = card(2, { column: 'in_progress', conversations: [session('s-2', 'running'), session('s-old', 'idle')] })
  const ready = card(3)
  const unaccepted = card(4, { acceptedAt: null })
  const blocked = card(5)
  depend(blocked, ready)
  const entry = only(milestone(1, [working, ready, unaccepted, blocked]))
  const row = manualRowOf(working, entry)
  assert.equal(row.kind, 'live')
  assert.deepEqual(row.kind === 'live' ? row.sessions.map((entry) => entry.id) : [], ['s-2'])
  assert.deepEqual(manualRowOf(ready, entry), { kind: 'launch' })
  assert.deepEqual(manualRowOf(unaccepted, entry), { kind: 'waits' })
  assert.deepEqual(manualRowOf(blocked, entry), { kind: 'waits' })
})

test('LCH-7 : le statut vivant prime sur celui du chargement', () => {
  const ready = card(2, { conversations: [session('s-2', 'idle')] })
  const entry = only(milestone(1, [ready]))
  assert.deepEqual(manualRowOf(ready, entry), { kind: 'launch' })
  const live = manualRowOf(ready, entry, () => 'running')
  assert.equal(live.kind, 'live')
})
