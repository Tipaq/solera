import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { conversations, openDatabase, projects, runMigrations, users, type ConversationRow } from '@solera/db'
import { BUILTIN_MCP_SERVER_NAME, DEFAULT_CLAUDE_CONFIG, type AgentConfig } from '@solera/protocol'
import { BUILTIN_MCP_SERVER_ID } from '../src/agents/mcp-builtin.js'
import { MCP_SESSION_TOKEN_PREFIX, McpSessionTokens } from '../src/agents/mcp-session-tokens.js'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { RunnerContext } from '../src/agents/types.js'
import { createApiToken } from '../src/auth/api-tokens.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { soleraUrlForAgents } from '../src/instance/agent-url.js'
import type { SecretStore } from '../src/secrets/store.js'
import { SessionManager } from '../src/sessions/session-manager.js'
import { mcpApp, mcpClient, sessionMcp, sessionScope } from './session-mcp-support.js'

/**
 * Le serveur MCP de Solera vu du CLI d'une session : une URL et un jeton, jamais la
 * base. Le jeton porte la portée que le gestionnaire de sessions calcule, n'ouvre que
 * le pont, et meurt avec le runner.
 */

async function database(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-mcp-session-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(users).values({ id: 'other', username: 'other', displayName: 'Other', passwordHash: '', createdAt: 2 }).run()
  db.insert(projects).values({ id: 'project', name: 'Projet', workspacePath: join(dir, 'project'), ownerId: 'owner', visibility: 'private', instructionsMode: 'solera', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'theirs', name: 'Le leur', workspacePath: join(dir, 'theirs'), ownerId: 'other', visibility: 'private', instructionsMode: 'solera', createdAt: 1 }).run()
  return { dir, db, dbPath }
}

function conversation(db: Awaited<ReturnType<typeof database>>['db'], id: string, config: Partial<AgentConfig> = {}): ConversationRow {
  db.insert(conversations).values({
    id, projectId: 'project', userId: 'owner', title: `Session ${id}`, agent: 'claude',
    config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, ...config }), status: 'idle', createdAt: 1, updatedAt: 1,
  }).run()
  return db.select().from(conversations).all().find((row) => row.id === id)!
}

async function manager(t: TestContext) {
  const base = await database(t)
  const { dir, db, dbPath } = base
  const registry = {
    adapter: () => ({ rawFormat: 'test@1', binary: 'claude', cli: { managedDir: join(dir, 'agents') } }),
  } as unknown as AgentRegistry
  const config = {
    server: { host: '0.0.0.0', port: 7517, publicUrl: '', agentUrl: '' },
    paths: {
      database: dbPath, threads: join(dir, 'threads'), memory: join(dir, 'memory'), attachments: join(dir, 'attachments'),
      data: dir, skillLibrary: join(dir, 'skills'),
    },
    limits: { maxConcurrentSessions: 2, sessionIdleTimeoutMin: 30 },
    mcp: { soleraServer: true, agentMemory: true, projectFiling: false, cardFiling: true, decisions: true },
    skills: {},
  } as unknown as Config
  const sessions = new SessionManager(db, new EventLog(db), config, registry, {} as SecretStore, {} as never, {} as never, {} as never)
  const context = (row: ConversationRow) =>
    (sessions as unknown as { buildContext(row: ConversationRow): RunnerContext }).buildContext(row)
  return { ...base, sessions, context }
}

