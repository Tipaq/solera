import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq, sql } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users, type ConversationRow } from '@solera/db'
import {
  DEFAULT_CLAUDE_CONFIG,
  DEFAULT_CODEX_CONFIG,
  type AgentAuthDto,
  type AgentUsage,
  type UsagePeekDto,
} from '@solera/protocol'
import { UNKNOWN_AUTH } from '../src/agents/auth.js'
import { parseClaudeAuth } from '../src/agents/claude/auth.js'
import type { CliInstaller } from '../src/agents/cli-install.js'
import { parseCodexAuth } from '../src/agents/codex/auth.js'
import { readGrokAuth } from '../src/agents/grok/auth.js'
import { readOpencodeAuth } from '../src/agents/opencode/auth.js'
import type { AgentAdapter, AgentRegistry } from '../src/agents/registry.js'
import type { RunnerContext } from '../src/agents/types.js'
import { UsageLedger } from '../src/agents/usage-ledger.js'
import { ClaudeAccountStore } from '../src/claude-accounts/store.js'
import { CodexAccountHomes } from '../src/codex-accounts/homes.js'
import { CodexAccountStore } from '../src/codex-accounts/store.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { GrokAccountHomes } from '../src/grok-accounts/homes.js'
import { GrokAccountStore } from '../src/grok-accounts/store.js'
import type { AppContext } from '../src/http/context.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerAgentRoutes } from '../src/http/routes/agents.js'
import type { SecretStore } from '../src/secrets/store.js'
import { SessionManager } from '../src/sessions/session-manager.js'

/**
 * L'aperçu gratuit de la page de brouillon : la connexion de chaque CLI et la dernière
 * consommation connue, sans qu'aucune sonde coûteuse ne parte pour le construire.
 */

const HOUR = 3600_000

async function database(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-usage-peek-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  for (const id of ['owner', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  const workspace = join(dir, 'project')
  await mkdir(workspace)
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: workspace, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  return { dir, db }
}

type Db = Awaited<ReturnType<typeof database>>['db']

function conversation(db: Db, id: string, agent: 'claude' | 'codex', account: string | null): ConversationRow {
  const config = { ...(agent === 'claude' ? DEFAULT_CLAUDE_CONFIG : DEFAULT_CODEX_CONFIG), account }
  const row = {
    id, projectId: 'project', worktreeId: null, cardId: null, userId: 'owner', title: id,
    titleSetByUser: false, agent, agentSessionId: null, forkedFromId: null,
    handoffFromId: null, createdByTokenId: null, originLabel: null, scheduleId: null,
    config: JSON.stringify(config), status: 'idle',
    backgroundCount: 0, loopCount: 0, lastSeq: 0, lastNotableSeq: 0, turnCount: 0,
    journalBytes: 0, contextUsedTokens: null, contextMaxTokens: null, model: null,
    costUsd: 0, inputTokens: 0, outputTokens: 0, pinned: false, position: 0,
    archivedAt: null, createdAt: 1, updatedAt: 1,
  } as ConversationRow
  db.insert(conversations).values(row).run()
  return row
}

const rateLimitEvent = (type: string, resetsAt: number | null, utilization: number | null = null) => ({
  type: 'usage.updated' as const,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  rateLimit: { type, status: 'allowed' as const, utilization, resetsAt },
})

const usageOf = (plan: string): AgentUsage => ({
  agent: 'claude', plan, limitsAvailable: true, windows: [], credits: null, fetchedAt: 1,
})

async function routes(t: TestContext, db: Db, dir: string, adapters: AgentAdapter[]) {
  const registry = {
    usageLedger: new UsageLedger(),
    find: (agent: string) => adapters.find((adapter) => adapter.kind === agent),
    all: () => adapters,
  } as unknown as AgentRegistry
  const claudeAccounts = new ClaudeAccountStore(db, randomBytes(32))
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, String(request.headers['x-user'] ?? 'owner'))).get()
  })
  registerErrorHandler(app)
  registerAgentRoutes(app, { db } as AppContext, registry, {} as CliInstaller, claudeAccounts, { store: new CodexAccountStore(db), homes: new CodexAccountHomes(join(dir, 'codex')) }, { store: new GrokAccountStore(db), homes: new GrokAccountHomes(join(dir, 'grok')) })
  t.after(() => app.close())
  return { app, registry, claudeAccounts }
}

const cliOf = (kind: string, { enabled = true, installed = true } = {}) => ({
  describe: async () => ({ agent: kind, enabled, installed }),
})

