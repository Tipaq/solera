import assert from 'node:assert/strict'
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, runMigrations, users } from '@solera/db'
import type { GrokAccount, GrokLoginStatusDto } from '@solera/protocol'
import { readGrokBilling, toGrokUsage } from '../src/agents/grok/billing.js'
import { GrokAccountHomes, grokSessionDir } from '../src/grok-accounts/homes.js'
import { GrokLoginService } from '../src/grok-accounts/login.js'
import { GrokAccountStore } from '../src/grok-accounts/store.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerGrokAccountRoutes } from '../src/http/routes/grok-accounts.js'

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-grok-accounts-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  for (const id of ['owner', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  // Le home de l'utilisateur, dont les homes des comptes recopient la configuration.
  const userHome = join(dir, 'user-grok')
  mkdirSync(join(userHome, 'sessions'), { recursive: true })
  writeFileSync(join(userHome, 'config.toml'), '[cli]\n')
  writeFileSync(join(userHome, 'auth.json'), '{"user":true}')
  writeFileSync(join(userHome, 'models_cache.json'), '{}')
  const previous = process.env.GROK_HOME
  process.env.GROK_HOME = userHome
  t.after(() => { if (previous === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = previous })

  const binary = join(dir, 'grok.mjs')
  copyFileSync(new URL('./fixtures/grok-agent.mjs', import.meta.url), binary)
  chmodSync(binary, 0o700)
  const store = new GrokAccountStore(db)
  const homes = new GrokAccountHomes(join(dir, 'grok-accounts'))
  const login = new GrokLoginService(homes, store, async () => binary)
  t.after(() => login.closeAll())
  return { dir, db, userHome, binary, store, homes, login }
}

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('home Grok d’un compte : aucun lien, la config sans secrets, ni connexion ni sessions de l’utilisateur', async (t) => {
  const { userHome, homes } = await harness(t)
  writeFileSync(join(userHome, 'config.toml'), '[cli]\ninstaller = "npm"\n[model.perso]\napi_key = "xai-s3cret"\nbase_url = "https://x"\n')
  mkdirSync(join(userHome, 'rules'))
  writeFileSync(join(userHome, 'rules', 'style.md'), 'règle')
  const home = homes.ensure('acct')
  for (const name of readdirSync(home)) assert.ok(!lstatSync(join(home, name)).isSymbolicLink(), name)
  const config = readFileSync(join(home, 'config.toml'), 'utf8')
  assert.match(config, /installer = "npm"/)
  assert.match(config, /base_url/)
  assert.ok(!config.includes('s3cret'), 'une clé ne passe pas au compte')
  assert.equal(readFileSync(join(home, 'rules', 'style.md'), 'utf8'), 'règle')
  assert.ok(!existsSync(join(home, 'auth.json')), 'la connexion de l’utilisateur ne passe pas au compte')
  assert.ok(!existsSync(join(home, 'models_cache.json')), 'le catalogue dépend de l’abonnement')
  assert.ok(!existsSync(join(home, 'sessions')))
  assert.equal(homes.connected('acct'), false)

  writeFileSync(join(home, 'logs'), '')
  homes.ensure('acct')
  assert.ok(existsSync(join(home, 'logs')), 'ce que Grok écrit dans le home du compte y reste')
})

test('session Grok : son dossier recopié depuis le home qui en a la dernière version', async (t) => {
  const { userHome, homes } = await harness(t)
  const id = '01a1bbd2-c7e3-71d1-a13f-522ca6f7366d'
  const session = (root: string, content: string, mtime: number) => {
    const dir = join(root, 'sessions', '%2Fprojets%2Fsolera', id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'summary.json'), content)
    utimesSync(join(dir, 'summary.json'), mtime, mtime)
  }
  session(userHome, 'cli', 2_000)
  const home = homes.ensure('acct')
  homes.bringSession(home, id, [userHome, home])
  assert.equal(readFileSync(join(grokSessionDir(home, id)!, 'summary.json'), 'utf8'), 'cli')
  assert.equal(grokSessionDir(home, '../../etc'), null, 'un identifiant ne sort pas de sessions/')
})

test('connexion par code d’appareil : URL et code lus sur la sortie de grok login, courriel et formule retenus', async (t) => {
  const { store, homes, login } = await harness(t)
  const account = store.create('owner', 'Perso')
  const started = await login.startDeviceCode(account.id)
  assert.deepEqual(started, {
    state: 'pending',
    verificationUrl: 'https://accounts.x.ai/oauth2/device?user_code=W68V-VRXD',
    userCode: 'W68V-VRXD',
    error: null,
  })
  await until(() => login.status(account.id).state === 'done', 'connexion')
  await until(() => store.find('owner', account.id)?.plan !== null, 'formule')
  const ready = store.find('owner', account.id)!
  assert.equal(ready.status, 'ready')
  assert.equal(ready.authMode, 'grok')
  assert.equal(ready.email, 'fixture@example.com')
  assert.equal(ready.plan, 'X Premium')
  assert.ok(homes.connected(account.id))

  // Déconnexion : `grok logout` est joué dans le home du compte, puis sa connexion retirée.
  await login.logout(account.id)
  assert.equal(homes.connected(account.id), false)
  assert.equal(readFileSync(join(homes.path(account.id), 'logout.log'), 'utf8'), 'logout\n')
  assert.equal(store.find('owner', account.id)!.status, 'pending')
})

test('connexion par code d’appareil : un double clic ne lance qu’un grok login', async (t) => {
  const { store, login } = await harness(t)
  const account = store.create('owner', 'Double')
  const first = login.startDeviceCode(account.id)
  const second = login.startDeviceCode(account.id)
  assert.equal(first, second, 'le second appel reprend le lancement en cours')
  assert.equal((await first).userCode, 'W68V-VRXD')
  await until(() => login.status(account.id).state === 'done', 'connexion')
})

test('connexion refusée : l’échec garde le motif écrit par Grok', async (t) => {
  const { store, login } = await harness(t)
  const account = store.create('owner', 'Refus')
  process.env.FIXTURE_LOGIN = 'fail'
  t.after(() => { delete process.env.FIXTURE_LOGIN })
  await login.startDeviceCode(account.id)
  await until(() => login.status(account.id).state === 'failed', 'échec')
  assert.match(login.status(account.id).error ?? '', /authorization denied/)
  assert.equal(store.find('owner', account.id)!.status, 'pending')
})

test('connexion par clé API : Grok l’écrit dans le home du compte, Solera n’en garde rien', async (t) => {
  const { store, homes, login } = await harness(t)
  const account = store.create('owner', 'Équipe')
  await login.loginWithApiKey(account.id, 'xai-secret')
  assert.ok(homes.connected(account.id))
  const ready = store.find('owner', account.id)!
  assert.equal(ready.authMode, 'apiKey')
  assert.ok(!JSON.stringify(ready).includes('xai-secret'))
})

test('consommation : enveloppe de crédits de la période, dépassement à la demande, formule', async (t) => {
  const { binary, homes } = await harness(t)
  const usage = await readGrokBilling(binary, homes.ensure('acct'))
  assert.deepEqual(usage, {
    agent: 'grok',
    plan: 'X Premium',
    limitsAvailable: true,
    windows: [{ id: 'credits', label: 'Crédits · 7 jours', utilization: 0.08, resetsAt: Date.parse('2026-10-19T22:23:39Z') }],
    credits: { label: 'À la demande', utilization: 0.25, detail: '5.00 $ sur 20.00 $', enabled: true },
  })
  // Un compte sans abonnement (clé API) n'a pas d'enveloppe : rien à montrer.
  assert.deepEqual(toGrokUsage({ config: {} }), { agent: 'grok', plan: null, limitsAvailable: false, windows: [], credits: null })
})

test('routes des comptes Grok : par utilisateur, libellés uniques, aucune clé au retour', async (t) => {
  const { db, store, login } = await harness(t)
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, String(request.headers['x-user'] ?? 'owner'))).get()
  })
  registerErrorHandler(app)
  registerGrokAccountRoutes(app, store, login)
  t.after(() => app.close())

  const created = await app.inject({ method: 'POST', url: '/api/grok-accounts', payload: { label: ' Boulot ' } })
  assert.equal(created.statusCode, 201, created.body)
  const account = created.json<GrokAccount>()
  assert.equal(account.label, 'Boulot')
  assert.equal((await app.inject({ method: 'POST', url: '/api/grok-accounts', payload: { label: 'Boulot' } })).statusCode, 409)
  assert.equal((await app.inject({ url: `/api/grok-accounts/${account.id}/login`, headers: { 'x-user': 'other' } })).statusCode, 404)

  const keyed = await app.inject({ method: 'POST', url: `/api/grok-accounts/${account.id}/login`, payload: { type: 'apiKey', apiKey: 'xai-key' } })
  assert.equal(keyed.statusCode, 200, keyed.body)
  assert.equal(keyed.json<GrokLoginStatusDto>().state, 'done')
  assert.ok(!(await app.inject('/api/grok-accounts')).body.includes('xai-key'))
  assert.equal((await app.inject('/api/grok-accounts')).json<{ accounts: GrokAccount[] }>().accounts[0]?.status, 'ready')

  assert.equal((await app.inject({ method: 'DELETE', url: `/api/grok-accounts/${account.id}/login` })).statusCode, 204)
  assert.equal(store.find('owner', account.id)!.status, 'pending')
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/grok-accounts/${account.id}`, headers: { 'x-user': 'other' } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/grok-accounts/${account.id}` })).statusCode, 204)
  assert.equal(store.list('owner').length, 0)
})
