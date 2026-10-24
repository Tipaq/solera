import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import {
  agentRequests,
  cardNotes,
  cards,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  users,
} from '@solera/db'
import { parseSessionMessage, type AgentConfig, type AgentModelDto } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import { EventLog } from '../src/events/event-log.js'
import type { Config } from '../src/config.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { AgentRequests, LAUNCHES_PER_HOUR, matchEffort, matchModel } from '../src/sessions/agent-requests.js'
import { adoptSessionTitle, sessionTitleReminder } from '../src/conversations/title.js'

const model = (value: string, displayName: string, efforts: string[], isDefault = false): AgentModelDto => ({
  value,
  displayName,
  description: '',
  hint: null,
  isDefault,
  efforts: efforts.map((effort) => ({ value: effort, label: effort, hint: null })),
  defaultEffort: efforts.includes('medium') ? 'medium' : (efforts[0] ?? null),
  supportsFastMode: false,
})

const CATALOG: Record<string, AgentModelDto[]> = {
  claude: [
    model('default', 'Default', ['low', 'medium', 'high', 'xhigh', 'max'], true),
    model('opus', 'Opus', ['low', 'medium', 'high', 'xhigh', 'max']),
  ],
  codex: [
    model('gpt-5.5', 'GPT-5.5', ['low', 'medium', 'high', 'xhigh'], true),
    model('astra-1', 'Astra', ['low', 'medium', 'high']),
  ],
}

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-agent-requests-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  const conversation = (id: string, agent: 'claude' | 'codex' = 'claude') =>
    db.insert(conversations).values({
      id, projectId: 'project', userId: 'owner', title: `Session ${id}`, agent, config: '{}', status: 'running',
      createdAt: 1, updatedAt: Date.now(),
    }).run()

  const sent: { to: string; text: string }[] = []
  // Le daemon y annonce les listes qu'une demande a changées, et les titres.
  const statusBus = new EventEmitter()
  const titleEvents: { conversationId: string; title: string }[] = []
  statusBus.on('title', (event: { conversationId: string; title: string }) => titleEvents.push(event))
  const sessions = {
    async sendMessage(to: string, _id: string, text: string) {
      sent.push({ to, text })
    },
    statusBus,
  } as unknown as SessionManager
  const registry = {
    adapter: (agent: string) => ({
      models: async () => ({ models: CATALOG[agent] }),
      // Le CLI remplace le modèle vide par le sien, comme le vrai adaptateur.
      resolveDefaults: async (config: AgentConfig) =>
        config.model ? config : { ...config, model: CATALOG[agent]?.[0]?.value ?? '' },
    }),
  } as unknown as AgentRegistry
  const config = { paths: { worktrees: join(dir, 'worktrees') } } as unknown as Config
  const requests = new AgentRequests({ db, config }, sessions, registry, new EventLog(db))

  /** Appelle un outil sur le vrai serveur MCP, pendant que le daemon balaie. */
  const mcp = async (from: string, name: string, args: object) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: 'project', SOLERA_MCP_CONVERSATION: from },
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n')

    const deadline = Date.now() + 10000
    while (!stdout.includes('\n') && Date.now() < deadline) {
      await requests.sweep()
      await new Promise((done) => setTimeout(done, 50))
    }
    child.kill()
    return JSON.parse(stdout).result as { content: { text: string }[]; isError?: boolean }
  }

  return { db, conversation, mcp, sent, statusBus, titleEvents }
}

test('matchModel finds a model by the name the user says, and never guesses between two', () => {
  assert.equal(matchModel(CATALOG.codex!, 'Astra')?.value, 'astra-1')
  assert.equal(matchModel(CATALOG.codex!, 'gpt-5.5')?.value, 'gpt-5.5')
  assert.equal(matchModel(CATALOG.codex!, 'astr')?.value, 'astra-1')
  assert.equal(matchModel(CATALOG.claude!, 'u'), null)
  assert.equal(matchModel(CATALOG.codex!, 'nope'), null)
})

test('matchEffort maps max to the highest level the model accepts', () => {
  assert.equal(matchEffort(['low', 'medium', 'high', 'xhigh'], 'max'), 'xhigh')
  assert.equal(matchEffort(['low', 'medium', 'high', 'xhigh', 'max'], 'max'), 'max')
  assert.equal(matchEffort(['low', 'medium'], 'high'), null)
})