test('aperçu : les lectures complètes sont gardées, le coup d’œil ne sonde jamais, chacun ne voit que ses comptes', async (t) => {
  const { dir, db } = await database(t)
  let probes = 0
  const adapter = {
    kind: 'claude',
    label: 'Claude',
    cli: cliOf('claude'),
    usage: async () => {
      probes += 1
      return usageOf('cli')
    },
    usageForAccount: async (accountId: string) => {
      probes += 1
      return usageOf(accountId)
    },
  } as unknown as AgentAdapter
  const { app, claudeAccounts } = await routes(t, db, dir, [adapter])

  const peek = async (user = 'owner') => {
    const response = await app.inject({ url: '/api/agents/usage/peek', headers: { 'x-user': user } })
    assert.equal(response.statusCode, 200, response.body)
    return response.json<{ entries: UsagePeekDto[] }>().entries
  }

  assert.deepEqual(await peek(), [], 'Rien de lu depuis le démarrage : rien à montrer')
  assert.equal(probes, 0, 'Le coup d’œil ne lance aucune sonde')

  const mine = claudeAccounts.create('owner', 'Boulot', 'sk-ant-oat01-' + 'a'.repeat(40))
  assert.equal((await app.inject('/api/agents/claude/usage')).statusCode, 200)
  assert.equal((await app.inject(`/api/agents/claude/usage?account=${mine.id}`)).statusCode, 200)
  assert.equal(probes, 2)

  const seen = await peek()
  assert.deepEqual(
    seen.map((entry) => [entry.agent, entry.account, entry.probed?.plan]).sort(),
    [['claude', mine.id, mine.id], ['claude', null, 'cli']].sort(),
  )
  assert.equal(probes, 2, 'Lire l’aperçu ne relance pas la sonde')

  // Un autre utilisateur voit la connexion partagée du CLI, pas le compte d'autrui.
  assert.deepEqual((await peek('other')).map((entry) => entry.account), [null])
})

test('connexion : un CLI en panne vaut unknown pour lui seul, désactivés et absents sont omis', async (t) => {
  const { dir, db } = await database(t)
  const ready = { status: 'ready', method: 'claude.ai', plan: 'max', identity: 'tim@example.com' } as const
  const adapters = [
    { kind: 'claude', cli: cliOf('claude'), auth: async () => ({ ...ready, fetchedAt: 1 }) },
    { kind: 'codex', cli: cliOf('codex'), auth: async () => { throw new Error('ENOENT') } },
    { kind: 'opencode', cli: cliOf('opencode') },
    { kind: 'grok', cli: cliOf('grok', { enabled: false }), auth: async () => ready },
  ] as unknown as AgentAdapter[]
  const { app } = await routes(t, db, dir, adapters)

  const response = await app.inject('/api/agents/auth')
  assert.equal(response.statusCode, 200, response.body)
  const { entries } = response.json<{ entries: AgentAuthDto[] }>()
  assert.deepEqual(entries, [
    { agent: 'claude', account: null, ...ready },
    { agent: 'codex', account: null, ...UNKNOWN_AUTH },
    { agent: 'opencode', account: null, ...UNKNOWN_AUTH },
  ], 'Le fetchedAt du cache ne fuit pas, Grok désactivé n’apparaît pas')
})

test('signaux des tours : relus du journal au démarrage, par CLI, compte et fenêtre', async (t) => {
  const { db } = await database(t)
  const log = new EventLog(db)
  const now = Date.now()
  conversation(db, 'cli', 'claude', null)
  conversation(db, 'acct', 'codex', 'compte-1')
  log.append('cli', rateLimitEvent('five_hour', now + HOUR))
  log.append('cli', rateLimitEvent('five_hour', now + 2 * HOUR))
  log.append('cli', rateLimitEvent('seven_day', now - HOUR), undefined)
  log.append('acct', rateLimitEvent('codex · 5h', Math.floor((now + HOUR) / 1000), 0.42))
  log.append('acct', { type: 'usage.updated', costUsd: 0, inputTokens: 1, outputTokens: 1 })
  // Plus vieux que l'horizon : hors de la relecture, quelle que soit sa remise à zéro.
  conversation(db, 'old', 'claude', 'ancien')
  log.append('old', rateLimitEvent('five_hour', now + HOUR))
  db.run(sql`UPDATE events SET ts = ${now - 8 * 24 * HOUR} WHERE conversation_id = 'old'`)
  db.run(sql`UPDATE conversations SET updated_at = ${now - 8 * 24 * HOUR} WHERE id = 'old'`)

  const ledger = new UsageLedger()
  ledger.seed(db, now)
  const entries = ledger.peek(() => true, now)
  const byKey = new Map(entries.map((entry) => [`${entry.agent}/${entry.account}`, entry]))
  assert.deepEqual([...byKey.keys()].sort(), ['claude/null', 'codex/compte-1'])

  const cli = byKey.get('claude/null')!
  assert.equal(cli.probed, null)
  assert.deepEqual(cli.live.map((window) => [window.type, window.resetsAt]), [['five_hour', now + 2 * HOUR]],
    'Le dernier signal de la fenêtre l’emporte, une fenêtre déjà remise à zéro tombe')
  const codex = byKey.get('codex/compte-1')!
  assert.equal(codex.live[0]!.resetsAt, Math.floor((now + HOUR) / 1000) * 1000, 'Des secondes ramenées en millisecondes')
  assert.equal(codex.live[0]!.utilization, 0.42)

  // Un signal plus ancien que celui qu'on a ne le remplace pas ; un plus récent, si.
  const claudeStatus = () => ledger.peek((agent) => agent === 'claude', now)[0]!.live[0]!.status
  ledger.recordLive('claude', null, { type: 'five_hour', status: 'rejected', utilization: 1, resetsAt: now + HOUR }, 0)
  assert.equal(claudeStatus(), 'allowed')
  ledger.recordLive('claude', null, { type: 'five_hour', status: 'rejected', utilization: 1, resetsAt: now + HOUR }, Date.now() + 1000)
  assert.equal(claudeStatus(), 'rejected')
  assert.deepEqual(ledger.peek(() => true, now + 3 * HOUR), [], 'Passée la remise à zéro, le signal ne dit plus rien')
})

