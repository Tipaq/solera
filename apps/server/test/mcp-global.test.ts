import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
  instructions,
  openDatabase,
  projects,
  runMigrations,
  users,
} from '@solera/db'
import type { AgentConfig } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import type { SessionManager } from '../src/sessions/session-manager.js'

/**
 * Le serveur MCP en mode global : branché de l'extérieur sur toute l'instance, au nom
 * d'un compte (`docs/mcp.md`). Ce qui le distingue du fil libre, le catalogue, le choix
 * du projet, les écritures signées par le compte, et les gestes sur une session qui
 * passent par le daemon.
 */

interface ToolResult {
  content: { text: string }[]
  isError?: boolean
}

const ENTRY = fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-mcp-global-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Owner', passwordHash: '', createdAt: 1, isAdmin: true }).run()
  for (const [id, name] of [['alpha', 'Alpha'], ['beta', 'Beta app'], ['gamma', 'Beta api']] as const) {
    db.insert(projects).values({ id, name, workspacePath: join(dir, id), ownerId: 'owner', visibility: 'private', instructionsMode: 'solera', createdAt: 1 }).run()
  }

  const conversation = (id: string, values: Partial<typeof conversations.$inferInsert> = {}) =>
    db.insert(conversations).values({
      id, projectId: 'alpha', userId: 'owner', title: `Session ${id}`, agent: 'claude', config: '{}', status: 'idle',
      createdAt: 1, updatedAt: Date.now(), ...values,
    }).run()

  const env = (extra: Record<string, string>) => ({
    ...process.env,
    SOLERA_MCP_DB: dbPath,
    SOLERA_MCP_MEMORY: join(dir, 'memory'),
    SOLERA_MCP_PROJECT: '',
    SOLERA_MCP_CONVERSATION: '',
    ...extra,
  })
  const GLOBAL = { SOLERA_MCP_GLOBAL: '1', SOLERA_MCP_USER: 'owner' }

  const run = (extra: Record<string, string>, requests: object[]) =>
    spawnSync(process.execPath, [ENTRY], {
      env: env(extra),
      encoding: 'utf8',
      timeout: 10000,
      input: requests.map((request, index) => JSON.stringify({ jsonrpc: '2.0', id: index + 1, ...request })).join('\n') + '\n',
    })
  const call = (name: string, args: object, extra: Record<string, string> = GLOBAL) => {
    const result = run(extra, [{ method: 'tools/call', params: { name, arguments: args } }])
    assert.equal(result.status, 0, result.stderr)
    const parsed = JSON.parse(result.stdout).result as ToolResult
    return { ...parsed, text: parsed.content[0]!.text }
  }
  const tools = (extra: Record<string, string> = GLOBAL) => {
    const result = run(extra, [{ method: 'tools/list' }])
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout).result.tools as {
      name: string
      description: string
      inputSchema: { properties: Record<string, { description?: string }>; required?: string[] }
    }[]
  }

  // Le daemon, avec un gestionnaire de sessions qui ne fait que noter les gestes.
  const gestures: string[] = []
  const sessions = {
    async sendMessage(to: string, _id: string, text: string) {
      gestures.push(`message ${to} ${text}`)
    },
    async steer(to: string, _id: string, text: string) {
      gestures.push(`steer ${to} ${text}`)
      return to !== 'stubborn'
    },
    async interrupt(to: string) {
      gestures.push(`interrupt ${to}`)
    },
    resolvePermission(to: string, requestId: string, decision: { decision: string; scope: string; decidedBy: string }) {
      gestures.push(`permission ${to} ${requestId} ${decision.decision} ${decision.scope} ${decision.decidedBy}`)
      return true
    },
    statusBus: new EventEmitter(),
  } as unknown as SessionManager
  const registry = {
    adapter: () => ({
      models: async () => ({ models: [] }),
      resolveDefaults: async (config: AgentConfig) => config,
    }),
  } as unknown as AgentRegistry
  const log = new EventLog(db)
  const requests = new AgentRequests({ db, config: { paths: { worktrees: join(dir, 'worktrees') } } as unknown as Config }, sessions, registry, log)

  /** Appelle un outil pendant que le daemon balaie : ce qui passe par `agent_requests`. */
  const daemonCall = async (name: string, args: object) => {
    const child = spawn(process.execPath, [ENTRY], { env: env(GLOBAL) })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n')
    const deadline = Date.now() + 10000
    while (!stdout.includes('\n') && Date.now() < deadline) {
      await requests.sweep()
      await new Promise((done) => setTimeout(done, 50))
    }
    child.kill()
    const parsed = JSON.parse(stdout).result as ToolResult
    return { ...parsed, text: parsed.content[0]!.text }
  }

  return { db, dir, log, run, call, tools, conversation, daemonCall, gestures, GLOBAL }
}

