import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CardConversationDto, CardDto, CardLinkDto, CardRefinementDto, MilestoneRunDto } from '@solera/protocol'
import type { SessionRequest } from '../../web/src/lib/session-request-summary.js'

const {
  ENTRY_STAGE,
  MATURITIES,
  cycleOf,
  gestureOf,
  horizonOf,
  isIdea,
  isMilestone,
  layersOf,
  maturityReasons,
  maturityTooltip,
  milestoneAsks,
  nextAction,
  nextActionText,
  reasonText,
  refinePending,
  waveProgress,
  wavesOf,
} = await import('../../web/src/lib/milestone-model.js')
const { cardDestination, cardDestinationHref } = await import('../../web/src/lib/card-destination.js')

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
  createdAt = NOW - DAY,
  archivedAt: number | null = null,
): CardConversationDto => ({
  id, title: id, agent: 'claude', status, costUsd: 0, worktreeId: null, worktreeName: null, archivedAt, createdAt,
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

/** Un jalon et ses enfants, liés dans les deux sens comme le serveur les rend. */
function milestone(number: number, kids: CardDto[], extra: Partial<CardDto> = {}): CardDto[] {
  const parent = card(number, { milestone: true, ...extra })
  for (const kid of kids) kid.parent = link(parent)
  parent.children = kids.map(link)
  return [parent, ...kids]
}

/** `blocked` attend `blocker`. */
function depend(blocked: CardDto, ...blockers: CardDto[]) {
  for (const blocker of blockers) {
    blocked.blockedBy.push(link(blocker))
    blocker.blocks.push(link(blocked))
  }
}

const refinement = (extra: Partial<CardRefinementDto> = {}): CardRefinementDto => ({
  conversationId: 'split-1',
  title: 'Affinage',
  status: 'idle',
  mode: 'questions',
  createdAt: NOW - DAY,
  draft: null,
  change: null,
  ...extra,
})

const run = (cardId: string, extra: Partial<MilestoneRunDto> = {}) =>
  ({ id: `run-${cardId}`, cardId, state: 'running', mode: 'auto', concurrency: 2, createdAt: NOW - 3 * DAY, cards: [], ...extra }) as MilestoneRunDto

const questionRequest = (...texts: string[]): SessionRequest =>
  ({
    kind: 'question',
    requestId: 'q-1',
    requestedAt: NOW - 1000,
    event: {
      type: 'question.requested',
      requestId: 'q-1',
      questions: texts.map((question, index) => ({
        id: `q${index}`, header: 'h', question, multiSelect: false, allowOther: true, secret: false, options: [],
      })),
    },
  }) as SessionRequest

type Options = Partial<Omit<Parameters<typeof horizonOf>[0], 'cards'>>

function analyse(cards: CardDto[], options: Options = {}) {
  return horizonOf({ cards, runs: [], requests: new Map(), ...options })
}

const only = (cards: CardDto[], options: Options = {}) => {
  const entries = analyse(cards, options)
  assert.equal(entries.length, 1, 'un seul jalon attendu')
  return entries[0]!
}

/** Un faux `t` : la clé et ses paramètres, de quoi vérifier ce qui est dit sans catalogue. */
const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')})` : key

/* ------------------------------------------------------------------ MAT-1, MAT-3 */

test('MAT-1 : six étapes, dans l’ordre du parcours', () => {
  assert.deepEqual(MATURITIES, ['idea', 'refine', 'split', 'ready', 'launched', 'delivered'])
})

test('MAT-3 : un jalon est une carte de premier niveau drapeautée ou qui a des enfants ; une idée n’a pas d’enfant', () => {
  const [parent, kid] = milestone(1, [card(2)])
  assert.equal(isMilestone(parent!), true)
  assert.equal(isMilestone(kid!), false, 'une enfant n’est jamais un jalon')
  assert.equal(isMilestone(card(3)), false)
  assert.equal(isMilestone(card(4, { milestone: true })), true)
  assert.equal(isIdea(card(4, { milestone: true })), true)
  assert.equal(isIdea(parent!), false, 'un jalon qui a des cartes n’est plus une idée')
  assert.equal(isIdea(card(3)), false, 'sans drapeau, une carte seule n’est pas une idée')
})

test('horizon : les jalons et les idées du projet, sans les cartes ordinaires ni les jalons abandonnés', () => {
  const entries = analyse([
    ...milestone(1, [card(2)]),
    card(3, { milestone: true }),
    card(4),
    card(5, { milestone: true, column: 'abandoned' }),
    card(8, { milestone: true, column: 'done' }),
    ...milestone(6, [card(7, { column: 'abandoned' })], { column: 'abandoned' }),
  ])
  assert.deepEqual(entries.map((entry) => entry.card.number), [1, 3])
  assert.deepEqual(entries[0]!.children.map((entry) => entry.number), [2])
})

test('horizon : les jalons datés d’abord, du plus proche au plus lointain, puis par numéro', () => {
  const entries = analyse([
    card(1, { milestone: true }),
    card(2, { milestone: true, dueAt: NOW + 10 * DAY }),
    card(3, { milestone: true, dueAt: NOW + 2 * DAY }),
  ])
  assert.deepEqual(entries.map((entry) => entry.card.number), [3, 2, 1])
})

/* ------------------------------------------------------------------ MAT-2 */

test('MAT-2 : une idée sans affinage est une Idée', () => {
  assert.equal(only([card(1, { milestone: true })]).maturity, 'idea')
})

test('MAT-2 : sans cartes, une session d’affinage vivante, des questions ou un brouillon font À affiner', () => {
  for (const status of ['running', 'awaiting_input'] as const) {
    assert.equal(only([card(1, { milestone: true, refinement: refinement({ status }) })]).maturity, 'refine', status)
  }
  assert.equal(
    only([card(1, { milestone: true, refinement: refinement({ status: 'idle' }) })]).maturity,
    'idea',
    'une session d’affinage au repos sans rien en attente laisse l’idée',
  )
  const draft = card(1, { milestone: true, refinement: refinement({ draft: { requestId: 'd-1', count: 4 } }) })
  assert.equal(only([draft]).maturity, 'refine')
  const asked = card(1, { milestone: true, refinement: refinement() })
  assert.equal(only([asked], { requests: new Map([['split-1', questionRequest('Pour qui ?')]]) }).maturity, 'refine')
})

test('MAT-2 : le statut vivant du socket l’emporte sur celui du chargement', () => {
  const idea = card(1, { milestone: true, refinement: refinement({ status: 'idle' }) })
  const live = (entry: { id: string; status: CardConversationDto['status'] }) => (entry.id === 'split-1' ? 'running' : entry.status)
  assert.equal(only([idea], { statusOf: live }).maturity, 'refine')
})

test('MAT-2 : avec des cartes, des questions ou un brouillon en attente font encore À affiner', () => {
  const draft = milestone(1, [card(2)], { refinement: refinement({ draft: { requestId: 'd-1', count: 2 } }) })
  assert.equal(only(draft).maturity, 'refine')
  const asked = milestone(1, [card(2)], { refinement: refinement() })
  assert.equal(only(asked, { requests: new Map([['split-1', questionRequest('Pour qui ?')]]) }).maturity, 'refine')
  const working = milestone(1, [card(2)], { refinement: refinement({ status: 'running' }) })
  assert.equal(only(working).maturity, 'ready', 'une session qui travaille sur un jalon déjà découpé ne le retient pas')
})

test('MAT-2 : une question d’une autre session que celle d’affinage ne compte pas', () => {
  const entries = milestone(1, [card(2, { conversations: [session('work', 'awaiting_input')] })], { refinement: refinement() })
  assert.equal(only(entries, { requests: new Map([['work', questionRequest('Je supprime ?')]]) }).maturity, 'ready')
})

test('MAT-2 : À régler pour chaque raison, une à une', () => {
  assert.equal(only(milestone(1, [card(2, { toClarifySince: NOW - DAY })])).maturity, 'split', 'à préciser')
  assert.equal(only(milestone(1, [card(2, { acceptedAt: null })])).maturity, 'split', 'pas acceptée')

  const a = card(2)
  const b = card(3)
  const free = card(4)
  depend(a, b)
  depend(b, a)
  assert.equal(only(milestone(1, [a, b, free])).maturity, 'split', 'un cycle, même avec une carte libre')

  const outside = card(9)
  const held = card(2)
  depend(held, outside)
  assert.equal(only([...milestone(1, [held]), outside]).maturity, 'split', 'aucune carte ne peut partir')
})

test('MAT-2 : Prêt quand rien n’est à régler et qu’une carte peut partir', () => {
  const first = card(2)
  const second = card(3)
  depend(second, first)
  const entry = only(milestone(1, [first, second]))
  assert.equal(entry.maturity, 'ready')
  assert.deepEqual(entry.startable.map((entry) => entry.number), [2])
})

test('MAT-2 : un bloqueur fait ou abandonné ne retient plus', () => {
  const done = card(2, { column: 'done' })
  const dropped = card(3, { column: 'abandoned' })
  const next = card(4)
  depend(next, done, dropped)
  assert.equal(only(milestone(1, [done, dropped, next])).maturity, 'ready')
})

test('MAT-2 : Lancé par un pilotage actif, même avec des choses à régler', () => {
  const entries = milestone(1, [card(2, { toClarifySince: NOW })])
  const entry = only(entries, { runs: [run('c-1')] })
  assert.equal(entry.maturity, 'launched')
  assert.equal(entry.launchedAt, NOW - 3 * DAY)
  assert.equal(only(entries, { runs: [run('c-1', { state: 'paused' })] }).paused, true)
})

test('MAT-2 : un pilotage fini ou arrêté ne lance plus le jalon', () => {
  for (const state of ['finished', 'stopped'] as const) {
    assert.equal(only(milestone(1, [card(2)]), { runs: [run('c-1', { state })] }).maturity, 'ready', state)
  }
})

test('MAT-2 : Lancé tant que la PR du jalon est ouverte et pas fusionnée, ses cartes closes', () => {
  const open = milestone(1, [card(2, { column: 'done' })], { branch: 'jalon/1', branchPr: { number: 7, url: 'u', base: 'main', mergedAt: null, closedAt: null } })
  assert.equal(only(open).maturity, 'launched')
  const merged = milestone(1, [card(2, { column: 'done' })], { branch: 'jalon/1', branchPr: { number: 7, url: 'u', base: 'main', mergedAt: NOW, closedAt: null } })
  assert.equal(only(merged).maturity, 'delivered')
})

test('MAT-2 : une PR de jalon fermée sans fusion le garde Lancé, sans proposer de la fusionner', () => {
  const pr = { number: 7, url: 'https://forge/pr/7', base: 'main', mergedAt: null, closedAt: NOW }
  const entry = only(milestone(1, [card(2, { column: 'done' })], { branch: 'jalon/1', branchPr: pr }))
  assert.equal(entry.maturity, 'launched', 'sa branche n’est pas dans main : pas livré')
  assert.deepEqual(nextAction(entry), { kind: 'prClosed', pr })
  assert.deepEqual(gestureOf(entry), { kind: 'link', url: 'https://forge/pr/7' }, '« Voir la PR » l’ouvre sur la forge')
  assert.deepEqual(maturityReasons(entry), [{ kind: 'merged', done: 1, total: 1 }, { kind: 'prClosed' }])
  assert.deepEqual(milestoneAsks(entry), [], 'rien à fusionner : la forge refuserait')
})

test('MAT-2 : une carte entrée au jalon après l’ouverture de sa PR : on suit le pilotage, rien à fusionner encore', () => {
  const pr = { number: 7, url: 'u', base: 'main', mergedAt: null, closedAt: null }
  const entry = only(milestone(1, [card(2, { column: 'done' }), card(3)], { branch: 'jalon/1', branchPr: pr }), { runs: [run('c-1')] })
  assert.equal(entry.maturity, 'launched')
  assert.equal(nextAction(entry).kind, 'follow', 'fusionner maintenant livrerait sans la carte ajoutée')
  assert.deepEqual(milestoneAsks(entry), [])
  assert.deepEqual(maturityReasons(entry), [{ kind: 'merged', done: 1, total: 2 }])
})

test('MAT-2 : Livré quand aucune carte n’est ouverte', () => {
  const entry = only(milestone(1, [card(2, { column: 'done' }), card(3, { column: 'abandoned' }), card(4, { column: 'done' })]))
  assert.equal(entry.maturity, 'delivered')
  assert.equal(entry.done, 2)
})

/* ------------------------------------------------------------------ MAT-4, MAT-5 */

test('MAT-4 : le cycle, ce sont les cartes prises dans une boucle interne, pas celles qui en dépendent', () => {
  const a = card(2)
  const b = card(3)
  const c = card(4)
  const after = card(5)
  depend(a, c)
  depend(b, a)
  depend(c, b)
  depend(after, c)
  assert.deepEqual(cycleOf([a, b, c, after]).map((entry) => entry.number), [2, 3, 4])
  assert.deepEqual(cycleOf([after]), [], 'un bloqueur hors du jeu ne forme pas de boucle')
})

test('MAT-4 : une carte close sort du cycle', () => {
  const a = card(2)
  const b = card(3, { column: 'done' })
  depend(a, b)
  depend(b, a)
  assert.deepEqual(only(milestone(1, [a, b])).cycle, [])
})

test('MAT-5 : l’analyse d’un jalon', () => {
  const clarify = card(2, { toClarifySince: NOW })
  const foreign = card(3, { acceptedAt: null })
  const done = card(4, { column: 'done' })
  const late = card(5, { createdAt: NOW - DAY })
  const entry = only(milestone(1, [clarify, foreign, done, late]), { runs: [run('c-1')] })
  assert.deepEqual(entry.toClarify.map((entry) => entry.number), [2])
  assert.deepEqual(entry.notAccepted.map((entry) => entry.number), [3])
  assert.deepEqual(entry.startable.map((entry) => entry.number), [2, 3, 5])
  assert.deepEqual(entry.addedSinceLaunch.map((entry) => entry.number), [5])
  assert.equal(entry.done, 1)
})

test('MAT-11 : les enfants qu’une session attend, au statut vivant', () => {
  const waiting = card(2, { conversations: [session('s2', 'awaiting_input')] })
  const archived = card(3, { conversations: [session('s3', 'awaiting_input', NOW, NOW)] })
  const later = card(4, { conversations: [session('s4', 'running')] })
  const entries = milestone(1, [waiting, archived, later])
  assert.deepEqual(only(entries).awaiting.map((entry) => entry.card.number), [2])
  const live = (entry: { id: string; status: CardConversationDto['status'] }) => (entry.id === 's4' ? 'awaiting_input' : entry.status)
  assert.deepEqual(only(entries, { statusOf: live }).awaiting.map((entry) => entry.card.number), [2, 4])
})

/* ------------------------------------------------------------------ MAT-6 */

test('MAT-6 : la prochaine action de chaque étape', () => {
  assert.deepEqual(nextAction(only([card(1, { milestone: true })])), { kind: 'refine' })

  const draft = only([card(1, { milestone: true, refinement: refinement({ draft: { requestId: 'd', count: 4 } }) })])
  assert.deepEqual(nextAction(draft), { kind: 'validateDraft', count: 4 })

  const asked = only([card(1, { milestone: true, refinement: refinement() })], {
    requests: new Map([['split-1', questionRequest('Pour qui ?', 'Quand ?')]]),
  })
  assert.deepEqual(nextAction(asked), { kind: 'answer', count: 2 })

  const working = only([card(1, { milestone: true, refinement: refinement({ status: 'running' }) })])
  assert.deepEqual(nextAction(working), { kind: 'refining' })

  // Elle attend, mais pas une question lisible ici (une permission) : on va lui répondre dans son fil.
  const waiting = only([card(1, { milestone: true, refinement: refinement({ status: 'awaiting_input' }) })])
  assert.equal(waiting.refining, 'waiting')
  assert.deepEqual(nextAction(waiting), { kind: 'openRefine' })
  assert.deepEqual(maturityReasons(waiting), [{ kind: 'refineWaiting' }])

  const ready = card(2)
  assert.deepEqual(nextAction(only(milestone(1, [ready, card(3)]))), { kind: 'launch', count: 2 })

  assert.deepEqual(nextAction(only(milestone(1, [card(2, { column: 'done' })]))), { kind: 'review', count: 1 })
})

test('MAT-6 : À régler dit quoi préciser, « Défaire le cycle » quand il n’y a que lui, sinon revoir les dépendances', () => {
  const a = card(2, { toClarifySince: NOW })
  const b = card(3, { acceptedAt: null })
  assert.deepEqual(nextAction(only(milestone(1, [a, b]))), { kind: 'settle', toClarify: [2], notAccepted: [3], cycle: [] })

  const c = card(4)
  const d = card(5)
  depend(c, d)
  depend(d, c)
  assert.deepEqual(nextAction(only(milestone(1, [c, d]))), { kind: 'undoCycle', cycle: [4, 5] })

  const outside = card(9)
  const held = card(2)
  depend(held, outside)
  assert.deepEqual(nextAction(only([...milestone(1, [held]), outside])), { kind: 'reviewDeps' })
})

test('MAT-6 : lancé, la PR ouverte d’abord, puis la session qui attend, sinon suivre', () => {
  const waiting = card(2, { conversations: [session('s2', 'awaiting_input')] })
  const added = card(3, { createdAt: NOW - DAY })
  const entries = milestone(1, [waiting, added, card(4, { column: 'done' })])
  const request = questionRequest('Je peux supprimer ?')

  const blocked = nextAction(only(entries, { runs: [run('c-1')], requests: new Map([['s2', request]]) }))
  assert.deepEqual(blocked, { kind: 'answerBlock', card: 2, request })

  waiting.conversations = []
  const follow = nextAction(only(entries, { runs: [run('c-1', { state: 'paused' })] }))
  assert.deepEqual(follow, { kind: 'follow', done: 1, total: 3, added: 1, paused: true })

  const pr = { number: 7, url: 'https://forge/pr/7', base: 'main', mergedAt: null, closedAt: null }
  const merge = nextAction(only(milestone(1, [card(2, { column: 'done' })], { branch: 'jalon/1', branchPr: pr })))
  assert.deepEqual(merge, { kind: 'merge', pr })
})

test('MAT-6 : la prochaine action dite en clés, pluriels et listes de numéros', () => {
  assert.equal(nextActionText({ kind: 'refine' }, t).label, 'milestones.next.refine.label')
  assert.equal(nextActionText({ kind: 'answer', count: 1 }, t).detail, 'milestones.next.answer.detail.one(count=1)')
  assert.equal(nextActionText({ kind: 'answer', count: 3 }, t).detail, 'milestones.next.answer.detail.other(count=3)')
  assert.equal(
    nextActionText({ kind: 'settle', toClarify: [2, 3], notAccepted: [4], cycle: [5, 6] }, t).detail,
    'milestones.next.settle.toClarify.other(count=2) · milestones.next.settle.notAccepted(count=1) · milestones.next.settle.cycle(cards=#5, #6)',
  )
  assert.equal(
    nextActionText({ kind: 'follow', done: 1, total: 3, added: 2, paused: true }, t).detail,
    'milestones.next.follow.detail(done=1,total=3) · milestones.next.follow.added(count=2) · milestones.next.follow.paused',
  )
  assert.equal(nextActionText({ kind: 'follow', done: 0, total: 2, added: 0, paused: false }, t).detail, 'milestones.next.follow.detail(done=0,total=2)')
  assert.equal(
    nextActionText({ kind: 'answerBlock', card: 4, request: questionRequest('Je peux supprimer ?') }, t).detail,
    'milestones.next.answerBlock.detail(question=Je peux supprimer ?)',
  )
  assert.equal(
    nextActionText({ kind: 'answerBlock', card: 4, request: null }, t).detail,
    'milestones.next.answerBlock.unknown(number=4)',
    'sans demande lisible, le numéro de la carte',
  )
})

/* ------------------------------------------------------------------ MAT-7 */

test('MAT-7 : les raisons concrètes de chaque étape', () => {
  assert.deepEqual(maturityReasons(only([card(1, { milestone: true })])), [{ kind: 'noCards' }])

  const both = only([card(1, { milestone: true, refinement: refinement({ draft: { requestId: 'd', count: 3 } }) })], {
    requests: new Map([['split-1', questionRequest('Pour qui ?')]]),
  })
  assert.deepEqual(maturityReasons(both), [{ kind: 'questions', count: 1 }, { kind: 'draft', count: 3 }])
  assert.deepEqual(maturityReasons(only([card(1, { milestone: true, refinement: refinement({ status: 'running' }) })])), [{ kind: 'refining' }])

  const a = card(2, { toClarifySince: NOW })
  const b = card(3, { acceptedAt: null })
  const c = card(4)
  const d = card(5)
  depend(c, d)
  depend(d, c)
  assert.deepEqual(maturityReasons(only(milestone(1, [a, b, c, d]))), [
    { kind: 'toClarify', cards: [2] },
    { kind: 'notAccepted', cards: [3] },
    { kind: 'cycle', cards: [4, 5] },
  ])
  const outside = card(9)
  const held = card(2)
  depend(held, outside)
  assert.deepEqual(maturityReasons(only([...milestone(1, [held]), outside])), [{ kind: 'noStartable' }])

  assert.deepEqual(maturityReasons(only(milestone(1, [card(2), card(3)]))), [{ kind: 'startable', count: 2 }])

  const waiting = card(2, { conversations: [session('s2', 'awaiting_input')] })
  const launched = milestone(1, [waiting, card(3, { column: 'done' })], {
    branch: 'jalon/1',
    branchPr: { number: 7, url: 'u', base: 'main', mergedAt: null, closedAt: null },
  })
  assert.deepEqual(maturityReasons(only(launched, { runs: [run('c-1', { state: 'paused' })] })), [
    { kind: 'merged', done: 1, total: 2 },
    { kind: 'paused' },
    { kind: 'blocked', cards: [2] },
  ])
  assert.deepEqual(maturityReasons(only(launched)).at(-1), { kind: 'prOpen' }, 'le pilotage fini, la PR attend sa fusion')
  assert.deepEqual(maturityReasons(only(milestone(1, [card(2, { column: 'done' })]))), [{ kind: 'delivered', count: 1 }])
})

test('MAT-7 : une raison dite en clé, avec ses numéros et son pluriel', () => {
  assert.equal(reasonText({ kind: 'toClarify', cards: [2] }, t), 'milestones.maturity.reason.toClarify.one(count=1,cards=#2)')
  assert.equal(reasonText({ kind: 'cycle', cards: [4, 5] }, t), 'milestones.maturity.reason.cycle(cards=#4, #5)')
  assert.equal(reasonText({ kind: 'merged', done: 1, total: 2 }, t), 'milestones.maturity.reason.merged(done=1,total=2)')
})

test('MAT-8 : l’infobulle d’une pastille, l’étape et sa première raison', () => {
  assert.equal(
    maturityTooltip(only(milestone(1, [card(2)])), t),
    'milestones.maturity.tooltip(step=milestones.maturity.label.ready,reason=milestones.maturity.reason.startable.one(count=1))',
  )
})

/* ------------------------------------------------------------------ MAT-12 */

test('MAT-12 : ce qui t’attend dans un jalon — questions d’affinage, brouillon, PR à fusionner', () => {
  const asked = card(1, { milestone: true, refinement: refinement({ draft: { requestId: 'd-1', count: 3 } }) })
  const asks = milestoneAsks(only([asked], { requests: new Map([['split-1', questionRequest('Pour qui ?')]]) }))
  assert.deepEqual(asks, [
    { kind: 'refine', key: 'refine-c-1', milestone: asked, conversationId: 'split-1', requestId: 'q-1', questions: [{ id: 'q0', text: 'Pour qui ?' }] },
    { kind: 'draft', key: 'draft-c-1', milestone: asked, conversationId: 'split-1', requestId: 'd-1', count: 3 },
  ])

  const [parent, ...rest] = milestone(2, [card(3, { column: 'done' })], { branch: 'jalon/2', branchPr: { number: 7, url: 'u', base: 'main', mergedAt: null, closedAt: null } })
  assert.deepEqual(milestoneAsks(only([parent!, ...rest])), [
    { kind: 'merge', key: 'merge-c-2', milestone: parent, branch: 'jalon/2', pr: { number: 7, url: 'u', base: 'main', mergedAt: null, closedAt: null } },
  ])
})

test('MAT-12 : une session bloquée n’en est pas une demande de jalon — elle est déjà dans la liste, étiquetée', () => {
  const waiting = card(2, { conversations: [session('s2', 'awaiting_input')] })
  assert.deepEqual(milestoneAsks(only(milestone(1, [waiting]), { runs: [run('c-1')] })), [])
})

test('composer : l’étape où entre un jalon selon le geste', () => {
  assert.deepEqual(ENTRY_STAGE, { note: 'idea', refine: 'refine', split: 'refine' })
})

/* ------------------------------------------------------------------ JAL-6, JAL-8 */

test('JAL-6 : le geste de chaque prochaine action', () => {
  const idea = only([card(1, { milestone: true })])
  assert.deepEqual(gestureOf(idea), { kind: 'refine' }, 'une idée ouvre sa session d’affinage')

  const draft = only(milestone(1, [card(2)], { refinement: refinement({ draft: { requestId: 'd-1', count: 2 } }) }))
  assert.deepEqual(gestureOf(draft), { kind: 'scroll', target: 'affinage' })
  const settle = only(milestone(1, [card(2, { toClarifySince: NOW })]))
  assert.deepEqual(gestureOf(settle), { kind: 'scroll', target: 'affinage' }, 'À régler défile jusqu’à l’affinage')
  assert.deepEqual(gestureOf(only(milestone(1, [card(2)]))), { kind: 'scroll', target: 'lancer' }, 'Prêt défile jusqu’à Lancer')

  const pr = { number: 7, url: 'https://forge/pr/7', base: 'main', mergedAt: null, closedAt: null }
  assert.deepEqual(gestureOf(only(milestone(1, [card(2, { column: 'done' })], { branch: 'jalon/1', branchPr: pr }))), { kind: 'merge' })

  const waiting = card(2, { conversations: [session('s2', 'awaiting_input')] })
  assert.deepEqual(
    gestureOf(only(milestone(1, [waiting]), { runs: [run('c-1')] })),
    { kind: 'sheet', number: 2 },
    'une session bloquée ouvre la fiche de sa carte, où l’on répond sur place',
  )
  assert.deepEqual(gestureOf(only(milestone(1, [card(2)]), { runs: [run('c-1')] })), { kind: 'scroll', target: 'lancer' }, 'sinon on suit')
  assert.equal(gestureOf(only(milestone(1, [card(2, { column: 'done' })]))), null, 'livré, rien à faire')
})

test('JAL-8 : l’affinage passe en tête quand il attend quelque chose', () => {
  assert.equal(refinePending(only([card(1, { milestone: true })])), true, 'une idée sans cartes')
  assert.equal(refinePending(only(milestone(1, [card(2)]))), false, 'un jalon prêt n’attend rien')
  assert.equal(refinePending(only(milestone(1, [card(2, { toClarifySince: NOW })]))), true, 'une carte à préciser')
  assert.equal(refinePending(only(milestone(1, [card(2, { acceptedAt: null })]))), true, 'une carte à accepter')
  const c = card(2)
  const d = card(3)
  depend(c, d)
  depend(d, c)
  assert.equal(refinePending(only(milestone(1, [c, d]))), true, 'un cycle')
  const draft = milestone(1, [card(2)], { refinement: refinement({ draft: { requestId: 'd-1', count: 2 } }) })
  assert.equal(refinePending(only(draft)), true, 'un brouillon')
  const asked = milestone(1, [card(2)], { refinement: refinement() })
  assert.equal(refinePending(only(asked, { requests: new Map([['split-1', questionRequest('Pour qui ?')]]) })), true, 'des questions')
  const change = milestone(1, [card(2)], { refinement: refinement({ change: { requestId: 'r-1', count: 2 } }) })
  assert.equal(refinePending(only(change)), true, 'un ajout proposé')
  const working = milestone(1, [card(2)], { refinement: refinement({ status: 'running' }) })
  assert.equal(refinePending(only(working)), false, 'une session qui travaille n’attend rien de toi')
  const waiting = card(2, { conversations: [session('s2', 'awaiting_input')] })
  assert.equal(
    refinePending(only(milestone(1, [waiting]), { runs: [run('c-1')] })),
    false,
    'une session bloquée se lit dans « Ce qui t’attend », pas dans l’affinage (§2.6-1)',
  )
})

/* ------------------------------------------------------------------ VAG-3..5 */

test('VAG-3 : l’étage d’une carte, 0 sans bloqueur dans le jeu, sinon un de plus que le plus haut', () => {
  const a = card(1)
  const b = card(2)
  const c = card(3)
  const outside = card(9)
  depend(b, a)
  depend(c, a, b)
  depend(a, outside)
  const layers = layersOf([a, b, c])
  assert.deepEqual([...layers.entries()].sort(), [['c-1', 0], ['c-2', 1], ['c-3', 2]], 'un bloqueur hors du jeu ne compte pas')
})

test('VAG-3 : un cycle est coupé, chaque carte garde un étage', () => {
  const a = card(1)
  const b = card(2)
  const c = card(3)
  depend(a, c)
  depend(b, a)
  depend(c, b)
  const layers = layersOf([a, b, c])
  assert.equal(layers.size, 3)
  assert.deepEqual([...layers.values()].sort(), [0, 1, 2])
})

test('VAG-3, VAG-4 : les vagues sans les abandonnées, les ouvertes d’abord puis par numéro', () => {
  const a = card(1, { column: 'done' })
  const b = card(2)
  const c = card(4)
  const d = card(3, { column: 'done' })
  const gone = card(5, { column: 'abandoned' })
  depend(c, a)
  depend(d, a)
  depend(gone, a)
  assert.deepEqual(
    wavesOf([gone, d, c, b, a]).map((wave) => wave.map((entry) => entry.number)),
    [[2, 1], [4, 3]],
  )
  assert.deepEqual(wavesOf([]), [])
})

test('VAG-5 : une vague terminée, en parallèle, ou en plusieurs passes à la concurrence', () => {
  const done = card(1, { column: 'done' })
  assert.deepEqual(waveProgress([done], 3), { kind: 'finished' })
  assert.deepEqual(waveProgress([done, card(2), card(3)], 3), { kind: 'open', open: 2, passes: 1 })
  assert.deepEqual(waveProgress([card(2), card(3), card(4), card(5)], 3), { kind: 'open', open: 4, passes: 2 })
})

/* ------------------------------------------------------------------ FCH-10 */

test('FCH-10 : une carte qui t’attend ouvre sa fiche, pour répondre sur place', () => {
  const waiting = card(4, { conversations: [session('a', 'running', NOW), session('b', 'awaiting_input', NOW - DAY)] })
  assert.deepEqual(cardDestination(waiting), { kind: 'sheet', number: 4 })
  const live = (entry: { id: string; status: CardConversationDto['status'] }) => (entry.id === 'b' ? 'idle' : entry.status)
  assert.deepEqual(cardDestination(waiting, live), { kind: 'session', conversationId: 'a' }, 'au statut vivant')
})

test('FCH-10 : sinon sa session — en erreur, puis qui tourne, sinon la plus récente, archivées exclues', () => {
  const sessions = [
    session('old', 'idle', NOW - 3 * DAY),
    session('recent', 'idle', NOW - DAY),
    session('archived', 'running', NOW, NOW),
  ]
  assert.deepEqual(cardDestination(card(4, { conversations: sessions })), { kind: 'session', conversationId: 'recent' })
  const running = [...sessions, session('run', 'running', NOW - 5 * DAY)]
  assert.deepEqual(cardDestination(card(4, { conversations: running })), { kind: 'session', conversationId: 'run' })
  const failed = [...running, session('err', 'error', NOW - 6 * DAY)]
  assert.deepEqual(cardDestination(card(4, { conversations: failed })), { kind: 'session', conversationId: 'err' })
})

test('FCH-10 : sans session, un brouillon rattaché à la carte ; un jalon sans session de travail ouvre son affinage', () => {
  assert.deepEqual(cardDestination(card(4)), { kind: 'draft', cardId: 'c-4' })
  assert.deepEqual(cardDestination(card(4, { conversations: [session('gone', 'idle', NOW, NOW)] })), { kind: 'draft', cardId: 'c-4' })
  assert.deepEqual(cardDestination(card(1, { milestone: true, refinement: refinement() })), { kind: 'session', conversationId: 'split-1' })
  assert.deepEqual(
    cardDestination(card(1, { milestone: true, refinement: refinement(), conversations: [session('work', 'idle')] })),
    { kind: 'session', conversationId: 'work' },
    'une session de travail passe devant l’affinage',
  )
})

test('FCH-10 : l’adresse, la fiche gardant les autres paramètres de la page', () => {
  assert.equal(cardDestinationHref('p', card(4)), '/p/p/c/new?card=c-4')
  assert.equal(cardDestinationHref('p', card(4, { conversations: [session('a', 'idle')] })), '/p/p/c/a')
  assert.equal(
    cardDestinationHref('p', card(4, { conversations: [session('a', 'awaiting_input')] }), { search: new URLSearchParams('vue=gantt') }),
    '?vue=gantt&fiche=4',
  )
})
