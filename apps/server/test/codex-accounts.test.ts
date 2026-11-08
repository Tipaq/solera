import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, runMigrations, users } from '@solera/db'
import type { CodexAccount, CodexLoginStatusDto } from '@solera/protocol'
import { CodexAccountHomes, codexThreadFile } from '../src/codex-accounts/homes.js'
import type { CodexLoginService } from '../src/codex-accounts/login.js'
import { CodexAccountStore } from '../src/codex-accounts/store.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerCodexAccountRoutes } from '../src/http/routes/codex-accounts.js'

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-codex-accounts-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  for (const id of ['owner', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  const store = new CodexAccountStore(db)
  const homes = new CodexAccountHomes(join(dir, 'codex-accounts'))

  // Le service de connexion sans app-server : il note ce qu'on lui demande et joue
  // l'issue que le test choisit.
  const calls: string[] = []
  let status: CodexLoginStatusDto = { state: 'idle', verificationUrl: null, userCode: null, error: null }
  const login = {
    status: () => status,
    startDeviceCode: async (id: string) => {
      calls.push(`device:${id}`)
      status = { state: 'pending', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234', error: null }
      return status
    },
    loginWithApiKey: async (id: string, apiKey: string) => {
      calls.push(`apikey:${id}:${apiKey}`)
      store.setIdentity(id, { authMode: 'apiKey', email: null, planType: null })
      status = { state: 'done', verificationUrl: null, userCode: null, error: null }
    },
    logout: async (id: string) => {
      calls.push(`logout:${id}`)
      store.setIdentity(id, { authMode: null, email: null, planType: null })
    },
    cancel: async (id: string) => { calls.push(`cancel:${id}`) },
    forget: async (id: string) => { calls.push(`forget:${id}`) },
  } as unknown as CodexLoginService

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, String(request.headers['x-user'] ?? 'owner'))).get()
  })
  registerErrorHandler(app)
  registerCodexAccountRoutes(app, store, login)
  t.after(() => app.close())
  return { dir, store, homes, app, calls }
}