test('signaux des tours : le gestionnaire de sessions les range sous le compte de la conversation', async (t) => {
  const { dir, db } = await database(t)
  const ledger = new UsageLedger()
  const registry = {
    usageLedger: ledger,
    adapter: () => ({ rawFormat: 'test@1', binary: 'codex', cli: { managedDir: join(dir, 'agents') } }),
  } as unknown as AgentRegistry
  const config = {
    paths: { threads: join(dir, 'threads'), memory: join(dir, 'memory'), attachments: join(dir, 'attachments'), data: dir, skillLibrary: join(dir, 'skills') },
    limits: { maxConcurrentSessions: 1, sessionIdleTimeoutMin: 30 },
    mcp: {}, skills: {},
  } as unknown as Config
  const sessions = new SessionManager(db, new EventLog(db), config, registry, {} as SecretStore, {} as never, {} as never, {} as never)
  const row = conversation(db, 'conv', 'codex', null)
  const context = (sessions as unknown as { buildContext(row: ConversationRow): RunnerContext }).buildContext(row)

  const resetsAt = Date.now() + HOUR
  context.emit(rateLimitEvent('codex · 5h', resetsAt, 0.3))
  context.emit({ type: 'usage.updated', costUsd: 0, inputTokens: 1, outputTokens: 1 })
  const [entry] = ledger.peek(() => true)
  assert.equal(entry?.agent, 'codex')
  assert.equal(entry?.account, null)
  assert.deepEqual(entry?.live.map((window) => [window.type, window.utilization, window.resetsAt]), [['codex · 5h', 0.3, resetsAt]])
})

test('lecture de la connexion, CLI par CLI', async (t) => {
  assert.deepEqual(
    parseClaudeAuth(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'a@b.c', orgName: 'Org', subscriptionType: 'max' })),
    { status: 'ready', method: 'claude.ai', plan: 'max', identity: 'a@b.c' },
  )
  assert.deepEqual(parseClaudeAuth(JSON.stringify({ loggedIn: false })), { ...UNKNOWN_AUTH, status: 'logged_out' })
  assert.deepEqual(parseClaudeAuth(JSON.stringify({ loggedIn: true, apiProvider: 'bedrock' })).method, 'bedrock')
  assert.deepEqual(parseClaudeAuth('pas du json'), UNKNOWN_AUTH)

  assert.deepEqual(parseCodexAuth('Not logged in\n'), { ...UNKNOWN_AUTH, status: 'logged_out' })
  assert.deepEqual(parseCodexAuth('Logged in using ChatGPT\n'), { ...UNKNOWN_AUTH, status: 'ready', method: 'chatgpt' })
  assert.equal(parseCodexAuth('Logged in using an API key - sk-proj-***ABCD\n').method, 'api_key')
  assert.equal(parseCodexAuth('Logged in using personal access token\n').method, 'personal_access_token')
  assert.deepEqual(parseCodexAuth(''), UNKNOWN_AUTH)

  const dir = await mkdtemp(join(tmpdir(), 'solera-auth-files-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.equal((await readGrokAuth(dir, {})).status, 'logged_out')
  assert.deepEqual(await readGrokAuth(dir, { XAI_API_KEY: 'xai-1' }), { ...UNKNOWN_AUTH, status: 'ready', method: 'api_key' })
  await writeFile(join(dir, 'auth.json'), '{}')
  assert.equal((await readGrokAuth(dir, {})).status, 'ready')

  const opencode = join(dir, 'opencode-auth.json')
  assert.deepEqual(await readOpencodeAuth(opencode), UNKNOWN_AUTH, 'Sans fichier, opencode peut encore tourner : on ne sait pas')
  await writeFile(opencode, '{}')
  assert.deepEqual(await readOpencodeAuth(opencode), UNKNOWN_AUTH)
  await writeFile(opencode, JSON.stringify({ openai: { type: 'oauth' }, anthropic: { type: 'api', key: 'k' } }))
  assert.deepEqual(await readOpencodeAuth(opencode), { ...UNKNOWN_AUTH, status: 'ready', method: 'anthropic, openai' })
})