test('session : le CLI reçoit une URL et un jeton, et le jeton ouvre la portée de la session', async (t) => {
  const { db, dbPath, sessions, context } = await manager(t)
  const row = conversation(db, 'conv')
  const ctx = context(row)
  const config = JSON.parse(row.config) as AgentConfig

  const servers = ctx.resolveMcpServers(config).servers
  const builtin = servers.find((server) => server.id === BUILTIN_MCP_SERVER_ID)
  assert.ok(builtin)
  assert.equal(builtin.name, BUILTIN_MCP_SERVER_NAME)
  // Plus de process à lancer, donc plus de chemin vers la base dans ce que le CLI voit.
  assert.equal(builtin.transport.type, 'http')
  if (builtin.transport.type === 'stdio') return
  assert.equal(builtin.transport.url, 'http://127.0.0.1:7517/api/v1/mcp')
  const token = /^Bearer (\S+)$/.exec(builtin.transport.headers.Authorization ?? '')?.[1]
  assert.ok(token?.startsWith(MCP_SESSION_TOKEN_PREFIX))
  assert.doesNotMatch(JSON.stringify(builtin), /sqlite/)

  // Le même jeton tant que la portée ne bouge pas : sans quoi chaque comparaison des
  // runners relancerait le CLI.
  assert.deepEqual(ctx.resolveMcpServers(config).servers, servers)

  const grant = sessions.mcpTokens.resolve(token!)
  assert.equal(grant?.conversationId, 'conv')
  assert.equal(grant?.scope.projectId, 'project')
  assert.equal(grant?.scope.cardFiling, true)
  assert.equal(grant?.scope.projectFiling, false)

  // Le pont lit ce jeton-là, et le process qu'il lance sert cette conversation.
  const { app } = await mcpApp(t, db, dbPath, sessions.mcpTokens)
  const client = mcpClient(app, token!)
  const names = await client.toolNames()
  assert.ok(names.includes('read_memory'))
  assert.ok(names.includes('request_card_change'))
  assert.ok(!names.includes('create_project'))
  assert.ok(!names.includes('list_projects'), 'pas le catalogue global')
  const listed = await client.call('list_sessions')
  // Le process sait qui il sert : il s'exclut de la liste de son projet.
  assert.equal(listed.isError, undefined, listed.text)
  assert.match(listed.text, /Aucune autre conversation de ce projet/)

  // Une portée qui change en reçoit un autre : la mémoire coupée retire ses outils.
  const narrowed = { ...config, agentMemory: false }
  const other = ctx.resolveMcpServers(narrowed).servers.find((server) => server.id === BUILTIN_MCP_SERVER_ID)!
  assert.notDeepEqual(other.transport, builtin.transport)
  if (other.transport.type === 'stdio') return
  const narrowedClient = mcpClient(app, /^Bearer (\S+)$/.exec(other.transport.headers.Authorization!)![1]!)
  assert.ok(!(await narrowedClient.toolNames()).includes('read_memory'))
})

test('session : serveur coupé, ni entrée ni jeton', async (t) => {
  const { db, sessions, context } = await manager(t)
  const row = conversation(db, 'off', { soleraMcp: false })
  const servers = context(row).resolveMcpServers(JSON.parse(row.config) as AgentConfig).servers
  assert.equal(servers.some((server) => server.id === BUILTIN_MCP_SERVER_ID), false)
  // Aucun jeton n'a été émis : il n'y a rien à révoquer.
  let revoked = 0
  sessions.mcpTokens.onRevoke(() => { revoked += 1 })
  sessions.mcpTokens.revoke('off')
  assert.equal(revoked, 0)
})

test('session : le jeton n ouvre que le pont MCP', async (t) => {
  const { db, dbPath } = await database(t)
  const { app, token, initialize } = await sessionMcp(t, db, dbPath, sessionScope({ projectId: 'project', conversationId: 'conv' }))
  for (const url of ['/api/projects', '/api/v1/tasks', '/api/v1/projects']) {
    const response = await app.inject({ url, headers: { authorization: `Bearer ${token}` } })
    assert.equal(response.statusCode, 403, url)
    assert.equal(response.json().error.code, 'session_token_outside_mcp')
  }

  // Une session du pont ne se présente qu'avec le jeton qui l'a ouverte.
  const session = await initialize()
  const { secret } = createApiToken(db, {
    userId: 'owner', label: 'mcp', scopes: ['mcp'], projectIds: [], agent: 'claude', config: {}, expiresAt: null, webhookUrl: null,
  })
  const stolen = await mcpClient(app, secret).post({ id: 1, method: 'ping' }, session)
  assert.equal(stolen.statusCode, 404)
})