test('start_session launches a session with the requested CLI, model and effort', async (t) => {
  const { db, conversation, mcp, sent } = await harness(t)
  conversation('parent')

  const result = await mcp('parent', 'start_session', {
    prompt: 'Corriger le titre tronqué dans la sidebar.',
    agent: 'codex',
    model: 'Astra',
    effort: 'max',
  })
  assert.equal(result.isError, undefined, result.content[0]?.text)
  assert.match(result.content[0]!.text, /Session lancée/)

  const request = db.select().from(agentRequests).get()!
  const launched = db.select().from(conversations).where(eq(conversations.id, request.launchedConversationId!)).get()!
  assert.equal(launched.agent, 'codex')
  assert.equal(launched.title, 'Corriger le titre tronqué dans la sidebar.')
  assert.equal(launched.titleSetByUser, false)
  const config = JSON.parse(launched.config) as AgentConfig
  assert.equal(config.model, 'astra-1')
  assert.equal(config.agent === 'codex' && config.reasoningEffort, 'high')

  // La mission arrive enveloppée, signée par la session qui l'a confiée.
  const envelope = parseSessionMessage(sent[0]!.text)
  assert.equal(sent[0]!.to, launched.id)
  assert.equal(envelope?.kind, 'launch')
  assert.equal(envelope?.from, 'parent')
  assert.equal(envelope?.body, 'Corriger le titre tronqué dans la sidebar.')
})

test('start_session names the models that exist when asked for one that does not', async (t) => {
  const { conversation, mcp } = await harness(t)
  conversation('parent')

  const result = await mcp('parent', 'start_session', { prompt: 'x', agent: 'codex', model: 'gpt-9' })
  assert.equal(result.isError, true)
  assert.match(result.content[0]!.text, /astra-1 \(Astra\)/)
})

