import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { conversations, events, openDatabase, projects, runMigrations, users } from '@solera/db'
import type { JournalEntry, SoleraEvent } from '@solera/protocol'
import { EventLog } from '../src/events/event-log.js'

function harness(ids = ['one', 'two']) {
  const { db, sqlite } = openDatabase(':memory:')
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  db.insert(users).values({ id: 'u', username: 'u', displayName: 'u', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'p', name: 'Test', workspacePath: '/tmp', ownerId: 'u', visibility: 'private', createdAt: 1 }).run()
  for (const id of ids) {
    db.insert(conversations).values({
      id, projectId: 'p', userId: 'u', title: id, agent: 'claude', config: '{}', status: 'idle', createdAt: 1, updatedAt: 1,
    }).run()
  }
  const log = new EventLog(db)
  log.thread.stop()
  return { db, sqlite, log }
}

const delta = (text: string, messageId = 'm1'): SoleraEvent => ({ type: 'message.delta', messageId, text, parentToolCallId: null })
const thinking = (text: string): SoleraEvent => ({ type: 'thinking.delta', messageId: 'm1', text, parentToolCallId: null })
const completed: SoleraEvent = {
  type: 'turn.completed', costUsd: 0, inputTokens: 1, outputTokens: 2, durationMs: 3,
} as SoleraEvent

/** Une séquence de tour : fragments entrelacés d'événements qui ne se tamponnent pas. */
const script: { event: SoleraEvent; raw?: unknown }[] = [
  { event: { type: 'turn.started' } as SoleraEvent },
  { event: thinking('je '), raw: { n: 1 } },
  { event: thinking('pense') },
  { event: delta('Bon'), raw: { n: 2, accent: 'é' } },
  { event: delta('jour', 'm1') },
  { event: delta(' à toi', 'm2') },
  { event: completed },
  { event: delta('après') },
]

function journal(db: ReturnType<typeof harness>['db'], id: string) {
  const rows = db
    .select({ seq: events.seq, type: events.type, payload: events.payload, raw: events.raw, rawFormat: events.rawFormat })
    .from(events)
    .where(eq(events.conversationId, id))
    .orderBy(events.seq)
    .all()
  const row = db
    .select({ lastSeq: conversations.lastSeq, lastNotableSeq: conversations.lastNotableSeq, journalBytes: conversations.journalBytes })
    .from(conversations)
    .where(eq(conversations.id, id))
    .get()
  return { rows, row }
}

test('appendStreamed : même journal, mêmes seq et même diffusion qu’append, événement par événement', () => {
  const direct = harness()
  const streamed = harness()
  try {
    const heard = { direct: [] as JournalEntry[], streamed: [] as JournalEntry[] }
    direct.log.subscribe('one', (entry) => heard.direct.push(entry))
    streamed.log.subscribe('one', (entry) => heard.streamed.push(entry))
    const all: JournalEntry[] = []
    streamed.log.subscribeAll((entry) => all.push(entry))

    for (const { event, raw } of script) {
      direct.log.append('one', event, raw, 'test-raw')
      streamed.log.appendStreamed('one', event, raw, 'test-raw')
    }
    streamed.log.flush()

    assert.deepEqual(journal(streamed.db, 'one'), journal(direct.db, 'one'))
    const shape = (entries: JournalEntry[]) => entries.map(({ seq, event }) => ({ seq, event }))
    assert.deepEqual(shape(heard.streamed), shape(heard.direct))
    // Les abonnés transverses (webhooks) reçoivent les fragments comme avec `append`.
    assert.deepEqual(shape(all), shape(heard.direct))
    assert.deepEqual(heard.streamed.map((entry) => entry.seq), [1, 2, 3, 4, 5, 6, 7, 8])
  } finally {
    direct.sqlite.close()
    streamed.sqlite.close()
  }
})

test('appendStreamed : rien n’est lisible en base avant d’être diffusé, et toute lecture vide le tampon', () => {
  const { db, sqlite, log } = harness()
  try {
    const order: string[] = []
    log.subscribe('one', (entry) => order.push(`bus ${entry.seq}`))
    log.appendStreamed('one', delta('a'))
    log.appendStreamed('one', delta('b'))

    // Ni écrit, ni diffusé : invisible pour tout le monde.
    assert.equal(db.select().from(events).all().length, 0)
    assert.deepEqual(order, [])

    const read = log.read('one', 0, 10)
    order.push('read')
    assert.deepEqual(read.map((entry) => entry.seq), [1, 2])
    assert.deepEqual(order, ['bus 1', 'bus 2', 'read'])
  } finally {
    sqlite.close()
  }
})

test('appendStreamed : un abonné qui relit après s’être abonné ne reçoit rien en double', () => {
  const { sqlite, log } = harness()
  try {
    log.appendStreamed('one', delta('a'))
    const heard: number[] = []
    log.subscribe('one', (entry) => heard.push(entry.seq))
    const read = log.read('one', 0, 10).map((entry) => entry.seq)
    assert.deepEqual([...heard, ...read], [1])
  } finally {
    sqlite.close()
  }
})

test('appendStreamed : le minuteur écrit les fragments de chaque conversation sans autre événement', async () => {
  const { db, sqlite, log } = harness()
  try {
    const heard: string[] = []
    for (const id of ['one', 'two']) log.subscribe(id, (entry) => heard.push(`${id} ${entry.seq}`))
    log.appendStreamed('one', delta('a'))
    log.appendStreamed('two', delta('b'))
    log.appendStreamed('one', delta('c'))
    await sleep(120)
    assert.deepEqual(heard.sort(), ['one 1', 'one 2', 'two 1'])
    assert.equal(db.select().from(events).all().length, 3)
  } finally {
    sqlite.close()
  }
})

test('appendStreamed : une conversation supprimée entre-temps perd ses fragments sans lever', () => {
  const { db, sqlite, log } = harness()
  try {
    const heard: number[] = []
    log.subscribe('one', (entry) => heard.push(entry.seq))
    log.appendStreamed('one', delta('a'))
    db.delete(conversations).where(eq(conversations.id, 'one')).run()
    assert.doesNotThrow(() => log.flush())
    assert.deepEqual(heard, [])
    // Et la conversation voisine n'en souffre pas.
    log.appendStreamed('two', delta('b'))
    assert.deepEqual(log.read('two', 0, 10).map((entry) => entry.seq), [1])
  } finally {
    sqlite.close()
  }
})