test('session : révoqué, le jeton ne vaut plus rien et son process s arrête', async (t) => {
  const { db, dbPath } = await database(t)
  const { tokens, bridge, token, post, initialize, rpc } = await sessionMcp(t, db, dbPath, sessionScope({ projectId: 'project', conversationId: 'conv' }))
  const session = await initialize()
  await rpc('ping')
  const owner = `session:${tokens.resolve(token)!.id}`
  assert.ok(bridge.lookup(session, owner))

  // Détaché, il vaut encore pour le CLI qui finit de s'arrêter, mais un runner relancé
  // entre-temps en reçoit un autre.
  const revoke = tokens.detach('conv')
  const relaunched = tokens.issue('conv', sessionScope({ projectId: 'project', conversationId: 'conv' }))
  assert.notEqual(relaunched, token)
  assert.equal((await post({ id: 2, method: 'ping' }, session)).statusCode, 200)

  revoke()
  assert.equal(tokens.resolve(token), null)
  assert.equal(bridge.lookup(session, owner), null, 'le process du pont est arrêté')
  assert.ok(tokens.resolve(relaunched), 'le jeton du runner relancé survit')
  const refused = await post({ id: 3, method: 'ping' }, session)
  assert.equal(refused.statusCode, 401)
})

test('session : la portée suit le jeton, pas la requête', async (t) => {
  const { db, dbPath } = await database(t)
  // Un fil libre : rien de ce qui parle d'un projet, même si le client en nomme un.
  const free = await sessionMcp(t, db, dbPath, sessionScope({ conversationId: 'free' }))
  const names = await free.toolNames()
  assert.ok(!names.includes('list_cards'))
  assert.doesNotMatch((await free.call('list_cards', { project: 'theirs' })).text, /Le leur/)

  const granted = await sessionMcp(t, db, dbPath, sessionScope({
    projectId: 'project', conversationId: 'conv', decisions: true, proposeCards: true, projectFiling: true,
  }))
  const all = await granted.toolNames()
  for (const name of ['request_decision', 'propose_cards', 'create_project', 'move_conversation']) {
    assert.ok(all.includes(name), name)
  }
})

test('adresse de Solera pour les agents : la boucle locale quand le serveur écoute partout', () => {
  const server = { host: '127.0.0.1', port: 7517, publicUrl: 'https://solera.example', agentUrl: '' }
  assert.equal(soleraUrlForAgents(server), 'http://127.0.0.1:7517')
  assert.equal(soleraUrlForAgents({ ...server, host: '0.0.0.0' }), 'http://127.0.0.1:7517')
  assert.equal(soleraUrlForAgents({ ...server, host: '::' }), 'http://127.0.0.1:7517')
  assert.equal(soleraUrlForAgents({ ...server, host: '100.64.0.7', port: 8081 }), 'http://100.64.0.7:8081')
  assert.equal(soleraUrlForAgents({ ...server, host: 'fd7a::1' }), 'http://[fd7a::1]:7517')
  assert.equal(soleraUrlForAgents({ ...server, agentUrl: 'http://solera.local:9000/' }), 'http://solera.local:9000')
})

test('jetons de session : un par portée, révoqués ensemble', () => {
  const tokens = new McpSessionTokens()
  const scope = sessionScope({ projectId: 'project', conversationId: 'a' })
  const first = tokens.issue('a', scope)
  assert.equal(tokens.issue('a', { ...scope }), first)
  const wider = tokens.issue('a', { ...scope, decisions: true })
  assert.notEqual(wider, first)
  const elsewhere = tokens.issue('b', sessionScope({ projectId: 'project', conversationId: 'b' }))
  assert.equal(tokens.resolve('solera_pat_whatever'), null)

  const revoked: string[][] = []
  tokens.onRevoke((ids) => revoked.push(ids))
  tokens.revoke('a')
  assert.equal(tokens.resolve(first), null)
  assert.equal(tokens.resolve(wider), null)
  assert.ok(tokens.resolve(elsewhere))
  assert.equal(revoked[0]?.length, 2)
})
