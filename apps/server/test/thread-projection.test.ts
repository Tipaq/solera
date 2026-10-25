import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { applyEvent, emptyChatState, deserializeChatState, serializeChatState, type ChatState } from '@solera/protocol/chat-state'
import { soleraEventSchema, type SoleraEvent } from '@solera/protocol'
import { EventLog } from '../src/events/event-log.js'
import { ThreadProjection } from '../src/events/thread-projection.js'
import { coalesceDeltas } from '../src/events/coalesce.js'

function fixture() {
  const { db, sqlite } = openDatabase(':memory:')
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  db.insert(users).values({ id: 'u', username: 'u', displayName: 'u', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'p', name: 'Test', workspacePath: '/tmp', ownerId: 'u', visibility: 'private', createdAt: 1 }).run()
  db.insert(conversations).values({ id: 'c', projectId: 'p', userId: 'u', title: 'Test', agent: 'codex', config: '{}', status: 'idle', createdAt: 1, updatedAt: 1 }).run()
  const log = new EventLog(db)
  log.thread.stop()
  const add = (event: unknown) => log.append('c', soleraEventSchema.parse(event))
  const reference = () => {
    let state = emptyChatState(), cursor = 0
    for (;;) {
      const page = log.readForReplay('c', cursor, { rows: 256, bytes: 1024 * 1024, bodies: true })
      for (const { seq, ts, event } of coalesceDeltas(page.entries)) state = applyEvent(state, seq, ts, event)
      if (page.nextAfter === cursor) return state
      cursor = page.nextAfter
    }
  }
  const build = () => {
    let batches = 0
    // Chaque lot repart de l'état écrit, comme après un arrêt brutal.
    while (!new ThreadProjection(db, log).advance('c')) assert.ok(++batches < 1000)
    return new ThreadProjection(db, log)
  }
  return { db, sqlite, log, add, reference, build }
}
function merge(current: ChatState, next: ChatState): ChatState {
  return { ...next,
    items: [...new Map([...current.items, ...next.items].map((v) => [v.position, v])).values()].sort((a,b) => a.position!-b.position!),
    tasks: new Map([...current.tasks, ...next.tasks]),
    editTurns: [...new Map([...current.editTurns, ...next.editTurns].map((v) => [v.id,v])).values()].sort((a,b) => (a.seq ?? a.ts)-(b.seq ?? b.ts)),
    checkpoints: [...new Map([...current.checkpoints, ...next.checkpoints].map((v) => [v.key,v])).values()].sort((a,b) => a.seq-b.seq),
  }
}
function all(projection: ThreadProjection) {
  let page = projection.page('c')
  assert.equal(page.building, false)
  if (page.building) throw Error('not ready')
  let state = deserializeChatState(page.state)
  const initialBytes = JSON.stringify(page).length
  while (page.hasMore) {
    page = projection.page('c', page.before, page.cursor)
    if (page.building) throw Error('not ready')
    state = merge(state, deserializeChatState(page.state))
  }
  return { state, initialBytes }
}
const wire = (state: ChatState) => JSON.parse(JSON.stringify(serializeChatState(state)))
const message = (id: string, role: 'user' | 'assistant', text: string): SoleraEvent => soleraEventSchema.parse({ type: 'message.completed', messageId: id, role, parentToolCallId: null, blocks: [{ type: 'text', text }] })

test('projection : le fil paginé égale le fold complet, malgré redémarrages, identifiants réutilisés et fins tardives', () => {
  const f = fixture()
  try {
    f.add({ type: 'question.requested', requestId: 'pending', questions: [], blocking: false })
    f.add({ type: 'tool.started', parentToolCallId: null, toolCallId: 'agent', name: 'Agent', input: { description: 'Nested' } })
    f.add({ type: 'task.started', taskId: 'task', toolCallId: 'agent', kind: 'agent', description: 'Nested' })
    for (let turn = 0; turn < 320; turn++) {
      f.add({ type: 'turn.started' })
      f.add({ type: 'checkpoint.started', key: `check-${turn}` })
      f.add(message(`user-${turn}`, 'user', `Request ${turn}`))
      f.add({ type: 'tool.started', parentToolCallId: null, toolCallId: `tool-${turn}`, name: 'Edit', input: { path: 'file' } })
      f.add({ type: 'file.edited', path: `file-${turn}`, action: 'modified', toolCallId: `tool-${turn}` })
      f.add({ type: 'tool.completed', toolCallId: `tool-${turn}`, output: 'x'.repeat(9000), isError: false, durationMs: 1 })
      f.add(message(`reply-${turn}`, 'assistant', 'Answer'))
      f.add({ type: 'diff.updated', files: [], patch: 'first' })
      f.add({ type: 'diff.updated', files: [], patch: 'last' })
      f.add({ type: 'checkpoint.completed', key: `check-${turn}`, status: 'ready', files: [], truncated: false, excluded: 0, reason: null })
      f.add({ type: 'turn.completed', costUsd: 0.01, stopReason: 'end', inputTokens: 1, outputTokens: 1 })
    }
    f.add({ type: 'background.updated', tasks: [{ id: 'task', kind: 'agent', description: 'Nested' }] })
    f.add(message('reply-0', 'assistant', ' late block'))
    f.add({ type: 'checkpoint.restored', key: 'check-0', written: 2, deleted: 1 })
    f.add({ type: 'tool.started', parentToolCallId: null, toolCallId: 'tool-0', name: 'Edit', input: { path: 'new' } })
    f.add({ type: 'tool.completed', toolCallId: 'tool-0', output: 'reused', isError: false, durationMs: 2 })
    f.add({ type: 'context.compacted', trigger: 'auto', preTokens: 1000, postTokens: 100 })
    const projection = f.build()
    const result = all(projection)
    assert.deepEqual(wire(result.state), wire(f.reference()))
    assert.ok(result.initialBytes < 50_000)
    assert.ok(result.state.items.length > 900)
    // Curseur et lignes nouvelles ou changées voyagent ensemble pendant qu'on remonte l'historique.
    const first = projection.page('c')
    assert.ok(!first.building)
    f.add(message('reply-0', 'assistant', ' updated during pagination'))
    f.add({ type: 'question.resolved', decidedBy: 'u', requestId: 'pending', status: 'answered', answers: {} })
    f.add(message('newest', 'user', 'Newest'))
    f.build()
    const next = projection.page('c', first.before, first.cursor)
    assert.ok(!next.building)
    assert.equal(next.cursor, f.reference().lastSeq)
    assert.equal(next.state.items.find((item) => item.id === 'pending')?.kind, 'question')
    assert.ok(next.state.items.some((item) => item.id === 'reply-0'))
    assert.deepEqual(wire(all(projection).state), wire(f.reference()))
    // Une projection incompatible se rebâtit sans toucher au journal.
    const count = f.sqlite.prepare('select count(*) n from events').get()
    f.sqlite.prepare('update thread_projections set version=-1').run()
    assert.deepEqual(wire(all(f.build()).state), wire(f.reference()))
    assert.deepEqual(f.sqlite.prepare('select count(*) n from events').get(), count)
  } finally { f.sqlite.close() }
})