test('le mode global s’ouvre par un drapeau, au nom d’un compte, et jamais pour une conversation', async (t) => {
  const { db, run, tools, GLOBAL } = await harness(t)

  // Un seul compte : il va de soi. Deux : il faut le nommer.
  assert.equal(run({ SOLERA_MCP_GLOBAL: '1' }, [{ method: 'ping' }]).status, 0)
  db.insert(users).values({ id: 'other', username: 'other', displayName: 'Other', passwordHash: '', createdAt: 2 }).run()
  const ambiguous = run({ SOLERA_MCP_GLOBAL: '1' }, [{ method: 'ping' }])
  assert.equal(ambiguous.status, 1)
  assert.match(ambiguous.stderr, /SOLERA_MCP_USER/)
  assert.equal(run({ SOLERA_MCP_GLOBAL: '1', SOLERA_MCP_USER: 'nobody' }, [{ method: 'ping' }]).status, 1)

  // Le drapeau avec une conversation ou un projet : une session mal lancée ne s'ouvre
  // pas sur toute l'instance.
  const mixed = run({ ...GLOBAL, SOLERA_MCP_CONVERSATION: 'c' }, [{ method: 'ping' }])
  assert.equal(mixed.status, 1)
  assert.match(mixed.stderr, /SOLERA_MCP_GLOBAL exclut/)
  assert.equal(run({ ...GLOBAL, SOLERA_MCP_PROJECT: 'alpha' }, [{ method: 'ping' }]).status, 1)

  // Sans le drapeau, l'absence de projet reste le fil libre.
  const free = tools({ SOLERA_MCP_CONVERSATION: 'c' }).map((tool) => tool.name)
  assert.ok(!free.includes('list_projects'))
  assert.ok(free.includes('read_instructions'))
})

test('le catalogue global : list_projects, un paramètre project, et rien de ce qui suppose une session', async (t) => {
  const { tools } = await harness(t)
  const listed = tools()
  const names = listed.map((tool) => tool.name)
  const byName = Object.fromEntries(listed.map((tool) => [tool.name, tool]))

  assert.equal(names[0], 'list_projects')
  for (const absent of [
    'broadcast_session_message', 'notify_when_done', 'read_session_messages', 'find_file_edits',
    'create_worktree', 'set_project_image', 'create_project', 'move_conversation', 'request_card_change',
    'request_decision', 'show_prototype', 'rename_session',
  ]) {
    assert.ok(!names.includes(absent), absent)
  }
  for (const present of ['read_conversation', 'send_session_message', 'interrupt_session', 'reply_session', 'read_memory', 'start_session']) {
    assert.ok(names.includes(present), present)
  }

  assert.deepEqual(byName.list_cards!.inputSchema.required, ['project'])
  assert.deepEqual(byName.add_card_note!.inputSchema.required, ['project', 'card', 'body'])
  assert.deepEqual(byName.read_conversation!.inputSchema.required, ['id'])
  assert.ok(byName.read_conversation!.inputSchema.properties.wait_seconds)
  assert.ok(!byName.read_conversation!.inputSchema.properties.project)
  // La portée des consignes devient le projet, celle d'une permission reste.
  assert.ok(!byName.edit_instructions!.inputSchema.properties.scope)
  assert.ok(byName.reply_session!.inputSchema.properties.scope)
  assert.ok(!byName.send_session_message!.inputSchema.properties.reply_to)
  assert.match(byName.start_session!.inputSchema.properties.agent!.description!, /Omettre pour Claude/)
  assert.match(byName.start_session!.inputSchema.properties.worktree!.description!, /Omettre pour la racine du projet/)
  assert.doesNotMatch(byName.list_cards!.description, /ce projet/)
})

