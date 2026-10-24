import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import type { ClientMessage, PushPayload, ServerMessage } from '@solera/protocol'
import type { Config } from '../src/config.js'
import type { EventLog } from '../src/events/event-log.js'
import { Notifications, type PushSender } from '../src/notifications/dispatcher.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import type { CloneJobs } from '../src/clone-jobs.js'
import type { TerminalManager } from '../src/terminals/terminal-manager.js'
import type { WebhookService } from '../src/webhooks/service.js'
import { registerClaudeSessionRoutes } from '../src/http/routes/claude-sessions.js'
import { registerConversationRoutes } from '../src/http/routes/conversations.js'
import { registerProjectRoutes } from '../src/http/routes/projects.js'
import { registerScheduleRoutes } from '../src/http/routes/schedules.js'
import { registerActionRoutes } from '../src/http/routes/actions.js'
import type { ActionRunner } from '../src/actions/actions.js'
import type { TaskScheduler } from '../src/scheduler/task-scheduler.js'
import { registerV1Routes } from '../src/http/v1/index.js'
import { LIST_ROUTES, registerWebSocketHub } from '../src/ws/hub.js'
import { writeNotificationPrefs } from '../src/settings/user-settings.js'

async function database(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-ws-hub-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects).values({ id: 'private', name: 'private', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  db.insert(conversations).values({
    id: 'c1', projectId: 'private', userId: 'owner', title: 'Session', agent: 'claude', config: '{}',
    status: 'running', createdAt: 1, updatedAt: 1,
  }).run()

  return { dir, db, ctx: { db, config: { paths: { data: dir } } as Config } }
}

/** Le compte vient d'un en-tête : le hook d'authentification réel lit un cookie. */
function authenticate(app: FastifyInstance, db: Awaited<ReturnType<typeof database>>['db']) {
  app.addHook('onRequest', async (request) => {
    const id = request.headers['x-user']
    if (typeof id === 'string') request.user = db.select().from(users).where(eq(users.id, id)).get()
  })
}

function stubSessions(warm: string[] = []) {
  return {
    statusBus: new EventEmitter(),
    setNotifier: () => {},
    warmConversationIds: () => warm,
    isWarm: (id: string) => warm.includes(id),
    backgroundCount: () => 2,
    loopCount: () => 0,
    appliedConfig: () => null,
  } as unknown as SessionManager
}

async function hub(t: TestContext, warm: string[] = []) {
  const { db, ctx } = await database(t)
  const sessions = stubSessions(warm)
  const app = Fastify()
  authenticate(app, db)

  // Déclarées avant le hub, comme dans `buildApp` : le hook doit s'y appliquer quand même.
  app.patch('/api/conversations/:id', async (request, reply) =>
    (request.params as { id: string }).id === 'missing' ? reply.code(404).send({}) : { ok: true })
  app.post('/api/conversations/:id/read', async () => ({ lastReadSeq: 1 }))

  // Le journal ne sert qu'à l'abonnement à un fil : rien à rattraper, rien à suivre.
  const log = { read: () => [], subscribe: () => () => {} } as unknown as EventLog
  // Le service de push réel parlerait au réseau : on retient ce qu'il aurait envoyé, et
  // à qui on aurait évité de l'envoyer.
  const pushed: Array<{ userId: string; payload: PushPayload; except: string[] }> = []
  const push: PushSender = {
    notify: async (userId, payload, options = {}) => {
      pushed.push({ userId, payload, except: [...(options.except ?? [])].sort() })
      return []
    },
  }
  const notifications = new Notifications(db, push)
  await registerWebSocketHub(app, ctx, log, sessions, notifications)
  await app.ready()
  // Les deux bouts coupés net : une fermeture polie attend la réponse de l'autre côté,
  // que les flux simulés de `injectWS` ne transmettent pas, et `ws` patiente alors 30 s.
  t.after(async () => {
    for (const client of app.websocketServer.clients) client.terminate()
    await app.close()
  })

  const open = async (user: string) => {
    const received: ServerMessage[] = []
    const socket = await app.injectWS('/api/ws', { headers: { 'x-user': user } }, {
      // Avant l'ouverture : l'instantané de statuts part dès la connexion.
      onInit: (ws) => ws.on('message', (raw) => received.push(JSON.parse(raw.toString()) as ServerMessage)),
    })
    t.after(() => socket.terminate())
    const send = (message: ClientMessage) => socket.send(JSON.stringify(message))
    return { received, send }
  }
  const connect = async (user: string) => (await open(user)).received

  return { app, db, sessions, connect, open, notifications, pushed }
}

/** Les messages traversent des flux asynchrones : on attend un peu avant de conclure. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const listsChanged = (messages: ServerMessage[]) => messages.filter((m) => m.t === 'lists-changed').length

test('un changement de liste réussi prévient tous les onglets', async (t) => {
  const { app, connect } = await hub(t)
  const owner = await connect('owner')
  const other = await connect('other')

  await app.inject({ method: 'PATCH', url: '/api/conversations/c1', headers: { 'x-user': 'owner' } })
  await settle()

  assert.equal(listsChanged(owner), 1)
  assert.equal(listsChanged(other), 1)
})

test('un échec ne prévient personne', async (t) => {
  const { app, connect } = await hub(t)
  const owner = await connect('owner')

  await app.inject({ method: 'PATCH', url: '/api/conversations/missing', headers: { 'x-user': 'owner' } })
  await settle()

  assert.equal(listsChanged(owner), 0)
})

test('le curseur de lecture ne fait pas relire la liste', async (t) => {
  const { app, connect } = await hub(t)
  const owner = await connect('owner')

  await app.inject({ method: 'POST', url: '/api/conversations/c1/read', headers: { 'x-user': 'owner' } })
  await settle()

  assert.equal(listsChanged(owner), 0)
})

test('un titre proposé fait relire la liste à qui peut lire le fil', async (t) => {
  const { sessions, connect } = await hub(t)
  const owner = await connect('owner')
  const other = await connect('other')

  sessions.statusBus.emit('title', { conversationId: 'c1', title: 'Nouveau titre' })
  await settle()

  assert.equal(listsChanged(owner), 1)
  assert.equal(listsChanged(other), 0)
})

test('un socket qui arrive reçoit le statut des sessions vivantes qu’il peut lire', async (t) => {
  const { connect } = await hub(t, ['c1'])
  const owner = await connect('owner')
  const other = await connect('other')
  await settle()

  const status = owner.find((m) => m.t === 'status')
  assert.ok(status && status.t === 'status')
  assert.equal(status.conversationId, 'c1')
  assert.equal(status.background, 2)
  assert.equal(other.some((m) => m.t === 'status'), false)
})

test('chaque route de LIST_ROUTES existe', async (t) => {
  const { ctx } = await database(t)
  const app = Fastify()
  // Les collaborateurs ne sont jamais appelés : seule la déclaration des routes compte.
  const sessions = stubSessions()
  registerProjectRoutes(app, ctx, {} as AttachmentStore, {} as CloneJobs, {} as TerminalManager)
  registerConversationRoutes(app, ctx, {} as EventLog, sessions, {} as AgentRegistry, {} as AttachmentStore, {} as WebhookService)
  registerClaudeSessionRoutes(app, ctx, {} as EventLog, sessions, {} as AgentRegistry)
  registerV1Routes(app, ctx, {} as EventLog, sessions, {} as AgentRegistry, {} as WebhookService)
  registerScheduleRoutes(app, ctx, sessions, {} as AgentRegistry, {} as TaskScheduler)
  registerActionRoutes(app, ctx, sessions, {} as ActionRunner)
  await app.ready()
  t.after(() => app.close())

  for (const key of LIST_ROUTES) {
    const [method, url] = key.split(' ') as [string, string]
    assert.ok(app.hasRoute({ method: method as 'GET', url }), `route absente : ${key}`)
  }
})

// --- L'aiguillage des notifications ------------------------------------------------

const toasts = (messages: ServerMessage[]) => messages.filter((m) => m.t === 'notify')

/** Une demande de permission dans `c1`, telle que le gestionnaire de sessions l'envoie. */
const permission = {
  kind: 'cliRequest' as const,
  conversationId: 'c1',
  push: { title: 'Une autorisation est demandée', body: 'Session', url: '/p/private/c/c1', tag: 'c1', kind: 'permission' as const },
  toast: {
    kind: 'cliRequest' as const,
    request: 'permission' as const,
    conversationId: 'c1',
    projectId: 'private',
    conversationTitle: 'Session',
    detail: 'Bash : ls',
  },
}

/** Une fin de tour : jamais de toast, seulement la notification système. */
const turnCompleted = {
  kind: 'turnCompleted' as const,
  conversationId: 'c1',
  push: { title: "L'agent a terminé", body: 'Session', url: '/p/private/c/c1', tag: 'c1', kind: 'turnCompleted' as const },
}

test("une demande arrive en toast sur l'appareil visible, en push sur les autres", async (t) => {
  const { open, notifications, pushed } = await hub(t)
  const desk = await open('owner')
  const phone = await open('owner')
  desk.send({ t: 'presence', visible: true, endpoint: 'https://push.example/desk' })
  phone.send({ t: 'presence', visible: false, endpoint: 'https://push.example/phone' })
  await settle()

  await notifications.dispatch('owner', permission)
  await settle()

  assert.equal(toasts(desk.received).length, 1)
  assert.equal(toasts(phone.received).length, 0)
  // Le push part pour tout le compte, sauf l'appareil qui a eu le toast.
  assert.deepEqual(pushed.map((p) => p.except), [['https://push.example/desk']])
})

test("rien ne part si la conversation est sous les yeux d'un onglet visible", async (t) => {
  const { open, notifications, pushed } = await hub(t)
  const desk = await open('owner')
  desk.send({ t: 'presence', visible: true, endpoint: null })
  desk.send({ t: 'subscribe', conversationId: 'c1', afterSeq: 0 })
  await settle()

  await notifications.dispatch('owner', permission)
  await settle()

  assert.equal(toasts(desk.received).length, 0)
  assert.equal(pushed.length, 0)
})

test("un onglet abonné au fil mais caché ne retient pas la notification", async (t) => {
  const { open, notifications, pushed } = await hub(t)
  const desk = await open('owner')
  desk.send({ t: 'presence', visible: false, endpoint: 'https://push.example/desk' })
  desk.send({ t: 'subscribe', conversationId: 'c1', afterSeq: 0 })
  await settle()

  await notifications.dispatch('owner', permission)
  await settle()

  assert.equal(toasts(desk.received).length, 0)
  assert.deepEqual(pushed.map((p) => p.except), [[]])
})

test("un onglet qui n'a rien déclaré compte comme absent", async (t) => {
  const { open, notifications, pushed } = await hub(t)
  const desk = await open('owner')
  desk.send({ t: 'subscribe', conversationId: 'c1', afterSeq: 0 })
  await settle()

  await notifications.dispatch('owner', permission)
  await settle()

  assert.equal(toasts(desk.received).length, 0)
  assert.equal(pushed.length, 1)
})

test("une fin de tour ne fait jamais de toast, et épargne l'appareil visible", async (t) => {
  const { open, notifications, pushed } = await hub(t)
  const desk = await open('owner')
  desk.send({ t: 'presence', visible: true, endpoint: 'https://push.example/desk' })
  await settle()

  await notifications.dispatch('owner', turnCompleted)
  await settle()

  assert.equal(toasts(desk.received).length, 0)
  assert.deepEqual(pushed.map((p) => p.except), [['https://push.example/desk']])
})

test("le toast ne va qu'au compte concerné", async (t) => {
  const { open, notifications } = await hub(t)
  const owner = await open('owner')
  const other = await open('other')
  owner.send({ t: 'presence', visible: true, endpoint: null })
  other.send({ t: 'presence', visible: true, endpoint: 'https://push.example/other' })
  await settle()

  await notifications.dispatch('owner', permission)
  await settle()

  assert.equal(toasts(owner.received).length, 1)
  assert.equal(toasts(other.received).length, 0)
})

test('une sorte coupée dans les réglages ne part nulle part', async (t) => {
  const { db, open, notifications, pushed } = await hub(t)
  writeNotificationPrefs(db, 'owner', { cliRequest: false, turnCompleted: true })
  const desk = await open('owner')
  desk.send({ t: 'presence', visible: true, endpoint: null })
  await settle()

  await notifications.dispatch('owner', permission)
  await notifications.dispatch('owner', turnCompleted)
  await settle()

  assert.equal(toasts(desk.received).length, 0)
  assert.deepEqual(pushed.map((p) => p.payload.kind), ['turnCompleted'])
})

test("un onglet qui passe en arrière-plan rend la main à la notification système", async (t) => {
  const { open, notifications, pushed } = await hub(t)
  const desk = await open('owner')
  desk.send({ t: 'presence', visible: true, endpoint: 'https://push.example/desk' })
  desk.send({ t: 'presence', visible: false, endpoint: 'https://push.example/desk' })
  await settle()

  await notifications.dispatch('owner', permission)
  await settle()

  assert.equal(toasts(desk.received).length, 0)
  assert.deepEqual(pushed.map((p) => p.except), [[]])
})