test('projection : un lot raté reprend au dernier curseur, et la suppression emporte tout', () => {
  const f = fixture()
  try {
    f.add(message('first', 'user', 'First'))
    f.sqlite.exec("create temp trigger fail_projection before update on thread_projections begin select raise(abort, 'test interruption'); end")
    assert.throws(() => new ThreadProjection(f.db, f.log).advance('c'), (error: unknown) => /test interruption/.test(String((error as { cause?: unknown }).cause ?? error)))
    assert.equal((f.sqlite.prepare('select cursor from thread_projections').get() as { cursor: number }).cursor, 0)
    assert.equal((f.sqlite.prepare('select count(*) n from thread_projection_rows').get() as { n: number }).n, 0)
    f.sqlite.exec('drop trigger fail_projection')
    assert.deepEqual(wire(all(f.build()).state), wire(f.reference()))
    f.sqlite.prepare("delete from conversations where id='c'").run()
    assert.equal((f.sqlite.prepare('select count(*) n from thread_projection_rows').get() as { n: number }).n, 0)
    assert.equal((f.sqlite.prepare('select count(*) n from thread_projections').get() as { n: number }).n, 0)
  } finally { f.sqlite.close() }
})

test('projection : les demandes propres à Solera (rangement, décision) se résolvent loin de leur page', () => {
  const f = fixture()
  try {
    f.add({ type: 'decision.requested', requestId: 'decision', question: 'Laquelle ?', context: '', options: ['a', 'b'], defaultOption: 'a', expiresAt: 10 })
    f.add({ type: 'filing.requested', requestId: 'filing', conversationId: 'c', conversationTitle: 'Test', projectId: 'p', projectName: 'Test', worktree: null, card: null, resumable: true })
    for (let turn = 0; turn < 40; turn++) {
      f.add({ type: 'turn.started' })
      f.add(message(`user-${turn}`, 'user', `Demande ${turn}`))
      f.add(message(`reply-${turn}`, 'assistant', 'Réponse'))
      f.add({ type: 'turn.completed', costUsd: 0, stopReason: 'end', inputTokens: 1, outputTokens: 1 })
    }
    f.add({ type: 'decision.resolved', requestId: 'decision', by: 'user', option: 'b', text: null, decidedBy: 'u' })
    f.add({ type: 'filing.resolved', requestId: 'filing', decision: 'refused', decidedBy: 'u', reason: null })
    const projection = f.build()
    const state = all(projection).state
    assert.deepEqual(wire(state), wire(f.reference()))
    const decision = state.items.find((item) => item.id === 'decision')
    assert.equal(decision?.kind === 'decision' && decision.status, 'user')
    const filing = state.items.find((item) => item.id === 'filing')
    assert.equal(filing?.kind === 'filing' && filing.status, 'refused')
  } finally { f.sqlite.close() }
})

test('projection : le nom tardif et l’intitulé d’un outil survivent aux pages stockées et aux reconstructions', () => {
  const f = fixture()
  try {
    f.add({ type: 'tool.started', toolCallId: 'late', name: 'WebSearch', input: { query: '' }, parentToolCallId: null })
    f.build()
    f.add({ type: 'tool.input_updated', toolCallId: 'late', name: 'WebFetch', input: { url: 'https://example.com' }, presentation: { title: 'Lire le guide' } })
    // Une mise à jour sans nom ni présentation garde ceux d'avant.
    f.add({ type: 'tool.input_updated', toolCallId: 'late', input: { url: 'https://example.com/guide' } })
    f.add({ type: 'tool.completed', toolCallId: 'late', output: 'Guide', isError: false, durationMs: 1 })
    for (let rebuild = 0; rebuild < 2; rebuild++) {
      const item = all(f.build()).state.items.find((candidate) => candidate.id === 'late')
      assert.equal(item?.kind, 'tool')
      if (item?.kind !== 'tool') throw Error('outil attendu')
      assert.equal(item.name, 'WebFetch')
      assert.equal(item.presentation?.title, 'Lire le guide')
      assert.deepEqual(item.input, { url: 'https://example.com/guide' })
      f.sqlite.prepare('update thread_projections set version=-1').run()
    }
  } finally { f.sqlite.close() }
})
