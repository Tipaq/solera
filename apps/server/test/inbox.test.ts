import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardDto, ConversationDto, ConversationStatus, ProjectDto, ProjectPullRequestDto } from '@solera/protocol'
import type { LiveConversation } from '../../web/src/lib/activity.js'
import type { SessionRequest } from '../../web/src/lib/session-request-summary.js'

// Hors navigateur, les catalogues restent sur l'anglais, la langue de repli.
const { buildInbox, inboxMilestoneNumber, inboxSummary, waitingByMilestone } = await import('../../web/src/lib/inbox.js')
const { requestSummary } = await import('../../web/src/lib/session-request-summary.js')
const { translate } = await import('../../web/src/lib/i18n/index.js')

const project = (id: string, name = id) => ({ id, name }) as ProjectDto
const projects = new Map([project('p1', 'Nimbus'), project('p2', 'Cirrus')].map((entry) => [entry.id, entry]))

function live(
  id: string,
  status: ConversationStatus,
  extra: Partial<ConversationDto> & { since?: number } = {},
): LiveConversation {
  const { since = 100, ...fields } = extra
  const conversation = {
    id, projectId: 'p1', title: `Session ${id}`, agent: 'claude', card: null, milestone: null,
    isOwner: true, archivedAt: null, updatedAt: since, ...fields,
  } as ConversationDto
  return {
    conversation, status, running: status === 'running', awaiting: status === 'awaiting_input',
    unread: false, settledAt: since, since, seq: 0,
  }
}

const question = (text: string): SessionRequest => ({
  kind: 'question', requestId: 'r', requestedAt: 1,
  event: {
    type: 'question.requested', requestId: 'r',
    questions: [{ id: 'q', header: '', question: text, options: [], multiSelect: false, allowOther: true, secret: false }],
  },
})

const card = (id: string, number: number, extra: Partial<CardDto> = {}) =>
  ({ id, number, title: `Carte ${number}`, projectId: 'p1', column: 'review', columnSince: 50, children: [], ...extra }) as CardDto

const pullRequest = (number: number, state: ProjectPullRequestDto['state'], updatedAt = 10): ProjectPullRequestDto => ({
  number, url: `https://github.com/o/r/pull/${number}`, title: `PR ${number}`, branch: `feat/${number}`, base: 'main',
  state, checks: { passed: 1, pending: 0, failed: [] }, review: null, updatedAt,
})

const keys = (items: { key: string }[]) => items.map((item) => item.key)

test('boîte : seules les sessions qui te demandent quelque chose y entrent', () => {
  const items = buildInbox({
    live: [
      live('waiting', 'awaiting_input'),
      live('fallen', 'error'),
      live('stopped', 'interrupted'),
      live('busy', 'running'),
      live('quiet', 'idle'),
      // Une décision ou une question asynchrone ouverte, sans tenir le fil en attente.
      live('asking', 'idle'),
    ],
    requests: new Map([['asking', question('Garder l’ancien composant ?')]]),
    projects,
    prefixProject: false,
  })
  assert.deepEqual(keys(items).sort(), ['s-asking', 's-fallen', 's-stopped', 's-waiting'])
  const tone = new Map(items.map((item) => [item.key, item.kind === 'session' ? item.tone : null]))
  assert.equal(tone.get('s-fallen'), 'broken')
  assert.equal(tone.get('s-stopped'), 'broken')
  assert.equal(tone.get('s-waiting'), 'awaiting')
  assert.equal(tone.get('s-asking'), 'awaiting')
})

test('boîte : une ligne de session porte sa demande, sa carte, son jalon et son fil', () => {
  const request = question('Où le voit-on ?')
  const [item] = buildInbox({
    live: [live('w', 'awaiting_input', {
      card: { id: 'c', number: 163, title: 'AskInbox', column: 'in_progress' },
      milestone: { id: 'm', number: 157, title: 'Socle commun' },
      isOwner: false,
      since: 42,
    })],
    requests: new Map([['w', request]]),
    projects,
    prefixProject: false,
  })
  assert.ok(item?.kind === 'session')
  assert.equal(item.conversationId, 'w')
  assert.equal(item.title, 'Session w')
  assert.equal(item.project, null)
  assert.equal(item.cardNumber, 163)
  assert.deepEqual(item.milestone, { number: 157, title: 'Socle commun', to: '/p/p1/timeline/157' })
  assert.equal(item.threadPath, '/p/p1/c/w')
  assert.equal(item.request, request)
  assert.equal(item.canDecide, false)
  // L'âge est celui de la demande, pas de la dernière écriture du fil.
  assert.equal(item.since, request.requestedAt)
  assert.equal(item.agent, 'claude')
})

test('boîte : sans demande lisible, l’âge est celui de la dernière écriture du fil', () => {
  const [item] = buildInbox({ live: [live('w', 'error', { since: 42 })], requests: new Map(), projects, prefixProject: false })
  assert.equal(item?.kind === 'session' && item.since, 42)
})

test('boîte : hors d’un projet, chaque ligne dit le sien ; un fil libre s’ouvre hors projet', () => {
  const items = buildInbox({
    live: [live('a', 'awaiting_input', { projectId: 'p2' }), live('free', 'awaiting_input', { projectId: null })],
    requests: new Map(),
    projects,
    prefixProject: true,
  })
  const byKey = new Map(items.map((item) => [item.key, item]))
  const a = byKey.get('s-a')
  const free = byKey.get('s-free')
  assert.ok(a?.kind === 'session' && free?.kind === 'session')
  assert.equal(a.project, 'Cirrus')
  assert.equal(a.threadPath, '/p/p2/c/a')
  assert.equal(free.project, null)
  assert.equal(free.threadPath, '/c/free')
  // Le portefeuille filtre par projet : chaque ligne porte le sien, nommé ou non.
  assert.equal(a.projectId, 'p2')
  assert.equal(free.projectId, null)
})

