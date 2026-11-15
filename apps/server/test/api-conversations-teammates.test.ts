import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { agentRequests, conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerConversationRoutes } from '../src/http/routes/conversations.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import type { WebhookService } from '../src/webhooks/service.js'

/**
 * Les coéquipiers d'une session (#74) : celles qu'elle a lancées avec `start_session`,
 * retrouvées par la session née de chaque demande. Ni un refus, ni une autre demande.
 */
test('les coéquipiers d’une session sont celles qu’elle a lancées, dans l’ordre', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-teammates-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()
  for (const id of ['lead', 'second', 'first', 'other']) {
    db.insert(conversations)
      .values({
        id, projectId: 'project', userId: 'owner', title: id, agent: 'claude',
        config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle', createdAt: 1, updatedAt: 1,
      })
      .run()
  }
  const request = (id: string, from: string, kind: 'start_session' | 'create_card', createdAt: number, launched: string | null) =>
    db.insert(agentRequests)
      .values({ id, projectId: 'project', conversationId: from, kind, payload: '{}', createdAt, launchedConversationId: launched })
      .run()
  request('r2', 'lead', 'start_session', 20, 'second')
  request('r1', 'lead', 'start_session', 10, 'first')
  request('r3', 'lead', 'start_session', 30, null)
  request('r4', 'lead', 'create_card', 40, null)
  request('r5', 'other', 'start_session', 50, 'lead')

  const app = Fastify()
  app.addHook('preHandler', async (req) => {
    req.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerConversationRoutes(
    app, { db, config: {} } as never, new EventLog(db), { statusBus: new EventEmitter() } as unknown as SessionManager,
    {} as AgentRegistry, {} as AttachmentStore, {} as WebhookService,
  )
  t.after(() => app.close())

  const get = async (id: string) => {
    const response = await app.inject({ method: 'GET', url: `/api/conversations/${id}/teammates` })
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as string[]
  }
  assert.deepEqual(await get('lead'), ['first', 'second'])
  assert.deepEqual(await get('first'), [])
  assert.equal((await app.inject({ method: 'GET', url: '/api/conversations/missing/teammates' })).statusCode, 404)
})
