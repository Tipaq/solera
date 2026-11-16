import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardBranchPrDto, CardDraft, CardDto, ConversationDto, ProjectDto, ProjectPullRequestDto } from '@solera/protocol'
import type { LiveConversation } from '../../web/src/lib/activity.js'
import type { HeavyInboxItem } from '../../web/src/lib/inbox.js'
import type { MilestoneAsk } from '../../web/src/lib/milestone-model.js'

const { buildInbox, waitingByMilestone } = await import('../../web/src/lib/inbox.js')
const { milestoneInbox } = await import('../../web/src/lib/milestone-inbox.js')

/*
 * Les demandes des jalons dans « Ce qui t'attend » (#255) : chaque demande de
 * `milestoneAsks` devient une ligne qui porte son geste et le lien du jalon, et prend la
 * place de la ligne qui disait la même chose — la session d'affinage, la PR prête.
 */

const milestone = (number: number) => ({ id: `c-${number}`, number, title: `Jalon ${number}` }) as CardDto
const pr = (extra: Partial<CardBranchPrDto> = {}): CardBranchPrDto => ({
  number: 7, url: 'https://forge/pr/7', base: 'main', mergedAt: null, closedAt: null, ...extra,
})

const refine = (number = 1): Extract<MilestoneAsk, { kind: 'refine' }> => ({
  kind: 'refine', key: `refine-c-${number}`, milestone: milestone(number), conversationId: `split-${number}`, requestId: 'q-1',
  questions: [{ id: 'q0', text: 'Pour qui ?' }, { id: 'q1', text: 'Pour quand ?' }],
})
const draft = (number = 1): Extract<MilestoneAsk, { kind: 'draft' }> => ({
  kind: 'draft', key: `draft-c-${number}`, milestone: milestone(number), conversationId: `split-${number}`, requestId: 'd-1', count: 2,
})
const merge = (number = 2, extra: Partial<CardBranchPrDto> = {}): Extract<MilestoneAsk, { kind: 'merge' }> => ({
  kind: 'merge', key: `merge-c-${number}`, milestone: milestone(number), branch: `jalon/${number}`, pr: pr(extra),
})

const proposal: CardDraft = {
  parent: null,
  cards: [
    { key: 'a', title: 'Compte', description: '', subtasks: [], after: [], blockedBy: [], related: [] },
    { key: 'b', title: 'Onglet', description: '', subtasks: [], after: ['a'], blockedBy: [], related: [] },
  ],
}

/** Les gestes, en doublure : on note ce qu'ils reçoivent, rien ne part. */
function spies() {
  const calls: unknown[][] = []
  return {
    calls,
    gestures: {
      answer: (...args: unknown[]) => void calls.push(['answer', ...args]),
      validate: (...args: unknown[]) => void calls.push(['validate', ...args]),
      merge: (...args: unknown[]) => void calls.push(['merge', ...args]),
    },
  }
}

type Input = Parameters<typeof milestoneInbox>[0]
function build(asks: MilestoneAsk[], extra: Partial<Input> = {}) {
  const { calls, gestures } = spies()
  const result = milestoneInbox({
    projectId: 'p1',
    asks,
    drafts: new Map(),
    answers: {},
    owns: () => true,
    stopped: () => false,
    defaultBase: 'la branche par défaut',
    errorOf: () => null,
    gestures,
    ...extra,
  })
  return { ...result, calls }
}

const only = <K extends HeavyInboxItem['kind']>(items: HeavyInboxItem[], kind: K) => {
  assert.equal(items.length, 1)
  assert.equal(items[0]!.kind, kind)
  return items[0] as Extract<HeavyInboxItem, { kind: K }>
}

test('INB-8 : les questions d’affinage, avec le lien du jalon, à la place de la session qui les pose', () => {
  const ask = refine()
  const { items, replaces, calls } = build([ask])
  const item = only(items, 'refine')
  assert.equal(item.key, 'refine-c-1')
  assert.deepEqual(item.milestone, { number: 1, title: 'Jalon 1', to: '/p/p1/timeline/1' })
  assert.deepEqual(item.questions, ask.questions)
  assert.deepEqual(replaces, ['s-split-1'])
  item.onAnswer('q1', 'Tim')
  assert.deepEqual(calls, [['answer', ask, 'q1', 'Tim']])
})

test('INB-8 : une question répondue sort de la ligne ; toutes répondues, la ligne part, la session reste cachée', () => {
  const ask = refine()
  const partial = only(build([ask], { answers: { 'q-1': { q0: ['Tim'] } } }).items, 'refine')
  assert.deepEqual(partial.questions, [{ id: 'q1', text: 'Pour quand ?' }])

  const sent = build([ask], { answers: { 'q-1': { q0: ['Tim'], q1: ['Demain'] } } })
  assert.deepEqual(sent.items, [], 'la réponse part : rien à redemander')
  assert.deepEqual(sent.replaces, ['s-split-1'], 'la question se lève : la session ne la repose pas entre-temps')

  const other = only(build([ask], { answers: { 'q-0': { q0: ['Tim'] } } }).items, 'refine')
  assert.equal(other.questions.length, 2, 'les réponses d’une autre demande ne comptent pas')
})

test('INB-9 : le découpage proposé, ses cartes lues au brouillon ; « Valider » le transmet tel quel', () => {
  const ask = draft()
  const { items, replaces, calls } = build([ask], { drafts: new Map([['c-1', proposal]]) })
  const item = only(items, 'draft')
  assert.deepEqual(item.cards, [{ key: 'a', title: 'Compte', after: [] }, { key: 'b', title: 'Onglet', after: ['a'] }])
  assert.deepEqual(replaces, ['s-split-1'])
  item.onValidate()
  assert.deepEqual(calls, [['validate', ask, proposal]])
})

