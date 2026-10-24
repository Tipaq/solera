import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, type TestContext } from 'node:test'
import { eq } from 'drizzle-orm'
import Fastify from 'fastify'
import { claudeTranscriptCursors, conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { EventLog } from '../src/events/event-log.js'
import { importPreparedTranscript, prepareTranscript, savedTranscript } from '../src/agents/claude/transcript-sync.js'
import { TranscriptChanged } from '../src/agents/claude/transcript-reader.js'
import { transcriptPath, translateTranscript, type TranscriptEntry } from '../src/agents/claude/transcript.js'
import { registerClaudeSessionRoutes } from '../src/http/routes/claude-sessions.js'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import type { Config } from '../src/config.js'

const user = (uuid: string, second = 0, text = uuid): TranscriptEntry => ({ type: 'user', uuid, timestamp: new Date(1000 + second * 1000).toISOString(), message: { content: text } })
const assistant = (uuid: string, second = 1, content: unknown = [{ type: 'text', text: uuid }]): TranscriptEntry => ({ type: 'assistant', uuid, timestamp: new Date(1000 + second * 1000).toISOString(), message: { id: uuid, model: 'claude-test', content } })
const end: TranscriptEntry = { type: 'system', subtype: 'turn_duration', timestamp: new Date(9000).toISOString() }
const jsonl = (entries: TranscriptEntry[]) => entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n'

async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-transcript-sync-'))
  const previous = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = join(dir, 'account')
  const { db, sqlite } = openDatabase(join(dir, 'test.db'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  db.insert(users).values({ id: 'u', username: 'u', displayName: 'u', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'p', name: 'p', workspacePath: dir, ownerId: 'u', visibility: 'private', createdAt: 1 }).run()
  db.insert(conversations).values({ id: 'c', projectId: 'p', userId: 'u', title: 'c', agent: 'claude', agentSessionId: 'session', config: '{}', status: 'idle', createdAt: 1, updatedAt: 1 }).run()
  const log = new EventLog(db)
  const file = transcriptPath(dir, 'session')
  await mkdir(dirname(file), { recursive: true })
  t.after(async () => {
    sqlite.close()
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previous
    await rm(dir, { recursive: true, force: true })
  })
  const row = () => db.select().from(conversations).where(eq(conversations.id, 'c')).get()!
  async function prepare() {
    let anchors: ReturnType<EventLog['importAnchors']> | undefined
    const prepared = await prepareTranscript(dir, 'session', savedTranscript(db, 'c', row().lastSeq), () => anchors ??= log.importAnchors('c'), row().lastSeq > 0)
    return { prepared, anchors }
  }
  async function sync(release = async () => true) {
    const { prepared, anchors } = await prepare()
    if (!prepared) return null
    const result = await importPreparedTranscript({ prepared, db, log, id: 'c', cwd: dir, lastSeq: row().lastSeq, anchors, release })
    return { ...result, prepared }
  }
  const events = () => log.read('c', 0, 100_000).map((entry) => entry.event)
  return { dir, db, sqlite, log, file, row, prepare, sync, events }
}

test('synchronisation : l’import en flux traduit comme avant, le curseur survit, un fichier inchangé ne se relit pas', async (t) => {
  const f = await fixture(t)
  const entries = [user('u'), assistant('a'), end]
  await writeFile(f.file, jsonl(entries))
  const result = await f.sync()
  assert.ok(result)
  assert.deepEqual(f.events(), translateTranscript(entries, f.dir).events.map((item) => item.event))
  const seq = f.row().lastSeq
  const repeated = await f.sync()
  assert.equal(repeated?.imported, 0)
  assert.equal(repeated?.prepared.bytesRead, 0)
  assert.equal(repeated?.prepared.parsed, 0)
  assert.equal(f.row().lastSeq, seq)
  assert.ok(savedTranscript(f.db, 'c', seq))

  await appendFile(f.file, jsonl([user('next', 10), assistant('answer', 11)]))
  const next = await f.sync()
  assert.equal(next?.prepared.parsed, 2, 'Seuls les enregistrements ajoutés sont décodés')
  assert.equal(f.events().filter((event) => event.type === 'message.completed').length, 4)
  assert.equal((await f.sync())?.imported, 0)
})

test('synchronisation : sans curseur, la reprise au point commun retrouve l’appel d’outil en attente', async (t) => {
  const f = await fixture(t)
  const prefix = [user('u'), assistant('tool-message', 1, [{ type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path: join(f.dir, 'file.ts'), old_string: 'a', new_string: 'b' } }])]
  const initial = translateTranscript(prefix, f.dir)
  f.log.appendBatch('c', initial.events, 'claude-transcript@1')
  const result: TranscriptEntry = { type: 'user', timestamp: new Date(3000).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'edit', content: 'done' }] } }
  await writeFile(f.file, jsonl([...prefix, result, assistant('final', 4), end]))
  await f.sync()
  assert.equal(f.events().filter((event) => event.type === 'tool.started').length, 1)
  assert.equal(f.events().filter((event) => event.type === 'tool.completed').length, 1)
  assert.ok(f.events().some((event) => event.type === 'file.edited' && event.path === 'file.ts'))
  assert.equal((await f.sync())?.imported, 0)
})

