import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import {
  agentRequests,
  cards,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  users,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerConversationRoutes } from '../src/http/routes/conversations.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import type { WebhookService } from '../src/webhooks/service.js'

/**
 * Le cycle de vie des demandes qui attendent un clic (#119) : `move_conversation`,
 * `request_card_change`, `propose_cards` et `request_decision`.
 */
async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-request-lifecycle-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Owner', passwordHash: '', createdAt: 1 }).run()
  for (const id of ['project', 'elsewhere']) {
    db.insert(projects)
      .values({ id, name: id, workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
      .run()
  }
  db.insert(conversations)
    .values({
      id: 'session', projectId: 'project', userId: 'owner', title: 'Session', agent: 'claude',
      config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, cardFiling: true, projectFiling: true }),
      status: 'idle', createdAt: 1, updatedAt: 1,
    })
    .run()

  let next = 1
  const card = (title: string) => {
    const id = randomUUID()
    const number = next++
    db.insert(cards)
      .values({
        id, projectId: 'project', number, title, description: '', column: 'todo',
        position: number, createdBy: 'owner', createdAt: 1, updatedAt: 1,
      })
      .run()
    return { id, number }
  }

  const log = new EventLog(db)
  const ctx = { db, config: { mcp: { cardFiling: true, projectFiling: true } } as unknown as Config }
  const sessions = { statusBus: new EventEmitter() } as unknown as SessionManager
  const requests = new AgentRequests(ctx, sessions, {} as AgentRegistry, log)

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerConversationRoutes(app, ctx, log, sessions, {} as AgentRegistry, {} as AttachmentStore, {} as WebhookService)
  t.after(() => app.close())

  /** Dépose une demande comme le serveur MCP, datée de `createdAt`, et balaie. */
  const deposit = async (
    kind: 'request_card_change' | 'move_conversation',
    payload: Record<string, unknown>,
    createdAt = Date.now(),
  ) => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({ id, projectId: 'project', conversationId: 'session', kind, payload: JSON.stringify(payload), createdAt })
      .run()
    await requests.sweep()
    return db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()!
  }

  return { db, log, app, requests, card, deposit }
}

test('une demande de rangement traitée après 5 minutes ne bloque plus les suivantes', async (t) => {
  const { card, deposit } = await harness(t)
  const one = card('Une carte')
  const change = { changes: [{ card: one.number, column: 'done', reason: 'Finie.' }] }

  // Le daemon ne l'a vue qu'au-delà de `STALE_MS` : redémarrage, balayage bloqué.
  const late = await deposit('request_card_change', change, Date.now() - 6 * 60 * 1000)
  assert.equal(late.isError, true)
  // Close, et pas seulement répondue : sans `resolved_at`, elle tenait pour toujours la
  // place de l'unique demande en attente, sans apparaître nulle part.
  assert.notEqual(late.resolvedAt, null)

  const fresh = await deposit('request_card_change', change)
  assert.equal(fresh.isError, false, fresh.result ?? '')

  const move = await deposit('move_conversation', { project: 'elsewhere' }, Date.now() - 6 * 60 * 1000)
  assert.notEqual(move.resolvedAt, null)
  const again = await deposit('move_conversation', { project: 'elsewhere' })
  assert.equal(again.isError, false, again.result ?? '')
})
