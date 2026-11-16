import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { cards, conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, type ConversationDto } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerConversationRoutes } from '../src/http/routes/conversations.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import type { WebhookService } from '../src/webhooks/service.js'

/**
 * Le jalon d'une session (#163) : la parente de la carte qu'elle traite, jointe aux
 * listes comme la carte l'est déjà. « Ce qui t'attend » étiquette chaque demande par
 * son jalon sans charger les cartes de tous les projets.
 */
async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-conversations-milestone-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()

  const card = (id: string, number: number, parentId: string | null = null) =>
    db.insert(cards)
      .values({
        id, projectId: 'project', number, title: `Carte ${number}`, column: 'todo', parentId,
        acceptedAt: 1, createdBy: 'owner', createdAt: 1, updatedAt: 1,
      })
      .run()
  const conversation = (id: string, cardId: string | null) =>
    db.insert(conversations)
      .values({
        id, projectId: 'project', userId: 'owner', title: id, agent: 'claude', cardId,
        config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle', createdAt: 1, updatedAt: 1,
      })
      .run()

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerConversationRoutes(
    app, { db, config: {} } as never, new EventLog(db), { statusBus: new EventEmitter() } as unknown as SessionManager,
    {} as AgentRegistry, {} as AttachmentStore, {} as WebhookService,
  )
  t.after(() => app.close())

  const get = async <T>(url: string) => {
    const response = await app.inject({ method: 'GET', url })
    assert.equal(response.statusCode, 200, response.body)
    return response.json() as T
  }
  const listed = async (url: string) =>
    new Map((await get<ConversationDto[]>(url)).map((dto) => [dto.id, dto.milestone]))
  return { db, card, conversation, get, listed }
}

test('le jalon d’une session est la parente de sa carte, dans les deux listes et la route d’un fil', async (t) => {
  const h = await harness(t)
  h.card('milestone', 157)
  h.card('leaf', 163, 'milestone')
  h.conversation('worker', 'leaf')

  const expected = { id: 'milestone', number: 157, title: 'Carte 157' }
  assert.deepEqual((await h.listed('/api/conversations')).get('worker'), expected)
  assert.deepEqual((await h.listed('/api/projects/project/conversations')).get('worker'), expected)
  assert.deepEqual((await h.get<ConversationDto>('/api/conversations/worker')).milestone, expected)
})

test('sans carte, ou avec une carte sans parente, pas de jalon', async (t) => {
  const h = await harness(t)
  h.card('alone', 12)
  h.conversation('loose', null)
  h.conversation('orphan', 'alone')

  for (const url of ['/api/conversations', '/api/projects/project/conversations']) {
    const milestones = await h.listed(url)
    assert.equal(milestones.get('loose'), null)
    assert.equal(milestones.get('orphan'), null)
  }
  assert.equal((await h.get<ConversationDto>('/api/conversations/loose')).milestone, null)
  assert.equal((await h.get<ConversationDto>('/api/conversations/orphan')).milestone, null)
})

test('le titre du jalon est lu à jour, pas figé', async (t) => {
  const h = await harness(t)
  h.card('milestone', 157)
  h.card('leaf', 163, 'milestone')
  h.conversation('worker', 'leaf')
  h.db.update(cards).set({ title: 'Socle commun' }).where(eq(cards.id, 'milestone')).run()

  assert.equal((await h.listed('/api/conversations')).get('worker')?.title, 'Socle commun')
  assert.equal((await h.get<ConversationDto>('/api/conversations/worker')).milestone?.title, 'Socle commun')
})