test('synchronisation : les positions UTF-8 et CRLF tiennent, une fin inachevée se relit', async (t) => {
  const f = await fixture(t)
  const tail = JSON.stringify(assistant('🌊', 1))
  await writeFile(f.file, JSON.stringify(user('début', 0, '你好 🌊')) + '\r\n' + tail.slice(0, -3))
  await f.sync()
  assert.equal(f.events().filter((event) => event.type === 'message.completed').length, 1)
  await appendFile(f.file, tail.slice(-3))
  await f.sync()
  assert.equal(f.events().filter((event) => event.type === 'message.completed').length, 2)
  await appendFile(f.file, '\r\n' + jsonl([user('suite', 2)]))
  await f.sync()
  assert.equal(f.events().filter((event) => event.type === 'message.completed').length, 3)
  assert.equal((await f.sync())?.prepared.bytesRead, 0)
})

test('synchronisation : un dernier objet importé ne se prolonge pas en un autre enregistrement', async (t) => {
  const f = await fixture(t)
  await writeFile(f.file, JSON.stringify(user('one')))
  await f.sync()
  await appendFile(f.file, JSON.stringify(user('invalid-continuation', 1)))
  assert.equal(await f.sync(), null)
  assert.equal(f.events().filter((event) => event.type === 'message.completed').length, 1)
})

test('synchronisation : une réécriture, un remplacement ou une troncature ne se fient pas à la position seule', async (t) => {
  const f = await fixture(t)
  await writeFile(f.file, jsonl([user('one'), assistant('two')]))
  await f.sync()
  const before = await stat(f.file)
  const seq = f.row().lastSeq
  await writeFile(f.file, jsonl([user('bad'), assistant('new')]))
  await utimes(f.file, before.atime, before.mtime)
  assert.equal(await f.sync(), null, 'Un remplacement sans rapport n’a pas de point commun')
  assert.equal(f.row().lastSeq, seq)
  await writeFile(f.file, jsonl([user('bad'), assistant('new'), user('growth', 2)]))
  assert.equal(await f.sync(), null, 'Un préfixe réécrit qui grandit ne passe pas pour un ajout')
  await writeFile(f.file + '.new', jsonl([user('one'), assistant('two'), user('three', 2)]))
  await rename(f.file + '.new', f.file)
  await f.sync()
  assert.equal(f.events().filter((event) => event.type === 'message.completed').length, 3)
  await writeFile(f.file, jsonl([user('one')]))
  await f.sync()
  await appendFile(f.file, jsonl([user('four', 3)]))
  await f.sync()
  assert.equal(f.events().filter((event) => event.type === 'message.completed').length, 4)
})

test('synchronisation : les sous-agents tardifs, prolongés ou imbriqués suivent, même parent inchangé', async (t) => {
  const f = await fixture(t)
  const spawn: TranscriptEntry = { type: 'user', timestamp: new Date(3000).toISOString(), toolUseResult: { agentId: 'child' }, message: { content: [{ type: 'tool_result', tool_use_id: 'task', content: 'background' }] } }
  await writeFile(f.file, jsonl([user('u'), assistant('a', 1, [{ type: 'tool_use', id: 'task', name: 'Agent', input: {} }]), spawn, end]))
  await f.sync()
  const child = join(f.file.replace(/\.jsonl$/, ''), 'subagents', 'agent-child.jsonl')
  await mkdir(dirname(child), { recursive: true })
  await writeFile(child, jsonl([user('child-u'), assistant('child-a')]))
  await f.sync()
  const nested = { ...spawn, toolUseResult: { agentId: 'grandchild' }, message: { content: [{ type: 'tool_result', tool_use_id: 'nested', content: 'done' }] } }
  await appendFile(child, jsonl([assistant('child-next', 2), nested]))
  await f.sync()
  await writeFile(join(dirname(child), 'agent-grandchild.jsonl'), jsonl([assistant('grandchild-a', 3)]))
  await f.sync()
  const messages = f.events().filter((event) => event.type === 'message.completed')
  assert.equal(messages.filter((event) => event.parentToolCallId === 'task').length, 3)
  assert.equal(messages.filter((event) => event.parentToolCallId === 'nested').length, 1)
  assert.equal((await f.sync())?.prepared.bytesRead, 0)
})