test('start_session links a card and moves it to in progress', async (t) => {
  const { db, conversation, mcp } = await harness(t)
  conversation('parent')
  db.insert(cards).values({
    id: 'card', projectId: 'project', number: 7, title: 'Bug', description: '', column: 'todo',
    position: 1, createdBy: 'owner', createdAt: 1, updatedAt: 1,
  }).run()

  const result = await mcp('parent', 'start_session', { prompt: 'Traiter la carte.', card: 7 })
  assert.match(result.content[0]!.text, /carte #7/)
  assert.equal(db.select().from(cards).get()?.column, 'in_progress')
  const request = db.select().from(agentRequests).get()!
  assert.equal(db.select().from(conversations).where(eq(conversations.id, request.launchedConversationId!)).get()?.cardId, 'card')
})

test('start_session refuses deep launch chains and launch storms', async (t) => {
  const { db, conversation, mcp } = await harness(t)
  for (const id of ['root', 'child', 'grandchild']) conversation(id)
  const launched = (from: string, to: string | null, at = Date.now()) =>
    db.insert(agentRequests).values({
      id: `${from}-${to ?? Math.random()}`, projectId: 'project', conversationId: from, kind: 'start_session',
      payload: '{}', createdAt: at, settledAt: at, result: 'ok', isError: false, launchedConversationId: to,
    }).run()
  launched('root', 'child')
  launched('child', 'grandchild')

  const deep = await mcp('grandchild', 'start_session', { prompt: 'encore' })
  assert.equal(deep.isError, true)
  assert.match(deep.content[0]!.text, /lancement en chaîne/)

  for (let i = 0; i < LAUNCHES_PER_HOUR - 1; i++) launched('root', null)
  const storm = await mcp('root', 'start_session', { prompt: 'une de trop' })
  assert.equal(storm.isError, true)
  assert.match(storm.content[0]!.text, /dans l'heure/)
})

test('create_card opens a todo card and says which session opened it', async (t) => {
  const { db, conversation, mcp } = await harness(t)
  conversation('parent')

  const result = await mcp('parent', 'create_card', { title: 'Titre tronqué', description: 'Voir la sidebar.' })
  assert.equal(result.isError, undefined, result.content[0]?.text)
  const card = db.select().from(cards).get()!
  assert.equal(card.number, 1)
  assert.equal(card.column, 'todo')
  assert.equal(db.select().from(cardNotes).get()?.conversationId, 'parent')
})

test('list_models shows the catalog and the defaults a launch would use', async (t) => {
  const { conversation, mcp } = await harness(t)
  conversation('parent')

  const result = await mcp('parent', 'list_models', { agent: 'codex' })
  assert.match(result.content[0]!.text, /par défaut : modèle gpt-5\.5/)
  assert.match(result.content[0]!.text, /`astra-1` \(Astra\)/)
})

test('rename_session names only its own session, and announces the title', async (t) => {
  const { db, conversation, mcp, titleEvents, statusBus } = await harness(t)
  conversation('self')
  conversation('peer')
  const title = (id: string) => db.select().from(conversations).where(eq(conversations.id, id)).get()!

  const renamed = await mcp('self', 'rename_session', { title: '  Refonte de la sidebar  ' })
  assert.equal(renamed.isError, undefined, renamed.content[0]?.text)
  assert.equal(title('self').title, 'Refonte de la sidebar')
  assert.equal(title('self').titleSetByAgent, true)
  assert.equal(title('self').titleSetByUser, false)
  assert.deepEqual(titleEvents, [{ conversationId: 'self', title: 'Refonte de la sidebar' }])

  // Le résumé du CLI ne remplace plus le titre de l'agent, et le même titre ne s'annonce pas deux fois.
  assert.equal(adoptSessionTitle(db, statusBus, 'self', 'Résumé du CLI', 'cli'), 'protected')
  await mcp('self', 'rename_session', { title: 'Refonte de la sidebar' })
  assert.equal(titleEvents.length, 1)

  for (const args of [{ title: '' }, { title: 'x'.repeat(61) }, { title: 'Deux\nlignes' }, { title: 'Bad\u0000title' }]) {
    assert.equal((await mcp('self', 'rename_session', args)).isError, true, JSON.stringify(args))
  }
  assert.equal(title('peer').title, 'Session peer')
  assert.equal(title('self').title, 'Refonte de la sidebar')

  // Le sujet change : l'agent ajuste son titre.
  assert.equal((await mcp('self', 'rename_session', { title: 'Corriger la connexion' })).isError, undefined)
  assert.equal(titleEvents.at(-1)?.title, 'Corriger la connexion')
})

test("le titre de l'utilisateur l'emporte sur celui de l'agent et sur le résumé tardif du CLI", async (t) => {
  const { db, conversation, mcp, statusBus, titleEvents } = await harness(t)
  conversation('self')
  assert.equal(adoptSessionTitle(db, statusBus, 'self', 'Résumé natif', 'cli'), 'updated')
  // Reprendre à son compte le titre affiché le protège quand même du prochain résumé.
  await mcp('self', 'rename_session', { title: 'Résumé natif' })
  assert.equal(db.select().from(conversations).get()?.titleSetByAgent, true)

  db.update(conversations).set({ title: 'Mon titre', titleSetByUser: true, titleSetByAgent: false }).run()
  titleEvents.length = 0
  const kept = await mcp('self', 'rename_session', { title: "Titre de l'agent" })
  assert.equal(kept.isError, undefined)
  assert.match(kept.content[0]!.text, /choisi par l'utilisateur/)
  assert.equal(adoptSessionTitle(db, statusBus, 'self', 'Résumé tardif', 'cli'), 'protected')
  assert.equal(db.select().from(conversations).get()?.title, 'Mon titre')
  assert.deepEqual(titleEvents, [])
  assert.equal(adoptSessionTitle(db, statusBus, 'disparue', 'Résumé', 'cli'), 'missing')
})

test('le rappel de nommage suit le titre : à donner, à garder, ou rien', async (t) => {
  const { db, conversation, statusBus } = await harness(t)
  conversation('self')
  assert.match(sessionTitleReminder(db, 'self', true) ?? '', /appelle `rename_session`/)
  assert.equal(sessionTitleReminder(db, 'self', false), null)
  adoptSessionTitle(db, statusBus, 'self', 'Refonte de la sidebar', 'agent')
  assert.match(sessionTitleReminder(db, 'self', true) ?? '', /Garde-le tant que le sujet principal ne change pas/)
  db.update(conversations).set({ titleSetByUser: true }).run()
  assert.equal(sessionTitleReminder(db, 'self', true), null)
})
