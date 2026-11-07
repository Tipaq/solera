import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { claudeAccounts, openDatabase, runMigrations, users } from '@solera/db'
import type { AgentUsage, ClaudeAccount } from '@solera/protocol'
import { ClaudeAccountStore } from '../src/claude-accounts/store.js'
import { CodexAccountHomes } from '../src/codex-accounts/homes.js'
import { CodexAccountStore } from '../src/codex-accounts/store.js'
import { GrokAccountHomes } from '../src/grok-accounts/homes.js'
import { GrokAccountStore } from '../src/grok-accounts/store.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerAgentRoutes } from '../src/http/routes/agents.js'
import { registerClaudeAccountRoutes } from '../src/http/routes/claude-accounts.js'
import type { AgentAdapter, AgentRegistry } from '../src/agents/registry.js'
import type { CliInstaller } from '../src/agents/cli-install.js'
import { UsageLedger } from '../src/agents/usage-ledger.js'
import type { AppContext } from '../src/http/context.js'

const TOKEN = 'sk-ant-oat01-' + 'a'.repeat(40)
const OTHER_TOKEN = 'sk-ant-oat01-' + 'c'.repeat(40)
const DEAD_TOKEN = 'sk-ant-oat01-' + 'd'.repeat(40)

/** Le `claude auth status` simulé : chaque jeton a son adresse, un jeton mort n'en a pas. */
const EMAILS: Record<string, string> = { [TOKEN]: 'boulot@exemple.fr', [OTHER_TOKEN]: 'perso@exemple.fr' }
const identify = async (source: { token: string } | { configDir: string }) =>
  'token' in source ? (EMAILS[source.token] ?? null) : null

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-claude-accounts-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  for (const id of ['owner', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  const store = new ClaudeAccountStore(db, randomBytes(32))

  // La consommation lue sous un jeton : l'adaptateur simulé rend le jeton reçu, ce qui
  // est tout ce que la route doit garantir.
  const seen: Array<{ accountId: string; token: string }> = []
  const adapter = {
    kind: 'claude',
    label: 'Claude',
    usage: async () => ({ agent: 'claude', plan: 'cli', limitsAvailable: true, windows: [], credits: null, fetchedAt: 1 }) as AgentUsage,
    usageForAccount: async (accountId: string, token: string) => {
      seen.push({ accountId, token })
      return { agent: 'claude', plan: accountId, limitsAvailable: true, windows: [], credits: null, fetchedAt: 1 } as AgentUsage
    },
  } as unknown as AgentAdapter
  const registry = { usageLedger: new UsageLedger(), find: (agent: string) => (agent === 'claude' ? adapter : undefined), all: () => [adapter] } as unknown as AgentRegistry

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, String(request.headers['x-user'] ?? 'owner'))).get()
  })
  registerErrorHandler(app)
  registerClaudeAccountRoutes(app, store, {} as never, identify)
  registerAgentRoutes(app, { db } as AppContext, registry, {} as CliInstaller, store, { store: new CodexAccountStore(db), homes: new CodexAccountHomes(join(dir, 'codex')) }, { store: new GrokAccountStore(db), homes: new GrokAccountHomes(join(dir, 'grok')) })
  t.after(() => app.close())
  return { db, store, app, seen }
}

