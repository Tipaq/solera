import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { and, asc, eq } from 'drizzle-orm'
import {
  agentRequests,
  cardBlocks,
  cardRelations,
  cards,
  conversations,
  events,
  openDatabase,
  projects,
  runMigrations,
  sessionMessages,
  users,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, type CardDraft, type SoleraEvent } from '@solera/protocol'
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
 * Le découpage en cartes (#70), du brouillon déposé par l'agent aux cartes créées au clic.
 *
 * De bout en bout, comme le rangement de cartes : le daemon lit et dépose, le journal
 * porte le brouillon, la route crée ce que la personne a corrigé. Le point qui compte le
 * plus est que **rien n'est créé avant le clic**.
 */
async function harness(t: TestContext, as: 'owner' | 'other' = 'owner', splitCardNumber?: number) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-card-drafts-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects)
    .values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'shared', createdAt: 1 })
    .run()

  let next = 1
  const card = (title: string, column: 'todo' | 'in_progress' | 'done' = 'todo') => {
    const id = randomUUID()
    const number = next++
    db.insert(cards)
      .values({ id, projectId: 'project', number, title, description: '', column, position: number, createdBy: 'owner', createdAt: 1, updatedAt: 1 })
      .run()
    return { id, number }
  }
  const start = splitCardNumber === undefined ? null : card('Le chantier à découper')

  db.insert(conversations)
    .values({
      id: 'session', projectId: 'project', userId: 'owner', title: 'Découpage', agent: 'claude',
      config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'running', purpose: 'split',
      splitCardId: start?.id ?? null, createdAt: 1, updatedAt: 1,
    })
    .run()

  const log = new EventLog(db)
  const ctx = { db, config: { mcp: { cardFiling: true } } as unknown as Config }
  const sessions = { statusBus: new EventEmitter() } as unknown as SessionManager
  const requests = new AgentRequests(ctx, sessions, {} as AgentRegistry, log)

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, as)).get()
  })
  registerErrorHandler(app)
  registerConversationRoutes(app, ctx, log, sessions, {} as AgentRegistry, {} as AttachmentStore, {} as WebhookService)
  t.after(() => app.close())

  const propose = async (payload: Record<string, unknown>) => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({ id, projectId: 'project', conversationId: 'session', kind: 'propose_cards', payload: JSON.stringify(payload), createdAt: Date.now() })
      .run()
    await requests.sweep()
    return { id, row: db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()! }
  }

  const decide = (requestId: string, body: { decision: 'created'; draft: CardDraft } | { decision: 'refused' }) =>
    app.inject({ method: 'POST', url: `/api/conversations/session/card-drafts/${requestId}`, payload: body })

  const journal = () =>
    db.select().from(events).where(eq(events.conversationId, 'session')).orderBy(asc(events.seq)).all()
      .map((row) => JSON.parse(row.payload) as SoleraEvent)
  /** Le brouillon tel que le journal le porte : ce que le bloc affiche, et renvoie corrigé. */
  const proposed = (requestId: string) => {
    const event = journal().find((e) => e.type === 'card_draft.proposed' && e.requestId === requestId)
    assert.ok(event && event.type === 'card_draft.proposed')
    return event.draft
  }
  const allCards = () => db.select().from(cards).orderBy(asc(cards.number)).all()

  return { db, card, start, propose, decide, journal, proposed, allCards }
}