test('INB-9 : le brouillon pas encore lu ne fait pas de ligne vide ; la session garde la sienne d’ici là', () => {
  const { items, replaces } = build([draft()])
  assert.deepEqual(items, [])
  assert.deepEqual(replaces, [], 'la demande ne disparaît pas de la liste le temps de la lecture')
})

test('INB-9 : un brouillon ne se valide pas tant que ses questions sont ouvertes (AFF-6)', () => {
  const { items } = build([refine(), draft()], { drafts: new Map([['c-1', proposal]]) })
  assert.deepEqual(items.map((item) => item.kind), ['refine'])
})

test('INB-8, INB-9 : la session d’un autre ne se répond pas d’ici ; elle reste dans sa propre ligne', () => {
  const { items, replaces } = build([refine(), draft(3)], { owns: () => false, drafts: new Map([['c-3', proposal]]) })
  assert.deepEqual(items, [])
  assert.deepEqual(replaces, [])
})

test('INB-10 : la PR du jalon, fusionnée dans sa base, à la place de la PR prête', () => {
  const ask = merge()
  const { items, replaces, calls } = build([ask])
  const item = only(items, 'merge')
  assert.equal(item.branch, 'jalon/2')
  assert.equal(item.base, 'main')
  assert.equal(item.error, null)
  assert.deepEqual(replaces, ['pr-p1-7'])
  item.onMerge()
  assert.deepEqual(calls, [['merge', ask]])

  const unknown = only(build([merge(2, { base: null })]).items, 'merge')
  assert.equal(unknown.base, 'la branche par défaut', 'une base pas encore relevée sur la forge')
  const failed = only(build([ask], { errorOf: (kind, id) => (kind === 'merge' && id === 'c-2' ? 'conflit' : null) }).items, 'merge')
  assert.equal(failed.error, 'conflit')
})

test('un refus ne se tait pas : la réponse et la validation refusées le disent dans leur ligne', () => {
  const refused = (kind: string, id: string) => (id === 'c-1' ? `${kind} refusé` : null)
  const refine1 = only(build([refine()], { errorOf: refused }).items, 'refine')
  assert.equal(refine1.error, 'refine refusé')
  assert.equal(refine1.questions.length, 2, 'les questions reviennent toutes : la réponse se renvoie entière')
  const draft1 = only(build([draft()], { errorOf: refused, drafts: new Map([['c-1', proposal]]) }).items, 'draft')
  assert.equal(draft1.error, 'draft refusé')
  const clean = build([refine(), draft(3)], { drafts: new Map([['c-3', proposal]]) }).items
  assert.deepEqual(clean.map((item) => ('error' in item ? item.error : undefined)), [null, null])
})

test('INB-6 : une session d’affinage arrêtée garde sa ligne « La session s’est arrêtée »', () => {
  const stopped = build([refine(), draft(3)], { stopped: (id) => id === 'split-1', drafts: new Map([['c-3', proposal]]) })
  assert.deepEqual(stopped.items.map((item) => item.key), ['draft-c-3'], 'rien ne répond à une session qui ne tourne plus')
  assert.deepEqual(stopped.replaces, ['s-split-3'], 'la session arrêtée n’est pas cachée')
})

test('INB-6, dans la liste : la session arrêtée reste, avec son signal', () => {
  const extra = build([refine(1)], { stopped: () => true })
  const items = buildInbox({
    live: [{ ...live('split-1', 1), status: 'error', awaiting: false }],
    requests: new Map(),
    projects: new Map([['p1', { id: 'p1', name: 'Nimbus' } as ProjectDto]]),
    prefixProject: false,
    extra,
  })
  assert.deepEqual(items.map((item) => [item.key, item.kind === 'session' ? item.tone : null]), [['s-split-1', 'broken']])
})

/* ------------------------------------------------------------------ dans la liste */

function live(id: string, milestoneNumber: number | null): LiveConversation {
  const conversation = {
    id, projectId: 'p1', title: id, agent: 'claude', card: null, isOwner: true, archivedAt: null, updatedAt: 100,
    milestone: milestoneNumber === null ? null : { number: milestoneNumber, title: `Jalon ${milestoneNumber}` },
  } as ConversationDto
  return { conversation, status: 'awaiting_input', running: false, awaiting: true, unread: false, settledAt: 100, since: 100, seq: 0 }
}

test('une demande à un seul endroit : la session et la PR remplacées sortent de la liste, le repère compte juste', () => {
  const extra = build([refine(1), merge(2)]).items
  const replaces = build([refine(1), merge(2)]).replaces
  const ready = { number: 7, title: 'Jalon 2', state: 'ready', url: 'u', updatedAt: 5 } as ProjectPullRequestDto
  const other = { number: 8, title: 'Autre', state: 'ready', url: 'v', updatedAt: 6 } as ProjectPullRequestDto
  const items = buildInbox({
    live: [live('split-1', 1), live('s-autre', 1)],
    requests: new Map(),
    projects: new Map([['p1', { id: 'p1', name: 'Nimbus' } as ProjectDto]]),
    pullRequests: [{ projectId: 'p1', pullRequest: ready }, { projectId: 'p1', pullRequest: other }],
    prefixProject: false,
    extra: { items: extra, replaces },
  })
  assert.deepEqual(items.map((item) => item.key), ['s-s-autre', 'refine-c-1', 'merge-c-2', 'pr-p1-8'])
  assert.deepEqual(
    [...waitingByMilestone(items)],
    [[1, { count: 2, key: 's-s-autre' }], [2, { count: 1, key: 'merge-c-2' }]],
    'l’affinage compte une fois, la PR finale compte enfin',
  )
})