test('comptes Claude : nommés par leur adresse, jeton jamais rendu, résolu avec son propriétaire', async (t) => {
  const { db, store, app, seen } = await harness(t)

  const created = await app.inject({ method: 'POST', url: '/api/claude-accounts', payload: { token: TOKEN } })
  assert.equal(created.statusCode, 201, created.body)
  const account = created.json<ClaudeAccount>()
  assert.equal(account.email, 'boulot@exemple.fr', 'L’adresse vient du jeton')
  assert.equal(account.alias, null)
  assert.equal(account.label, 'boulot@exemple.fr', 'Sans alias, le compte s’appelle par son adresse')
  assert.equal(account.kind, 'oauth')
  assert.ok(!('token' in account))

  // Le jeton n'est stocké que chiffré.
  const row = db.select().from(claudeAccounts).where(eq(claudeAccounts.id, account.id)).get()!
  assert.ok(!row.ciphertext.includes('sk-ant'))
  assert.equal(store.resolveToken('owner', account.id)?.token, TOKEN)
  assert.equal(store.resolveToken('other', account.id), undefined, "Le compte d'un autre ne se résout pas")

  // Une adresse, un compte : le même jeton, ou un autre de la même adresse, est refusé.
  const again = await app.inject({ method: 'POST', url: '/api/claude-accounts', payload: { alias: 'Encore', token: TOKEN } })
  assert.equal(again.statusCode, 409)
  assert.equal(again.json<{ error: { code: string } }>().error.code, 'claude_account_email_taken')
  // Un jeton dont le CLI ne dit pas l'adresse (le cas du vrai, sous un jeton) est rangé
  // sans elle : c'est la jauge qui la donnera.
  const silent = await app.inject({ method: 'POST', url: '/api/claude-accounts', payload: { alias: 'Sans adresse', token: DEAD_TOKEN } })
  assert.equal(silent.statusCode, 201, 'Un jeton sans adresse est rangé')
  assert.equal(silent.json<ClaudeAccount>().email, null)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/claude-accounts/${silent.json<ClaudeAccount>().id}` })).statusCode, 204)
  assert.equal((await app.inject({ method: 'POST', url: '/api/claude-accounts', payload: { alias: 'Perso', token: 'sk-ant-api03-nope' } })).statusCode, 400, 'Un secret tronqué est refusé')
  assert.equal((await app.inject({ method: 'POST', url: '/api/claude-accounts', payload: { token: 'sk-ant-api03-' + 'k'.repeat(40) } })).statusCode, 400, 'Une clé API sans adresse exige un nom')
  const keyed = (await app.inject({ method: 'POST', url: '/api/claude-accounts', payload: { alias: 'Boîte', token: 'sk-ant-api03-' + 'k'.repeat(40) } })).json<ClaudeAccount>()
  assert.equal(keyed.kind, 'apiKey', 'Une clé API Console se reconnaît à son préfixe')
  assert.equal(keyed.email, null)
  assert.equal(keyed.label, 'Boîte')
  assert.equal(store.resolveToken('owner', keyed.id)?.kind, 'apiKey')
  assert.equal((await app.inject({ method: 'POST', url: '/api/claude-accounts', payload: { token: TOKEN }, headers: { 'x-user': 'other' } })).statusCode, 201, 'La même adresse chez un autre utilisateur passe')

  const list = (await app.inject('/api/claude-accounts')).json<{ accounts: ClaudeAccount[] }>()
  assert.deepEqual(list.accounts.map((entry) => entry.label), ['boulot@exemple.fr', 'Boîte'])
  assert.ok(list.accounts.every((entry) => !('token' in entry) && !entry.duplicate))

  // La consommation par compte est demandée pour le compte, et seulement au propriétaire.
  const usage = await app.inject(`/api/agents/claude/usage?account=${account.id}`)
  assert.equal(usage.statusCode, 200, usage.body)
  assert.equal(usage.json<AgentUsage>().plan, account.id)
  // Sans jauge, le compte est connu mais rien n'est à lire : l'adaptateur reçoit une
  // chaîne vide, jamais le jeton, qui ne lit pas les limites du forfait.
  assert.deepEqual(seen, [{ accountId: account.id, token: '' }])
  assert.equal((await app.inject({ url: `/api/agents/claude/usage?account=${account.id}`, headers: { 'x-user': 'other' } })).statusCode, 404)
  assert.equal((await app.inject('/api/agents/claude/usage')).json<AgentUsage>().plan, 'cli', 'Sans compte, la connexion du CLI')

  // Un alias, un jeton renouvelé de la même adresse, ou rien : chaque cas a sa réponse.
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/claude-accounts/${account.id}`, payload: {} })).statusCode, 400)
  const renewed = TOKEN.replace(/a+$/, 'b'.repeat(40))
  EMAILS[renewed] = 'boulot@exemple.fr'
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/claude-accounts/${account.id}`, payload: { alias: ' Travail ', token: renewed } })).statusCode, 204)
  assert.equal(store.resolveToken('owner', account.id)?.token, renewed)
  assert.equal(store.find('owner', account.id)?.label, 'Travail · boulot@exemple.fr')
  // Un jeton d'une autre adresse serait un autre compte : refusé, rien de remplacé.
  const mismatch = await app.inject({ method: 'PATCH', url: `/api/claude-accounts/${account.id}`, payload: { token: OTHER_TOKEN } })
  assert.equal(mismatch.statusCode, 409)
  assert.equal(mismatch.json<{ error: { code: string } }>().error.code, 'claude_account_email_mismatch')
  assert.equal(store.resolveToken('owner', account.id)?.token, renewed)
  // Un alias vide le retire : le compte reprend son adresse pour nom.
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/claude-accounts/${account.id}`, payload: { alias: '' } })).statusCode, 204)
  assert.equal(store.find('owner', account.id)?.label, 'boulot@exemple.fr')
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/claude-accounts/${keyed.id}`, payload: { alias: '' } })).statusCode, 400, 'Une clé API garde son nom')
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/claude-accounts/${account.id}`, payload: { alias: 'X' }, headers: { 'x-user': 'other' } })).statusCode, 404)

  assert.equal((await app.inject({ method: 'DELETE', url: `/api/claude-accounts/${account.id}`, headers: { 'x-user': 'other' } })).statusCode, 404)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/claude-accounts/${account.id}` })).statusCode, 204)
  assert.equal(store.list('owner').length, 1)
  assert.equal(store.list('other').length, 1)
})

test('jauge d’un abonnement : reprise d’un dossier jetable, retirée avec le compte', async (t) => {
  const { ClaudeAccountGauges } = await import('../src/claude-accounts/gauges.js')
  const { mkdirSync, writeFileSync, existsSync, statSync } = await import('node:fs')
  const dir = await mkdtemp(join(tmpdir(), 'solera-gauges-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  const gauges = new ClaudeAccountGauges(join(dir, 'claude-accounts'))
  const store = new ClaudeAccountStore(db, randomBytes(32), gauges)

  const account = store.create('owner', { email: 'perso@exemple.fr', alias: 'Perso' }, TOKEN)
  const keyed = store.create('owner', { email: null, alias: 'Boîte' }, 'sk-ant-api03-' + 'k'.repeat(40))
  assert.equal(store.find('owner', account.id)?.gauge, false)

  // Une connexion ratée ne laisse rien : pas d'identifiants, pas de reprise.
  const staging = join(dir, 'staging')
  mkdirSync(staging)
  assert.throws(() => gauges.adopt(account.id, staging))
  assert.equal(gauges.has(account.id), false)

  writeFileSync(join(staging, '.credentials.json'), '{"claudeAiOauth":{}}')
  writeFileSync(join(staging, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'perso@example.com' } }))
  writeFileSync(join(staging, 'history.jsonl'), 'pas gardé')
  gauges.adopt(account.id, staging)
  assert.equal(store.find('owner', account.id)?.gauge, true)
  assert.equal(existsSync(join(gauges.path(account.id), 'history.jsonl')), false, 'Seule la connexion est gardée')
  assert.equal(statSync(join(gauges.path(account.id), '.credentials.json')).mode & 0o777, 0o600)

  // Une clé API n'a pas de forfait : même un dossier égaré ne lui donne pas de jauge.
  mkdirSync(gauges.path(keyed.id), { recursive: true })
  writeFileSync(join(gauges.path(keyed.id), '.credentials.json'), '{}')
  assert.equal(store.find('owner', keyed.id)?.gauge, false)

  assert.ok(store.delete('owner', account.id))
  assert.equal(existsSync(gauges.path(account.id)), false, 'La jauge part avec le compte')
})

test('comptes d’avant les adresses : l’adresse retrouvée sous le jeton, les doublons signalés', async (t) => {
  const { backfillClaudeEmails } = await import('../src/claude-accounts/identity.js')
  const { store } = await harness(t)
  // Tels que la migration les laisse : l'ancien libellé en alias, pas d'adresse.
  const named = store.create('owner', { email: null, alias: 'Boulot' }, TOKEN)
  const plain = store.create('owner', { email: null, alias: 'Perso@Exemple.fr' }, OTHER_TOKEN)
  const twin = store.create('owner', { email: null, alias: 'Boulot bis' }, TOKEN)
  const dead = store.create('owner', { email: null, alias: 'Vieux' }, DEAD_TOKEN)
  const keyed = store.create('owner', { email: null, alias: 'Boîte' }, 'sk-ant-api03-' + 'k'.repeat(40))
  const before = store.find('owner', named.id)!.updatedAt

  assert.equal(await backfillClaudeEmails(store, identify), 3)
  assert.equal(store.find('owner', named.id)?.label, 'Boulot · boulot@exemple.fr', 'L’ancien nom devient l’alias')
  assert.equal(store.find('owner', named.id)?.updatedAt, before, 'La date reste celle du jeton')
  assert.equal(store.find('owner', plain.id)?.alias, null, 'Un alias qui répète l’adresse disparaît')
  assert.equal(store.find('owner', plain.id)?.label, 'perso@exemple.fr')
  // Deux comptes qui se révèlent être le même : signalés, aucun n'est supprimé.
  assert.equal(store.find('owner', named.id)?.duplicate, true)
  assert.equal(store.find('owner', twin.id)?.duplicate, true)
  assert.equal(store.find('owner', plain.id)?.duplicate, false)
  // Un jeton mort reste sans adresse, à reconnecter ; une clé API n'en a jamais.
  assert.equal(store.find('owner', dead.id)?.email, null)
  assert.equal(store.find('owner', keyed.id)?.email, null)
  assert.deepEqual(store.withoutEmail().map((entry) => entry.id), [dead.id])
  assert.equal(await backfillClaudeEmails(store, identify), 0, 'Rien à refaire au démarrage suivant')
})