test('le projet se désigne par son id ou son nom, sans jamais deviner entre deux, et dans ce que le compte voit', async (t) => {
  const { db, call, GLOBAL } = await harness(t)
  db.insert(users).values({ id: 'other', username: 'other', displayName: 'Other', passwordHash: '', createdAt: 2 }).run()
  db.insert(projects).values({ id: 'shared', name: 'Partagé', workspacePath: '/x', ownerId: 'other', visibility: 'shared', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'secret', name: 'Secret', workspacePath: '/y', ownerId: 'other', visibility: 'private', createdAt: 1 }).run()
  db.insert(cards).values({ id: 'card-1', projectId: 'alpha', number: 1, title: 'Première carte', column: 'todo', createdBy: 'owner', createdAt: 1, updatedAt: 1 }).run()

  const listed = call('list_projects', {}).text
  assert.match(listed, /Alpha \(id alpha\)/)
  assert.match(listed, /Partagé/)
  assert.doesNotMatch(listed, /Secret/)

  assert.match(call('list_cards', { project: 'alpha' }).text, /Première carte/)
  assert.match(call('list_cards', { project: 'ALPHA' }).text, /Première carte/)
  assert.match(call('list_cards', { project: 'alp' }).text, /Première carte/)
  const ambiguous = call('list_cards', { project: 'beta ap' })
  assert.equal(ambiguous.isError, true)
  assert.match(ambiguous.text, /Plusieurs projets/)
  assert.equal(call('list_cards', {}).isError, true)
  assert.equal(call('list_cards', { project: 'secret' }).isError, true)

  // La liste blanche d'un jeton borne ce que le compte voit.
  const bounded = { ...GLOBAL, SOLERA_MCP_PROJECTS: 'gamma' }
  assert.doesNotMatch(call('list_projects', {}, bounded).text, /Alpha/)
  assert.equal(call('list_cards', { project: 'alpha' }, bounded).isError, true)

  // Un outil hors du catalogue global est refusé avant de recevoir un projet.
  assert.match(call('find_file_edits', { project: 'alpha' }).text, /Outil inconnu/)
})

