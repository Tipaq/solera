import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { and, eq } from 'drizzle-orm'
import {
  agentRequests,
  cardMoves,
  cards,
  conversationReads,
  conversations,
  events,
  openDatabase,
  projects,
  runMigrations,
  sessionMessages,
  users,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import type { Config } from '../src/config.js'
import { archiveStaleConversations } from '../src/conversations/auto-archive.js'
import { Decisions } from '../src/decisions/decisions.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerConversationRoutes } from '../src/http/routes/conversations.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import { SessionRelay } from '../src/sessions/session-relay.js'
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
      config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, cardFiling: true, projectFiling: true, decisions: true }),
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
  const ctx = { db, config: { mcp: { cardFiling: true, projectFiling: true, decisions: true } } as unknown as Config }
  const bus = new EventEmitter()
  // `releaseRunner` : le déplacement accordé relâche le runner, qu'aucun test ne fait tourner.
  const sessions = { statusBus: bus, releaseRunner: async () => true } as unknown as SessionManager
  const decisions = new Decisions(ctx, log, bus)
  const requests = new AgentRequests(ctx, sessions, {} as AgentRegistry, log, decisions)

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerConversationRoutes(app, ctx, log, sessions, {} as AgentRegistry, {} as AttachmentStore, {} as WebhookService)
  t.after(() => app.close())

  /** Dépose une demande comme le serveur MCP, datée de `createdAt`, et balaie. */
  const deposit = async (
    kind: 'request_card_change' | 'move_conversation' | 'propose_cards' | 'request_decision',
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

  const row = (id: string) => db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()!
  const thread = (id: string) => db.select().from(conversations).where(eq(conversations.id, id)).get()!
  /** Les issues remises à la session, dans l'ordre. */
  const outcomes = () =>
    db.select().from(sessionMessages).where(eq(sessionMessages.kind, 'outcome')).all().map((message) => message.body)
  /** Le dernier événement de ce type dans le journal du fil, relu brut. */
  const lastEvent = (conversationId: string, type: string) => {
    const rows = db
      .select({ payload: events.payload })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), eq(events.type, type)))
      .all()
    const last = rows.at(-1)
    return last ? (JSON.parse(last.payload) as Record<string, unknown>) : null
  }
  const decideFiling = (requestId: string, decision: 'accepted' | 'refused') =>
    app.inject({ method: 'POST', url: `/api/conversations/session/filings/${requestId}`, payload: { decision } })
  const decideCards = (requestId: string, decision: 'accepted' | 'refused') =>
    app.inject({ method: 'POST', url: `/api/conversations/session/card-filings/${requestId}`, payload: { decision } })

  return { db, log, app, requests, card, deposit, row, thread, outcomes, lastEvent, decideFiling, decideCards }
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

test('un déplacement accordé tard est revérifié au clic, et devient « plus applicable »', async (t) => {
  const { db, deposit, row, thread, outcomes, lastEvent, decideFiling } = await harness(t)

  // Un travail de fond est parti depuis la demande : le déplacement le couperait.
  const busy = await deposit('move_conversation', { project: 'elsewhere' })
  assert.equal(busy.isError, false, busy.result ?? '')
  db.update(conversations).set({ backgroundCount: 1 }).where(eq(conversations.id, 'session')).run()
  const response = await decideFiling(busy.id, 'accepted')
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().reason, 'background_running')
  assert.notEqual(row(busy.id).resolvedAt, null)
  assert.equal(row(busy.id).acceptedAt, null)
  assert.equal(thread('session').projectId, 'project')
  assert.deepEqual(
    [lastEvent('session', 'filing.resolved')?.decision, lastEvent('session', 'filing.resolved')?.reason],
    ['impossible', 'background_running'],
  )
  // L'agent l'apprend, sans relance : un message `outcome`, que le relais garde pour son tour.
  assert.match(outcomes().at(-1) ?? '', /n'est plus applicable : un travail de fond tourne/)

  // L'option coupée entre-temps.
  db.update(conversations).set({ backgroundCount: 0 }).where(eq(conversations.id, 'session')).run()
  const cut = await deposit('move_conversation', { project: 'elsewhere' })
  db.update(conversations)
    .set({ config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, cardFiling: true, projectFiling: false }) })
    .where(eq(conversations.id, 'session'))
    .run()
  assert.equal((await decideFiling(cut.id, 'accepted')).json().reason, 'option_disabled')
})