test('rien n’est créé au dépôt ; le clic crée le jalon, ses enfants, leurs sous-tâches, blocages et liens', async (t) => {
  const { db, card, propose, decide, journal, proposed, allCards } = await harness(t)
  const existing = card('Le serveur MCP existant')
  const neighbour = card('Une carte voisine')

  const { id, row } = await propose({
    milestone: { title: 'Découper en cartes', description: 'La cible.' },
    cards: [
      { key: 'api', title: 'Le protocole', description: 'Le schéma.', subtasks: ['Le type', 'Le fold'], blocked_by: [existing.number] },
      { key: 'ui', title: 'Le bloc éditable', after: ['api'], related: [neighbour.number] },
      { key: 'doc', title: 'Une doc de trop', after: ['ui'] },
    ],
  })
  assert.equal(row.isError, false, row.result ?? '')
  assert.match(row.result ?? '', /Rien n'est créé/)
  assert.equal(allCards().length, 2)

  // La personne renomme une carte et en retire une, comme le bloc le permet.
  const draft = proposed(id)
  const edited: CardDraft = {
    ...draft,
    cards: draft.cards.filter((c) => c.key !== 'doc').map((c) => (c.key === 'ui' ? { ...c, title: 'Le bloc dans le fil' } : c)),
  }
  const response = await decide(id, { decision: 'created', draft: edited })
  assert.equal(response.statusCode, 200, response.body)

  const created = allCards().slice(2)
  assert.deepEqual(created.map((c) => c.title), ['Découper en cartes', 'Le protocole', 'Le bloc dans le fil'])
  const [milestone, api, ui] = created
  assert.equal(api!.parentId, milestone!.id)
  assert.equal(ui!.parentId, milestone!.id)
  assert.match(api!.description, /- \[ \] Le type\n- \[ \] Le fold/)

  const blocks = db.select().from(cardBlocks).all()
  assert.deepEqual(
    blocks.map((b) => [b.sourceId, b.targetId]).sort(),
    [[existing.id, api!.id], [api!.id, ui!.id]].sort(),
  )
  const relations = db.select().from(cardRelations).all()
  assert.equal(relations.length, 1)
  assert.equal(relations[0]!.kind, 'related')
  assert.deepEqual([relations[0]!.sourceId, relations[0]!.targetId].sort(), [ui!.id, neighbour.id].sort())

  const resolved = journal().find((e) => e.type === 'card_draft.resolved')
  assert.ok(resolved && resolved.type === 'card_draft.resolved')
  assert.equal(resolved.decision, 'created')
  assert.equal(resolved.parent?.number, milestone!.number)
  assert.deepEqual(resolved.created.map((c) => c.key), ['api', 'ui'])

  // La session apprend les numéros par un message, qui la relancera.
  const message = db.select().from(sessionMessages).where(eq(sessionMessages.toConversationId, 'session')).get()
  assert.equal(message?.kind, 'cards')
  assert.match(message?.body ?? '', new RegExp(`#${api!.number} « Le protocole »`))

  // Un second clic ne crée rien de plus.
  const again = await decide(id, { decision: 'created', draft: edited })
  assert.equal(again.statusCode, 400)
  assert.equal(allCards().length, 5)
})

test('un nouveau brouillon remplace celui qui attendait', async (t) => {
  const { propose, decide, journal, proposed } = await harness(t)
  const first = await propose({ cards: [{ title: 'Une' }] })
  const second = await propose({ cards: [{ title: 'Une' }, { title: 'Deux', after: ['1'] }] })
  assert.equal(second.row.isError, false, second.row.result ?? '')
  assert.match(second.row.result ?? '', /remplace le précédent/)

  const superseded = journal().find((e) => e.type === 'card_draft.resolved' && e.requestId === first.id)
  assert.ok(superseded && superseded.type === 'card_draft.resolved')
  assert.equal(superseded.decision, 'superseded')
  const stale = await decide(first.id, { decision: 'created', draft: proposed(first.id) })
  assert.equal(stale.statusCode, 400)
})

test('au dépôt, une boucle, une clé inconnue ou une parente close sont refusées', async (t) => {
  const { card, propose } = await harness(t)
  const closed = card('Finie', 'done')

  const cycle = await propose({ cards: [{ key: 'a', title: 'A', after: ['b'] }, { key: 'b', title: 'B', after: ['a'] }] })
  assert.equal(cycle.row.isError, true)
  assert.match(cycle.row.result ?? '', /en boucle/)
  // Refusé d'entrée, il ne tient pas la place d'un brouillon en attente.
  assert.notEqual(cycle.row.resolvedAt, null)

  const unknown = await propose({ cards: [{ key: 'a', title: 'A', after: ['z'] }] })
  assert.match(unknown.row.result ?? '', /n'est pas une clé du brouillon/)

  const parent = await propose({ parent: closed.number, cards: [{ title: 'A' }] })
  assert.match(parent.row.result ?? '', /est close/)
})

test('lancé depuis une carte, le brouillon la propose comme parente', async (t) => {
  const { start, propose, decide, proposed, allCards } = await harness(t, 'owner', 1)
  const { id } = await propose({ cards: [{ title: 'Un morceau' }] })
  const draft = proposed(id)
  assert.equal(draft.parent?.kind, 'existing')
  assert.equal(draft.parent?.kind === 'existing' && draft.parent.card.number, start!.number)

  assert.equal((await decide(id, { decision: 'created', draft })).statusCode, 200)
  const child = allCards().find((c) => c.title === 'Un morceau')
  assert.equal(child?.parentId, start!.id)
})

test('seul le propriétaire du projet crée, et un refus ne crée rien', async (t) => {
  const { propose, decide, proposed, allCards } = await harness(t, 'other')
  const { id } = await propose({ cards: [{ title: 'A' }] })
  const forbidden = await decide(id, { decision: 'created', draft: proposed(id) })
  assert.equal(forbidden.statusCode, 403)
  assert.equal(allCards().length, 0)
})

test('refusé, le brouillon se clôt sans rien créer ni relancer la session', async (t) => {
  const { db, propose, decide, allCards } = await harness(t)
  const { id } = await propose({ cards: [{ title: 'A' }] })
  assert.equal((await decide(id, { decision: 'refused' })).statusCode, 200)
  assert.equal(allCards().length, 0)
  assert.equal(db.select().from(sessionMessages).all().length, 0)
  const row = db.select().from(agentRequests).where(and(eq(agentRequests.id, id))).get()
  assert.notEqual(row?.resolvedAt, null)
})
