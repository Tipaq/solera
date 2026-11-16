import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  CardConversationDto,
  CardDto,
  CardLinkDto,
  ConversationDto,
  ConversationStatus,
  ProjectPullRequestDto,
  WorktreeStatusDto,
  WorktreeStatusListDto,
} from '@solera/protocol'

const { horizonOf } = await import('../../web/src/lib/milestone-model.js')
const { otherActiveSessions, pullRequestChecks, readyCards, sessionInMilestone, sessionWorktree } = await import(
  '../../web/src/lib/project-pane.js'
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

const session = (id: string, status: ConversationStatus, archivedAt: number | null = null): CardConversationDto => ({
  id, title: id, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt, createdAt: NOW - DAY,
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
    conversations: [],
    blocks: [],
    blockedBy: [],
    references: [],
    referencedBy: [],
    ...extra,
  }) as CardDto

/** Une conversation vivante telle que `useLiveConversations` la rend. */
const live = (id: string, status: ConversationStatus, extra: Partial<ConversationDto> = {}) => ({
  conversation: { id, title: `fil ${id}`, agent: 'claude', archivedAt: null, card: null, ...extra } as ConversationDto,
  status,
  running: status === 'running',
  awaiting: status === 'awaiting_input',
})

/* ------------------------------------------------------------- prêtes à partir */

test('readyCards : à faire, acceptée, rien à préciser, bloqueurs fermés, sans session vivante', () => {
  const blockerDone = card(1, { column: 'done' })
  const blockerOpen = card(2, { column: 'in_progress' })
  const cards = [
    blockerDone,
    blockerOpen,
    card(10, { blockedBy: [link(blockerDone)] }), // prête : son bloqueur est fait
    card(11, { blockedBy: [link(blockerOpen)] }), // bloquée
    card(12, { acceptedAt: null }), // pas acceptée
    card(13, { toClarifySince: NOW - DAY }), // à préciser
    card(14, { conversations: [session('s', 'running')] }), // une session y travaille
    card(15, { conversations: [session('s', 'awaiting_input')] }), // une session y attend
    card(16, { conversations: [session('s', 'idle'), session('t', 'running', NOW)] }), // repos, et une rangée
    card(17, { column: 'in_progress' }), // déjà partie
    card(18, { children: [link(card(19))] }), // un regroupement
  ]
  assert.deepEqual(readyCards(cards).map((entry: CardDto) => entry.number), [10, 16])
})

test('readyCards : un bloqueur abandonné ne retient plus ; ordre du tableau', () => {
  const dropped = card(1, { column: 'abandoned' })
  const cards = [card(30, { position: 2 }), card(31, { position: 1, blockedBy: [link(dropped)] }), card(32, { position: 3 })]
  assert.deepEqual(readyCards(cards).map((entry: CardDto) => entry.number), [31, 30, 32])
})

test('readyCards : le statut vivant prime sur celui du chargement', () => {
  const cards = [card(40, { conversations: [session('s-40', 'idle')] })]
  assert.equal(readyCards(cards, (entry: { id: string; status: ConversationStatus }) => (entry.id === 's-40' ? 'running' : entry.status)).length, 0)
})

/* ------------------------------------------------------- autres sessions actives */

test('otherActiveSessions : celles qui attendent d’abord, sans la session ni les rangées', () => {
  const rows = otherActiveSessions(
    [
      live('here', 'running'),
      live('a', 'running', { card: { id: 'c-5', number: 5, title: 'cinq', column: 'in_progress' } }),
      live('b', 'awaiting_input'),
      live('c', 'idle'),
      live('d', 'error'),
      live('e', 'running', { archivedAt: NOW }),
      live('f', 'awaiting_input'),
    ],
    'here',
  )
  assert.deepEqual(rows.map((row: { id: string }) => row.id), ['b', 'f', 'a'])
  assert.deepEqual(rows[2], { id: 'a', title: 'fil a', agent: 'claude', awaiting: false, card: 5 })
  assert.equal(rows[0].card, null)
})

/* ---------------------------------------------------------- branche de la session */

const tree = (name: string, conversations: string[], extra: Partial<WorktreeStatusDto> = {}): WorktreeStatusDto =>
  ({
    id: name, name, path: `/w/${name}`, branch: `feat/${name}`, external: false, state: 'active',
    ahead: 0, behind: 0, modified: 0, untracked: 0, conflicts: false,
    conversations: conversations.map((id) => ({ id, link: 'session' })),
    card: null, cardSource: null, ...extra,
  }) as WorktreeStatusDto

test('sessionWorktree : l’arbre où la session travaille, null à la racine ou avant lecture', () => {
  const list = { worktrees: [tree('a', ['x']), tree('b', ['y', 'here'])] } as WorktreeStatusListDto
  assert.equal(sessionWorktree(list, 'here')?.name, 'b')
  assert.equal(sessionWorktree(list, 'nowhere'), null)
  assert.equal(sessionWorktree(undefined, 'here'), null)
})

test('pullRequestChecks : réussis sur le total, null sans check', () => {
  const pr = (checks: ProjectPullRequestDto['checks']) => ({ checks }) as ProjectPullRequestDto
  assert.deepEqual(pullRequestChecks(pr({ passed: 6, pending: 2, failed: ['lint'] })), { passed: 6, total: 9 })
  assert.equal(pullRequestChecks(pr({ passed: 0, pending: 0, failed: [] })), null)
})

/* ------------------------------------------------------------- jalon de la session */

test('sessionInMilestone : la carte de la session est-elle dans le jalon ?', () => {
  const kid = card(50)
  const outsider = card(60)
  const parent = card(5, { milestone: true, children: [link(kid)] })
  kid.parent = link(parent)
  const [entry] = horizonOf({ cards: [parent, kid, outsider], runs: [], requests: new Map() })
  assert.equal(sessionInMilestone(entry, kid), true)
  assert.equal(sessionInMilestone(entry, parent), true, 'la carte-jalon elle-même en fait partie')
  assert.equal(sessionInMilestone(entry, outsider), false)
  assert.equal(sessionInMilestone(entry, null), null, 'sans carte, rien à dire')
})