test('un déplacement accordé attend un travail de fond au lieu de le couper', async (t) => {
  const { db, deposit, requests, row, decideFiling } = await harness(t)
  const move = await deposit('move_conversation', { project: 'elsewhere' })
  assert.equal((await decideFiling(move.id, 'accepted')).statusCode, 200)
  assert.notEqual(row(move.id).acceptedAt, null)

  // Accordé sans travail de fond, puis il en part un avant que le balayage applique.
  db.update(conversations).set({ backgroundCount: 1 }).where(eq(conversations.id, 'session')).run()
  await requests.sweep()
  assert.equal(row(move.id).resolvedAt, null)
  assert.equal(db.select().from(conversations).where(eq(conversations.id, 'session')).get()!.projectId, 'project')
})

test('un changement de cartes accordé après que le fil a changé de projet ne touche à rien', async (t) => {
  const { db, card, deposit, row, outcomes, decideCards } = await harness(t)
  const one = card('Une carte')
  const change = await deposit('request_card_change', { changes: [{ card: one.number, column: 'done', reason: 'Finie.' }] })
  assert.equal(change.isError, false, change.result ?? '')

  db.update(conversations).set({ projectId: 'elsewhere' }).where(eq(conversations.id, 'session')).run()
  const response = await decideCards(change.id, 'accepted')
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().reason, 'project_changed')
  assert.notEqual(row(change.id).resolvedAt, null)
  assert.deepEqual(db.select().from(cardMoves).all(), [])
  assert.equal(db.select().from(cards).where(eq(cards.id, one.id)).get()!.column, 'todo')
  assert.match(outcomes().at(-1) ?? '', /n'est plus applicable : le fil a changé de projet/)
})

