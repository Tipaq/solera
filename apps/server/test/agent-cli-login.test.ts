import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, runMigrations, users } from '@solera/db'
import type { ClaudeLoginStatusDto, CodexLoginStatusDto } from '@solera/protocol'
import { UNKNOWN_AUTH, type AgentAuth } from '../src/agents/auth.js'
import { ClaudeLoginService } from '../src/claude-accounts/login.js'
import type { ClaudeAccountStore } from '../src/claude-accounts/store.js'
import { CodexAccountHomes } from '../src/codex-accounts/homes.js'
import { CodexLoginService } from '../src/codex-accounts/login.js'
import { CodexAccountStore } from '../src/codex-accounts/store.js'
import { GrokAccountHomes } from '../src/grok-accounts/homes.js'
import { GrokLoginService } from '../src/grok-accounts/login.js'
import { GrokAccountStore } from '../src/grok-accounts/store.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerAgentLoginRoutes } from '../src/http/routes/agent-login.js'

/**
 * La connexion propre d'un CLI, menée depuis l'interface : elle doit écrire là où les
 * sessions lisent, et non dans un dossier jetable comme celle d'un compte. Les faux CLI
 * des fixtures tiennent lieu de Claude Code, Codex et Grok ; rien ne joint un vrai compte.
 */

async function until(check: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/** Pose une variable d'environnement le temps du test. */
function withEnv(t: TestContext, name: string, value: string): void {
  const previous = process.env[name]
  process.env[name] = value
  t.after(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })
}

async function tempDir(t: TestContext, prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function claudeHarness(t: TestContext, auth: AgentAuth) {
  const dir = await tempDir(t, 'solera-claude-cli-login-')
  const binary = join(dir, 'claude.mjs')
  copyFileSync(new URL('./fixtures/claude-login.mjs', import.meta.url), binary)
  chmodSync(binary, 0o700)
  const log = join(dir, 'launches.jsonl')
  withEnv(t, 'FIXTURE_CLAUDE_LOG', log)
  // La configuration des sessions : celle que le CLI doit garder, et non un dossier jetable.
  const sessionsConfig = join(dir, 'claude-config')
  withEnv(t, 'CLAUDE_CONFIG_DIR', sessionsConfig)
  let reads = 0
  const login = new ClaudeLoginService({} as ClaudeAccountStore, async () => binary, null, async () => {
    reads += 1
    return auth
  })
  t.after(() => login.closeAll())
  const launches = () =>
    existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { args: string[]; cwd: string; configDir: string | null })
      : []
  return { login, sessionsConfig, launches, reads: () => reads }
}

test('connexion Claude du CLI : la configuration des sessions, un code refusé relance, le bon conclut', async (t) => {
  const { login, sessionsConfig, launches, reads } = await claudeHarness(t, { ...UNKNOWN_AUTH, status: 'ready', method: 'claude.ai' })

  const started = await login.startCli('admin')
  assert.equal(started.purpose, 'cli')
  assert.equal(started.state, 'waiting_code', started.error ?? '')
  assert.match(started.authUrl ?? '', /^https:\/\/claude\.com\/cai\/oauth\/authorize\?.*state=/)
  const [first] = launches()
  assert.deepEqual(first?.args, ['auth', 'login', '--claudeai'])
  assert.equal(first?.configDir, sessionsConfig, 'le CLI écrit sa connexion là où les sessions la lisent')
  assert.notEqual(first?.cwd, sessionsConfig, 'le dossier temporaire ne sert que de cwd')
  // La connexion est à qui l'a lancée.
  assert.equal(login.status('other', started.loginId), undefined)

  login.submitCode('admin', started.loginId, 'bad')
  await until(() => launches().length === 2 && login.status('admin', started.loginId)?.authUrl !== started.authUrl, 'relance après refus')
  const refused = login.status('admin', started.loginId)!
  assert.equal(refused.state, 'failed')
  assert.match(refused.error ?? '', /Invalid code/)
  assert.equal(launches()[1]?.configDir, sessionsConfig)

  login.submitCode('admin', started.loginId, 'good')
  await until(() => login.status('admin', started.loginId)?.state === 'done', 'connexion')
  assert.equal(login.status('admin', started.loginId)?.error, null)
  assert.equal(login.status('admin', started.loginId)?.account, null)
  assert.equal(reads(), 1, 'la connexion est relue une fois, sans cache')
})

test('connexion Claude du CLI : un code 0 que auth status dément reste un échec', async (t) => {
  const { login, reads } = await claudeHarness(t, { ...UNKNOWN_AUTH, status: 'logged_out' })
  const started = await login.startCli('admin')
  login.submitCode('admin', started.loginId, 'good')
  await until(() => login.status('admin', started.loginId)?.state === 'failed', 'échec')
  assert.match(login.status('admin', started.loginId)?.error ?? '', /auth status/)
  assert.equal(reads(), 1)
})

test('connexion Claude du CLI : une relecture muette ne défait pas un succès dit par le CLI', async (t) => {
  const { login } = await claudeHarness(t, UNKNOWN_AUTH)
  const started = await login.startCli('admin')
  login.submitCode('admin', started.loginId, 'good')
  await until(() => login.status('admin', started.loginId)?.state === 'done', 'connexion')
})

async function serviceDb(t: TestContext, dir: string) {
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  return db
}