test('les écritures directes sont signées par le compte : note de carte, consignes, mémoire', async (t) => {
  const { db, dir, call, GLOBAL } = await harness(t)
  db.insert(cards).values({ id: 'card-1', projectId: 'alpha', number: 1, title: 'Première carte', column: 'todo', createdBy: 'owner', createdAt: 1, updatedAt: 1 }).run()

  assert.match(call('add_card_note', { project: 'alpha', card: 1, body: 'Décidé avec Tim.' }).text, /#1/)
  const note = db.select().from(cardNotes).where(eq(cardNotes.cardId, 'card-1')).get()!
  assert.equal(note.userId, 'owner')
  assert.equal(note.conversationId, null)
  assert.equal(call('add_card_note', { project: 'alpha', card: 9, body: 'x' }).isError, true)

  // Sans projet, la partie globale ; avec, celle du projet.
  call('write_instructions', { content: 'Répondre court.' })
  call('write_instructions', { project: 'alpha', content: 'Tests en français.' })
  assert.equal(db.select().from(instructions).where(eq(instructions.id, 'global')).get()!.content, 'Répondre court.')
  const alpha = db.select().from(instructions).where(eq(instructions.id, 'alpha')).get()!
  assert.equal(alpha.content, 'Tests en français.')
  assert.equal(alpha.updatedByUserId, 'owner')

  // Un compte non administrateur ne touche pas à la partie globale.
  db.insert(users).values({ id: 'guest', username: 'guest', displayName: 'Guest', passwordHash: '', createdAt: 2 }).run()
  const refused = call('write_instructions', { content: 'Non.' }, { ...GLOBAL, SOLERA_MCP_USER: 'guest' })
  assert.equal(refused.isError, true)
  assert.match(refused.text, /administrateur/)

  // Sans projet, la mémoire du compte, celle de ses fils libres ; avec, celle du projet.
  call('write_memory', { file: 'qui.md', content: '---\nname: qui\ndescription: Tim\n---\nTim.' })
  call('write_memory', { project: 'alpha', file: 'port.md', content: 'Port 4242.' })
  assert.equal(await readFile(join(dir, 'memory', 'threads', 'owner', 'qui.md'), 'utf8'), '---\nname: qui\ndescription: Tim\n---\nTim.')
  assert.ok(existsSync(join(dir, 'memory', 'projects', 'alpha', 'port.md')))
  assert.match(call('read_memory', {}).text, /de ton compte/)

  // La mémoire refusée retire les trois outils, comme dans une session.
  const names = (spawnSync(process.execPath, [ENTRY], {
    env: { ...process.env, ...GLOBAL, SOLERA_MCP_DB: join(dir, 'test.sqlite'), SOLERA_MCP_MEMORY: '' },
    encoding: 'utf8',
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n',
  }).stdout)
  assert.doesNotMatch(names, /"read_memory"/)
})

test('list_sessions sans projet couvre tous les projets du compte et ses fils libres', async (t) => {
  const { conversation, call, GLOBAL } = await harness(t)
  conversation('a', { status: 'running' })
  conversation('g', { projectId: 'gamma', status: 'awaiting_input' })
  conversation('free', { projectId: null })

  const all = call('list_sessions', {}).text
  assert.match(all, /projet Alpha, racine du projet/)
  assert.match(all, /projet Beta api/)
  assert.match(all, /attend une réponse/)
  assert.match(all, /fil libre/)

  const one = call('list_sessions', { project: 'gamma' }).text
  assert.match(one, /Session g/)
  assert.doesNotMatch(one, /Session a/)

  // Un jeton borné à des projets ne voit pas les fils libres.
  assert.doesNotMatch(call('list_sessions', {}, { ...GLOBAL, SOLERA_MCP_PROJECTS: 'gamma,alpha' }).text, /fil libre/)
})

test('read_conversation pose l’état en tête, sollicitation comprise, et se lit dans un projet partagé', async (t) => {
  const { db, log, conversation, call } = await harness(t)
  conversation('s', { status: 'awaiting_input' })
  log.append('s', { type: 'message.completed', messageId: 'm1', role: 'user', blocks: [{ type: 'text', text: 'Corrige le titre.' }], parentToolCallId: null })
  log.append('s', { type: 'message.completed', messageId: 'm2', role: 'assistant', blocks: [{ type: 'text', text: 'Je regarde.' }], parentToolCallId: null })
  log.append('s', { type: 'permission.requested', requestId: 'perm-1', toolName: 'Bash', input: { command: 'pnpm test' }, suggestions: [] })

  const read = call('read_conversation', { id: 's' }).text
  assert.match(read, /État : attend une réponse/)
  assert.match(read, /request_id perm-1/)
  assert.match(read, /Permission pour l'outil Bash/)
  assert.match(read, /Corrige le titre\./)
  assert.match(read, /Je regarde\./)

  // Une session d'un autre compte, dans un projet partagé : lisible, pas à lui.
  db.insert(users).values({ id: 'other', username: 'other', displayName: 'Other', passwordHash: '', createdAt: 2 }).run()
  db.insert(projects).values({ id: 'shared', name: 'Partagé', workspacePath: '/x', ownerId: 'other', visibility: 'shared', createdAt: 1 }).run()
  conversation('theirs', { projectId: 'shared', userId: 'other' })
  assert.equal(call('read_conversation', { id: 'theirs' }).isError, undefined)
  const refused = call('send_session_message', { to: 'theirs', body: 'Salut.' })
  assert.equal(refused.isError, true)
  assert.match(refused.text, /Aucune session « theirs » à toi/)

  // Un fil libre d'un autre compte n'existe pas pour celui-ci.
  conversation('their-thread', { projectId: null, userId: 'other' })
  assert.equal(call('read_conversation', { id: 'their-thread' }).isError, true)
})

test('le daemon traite les gestes du compte : lancer nu, écrire, interrompre, répondre', async (t) => {
  const { db, log, conversation, daemonCall, gestures } = await harness(t)

  // Une session lancée par un compte reçoit sa mission telle quelle, sans enveloppe.
  const launched = await daemonCall('start_session', { project: 'alpha', prompt: 'Relire la PR #12.' })
  assert.equal(launched.isError, undefined, launched.text)
  assert.match(launched.text, /read_conversation/)
  const request = db.select().from(agentRequests).get()!
  assert.equal(request.conversationId, '')
  assert.equal(request.userId, 'owner')
  assert.ok(gestures.some((gesture) => gesture.endsWith(' Relire la PR #12.')))
  const row = db.select().from(conversations).where(eq(conversations.id, request.launchedConversationId!)).get()!
  assert.equal(row.userId, 'owner')
  assert.equal(row.worktreeId, null)

  // Une carte créée au nom du compte n'a pas de note de provenance.
  assert.match((await daemonCall('create_card', { project: 'alpha', title: 'Un bug vu de loin' })).text, /#1/)
  assert.equal(db.select().from(cardNotes).all().length, 0)

  // Écrire : glissé dans le tour s'il y en a un, en file si le CLI ne sait pas.
  conversation('busy', { status: 'running' })
  conversation('stubborn', { status: 'running' })
  conversation('rest')
  assert.match((await daemonCall('send_session_message', { to: 'busy', body: 'Plutôt la v2.' })).text, /glissé dans le tour/)
  assert.match((await daemonCall('send_session_message', { to: 'stubborn', body: 'Stop.' })).text, /en file/)
  assert.match((await daemonCall('send_session_message', { to: 'rest', body: 'Reprends.' })).text, /elle reprend/)
  assert.ok(gestures.includes('steer busy Plutôt la v2.'))
  assert.ok(gestures.includes('message stubborn Stop.'))
  assert.ok(gestures.includes('message rest Reprends.'))

  assert.match((await daemonCall('interrupt_session', { session: 'busy' })).text, /interrompu/)
  assert.ok(gestures.includes('interrupt busy'))
  assert.match((await daemonCall('interrupt_session', { session: 'rest' })).text, /rien à interrompre/)

  // Répondre : dans la forme que la sollicitation impose, au nom du compte.
  log.append('rest', { type: 'permission.requested', requestId: 'perm-1', toolName: 'Bash', input: {}, suggestions: [] })
  const malformed = await daemonCall('reply_session', { session: 'rest', decision: 'approved' })
  assert.equal(malformed.isError, true)
  assert.match(malformed.text, /permission/)
  const replied = await daemonCall('reply_session', { session: 'rest', decision: 'allowed', scope: 'session' })
  assert.equal(replied.isError, undefined, replied.text)
  assert.ok(gestures.includes('permission rest perm-1 allowed session owner'))
})

test('le daemon refuse à un compte ce qui ne vaut que pour une session, et ce qu’il ne voit pas', async (t) => {
  const { db, conversation } = await harness(t)
  db.insert(users).values({ id: 'other', username: 'other', displayName: 'Other', passwordHash: '', createdAt: 2 }).run()
  db.insert(projects).values({ id: 'secret', name: 'Secret', workspacePath: '/y', ownerId: 'other', visibility: 'private', createdAt: 1 }).run()
  conversation('theirs', { userId: 'other' })

  const sessions = { statusBus: new EventEmitter() } as unknown as SessionManager
  const requests = new AgentRequests({ db, config: {} as Config }, sessions, {} as AgentRegistry, new EventLog(db))
  const deposit = (kind: typeof agentRequests.$inferInsert.kind, projectId: string | null, payload: object) => {
    const id = `${kind}-${projectId}`
    db.insert(agentRequests).values({ id, projectId, conversationId: '', userId: 'owner', kind, payload: JSON.stringify(payload), createdAt: Date.now() }).run()
    return id
  }
  const decision = deposit('request_decision', 'alpha', { question: 'Oui ?' })
  const secret = deposit('create_card', 'secret', { title: 'Intrus' })
  const theirs = deposit('interrupt_session', null, { session: 'theirs' })
  await requests.sweep()

  const result = (id: string) => db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()!
  assert.equal(result(decision).isError, true)
  assert.match(result(decision).result!, /n'existe que dans une session/)
  assert.equal(result(secret).isError, true)
  assert.equal(db.select().from(cards).all().length, 0)
  assert.equal(result(theirs).isError, true)
  assert.match(result(theirs).result!, /à toi/)
})