test('l’agent apprend un refus et un accord, sans être relancé', async (t) => {
  const { card, deposit, outcomes, decideCards, decideFiling, requests } = await harness(t)
  const one = card('Une carte')
  const refused = await deposit('request_card_change', { changes: [{ card: one.number, column: 'done', reason: 'Finie.' }] })
  assert.equal((await decideCards(refused.id, 'refused')).statusCode, 200)
  assert.match(outcomes().at(-1) ?? '', /a été refusée/)

  const accepted = await deposit('request_card_change', { changes: [{ card: one.number, column: 'done', reason: 'Finie.' }] })
  assert.equal((await decideCards(accepted.id, 'accepted')).statusCode, 200)
  assert.match(outcomes().at(-1) ?? '', /accordée : #1 a changé/)

  const move = await deposit('move_conversation', { project: 'elsewhere' })
  assert.equal((await decideFiling(move.id, 'accepted')).statusCode, 200)
  // Appliqué par le balayage : c'est lui qui le dit à l'agent, une fois le fil rangé.
  await requests.sweep()
  assert.match(outcomes().at(-1) ?? '', /accordée : « Session » est maintenant rangée dans « elsewhere »/)
})

test('archiver un fil retire ses demandes, et l’agent en est prévenu', async (t) => {
  const { db, card, deposit, requests, row, outcomes, lastEvent } = await harness(t)
  const one = card('Une carte')
  const change = await deposit('request_card_change', { changes: [{ card: one.number, column: 'done', reason: 'Finie.' }] })
  const move = await deposit('move_conversation', { project: 'elsewhere' })
  const decision = await deposit('request_decision', { question: 'On pousse ?', options: ['Oui', 'Non'], default: 'Oui', expires_in_hours: 2 })
  for (const request of [change, move, decision]) assert.equal(request.isError, false, request.result ?? '')

  db.update(conversations).set({ archivedAt: Date.now() }).where(eq(conversations.id, 'session')).run()
  await requests.sweep()

  for (const request of [change, move, decision]) assert.notEqual(row(request.id).resolvedAt, null)
  assert.equal(lastEvent('session', 'card_filing.resolved')?.reason, 'conversation_archived')
  assert.equal(lastEvent('session', 'filing.resolved')?.reason, 'conversation_archived')
  // Retirée, la décision n'applique pas son défaut.
  assert.equal(JSON.parse(row(decision.id).answer!).by, 'withdrawn')
  assert.equal(row(decision.id).acceptedAt, null)
  const told = outcomes()
  assert.equal(told.length, 3)
  assert.ok(told.some((body) => /décision a été retirée/.test(body)))
})

test('supprimer un fil retire ses demandes', async (t) => {
  const { db, card, deposit, requests, row } = await harness(t)
  const one = card('Une carte')
  const change = await deposit('request_card_change', { changes: [{ card: one.number, column: 'done', reason: 'Finie.' }] })
  db.delete(conversations).where(eq(conversations.id, 'session')).run()
  await requests.sweep()
  assert.notEqual(row(change.id).resolvedAt, null)
})

test('la fenêtre d’archivage compte les demandes en attente de chaque fil', async (t) => {
  const { db, app, card, deposit } = await harness(t)
  db.insert(conversations)
    .values({
      id: 'quiet', projectId: 'project', userId: 'owner', title: 'Calme', agent: 'claude',
      config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle', createdAt: 1, updatedAt: 1,
    })
    .run()
  const one = card('Une carte')
  await deposit('request_card_change', { changes: [{ card: one.number, column: 'done', reason: 'Finie.' }] })
  // Un déplacement qui vise un autre fil compte pour celui-là aussi.
  await deposit('move_conversation', { project: 'elsewhere', conversation: 'quiet' })
  await deposit('request_decision', { question: 'On pousse ?', options: ['Oui', 'Non'] })

  const response = await app.inject({ method: 'GET', url: '/api/conversations/pending-requests?ids=session,quiet,unknown' })
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(response.json().conversations, [
    { id: 'session', decision: 1, cardChange: 1, cardDraft: 0, move: 1 },
    { id: 'quiet', decision: 0, cardChange: 0, cardDraft: 0, move: 1 },
  ])
})

test('l’archivage automatique épargne un fil qui a une demande en attente', async (t) => {
  const { db, card, deposit } = await harness(t)
  const one = card('Une carte')
  const change = await deposit('request_card_change', { changes: [{ card: one.number, column: 'done', reason: 'Finie.' }] })
  const old = Date.now() - 10 * 24 * 3_600_000
  db.update(conversations).set({ updatedAt: old, lastSeq: 0 }).where(eq(conversations.id, 'session')).run()
  db.insert(conversationReads).values({ conversationId: 'session', userId: 'owner', lastReadSeq: 0, updatedAt: old }).run()

  assert.equal(archiveStaleConversations(db, 7), 0)
  db.update(agentRequests).set({ resolvedAt: Date.now() }).where(eq(agentRequests.id, change.id)).run()
  assert.equal(archiveStaleConversations(db, 7), 1)
})

test('le relais ne remet une issue que pendant un tour, sans jamais relancer', async (t) => {
  const { db, log, card, deposit, decideCards } = await harness(t)
  const one = card('Une carte')
  const change = await deposit('request_card_change', { changes: [{ card: one.number, column: 'done', reason: 'Finie.' }] })
  await decideCards(change.id, 'refused')

  const steered: string[] = []
  const sent: string[] = []
  const sessions = {
    steer: async (_id: string, messageId: string) => {
      steered.push(messageId)
      return true
    },
    sendMessage: async (_id: string, messageId: string) => {
      sent.push(messageId)
    },
  } as unknown as SessionManager
  const relay = new SessionRelay(db, sessions, log)
  const pending = () => db.select().from(sessionMessages).where(eq(sessionMessages.kind, 'outcome')).get()!

  // Au repos, et même vieux d'un jour : il attend, ni remis, ni réveil, ni expiré.
  db.update(sessionMessages).set({ createdAt: Date.now() - 2 * 24 * 3_600_000 }).run()
  await relay.sweep()
  assert.equal(pending().deliveredAt, null)
  assert.deepEqual([steered, sent], [[], []])

  // Le tour suivant s'ouvre : l'issue y est glissée.
  db.update(conversations).set({ status: 'running' }).where(eq(conversations.id, 'session')).run()
  await relay.sweep()
  assert.equal(pending().deliveredVia, 'steer')
  assert.deepEqual(sent, [])
})
