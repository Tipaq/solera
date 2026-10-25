import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { sessionMentionAt, sessionReference, sessionReferenceRanges } from '@solera/protocol'
import { describeOutgoingMessage } from '../src/agents/outgoing.js'
import { sessionReferenceContext } from '../src/conversations/references.js'

const PROJECT = '11111111-1111-4111-8111-111111111111'
const OTHER_PROJECT = '22222222-2222-4222-8222-222222222222'
const CITED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ARCHIVED = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ELSEWHERE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const MISSING = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-session-refs-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  for (const id of [PROJECT, OTHER_PROJECT]) {
    db.insert(projects).values({ id, name: id, workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  }
  const conversation = (id: string, projectId: string, title: string, archivedAt: number | null = null) =>
    db.insert(conversations).values({
      id, projectId, userId: 'owner', title, agent: 'codex', config: '{}', status: 'idle', createdAt: 1, updatedAt: 1, archivedAt,
    }).run()
  conversation(CITED, PROJECT, 'Refonte de la sidebar')
  conversation(ARCHIVED, PROJECT, 'Ancienne piste', 5)
  conversation(ELSEWHERE, OTHER_PROJECT, 'Secret d’un autre projet')
  return { db, dbPath }
}

test('une référence se reconnaît sous ses trois formes, et pas collée à autre chose', () => {
  const text = [
    `vu dans ${sessionReference(CITED)}, et`,
    `https://solera.local/p/${PROJECT}/c/${ARCHIVED}.`,
    `/c/${MISSING}`,
    `commit-${ELSEWHERE}`,
    `https://ailleurs.example/p/${PROJECT}/c/${ELSEWHERE}`,
  ].join(' ')
  const ranges = sessionReferenceRanges(text, 'https://solera.local:443')
  assert.deepEqual(ranges.map((ref) => [ref.id, ref.explicit, ref.projectId ?? null]), [
    [CITED, true, null],
    [ARCHIVED, true, PROJECT],
    [MISSING, true, null],
  ])
  // Le point qui ferme la phrase ne fait pas partie de l'adresse.
  const address = ranges[1]!
  assert.equal(text.slice(address.start, address.end).endsWith(ARCHIVED), true)
  // Un UUID nu est candidat, mais pas affirmé.
  assert.deepEqual(sessionReferenceRanges(`voir ${CITED}`).map((ref) => ref.explicit), [false])
})

test('le `@@` en cours de frappe porte une recherche en plusieurs mots', () => {
  assert.deepEqual(sessionMentionAt('voir @@refonte side', 19), { query: 'refonte side', start: 5, end: 19 })
  assert.equal(sessionMentionAt('mail@@x', 7), null)
  assert.equal(sessionMentionAt('voir @fichier', 13), null)
})

test("l'agent reçoit le titre courant des sessions citées de son projet, et rien des autres", async (t) => {
  const { db } = await harness(t)
  const context = sessionReferenceContext(
    db,
    PROJECT,
    `${sessionReference(CITED)} et ${sessionReference(ARCHIVED)}, ${sessionReference(ELSEWHERE)}, ${sessionReference(MISSING)} et ${MISSING}`,
    true,
  )
  assert.ok(context)
  assert.match(context, /session:aaaaaaaa.* \| codex \| titre : "Refonte de la sidebar"/)
  assert.match(context, /session:bbbbbbbb.* \| codex \| archivée \| titre : "Ancienne piste"/)
  assert.match(context, /read_conversation/)
  // Une session d'un autre projet ne livre pas son titre.
  assert.doesNotMatch(context, /Secret/)
  assert.match(context, new RegExp(`session:${ELSEWHERE} \\| introuvable`))
  // Citée deux fois, dont une nue : une seule ligne.
  assert.equal(context.split(MISSING).length - 1, 1)

  // Sans le serveur MCP, l'agent apprend qu'il ne pourra pas lire ces fils.
  assert.match(sessionReferenceContext(db, PROJECT, sessionReference(CITED), false)!, /coupés/)
  // Rien à dire : ni texte, ni fil libre.
  assert.equal(sessionReferenceContext(db, PROJECT, `un UUID nu ${MISSING}`, true), null)
  assert.equal(sessionReferenceContext(db, null, sessionReference(CITED), true), null)
})

test('le contexte part au modèle, le journal garde le texte écrit', () => {
  const { blocks, promptText } = describeOutgoingMessage('regarde session:x', [], 'Sessions citées…')
  assert.deepEqual(blocks, [{ type: 'text', text: 'regarde session:x' }])
  assert.equal(promptText, 'regarde session:x\n\nSessions citées…')
})

test('read_conversation accepte la forme session:<id> et la rappelle en tête du fil', async (t) => {
  const { dbPath } = await harness(t)
  const call = (name: string, args: object) => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: PROJECT, SOLERA_MCP_CONVERSATION: 'moi' },
      input: [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
      ].join('\n') + '\n',
      encoding: 'utf8',
    })
    const reply = run.stdout.trim().split('\n').map((line) => JSON.parse(line)).find((message) => message.id === 2)
    return reply.result.content[0].text as string
  }
  const thread = call('read_conversation', { id: sessionReference(CITED) })
  assert.match(thread, new RegExp(`^Refonte de la sidebar \\| session:${CITED} `))
})
