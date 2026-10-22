import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { asc, eq } from 'drizzle-orm'
import {
  agentRequests,
  cardNotes,
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
import { DEFAULT_CLAUDE_CONFIG, parseSessionMessage } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { archiveStaleConversations } from '../src/conversations/auto-archive.js'
import { Decisions } from '../src/decisions/decisions.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerDecisionRoutes } from '../src/http/routes/decisions.js'
import { Notifications, type OutgoingNotification, type PushSender } from '../src/notifications/dispatcher.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { SessionRelay } from '../src/sessions/session-relay.js'

/**
 * Les décisions, du dépôt par le serveur MCP à la réponse remise en message.
 *
 * Testées de bout en bout parce que le chemin traverse quatre endroits — le daemon qui
 * valide et dépose, la route qui tranche, le balayage qui fait échoir et retire, le
 * relais qui remet — et qu'une décision n'est vraie que si la session finit par lire sa
 * réponse.
 */

const ALLOWED = 'allowed'
const PLAIN = 'plain'
const FREE = 'free'
const CARDED = 'carded'

/** `push` : un vrai aiguillage devant ce service, au lieu d'un `dispatch` qui note seulement. */
async function harness(t: TestContext, { push }: { push?: PushSender } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-decisions-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'other']) {
    db.insert(users)
      .values({ id, username: id, displayName: id === 'owner' ? 'Tim' : 'Autre', passwordHash: '', createdAt: 1 })
      .run()
  }
  db.insert(projects)
    .values({ id: 'project', name: 'Nimbus', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()
  db.insert(cards)
    .values({
      id: 'card', projectId: 'project', number: 7, title: 'Monter vite', description: '', column: 'in_progress',
      position: 1, createdBy: 'owner', createdAt: 1, updatedAt: 1,
    })
    .run()

  const now = Date.now()
  const thread = (id: string, decisions: boolean, extra: Partial<typeof conversations.$inferInsert> = {}) =>
    db.insert(conversations)
      .values({
        id, projectId: 'project', userId: 'owner', title: `Session ${id}`, agent: 'claude',
        config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, decisions, decisionMaxHours: 12 }),
        status: 'idle', createdAt: now, updatedAt: now, ...extra,
      })
      .run()
  thread(ALLOWED, true)
  thread(PLAIN, false)
  thread(FREE, true, { projectId: null })
  thread(CARDED, true, { cardId: 'card' })

  const log = new EventLog(db)
  const bus = new EventEmitter()
  const awaited: string[][] = []
  bus.on('awaiting', ({ userIds }: { userIds: string[] }) => awaited.push(userIds))
  const dispatched: Array<{ userId: string; notification: OutgoingNotification }> = []
  const ctx = { db, config: { mcp: { decisions: true } } as unknown as Config }
  const decisions = new Decisions(
    ctx,
    log,
    bus,
    push
      ? new Notifications(db, push)
      : {
          dispatch: async (userId, notification) => {
            dispatched.push({ userId, notification })
          },
        },
  )
  const sessions = { statusBus: bus } as unknown as SessionManager
  const requests = new AgentRequests(ctx, sessions, {} as AgentRegistry, log, decisions)

  /** Dépose une demande comme le serveur MCP le fait, et laisse le daemon la traiter. */
  const ask = async (conversationId: string, payload: object, projectId: string | null = 'project') => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({ id, projectId, conversationId, kind: 'request_decision', payload: JSON.stringify(payload), createdAt: Date.now() })
      .run()
    await requests.sweep()
    return db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()!
  }
  const row = (id: string) => db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()!
  const messages = (to: string) =>
    db.select().from(sessionMessages).where(eq(sessionMessages.toConversationId, to)).orderBy(asc(sessionMessages.createdAt)).all()
  const journal = (conversationId: string) =>
    db.select({ type: events.type, payload: events.payload }).from(events)
      .where(eq(events.conversationId, conversationId)).orderBy(asc(events.seq)).all()

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    const as = (request.headers['x-as'] as string | undefined) ?? 'owner'
    request.user = db.select().from(users).where(eq(users.id, as)).get()
  })
  registerErrorHandler(app)
  registerDecisionRoutes(app, decisions)
  t.after(() => app.close())

  const tools = (conversationId: string, env: Record<string, string>) => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: 'project', SOLERA_MCP_CONVERSATION: conversationId, SOLERA_MCP_MEMORY: '', ...env },
      encoding: 'utf8', timeout: 10000,
      input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`,
    })
    assert.equal(run.status, 0, run.stderr)
    return (JSON.parse(run.stdout).result as { tools: { name: string }[] }).tools.map((tool) => tool.name)
  }

  return { db, ctx, bus, app, decisions, requests, ask, row, messages, journal, dispatched, awaited, tools }
}

test('décisions : la colonne se relit après la clôture, et un push lent ne retient rien', async (t) => {
  // Un abonnement push qui ne répond pas avant qu'on le libère, comme un service lointain.
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  t.after(() => release())
  let pushed = 0
  const { db, bus, decisions, requests, row } = await harness(t, {
    push: { notify: async () => { pushed += 1; await held } },
  })
  // Ce qu'un onglet relirait au signal : la section « À décider » au moment de l'émettre.
  const seen: string[][] = []
  bus.on('awaiting', () => seen.push(decisions.awaiting('owner').map((entry) => entry.id)))

  const id = randomUUID()
  db.insert(agentRequests)
    .values({ id, projectId: 'project', conversationId: ALLOWED, kind: 'request_decision', payload: JSON.stringify({ question: 'On pousse ?' }), createdAt: Date.now() })
    .run()
  const swept = await Promise.race([
    requests.sweep().then(() => 'fini'),
    new Promise((resolve) => setTimeout(() => resolve('retenu par le push'), 2_000)),
  ])

  assert.equal(swept, 'fini')
  assert.equal(pushed, 1, 'Le push est bien parti')
  const deposited = row(id)
  assert.ok(deposited.settledAt, "L'agent a sa réponse sans attendre le push")
  assert.equal(deposited.isError, false, deposited.result ?? '')
  assert.deepEqual(seen, [[id]], 'Au signal, la décision est déjà dans « À décider »')
})

test('décisions : déposée sans bloquer, notifiée, et rendue à la session par un message', async (t) => {
  const { db, app, ask, row, messages, journal, dispatched, awaited } = await harness(t)

  const asked = await ask(ALLOWED, {
    question: '  Monter vite en 7.0 maintenant ?  ',
    context: 'Les tests passent sur la branche.',
    options: ['Oui', 'Attendre la 7.0.1', 'Oui'],
    default: 'Attendre la 7.0.1',
    expires_in_hours: 48,
  })
  // L'agent a sa réponse tout de suite : la demande est déposée, pas tranchée.
  assert.equal(asked.isError, false, asked.result ?? '')
  assert.ok(asked.settledAt)
  assert.match(asked.result ?? '', /Demande déposée/)
  assert.match(asked.result ?? '', /« Attendre la 7\.0\.1 »/)
  assert.equal(asked.resolvedAt, null)
  // Charge normalisée, doublon retiré, délai ramené au maximum de la session (12 h).
  assert.deepEqual(JSON.parse(asked.payload), {
    question: 'Monter vite en 7.0 maintenant ?',
    context: 'Les tests passent sur la branche.',
    options: ['Oui', 'Attendre la 7.0.1'],
    defaultOption: 'Attendre la 7.0.1',
  })
  assert.ok(asked.expiresAt! - asked.createdAt <= 12 * 3_600_000 + 5_000)
  assert.ok(asked.expiresAt! - asked.createdAt >= 12 * 3_600_000 - 5_000)

  // Notifiée par l'aiguillage, sous sa sorte et avec son toast ; la colonne se relit.
  assert.equal(dispatched.length, 1)
  assert.equal(dispatched[0]!.notification.kind, 'decision')
  assert.equal(dispatched[0]!.notification.toast?.kind, 'decision')
  assert.equal(dispatched[0]!.notification.push.badge, 1)
  assert.ok(awaited.some((ids) => ids.includes('owner')))
  assert.ok(journal(ALLOWED).some((entry) => entry.type === 'decision.requested'))

  // La colonne la liste, et l'historique aussi.
  const awaiting = (await app.inject({ method: 'GET', url: '/api/awaiting' })).json()
  assert.deepEqual(awaiting.requests.map((entry: { kind: string; id: string }) => [entry.kind, entry.id]), [['decision', asked.id]])
  const pending = (await app.inject({ method: 'GET', url: '/api/decisions' })).json()
  assert.equal(pending.decisions[0].status, 'pending')

  // Une option qui n'était pas proposée est refusée ; un autre compte ne la voit pas.
  const unknown = await app.inject({ method: 'POST', url: `/api/decisions/${asked.id}/answer`, payload: { option: 'Peut-être' } })
  assert.equal(unknown.statusCode, 400)
  const stranger = await app.inject({
    method: 'POST', url: `/api/decisions/${asked.id}/answer`, headers: { 'x-as': 'other' }, payload: { option: 'Oui' },
  })
  assert.equal(stranger.statusCode, 404)

  const answered = await app.inject({
    method: 'POST', url: `/api/decisions/${asked.id}/answer`,
    payload: { option: 'Oui', text: 'Vérifie les avertissements des plugins.' },
  })
  assert.equal(answered.statusCode, 200, answered.body)
  assert.equal(answered.json().status, 'user')
  assert.equal(answered.json().answer.byName, 'Tim')

  const closed = row(asked.id)
  assert.ok(closed.resolvedAt)
  assert.ok(closed.acceptedAt)
  assert.deepEqual(JSON.parse(closed.answer!), { by: 'user', userId: 'owner', option: 'Oui', text: 'Vérifie les avertissements des plugins.' })
  assert.ok(journal(ALLOWED).some((entry) => entry.type === 'decision.resolved'))

  // La réponse part en message de genre `decision`, de la session à elle-même.
  const [message] = messages(ALLOWED)
  assert.ok(message)
  assert.equal(message.kind, 'decision')
  assert.equal(message.fromConversationId, ALLOWED)
  assert.match(message.body, /Réponse : « Oui »/)
  assert.match(message.body, /Précision : Vérifie les avertissements/)
  assert.match(message.body, /Répondu par Tim/)

  // Une seconde réponse trouve la décision close.
  const twice = await app.inject({ method: 'POST', url: `/api/decisions/${asked.id}/answer`, payload: { option: 'Oui' } })
  assert.equal(twice.statusCode, 409)
  assert.equal((await app.inject({ method: 'GET', url: '/api/awaiting' })).json().requests.length, 0)

  // Et le relais la remet : la session au repos est relancée, sans garde-fou de boucle.
  const sent: Array<{ to: string; text: string }> = []
  const relay = new SessionRelay(
    db,
    {
      sendMessage: async (to: string, _id: string, text: string) => { sent.push({ to, text }) },
      steer: async () => false,
    } as unknown as SessionManager,
    new EventLog(db),
  )
  await relay.sweep()
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.to, ALLOWED)
  assert.equal(parseSessionMessage(sent[0]!.text)?.kind, 'decision')
  assert.equal(messages(ALLOWED)[0]!.deliveredVia, 'wake')
})

test('décisions : refusées par l’instance, sans le drapeau, en fil libre, et une seule à la fois', async (t) => {
  const { ctx, ask, tools } = await harness(t)

  // L'instance tient le plafond : éteinte, même une session qui a le drapeau est refusée.
  ctx.config.mcp.decisions = false
  const vetoed = await ask(ALLOWED, { question: 'On pousse ?' })
  assert.equal(vetoed.isError, true)
  assert.match(vetoed.result ?? '', /\[mcp\] decisions/)
  ctx.config.mcp.decisions = true

  const refused = await ask(PLAIN, { question: 'On pousse ?' })
  assert.equal(refused.isError, true)
  assert.match(refused.result ?? '', /pas accordées/)
  assert.ok(refused.resolvedAt, 'Un refus ne tient pas la place de la demande en attente')

  const free = await ask(FREE, { question: 'On pousse ?' }, null)
  assert.equal(free.isError, true)
  assert.match(free.result ?? '', /exige un projet/)

  const bad = await ask(ALLOWED, { question: 'On pousse ?', options: ['Oui', 'Non'], default: 'Peut-être' })
  assert.equal(bad.isError, true)
  assert.equal(bad.expiresAt, null)

  const first = await ask(ALLOWED, { question: 'On pousse ?', options: ['Oui', 'Non'] })
  assert.equal(first.isError, false, first.result ?? '')
  const second = await ask(ALLOWED, { question: 'Et la doc ?' })
  assert.equal(second.isError, true)
  assert.match(second.result ?? '', /une seule à la fois/i)

  // L'outil n'est listé que si la portée est accordée.
  assert.ok(!tools(ALLOWED, {}).includes('request_decision'))
  assert.ok(tools(ALLOWED, { SOLERA_MCP_DECISIONS: '1' }).includes('request_decision'))
})

test('décisions : à l’échéance, le défaut s’applique ou la session apprend que personne n’a répondu', async (t) => {
  const { db, decisions, ask, row, messages } = await harness(t)

  const withDefault = await ask(ALLOWED, { question: 'On pousse ?', options: ['Oui', 'Non'], default: 'Non' })
  const withoutDefault = await ask(CARDED, { question: 'Quelle version ?' })
  assert.equal(withoutDefault.isError, false, withoutDefault.result ?? '')

  // Rien n'échoit avant l'heure.
  decisions.sweep(Date.now())
  assert.equal(row(withDefault.id).resolvedAt, null)

  decisions.sweep(Date.now() + 13 * 3_600_000)
  const defaulted = row(withDefault.id)
  assert.ok(defaulted.resolvedAt)
  assert.ok(defaulted.acceptedAt, 'Le défaut appliqué est une réponse')
  assert.deepEqual(JSON.parse(defaulted.answer!), { by: 'default', option: 'Non' })
  assert.match(messages(ALLOWED)[0]!.body, /Réponse appliquée par défaut[^\n]*« Non »/)

  const expired = row(withoutDefault.id)
  assert.ok(expired.resolvedAt)
  assert.equal(expired.acceptedAt, null)
  assert.deepEqual(JSON.parse(expired.answer!), { by: 'expired' })
  assert.match(messages(CARDED)[0]!.body, /Personne n'a répondu/)

  // La session rattachée à une carte y a inscrit la question, puis l'issue.
  const notes = db.select().from(cardNotes).where(eq(cardNotes.cardId, 'card')).orderBy(asc(cardNotes.createdAt)).all()
  assert.equal(notes.length, 2)
  assert.equal(notes[0]!.conversationId, CARDED)
  assert.match(notes[0]!.body, /Décision demandée : Quelle version \?/)
  assert.match(notes[1]!.body, /expirée sans réponse/)
})

test('décisions : archiver la session retire sa demande, sans rien lui remettre', async (t) => {
  const { db, ask, row, messages, requests } = await harness(t)

  const asked = await ask(CARDED, { question: 'On garde la branche ?', options: ['Oui', 'Non'] })
  db.update(conversations).set({ archivedAt: Date.now() }).where(eq(conversations.id, CARDED)).run()
  await requests.sweep()

  const withdrawn = row(asked.id)
  assert.ok(withdrawn.resolvedAt)
  assert.deepEqual(JSON.parse(withdrawn.answer!), { by: 'withdrawn' })
  assert.equal(messages(CARDED).length, 0)
  // La question est sur la carte, l'issue non : personne n'a tranché.
  const notes = db.select().from(cardNotes).where(eq(cardNotes.cardId, 'card')).all()
  assert.equal(notes.length, 1)
})

test('« À décider » liste aussi les rangements de cartes en attente, pour le propriétaire du projet', async (t) => {
  const { db, app, requests } = await harness(t)
  db.update(conversations)
    .set({ config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, cardFiling: true }) })
    .where(eq(conversations.id, PLAIN))
    .run()
  const ctxRequests = new AgentRequests(
    { db, config: { mcp: { cardFiling: true } } as unknown as Config },
    { statusBus: new EventEmitter() } as unknown as SessionManager,
    {} as AgentRegistry,
    new EventLog(db),
  )
  db.insert(agentRequests)
    .values({
      id: 'move', projectId: 'project', conversationId: PLAIN, kind: 'request_card_move',
      payload: JSON.stringify({ moves: [{ card: 7, column: 'done', reason: 'PR fusionnée.' }] }), createdAt: Date.now(),
    })
    .run()
  await ctxRequests.sweep()
  await requests.sweep()

  const mine = (await app.inject({ method: 'GET', url: '/api/awaiting' })).json()
  assert.deepEqual(mine.requests, [
    {
      kind: 'request_card_move', id: 'move', conversationId: PLAIN, projectId: 'project',
      conversationTitle: `Session ${PLAIN}`, count: 1, createdAt: mine.requests[0].createdAt,
    },
  ])
  const theirs = (await app.inject({ method: 'GET', url: '/api/awaiting', headers: { 'x-as': 'other' } })).json()
  assert.equal(theirs.requests.length, 0)
})

test('décisions : l’archivage automatique épargne une session qui attend sa réponse', async (t) => {
  const { db, ask } = await harness(t)
  const asked = await ask(ALLOWED, { question: 'On pousse ?', options: ['Oui', 'Non'] })
  assert.equal(asked.isError, false, asked.result ?? '')
  // Deux sessions au repos, lues et vieilles de dix jours : seule celle sans décision part.
  const old = Date.now() - 10 * 24 * 3_600_000
  for (const id of [ALLOWED, PLAIN]) {
    db.update(conversations).set({ updatedAt: old, lastSeq: 0 }).where(eq(conversations.id, id)).run()
    db.insert(conversationReads).values({ conversationId: id, userId: 'owner', lastReadSeq: 0, updatedAt: old }).run()
  }

  assert.equal(archiveStaleConversations(db, 7), 1)
  const archived = (id: string) => db.select().from(conversations).where(eq(conversations.id, id)).get()!.archivedAt
  assert.ok(archived(PLAIN))
  assert.equal(archived(ALLOWED), null)

  // Échue, elle ne protège plus la session.
  db.update(agentRequests).set({ expiresAt: Date.now() - 1 }).where(eq(agentRequests.id, asked.id)).run()
  assert.equal(archiveStaleConversations(db, 7), 1)
  assert.ok(archived(ALLOWED))
})