test('synchronisation : fil principal et sous-agents restent dans l’ordre, et un sous-agent n’ouvre pas de tour', async (t) => {
  const f = await fixture(t)
  const spawn: TranscriptEntry = { type: 'user', timestamp: new Date(6000).toISOString(), toolUseResult: { agentId: 'child' }, message: { content: [{ type: 'tool_result', tool_use_id: 'task', content: 'done' }] } }
  const main = [user('u'), assistant('a', 1, [{ type: 'tool_use', id: 'task', name: 'Agent', input: {} }]), spawn, end]
  const childEntries = [user('child-u', 2), assistant('child-a', 3)]
  await writeFile(f.file, jsonl(main))
  const child = join(f.file.replace(/\.jsonl$/, ''), 'subagents', 'agent-child.jsonl')
  await mkdir(dirname(child), { recursive: true })
  await writeFile(child, jsonl(childEntries))
  await f.sync()
  assert.deepEqual(f.events(), translateTranscript(main, f.dir, new Map([['task', childEntries]])).events.map((item) => item.event))
})

test('synchronisation : un autre dossier de configuration Claude ne reprend pas le curseur', async (t) => {
  const f = await fixture(t)
  await writeFile(f.file, jsonl([user('original'), assistant('answer')]))
  await f.sync()
  process.env.CLAUDE_CONFIG_DIR = join(f.dir, 'another-account')
  const other = transcriptPath(f.dir, 'session')
  await mkdir(dirname(other), { recursive: true })
  await writeFile(other, jsonl([user('original'), assistant('answer'), user('additional', 2)]))
  await f.sync()
  assert.equal(f.events().filter((event) => event.type === 'message.completed').length, 3)
})

test('synchronisation : une activité en direct rend le curseur caduc', async (t) => {
  const f = await fixture(t)
  const initial = [user('one'), assistant('two'), end]
  await writeFile(f.file, jsonl(initial))
  await f.sync()
  const live = [user('live', 10), assistant('live-answer', 11)]
  f.log.appendBatch('c', translateTranscript(live, f.dir).events, 'claude-sdk@1')
  await appendFile(f.file, jsonl([...live, user('external', 12)]))
  await f.sync()
  const ids = f.events().flatMap((event) => event.type === 'message.completed' ? [event.messageId] : [])
  assert.deepEqual(ids, ['one', 'two', 'live', 'live-answer', 'external'])
})

test('synchronisation : les lots bornés écrivent leur curseur avec eux, et un échec reprend sans doublon', async (t) => {
  const f = await fixture(t)
  await writeFile(f.file, jsonl(Array.from({ length: 350 }, (_, i) => user(`u${i}`, i, 'x'.repeat(12_000)))))
  const original = f.log.appendBatch.bind(f.log)
  let commits = 0
  f.log.appendBatch = (id, events, format, checkpoint, recount) => {
    assert.ok(Buffer.byteLength(JSON.stringify(events)) < 1_100_000)
    commits++
    return original(id, events, format, (tx, seq) => {
      checkpoint?.(tx, seq)
      if (commits === 2) throw new Error('simulated write failure')
    }, recount)
  }
  await assert.rejects(f.sync(), /simulated write failure/)
  const seq = f.row().lastSeq
  assert.ok(seq > 0)
  assert.equal(f.db.select().from(claudeTranscriptCursors).get()?.journalSeq, seq)
  f.log.appendBatch = original
  await f.sync()
  const ids = f.events().flatMap((event) => event.type === 'message.completed' ? [event.messageId] : [])
  assert.equal(ids.length, 350)
  assert.equal(new Set(ids).size, 350)
  assert.equal(f.row().turnCount, 350)
})

test('synchronisation : un runner occupé ou un fichier qui bouge arrêtent l’import', async (t) => {
  const f = await fixture(t)
  await writeFile(f.file, jsonl([user('one')]))
  await assert.rejects(f.sync(async () => false), TranscriptChanged)
  assert.equal(f.row().lastSeq, 0)
  const { prepared } = await f.prepare()
  assert.ok(prepared)
  await appendFile(f.file, jsonl([user('two', 1)]))
  await assert.rejects(importPreparedTranscript({ prepared, db: f.db, log: f.log, id: 'c', cwd: f.dir, lastSeq: 0, release: async () => true }), TranscriptChanged)
  assert.equal(f.row().lastSeq, 0)
})