test('connexion Codex du CLI : le code d’appareil écrit auth.json dans le home des sessions', async (t) => {
  const dir = await tempDir(t, 'solera-codex-cli-login-')
  const binary = join(dir, 'codex.mjs')
  copyFileSync(new URL('./fixtures/codex-app-server.mjs', import.meta.url), binary)
  chmodSync(binary, 0o700)
  // Le home des sessions, pas encore créé : la première connexion le fait naître.
  const userHome = join(dir, 'user-codex')
  withEnv(t, 'CODEX_HOME', userHome)
  const db = await serviceDb(t, dir)
  let reads = 0
  const login = new CodexLoginService(new CodexAccountHomes(join(dir, 'codex-accounts')), new CodexAccountStore(db), async () => binary, async () => {
    reads += 1
    return UNKNOWN_AUTH
  })
  t.after(() => login.closeAll())

  const started = await login.startCliDeviceCode()
  assert.equal(started.state, 'pending')
  assert.equal(started.userCode, 'FIXT-CODE')
  assert.equal(login.cliStatus().state, 'pending')
  await until(() => login.cliStatus().state === 'done', 'connexion')
  assert.ok(existsSync(join(userHome, 'auth.json')), 'la connexion vit dans le home des sessions')
  assert.ok(!existsSync(join(dir, 'codex-accounts')), 'aucun home de compte n’est créé')
  assert.equal(reads, 1)
})

test('connexion Grok du CLI : grok login sans GROK_HOME imposé, auth.json dans le home des sessions', async (t) => {
  const dir = await tempDir(t, 'solera-grok-cli-login-')
  const binary = join(dir, 'grok.mjs')
  copyFileSync(new URL('./fixtures/grok-agent.mjs', import.meta.url), binary)
  chmodSync(binary, 0o700)
  const userHome = join(dir, 'user-grok')
  mkdirSync(userHome)
  withEnv(t, 'GROK_HOME', userHome)
  const db = await serviceDb(t, dir)
  const login = new GrokLoginService(new GrokAccountHomes(join(dir, 'grok-accounts')), new GrokAccountStore(db), async () => binary)
  t.after(() => login.closeAll())

  const started = await login.startCliDeviceCode()
  assert.equal(started.state, 'pending')
  assert.equal(started.userCode, 'W68V-VRXD')
  await until(() => login.cliStatus().state === 'done', 'connexion')
  assert.ok(existsSync(join(userHome, 'auth.json')))
  assert.ok(!existsSync(join(dir, 'grok-accounts')), 'aucun home de compte n’est créé')
})

test('routes de connexion du CLI : réservées à l’administrateur, OpenCode reste au terminal', async (t) => {
  const dir = await tempDir(t, 'solera-agent-login-routes-')
  const db = await serviceDb(t, dir)
  db.insert(users).values({ id: 'admin', username: 'admin', displayName: 'admin', passwordHash: '', isAdmin: true, createdAt: 1 }).run()
  db.insert(users).values({ id: 'member', username: 'member', displayName: 'member', passwordHash: '', createdAt: 1 }).run()

  const calls: string[] = []
  const pending: CodexLoginStatusDto = { state: 'pending', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234', error: null }
  const device = (agent: string) => ({
    cliStatus: () => pending,
    startCliDeviceCode: async () => { calls.push(`${agent}:start`); return pending },
    cancelCli: async () => { calls.push(`${agent}:cancel`) },
  })
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, String(request.headers['x-user'] ?? 'admin'))).get()
  })
  registerErrorHandler(app)
  registerAgentLoginRoutes(app, {
    claude: {
      startCli: async (ownerId: string) => {
        calls.push(`claude:start:${ownerId}`)
        return { loginId: 'l1', purpose: 'cli', state: 'waiting_code', authUrl: 'https://claude.com/x', error: null, account: null } satisfies ClaudeLoginStatusDto
      },
    },
    codex: device('codex'),
    grok: device('grok'),
  })
  t.after(() => app.close())

  const member = { 'x-user': 'member' }
  for (const [method, url] of [['POST', '/api/agents/claude/login'], ['POST', '/api/agents/codex/login'], ['GET', '/api/agents/grok/login'], ['DELETE', '/api/agents/codex/login']] as const) {
    const response = await app.inject({ method, url, headers: member })
    assert.equal(response.statusCode, 403, `${method} ${url}`)
  }
  assert.deepEqual(calls, [], 'rien n’est lancé pour un non-administrateur')

  const claude = await app.inject({ method: 'POST', url: '/api/agents/claude/login' })
  assert.equal(claude.statusCode, 201, claude.body)
  assert.equal(claude.json<ClaudeLoginStatusDto>().purpose, 'cli')
  const codex = await app.inject({ method: 'POST', url: '/api/agents/codex/login' })
  assert.equal(codex.json<CodexLoginStatusDto>().userCode, 'ABCD-1234')
  assert.equal((await app.inject('/api/agents/grok/login')).json<CodexLoginStatusDto>().state, 'pending')
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/agents/grok/login' })).statusCode, 204)
  assert.deepEqual(calls, ['claude:start:admin', 'codex:start', 'grok:cancel'])

  assert.equal((await app.inject({ method: 'POST', url: '/api/agents/opencode/login' })).statusCode, 400)
  assert.equal((await app.inject({ method: 'POST', url: '/api/agents/nope/login' })).statusCode, 404)
})
