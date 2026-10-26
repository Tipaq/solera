import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, type ConversationPromptDto } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerConversationRoutes } from '../src/http/routes/conversations.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import type { WebhookService } from '../src/webhooks/service.js'

/**
 * Les demandes en attente d'un projet, telles que l'onglet Activité les déplie sous leur
 * ligne (#112) : une par session qui attend, la plus récente encore ouverte, et rien
 * pour un fil qui ne réclame rien.
 */
async function harness(t: TestContext, as: 'owner' | 'stranger' = 'owner') {
  const dir = await mkdtemp(join(tmpdir(), 'solera-project-prompts-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'stranger']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()

  const project = (id: string, values: Partial<typeof projects.$inferInsert> = {}) =>
    db.insert(projects)
      .values({ id, name: id, workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1, ...values })
      .run()

  const conversation = (id: string, status: 'idle' | 'running' | 'awaiting_input', projectId = 'project') =>
    db.insert(conversations)
      .values({
        id, projectId, userId: 'owner', title: id, agent: 'claude',
        config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status, createdAt: 1, updatedAt: 1,
      })
      .run()

  const log = new EventLog(db)
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, as)).get()
  })
  registerErrorHandler(app)
  registerConversationRoutes(
    app, { db, config: {} } as never, log, { statusBus: new EventEmitter() } as unknown as SessionManager,
    {} as AgentRegistry, {} as AttachmentStore, {} as WebhookService,
  )
  t.after(() => app.close())

  const prompts = async () => {
    const response = await app.inject({ method: 'GET', url: '/api/projects/project/prompts' })
    return { status: response.statusCode, body: response.json() as { prompts: ConversationPromptDto[] } }
  }
  const all = async () => {
    const response = await app.inject({ method: 'GET', url: '/api/prompts' })
    return { status: response.statusCode, body: response.json() as { prompts: ConversationPromptDto[] } }
  }
  return { conversation, log, prompts, all, project }
}

const permission = (requestId: string) => ({
  type: 'permission.requested' as const,
  requestId,
  toolName: 'Bash',
  input: { command: 'pnpm install --ignore-scripts' },
  suggestions: [],
})

test('une session qui attend rend sa demande ouverte, et celle déjà tranchée ne compte plus', async (t) => {
  const { conversation, log, prompts } = await harness(t)
  conversation('waiting', 'awaiting_input')
  log.append('waiting', permission('first'))
  log.append('waiting', { type: 'permission.resolved', requestId: 'first', decision: 'allowed', scope: 'once', decidedBy: 'owner' })
  log.append('waiting', {
    type: 'question.requested',
    requestId: 'second',
    questions: [{ id: 'q', header: 'Jalon', question: 'Où le voit-on ?', options: [], multiSelect: false, allowOther: true, secret: false }],
  })

  const { status, body } = await prompts()
  assert.equal(status, 200)
  assert.equal(body.prompts.length, 1)
  const [prompt] = body.prompts
  assert.equal(prompt!.conversationId, 'waiting')
  assert.equal(prompt!.kind, 'question')
  assert.equal(prompt!.requestId, 'second')
  assert.equal(prompt!.event.type, 'question.requested')
})

test('un fil qui ne réclame rien ne rend rien, une question asynchrone ouverte si', async (t) => {
  const { conversation, log, prompts } = await harness(t)
  conversation('busy', 'running')
  log.append('busy', permission('stale'))
  conversation('async', 'idle')
  log.append('async', {
    type: 'question.requested',
    requestId: 'later',
    questions: [{ id: 'q', header: 'Choix', question: 'Lequel ?', options: [], multiSelect: false, allowOther: true, secret: false }],
    blocking: false,
  })

  const { body } = await prompts()
  assert.deepEqual(body.prompts.map((entry) => entry.conversationId), ['async'])
})

test('un projet privé reste fermé à qui ne le possède pas', async (t) => {
  const { prompts } = await harness(t, 'stranger')
  assert.equal((await prompts()).status, 404)
})

test("le portefeuille rend les demandes de tous les projets visibles, sauf les archivés et ceux des autres", async (t) => {
  const { conversation, log, all, project } = await harness(t)
  project('archived', { archivedAt: 2 })
  project('foreign', { ownerId: 'stranger' })
  project('shared', { ownerId: 'stranger', visibility: 'shared' })
  conversation('here', 'awaiting_input')
  conversation('elsewhere', 'awaiting_input', 'shared')
  conversation('shelved', 'awaiting_input', 'archived')
  conversation('hidden', 'awaiting_input', 'foreign')
  for (const id of ['here', 'elsewhere', 'shelved', 'hidden']) log.append(id, permission(`ask-${id}`))

  const { status, body } = await all()
  assert.equal(status, 200)
  assert.deepEqual(body.prompts.map((entry) => entry.conversationId).sort(), ['elsewhere', 'here'])
})