test('synchronisation : une écriture concurrente au dernier lot n’avance pas le curseur', async (t) => {
  const f = await fixture(t)
  await writeFile(f.file, jsonl([user('external')]))
  const original = f.log.appendBatch.bind(f.log)
  f.log.appendBatch = (id, events, format, checkpoint, recount) => {
    f.log.append('c', { type: 'turn.started' })
    return original(id, events, format, checkpoint, recount)
  }
  await assert.rejects(f.sync(), TranscriptChanged)
  assert.deepEqual(f.events(), [{ type: 'turn.started' }])
  assert.equal(f.db.select().from(claudeTranscriptCursors).get(), undefined)
})

test('synchronisation : deux appels HTTP simultanés n’en font qu’un, et le propriétaire reste vérifié', async (t) => {
  const f = await fixture(t)
  await writeFile(f.file, jsonl([user('one'), assistant('two'), end]))
  const app = Fastify()
  app.addHook('onRequest', async (request) => { request.user = { id: String(request.headers['x-user'] ?? 'u'), username: 'u', displayName: 'u', passwordHash: '', isAdmin: false, createdAt: 1 } })
  let releases = 0
  registerClaudeSessionRoutes(app, { db: f.db, config: { paths: { threads: join(f.dir, 'threads') } } as Config }, f.log, { releaseRunner: async () => { releases++; await new Promise((resolve) => setTimeout(resolve, 20)); return true } } as unknown as SessionManager, {} as AgentRegistry)
  t.after(() => app.close())
  const [one, two] = await Promise.all([app.inject({ method: 'POST', url: '/api/conversations/c/claude-sync' }), app.inject({ method: 'POST', url: '/api/conversations/c/claude-sync' })])
  assert.equal(one.statusCode, 200)
  assert.deepEqual(one.json(), two.json())
  assert.equal(releases, 1)
  assert.equal(f.events().filter((event) => event.type === 'message.completed').length, 2)
  const foreign = await app.inject({ method: 'POST', url: '/api/conversations/c/claude-sync', headers: { 'x-user': 'other' } })
  assert.notEqual(foreign.statusCode, 200)
})

test('import : le titre vient du premier message, et un import raté ne laisse pas de conversation', async (t) => {
  const f = await fixture(t)
  const native = '11111111-1111-4111-8111-111111111111'
  const failed = '22222222-2222-4222-8222-222222222222'
  const entries = [user('hello', 0, 'A transcript imported in bounded batches'), assistant('reply'), end]
  for (const id of [native, failed]) await writeFile(transcriptPath(f.dir, id), jsonl(entries))
  const app = Fastify()
  app.addHook('onRequest', async (request) => { request.user = f.db.select().from(users).get() })
  registerClaudeSessionRoutes(app, { db: f.db, config: { paths: { threads: join(f.dir, 'threads') } } as Config }, f.log, {} as SessionManager, { adapter: () => ({ resolveDefaults: async (config: unknown) => config }) } as unknown as AgentRegistry)
  t.after(() => app.close())
  const created = await app.inject({ method: 'POST', url: `/api/projects/p/claude-sessions/${native}/import` })
  assert.equal(created.statusCode, 201, created.body)
  assert.equal(created.json().title, 'A transcript imported in bounded batches')
  assert.equal(f.log.read(created.json().id, 0, 100).filter(({ event }) => event.type === 'message.completed').length, 2)
  const duplicate = await app.inject({ method: 'POST', url: `/api/projects/p/claude-sessions/${native}/import` })
  assert.equal(duplicate.statusCode, 400)
  const count = f.db.select().from(conversations).all().length
  f.log.appendBatch = () => { throw new Error('simulated failure') }
  const rejected = await app.inject({ method: 'POST', url: `/api/projects/p/claude-sessions/${failed}/import` })
  assert.equal(rejected.statusCode, 500)
  assert.equal(f.db.select().from(conversations).all().length, count)
})

test('synchronisation : un premier import de 80 Mo et la reprise au point commun tiennent dans 64 Mio de tas', { timeout: 90_000 }, async () => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  for (const mode of ['import', 'recover']) {
    await promisify(execFile)(process.execPath, ['--max-old-space-size=64', '--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./fixtures/transcript-memory.mts', import.meta.url)), mode], { timeout: 40_000 })
  }
})