test('boîte : les cartes feuilles à relire et les PR prêtes, en lignes légères', () => {
  const items = buildInbox({
    live: [],
    requests: new Map(),
    projects,
    reviewCards: [
      card('leaf', 12),
      // Un jalon se déduit de ses enfants : relire ses enfants suffit.
      card('parent', 3, { children: [{ id: 'leaf', number: 12, title: 'Carte 12', column: 'review' }] }),
      card('todo', 14, { column: 'todo' }),
    ],
    pullRequests: [
      { projectId: 'p1', pullRequest: pullRequest(17, 'ready') },
      { projectId: 'p1', pullRequest: pullRequest(18, 'checks') },
      { projectId: 'p1', pullRequest: pullRequest(19, 'merged') },
    ],
    prefixProject: false,
  })
  assert.deepEqual(keys(items), ['pr-p1-17', 'c-leaf'])
  const [pr, review] = items
  assert.ok(pr?.kind === 'light' && review?.kind === 'light')
  assert.deepEqual(
    { tone: review.tone, number: review.number, to: review.to, external: review.external, since: review.since, projectId: review.projectId },
    { tone: 'review-card', number: 12, to: '/p/p1/board?carte=12', external: false, since: 50, projectId: 'p1' },
  )
  assert.deepEqual(
    { tone: pr.tone, number: pr.number, title: pr.title, to: pr.to, external: pr.external, projectId: pr.projectId },
    { tone: 'review-pr', number: 17, title: 'PR 17', to: 'https://github.com/o/r/pull/17', external: true, projectId: 'p1' },
  )
})

test('boîte : les lourdes avant les légères, chacune de la plus ancienne à la plus récente', () => {
  const items = buildInbox({
    live: [live('recent', 'awaiting_input', { since: 300 }), live('old', 'error', { since: 100 })],
    requests: new Map(),
    projects,
    reviewCards: [card('late', 2, { columnSince: 5 }), card('early', 1, { columnSince: 1 })],
    pullRequests: [{ projectId: 'p1', pullRequest: pullRequest(7, 'ready', 3) }],
    extra: [{ kind: 'merge', key: 'm-157', milestone: { number: 157, title: 'Socle', to: '/x' }, branch: 'jalon/157', base: 'main', onMerge: () => {} }],
    prefixProject: false,
  })
  assert.deepEqual(keys(items), ['s-old', 's-recent', 'm-157', 'c-early', 'pr-p1-7', 'c-late'])
  assert.deepEqual(inboxSummary(items), { requests: 3, review: 3 })
})

test('boîte : le jalon d’une demande, et ce qui attend dans chaque jalon', () => {
  const milestone = { id: 'm', number: 157, title: 'Socle' }
  const items = buildInbox({
    live: [
      live('a', 'awaiting_input', { milestone, since: 1 }),
      live('b', 'error', { milestone, since: 2 }),
      live('c', 'awaiting_input'),
    ],
    requests: new Map(),
    projects,
    reviewCards: [card('leaf', 12)],
    extra: [{ kind: 'refine', key: 'q-182', milestone: { number: 182, title: 'Jalons', to: '/y' }, questions: [{ id: '1', text: '?' }], onAnswer: () => {} }],
    prefixProject: false,
  })
  assert.deepEqual(items.map(inboxMilestoneNumber), [157, 157, null, 182, null])
  assert.deepEqual(
    [...waitingByMilestone(items)],
    [[157, { count: 2, key: 's-a' }], [182, { count: 1, key: 'q-182' }]],
  )
})

test('résumé d’une demande : la question, la permission, le plan, la saisie, la décision', () => {
  const permission = (input: unknown, title?: string): SessionRequest => ({
    kind: 'permission', requestId: 'r', requestedAt: 1,
    event: { type: 'permission.requested', requestId: 'r', toolName: 'Bash', input, suggestions: [], ...(title ? { title } : {}) },
  })
  assert.equal(requestSummary(question('Garder l’ancien composant ?'), translate), 'Garder l’ancien composant ?')
  assert.equal(requestSummary(permission({ command: 'pnpm install' }), translate), 'Bash : pnpm install')
  assert.equal(requestSummary(permission({ file_path: 'src/a.ts' }), translate), 'Bash : src/a.ts')
  // Une entrée sans cible lisible : le titre du CLI, ou une phrase faite de l'outil.
  assert.equal(requestSummary(permission({ x: 1 }, 'Écrire dans le dépôt'), translate), 'Écrire dans le dépôt')
  assert.equal(requestSummary(permission({ x: 1 }), translate), 'Bash is requesting a permission')
  assert.equal(
    requestSummary({ kind: 'plan', requestId: 'r', requestedAt: 1, event: { type: 'plan.review_requested', requestId: 'r', plan: '' } } as SessionRequest, translate),
    'A plan awaits your approval',
  )
  assert.equal(
    requestSummary({
      kind: 'elicitation', requestId: 'r', requestedAt: 1,
      event: { type: 'elicitation.requested', requestId: 'r', serverName: 'github', message: 'Jeton ?' },
    } as SessionRequest, translate),
    'github : Jeton ?',
  )
  assert.equal(requestSummary({ kind: 'decision', requestId: 'd', requestedAt: 1, question: 'Lequel ?' }, translate), 'Lequel ?')
})
