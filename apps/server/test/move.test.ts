import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import {
  conversationHandoffs,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  users,
  type ConversationRow,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, type AgentKind } from '@solera/protocol'
import { transcriptPath } from '../src/agents/claude/transcript.js'
import type { Config } from '../src/config.js'
import { moveConversation } from '../src/conversations/move.js'
import { EventLog } from '../src/events/event-log.js'
import type { SessionManager } from '../src/sessions/session-manager.js'

/**
 * *Ranger…* sans perdre la mémoire de l'agent (carte #118).
 *
 * Le déplacement mettait `agentSessionId` à nul dans tous les cas, même quand le CLI
 * tournait déjà dans le dossier de destination : l'agent repartait de rien pour un
 * changement qui ne touchait pas son répertoire de travail.
 */

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-move-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  // Les transcripts de Claude, sous un dossier de config à ce test.
  const previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  process.env.CLAUDE_CONFIG_DIR = join(dir, 'claude')
  t.after(() => {
    if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  })

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  const project = (id: string, workspacePath: string) =>
    db.insert(projects).values({ id, name: id, workspacePath, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  project('solera', join(dir, 'solera'))
  // Deux projets sur le même dossier : le cas où le CLI ne change pas de cwd.
  project('twin', join(dir, 'solera'))
  project('other', join(dir, 'other'))

  const thread = (id: string, projectId: string | null, agent: AgentKind): ConversationRow => {
    const row: ConversationRow = {
      id, projectId, worktreeId: null, cardId: null, userId: 'owner', title: id,
      titleSetByUser: false, agent, agentSessionId: `session-${id}`, forkedFromId: null,
      createdByTokenId: null, originLabel: null, scheduleId: null,
      config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle',
      backgroundCount: 0, loopCount: 0, lastSeq: 0, lastNotableSeq: 0, turnCount: 0,
      journalBytes: 0, contextUsedTokens: null, contextMaxTokens: null, model: null,
      costUsd: 0, inputTokens: 0, outputTokens: 0, pinned: false, position: 0,
      archivedAt: null, createdAt: 1, updatedAt: 1,
    }
    db.insert(conversations).values(row).run()
    return row
  }

  const log = new EventLog(db)
  const ctx = { db, config: { paths: { threads: join(dir, 'threads') } } as unknown as Config }
  const sessions = { releaseRunner: async () => true } as unknown as SessionManager
  const move = async (row: ConversationRow, projectId: string | null) => {
    const result = await moveConversation(ctx, sessions, log, row, projectId)
    assert.ok(result.ok)
    return db.select().from(conversations).where(eq(conversations.id, row.id)).get()!
  }
  const handoff = (id: string) =>
    db.select().from(conversationHandoffs).where(eq(conversationHandoffs.conversationId, id)).get()

  return { dir, log, thread, move, handoff }
}

test('rangé sans changer de dossier, le fil garde sa session native', async (t) => {
  const { thread, move, handoff } = await harness(t)
  // opencode, qui ne reprend pas depuis un autre dossier : seul le cwd inchangé le sauve.
  const row = thread('same', 'twin', 'opencode')

  const moved = await move(row, 'solera')
  assert.equal(moved.projectId, 'solera')
  assert.equal(moved.agentSessionId, 'session-same')
  assert.equal(handoff(row.id), undefined)
})

test('Claude change de dossier : la session est gardée et son transcript recopié', async (t) => {
  const { dir, thread, move } = await harness(t)
  const row = thread('claude', 'other', 'claude')
  const from = transcriptPath(join(dir, 'other'), 'session-claude')
  mkdirSync(dirname(from), { recursive: true })
  writeFileSync(from, '{"type":"user"}\n')
  mkdirSync(join(from.replace(/\.jsonl$/, ''), 'subagents'), { recursive: true })
  writeFileSync(join(from.replace(/\.jsonl$/, ''), 'subagents', 'agent-1.jsonl'), '{}\n')

  const moved = await move(row, 'solera')
  assert.equal(moved.agentSessionId, 'session-claude')
  const to = transcriptPath(join(dir, 'solera'), 'session-claude')
  assert.equal(readFileSync(to, 'utf8'), '{"type":"user"}\n')
  assert.ok(existsSync(join(to.replace(/\.jsonl$/, ''), 'subagents', 'agent-1.jsonl')))
  // L'original reste : c'est une copie, pas un déplacement.
  assert.ok(existsSync(from))
})

test('un fil libre rangé sous Claude reprend sa session dans le projet', async (t) => {
  const { dir, thread, move } = await harness(t)
  const row = thread('free', null, 'claude')
  const from = transcriptPath(join(dir, 'threads', 'free'), 'session-free')
  mkdirSync(dirname(from), { recursive: true })
  writeFileSync(from, '{}\n')

  const moved = await move(row, 'solera')
  assert.equal(moved.agentSessionId, 'session-free')
  assert.ok(existsSync(transcriptPath(join(dir, 'solera'), 'session-free')))
})

test('un CLI qui ne reprend pas ailleurs repart d’une sélection du fil', async (t) => {
  const { log, thread, move, handoff } = await harness(t)
  const row = thread('relay', 'other', 'grok')
  log.append(row.id, { type: 'message.completed', messageId: 'u1', role: 'user', blocks: [{ type: 'text', text: 'Corrige le bandeau' }], parentToolCallId: null })
  log.append(row.id, { type: 'message.completed', messageId: 'a1', role: 'assistant', blocks: [{ type: 'text', text: 'Le bandeau est corrigé.' }], parentToolCallId: null })

  const moved = await move(row, 'solera')
  assert.equal(moved.agentSessionId, null)
  const relay = handoff(row.id)
  assert.ok(relay)
  assert.match(relay.text, /nouveau répertoire de travail/)
  assert.match(relay.text, /Corrige le bandeau/)
  assert.match(relay.text, /Le bandeau est corrigé\./)
})

test('un fil sans message n’a rien à transmettre', async (t) => {
  const { thread, move, handoff } = await harness(t)
  const row = thread('empty', 'other', 'opencode')

  const moved = await move(row, 'solera')
  assert.equal(moved.agentSessionId, null)
  assert.equal(handoff(row.id), undefined)
})