test('comptes Codex : par utilisateur, connexion par code ou clé, déconnexion', async (t) => {
  const { store, app, calls } = await harness(t)

  const created = await app.inject({ method: 'POST', url: '/api/codex-accounts', payload: { label: ' Boulot ' } })
  assert.equal(created.statusCode, 201, created.body)
  const account = created.json<CodexAccount>()
  assert.equal(account.label, 'Boulot')
  assert.equal(account.status, 'pending')
  assert.equal((await app.inject({ method: 'POST', url: '/api/codex-accounts', payload: { label: 'Boulot' } })).statusCode, 409)
  assert.equal((await app.inject({ url: `/api/codex-accounts/${account.id}/login`, headers: { 'x-user': 'other' } })).statusCode, 404)

  // Code d'appareil : la réponse dit quoi faire, le statut le répète.
  const device = await app.inject({ method: 'POST', url: `/api/codex-accounts/${account.id}/login`, payload: { type: 'deviceCode' } })
  assert.equal(device.statusCode, 200, device.body)
  assert.equal(device.json<CodexLoginStatusDto>().userCode, 'ABCD-1234')
  assert.equal((await app.inject(`/api/codex-accounts/${account.id}/login`)).json<CodexLoginStatusDto>().state, 'pending')
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/codex-accounts/${account.id}/login` })).statusCode, 204)
  assert.deepEqual(calls, [`device:${account.id}`, `cancel:${account.id}`])

  // Clé API : fait au retour, le compte devient prêt.
  calls.length = 0
  const keyed = await app.inject({ method: 'POST', url: `/api/codex-accounts/${account.id}/login`, payload: { type: 'apiKey', apiKey: 'sk-test' } })
  assert.equal(keyed.statusCode, 200, keyed.body)
  assert.equal(keyed.json<CodexLoginStatusDto>().state, 'done')
  const ready = store.find('owner', account.id)!
  assert.equal(ready.status, 'ready')
  assert.equal(ready.authMode, 'apiKey')
  assert.deepEqual(calls, [`apikey:${account.id}:sk-test`])
  assert.ok(!JSON.stringify((await app.inject('/api/codex-accounts')).json()).includes('sk-test'))

  // Déconnexion d'un compte prêt, puis renommage et suppression par le seul propriétaire.
  calls.length = 0
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/codex-accounts/${account.id}/login` })).statusCode, 204)
  assert.equal(store.find('owner', account.id)!.status, 'pending')
  assert.deepEqual(calls, [`logout:${account.id}`])
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/codex-accounts/${account.id}`, payload: { label: 'Travail' } })).statusCode, 204)
  assert.equal(store.list('owner')[0]?.label, 'Travail')
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/codex-accounts/${account.id}`, headers: { 'x-user': 'other' } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/codex-accounts/${account.id}` })).statusCode, 204)
  assert.equal(store.list('owner').length, 0)
  assert.ok(calls.includes(`forget:${account.id}`))
})

test('home Codex d’un compte : aucun lien, la config sans secrets, ni connexion ni mémoire de l’utilisateur', async (t) => {
  const { dir, homes } = await harness(t)
  const userHome = join(dir, 'user-codex')
  mkdirSync(join(userHome, 'sessions'), { recursive: true })
  mkdirSync(join(userHome, 'skills', 'revue'), { recursive: true })
  mkdirSync(join(userHome, 'skills', '.system'), { recursive: true })
  writeFileSync(join(userHome, 'skills', 'revue', 'SKILL.md'), 'revue')
  writeFileSync(join(userHome, 'config.toml'), 'model = "x"\n[mcp_servers.perso]\ncommand = "perso"\n[mcp_servers.perso.env]\nTOKEN = "s3cret"\n')
  writeFileSync(join(userHome, 'AGENTS.md'), 'consignes')
  writeFileSync(join(userHome, 'auth.json'), '{}')
  writeFileSync(join(userHome, 'memories_1.sqlite'), '')
  const previous = process.env.CODEX_HOME
  process.env.CODEX_HOME = userHome
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous })

  const home = homes.ensure('acct')
  for (const name of readdirSync(home)) assert.ok(!lstatSync(join(home, name)).isSymbolicLink(), name)
  const config = readFileSync(join(home, 'config.toml'), 'utf8')
  assert.match(config, /model = "x"/)
  assert.ok(!config.includes('s3cret') && !config.includes('perso'), 'un serveur MCP qui porte un secret ne passe pas')
  assert.equal(readFileSync(join(home, 'AGENTS.md'), 'utf8'), 'consignes')
  assert.equal(readFileSync(join(home, 'skills', 'revue', 'SKILL.md'), 'utf8'), 'revue')
  assert.ok(!existsSync(join(home, 'skills', '.system')), 'les skills système sont celles que Codex pose dans le home')
  assert.ok(!existsSync(join(home, 'auth.json')), 'La connexion de l’utilisateur ne passe pas au compte')
  assert.ok(!existsSync(join(home, 'memories_1.sqlite')))
  assert.ok(!existsSync(join(home, 'sessions')))
  assert.equal(homes.connected('acct'), false)

  // Repris au lancement suivant : ce qui a changé chez l'utilisateur suit, ce que Codex a
  // écrit dans le home du compte y reste.
  writeFileSync(join(userHome, 'config.toml'), 'model = "y"\n')
  rmSync(join(userHome, 'AGENTS.md'))
  writeFileSync(join(home, 'history.jsonl'), 'compte')
  writeFileSync(join(home, 'auth.json'), '{}')
  homes.ensure('acct')
  assert.match(readFileSync(join(home, 'config.toml'), 'utf8'), /model = "y"/)
  assert.ok(!existsSync(join(home, 'AGENTS.md')))
  assert.equal(readFileSync(join(home, 'history.jsonl'), 'utf8'), 'compte')
  assert.equal(homes.connected('acct'), true)
})

test('home Codex d’un compte d’avant : ses liens vers le home de l’utilisateur sont retirés', async (t) => {
  const { dir, homes } = await harness(t)
  const userHome = join(dir, 'user-codex')
  mkdirSync(join(userHome, 'sessions'), { recursive: true })
  writeFileSync(join(userHome, 'config.toml'), 'model = "x"\n')
  const previous = process.env.CODEX_HOME
  process.env.CODEX_HOME = userHome
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous })

  const home = homes.path('acct')
  mkdirSync(home, { recursive: true })
  symlinkSync(join(userHome, 'sessions'), join(home, 'sessions'))
  symlinkSync(join(userHome, 'config.toml'), join(home, 'config.toml'))
  homes.ensure('acct')
  assert.ok(!existsSync(join(home, 'sessions')))
  assert.ok(!lstatSync(join(home, 'config.toml')).isSymbolicLink())
  assert.equal(readFileSync(join(userHome, 'config.toml'), 'utf8'), 'model = "x"\n', 'le fichier de l’utilisateur est intact')
})

test('thread Codex : recopié au même chemin depuis le home qui en a la dernière version', async (t) => {
  const { dir, homes } = await harness(t)
  const id = '01a1bbd2-4486-7b50-bf34-da762a389b3b'
  const rollout = (root: string, content: string, mtime: number) => {
    const day = join(root, 'sessions', '2026', '11', '08')
    mkdirSync(day, { recursive: true })
    const path = join(day, `rollout-2026-11-08T16-41-21-${id}.jsonl`)
    writeFileSync(path, content)
    utimesSync(path, mtime, mtime)
    return path
  }
  const cli = join(dir, 'user-codex')
  const a = homes.path('a')
  const b = homes.path('b')
  rollout(cli, 'ancien', 1_000)
  rollout(a, 'récent', 2_000)
  mkdirSync(b, { recursive: true })
  assert.equal(codexThreadFile(b, id), null)

  homes.bringThread(b, id, [cli, a, b])
  assert.equal(readFileSync(codexThreadFile(b, id)!, 'utf8'), 'récent')
  assert.equal(relative(b, codexThreadFile(b, id)!), relative(a, codexThreadFile(a, id)!))

  // Le home qui a la plus récente la garde ; un thread inconnu ne crée rien.
  rollout(b, 'suite sur b', 3_000)
  homes.bringThread(b, id, [cli, a, b])
  assert.equal(readFileSync(codexThreadFile(b, id)!, 'utf8'), 'suite sur b')
  homes.bringThread(a, id, [cli, a, b])
  assert.equal(readFileSync(codexThreadFile(a, id)!, 'utf8'), 'suite sur b')
  homes.bringThread(b, 'inconnu', [cli, a])
  assert.equal(codexThreadFile(b, 'inconnu'), null)
})
