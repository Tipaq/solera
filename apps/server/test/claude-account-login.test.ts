import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { chmodSync, copyFileSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { openDatabase, runMigrations, users } from '@solera/db'
import { ClaudeAccountGauges } from '../src/claude-accounts/gauges.js'
import type { ClaudeIdentify } from '../src/claude-accounts/identity.js'
import { ClaudeLoginService } from '../src/claude-accounts/login.js'
import { ClaudeAccountStore } from '../src/claude-accounts/store.js'

/**
 * La connexion guidée d'un abonnement nomme le compte par l'adresse du jeton obtenu :
 * une adresse connue reconnecte son compte, la reconnexion d'un compte refuse un jeton
 * d'une autre adresse, et la jauge doit mener à la même. Le faux CLI des fixtures tient
 * lieu de Claude Code, le faux `auth status` lit ce qu'il a écrit.
 */

const TOKEN = 'sk-ant-oat01-' + 'a'.repeat(80)
const OTHER_TOKEN = 'sk-ant-oat01-' + 'c'.repeat(80)
const EMAILS: Record<string, string> = { [TOKEN]: 'boulot@exemple.fr', [OTHER_TOKEN]: 'perso@exemple.fr' }

const identify: ClaudeIdentify = async (source) => {
  if ('token' in source) return EMAILS[source.token] ?? null
  try {
    const { email } = JSON.parse(readFileSync(join(source.configDir, '.credentials.json'), 'utf8')) as { email: string }
    // Une connexion dont `auth status` ne dit pas l'adresse.
    return email === 'muette' ? null : email
  } catch {
    return null
  }
}

async function until(check: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Délai dépassé : ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function withEnv(t: TestContext, name: string, value: string): void {
  const previous = process.env[name]
  process.env[name] = value
  t.after(() => {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  })
}

/**
 * Le vrai CLI (2.1.302) : sous le jeton de `setup-token`, `auth status` ne dit aucune
 * adresse ; seule la connexion claude.ai de la jauge la donne.
 */
const identifyLikeTheCli: ClaudeIdentify = async (source) => ('token' in source ? null : identify(source))

async function harness(t: TestContext, identifyAs: ClaudeIdentify = identify) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-claude-account-login-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'tim', username: 'tim', displayName: 'tim', passwordHash: '', createdAt: 1 }).run()
  const binary = join(dir, 'claude.mjs')
  copyFileSync(new URL('./fixtures/claude-login.mjs', import.meta.url), binary)
  chmodSync(binary, 0o700)
  const gauges = new ClaudeAccountGauges(join(dir, 'gauges'))
  const store = new ClaudeAccountStore(db, randomBytes(32), gauges)
  const login = new ClaudeLoginService(store, async () => binary, gauges, null, identifyAs)
  t.after(() => login.closeAll())

  /** Une connexion menée jusqu'au bout avec le bon code : rend son état final. */
  const run = async (start: Promise<{ loginId: string }>) => {
    const { loginId } = await start
    login.submitCode('tim', loginId, 'good')
    await until(() => ['done', 'failed'].includes(login.status('tim', loginId)?.state ?? ''), 'fin de connexion')
    return login.status('tim', loginId)!
  }
  return { store, login, run }
}

test('connexion guidée : le compte prend l’adresse du jeton, une adresse connue est reconnectée', async (t) => {
  const { store, login, run } = await harness(t)
  withEnv(t, 'FIXTURE_CLAUDE_TOKEN', TOKEN)

  const first = await run(login.start('tim', null))
  assert.equal(first.state, 'done', first.error ?? '')
  assert.equal(first.account?.email, 'boulot@exemple.fr')
  assert.equal(first.account?.label, 'boulot@exemple.fr')

  // La même adresse, connectée une seconde fois : le même compte, qui garde son nom.
  store.update('tim', first.account!.id, { alias: 'Boulot' })
  const again = await run(login.start('tim', 'Autre nom'))
  assert.equal(again.state, 'done', again.error ?? '')
  assert.equal(again.account?.id, first.account?.id)
  assert.equal(again.account?.label, 'Boulot · boulot@exemple.fr')
  assert.equal(store.list('tim').length, 1, 'Jamais deux comptes pour la même adresse')
})

test('reconnexion : même adresse, jeton remplacé ; autre adresse, refusée sans rien toucher', async (t) => {
  const { store, login, run } = await harness(t)
  const account = store.create('tim', { email: 'boulot@exemple.fr', alias: null }, 'sk-ant-oat01-' + 'z'.repeat(80))

  withEnv(t, 'FIXTURE_CLAUDE_TOKEN', OTHER_TOKEN)
  const wrong = await run(login.start('tim', null, account.id))
  assert.equal(wrong.state, 'failed')
  assert.match(wrong.error ?? '', /perso@exemple\.fr, pas boulot@exemple\.fr/)
  assert.equal(store.resolveToken('tim', account.id)?.token, 'sk-ant-oat01-' + 'z'.repeat(80))
  assert.equal(store.list('tim').length, 1)

  process.env.FIXTURE_CLAUDE_TOKEN = TOKEN
  const right = await run(login.start('tim', null, account.id))
  assert.equal(right.state, 'done', right.error ?? '')
  assert.equal(store.resolveToken('tim', account.id)?.token, TOKEN)

  // Un compte d'avant les adresses, au jeton mort, la retrouve en se reconnectant.
  const old = store.create('tim', { email: null, alias: 'Perso' }, 'sk-ant-oat01-' + 'y'.repeat(80))
  process.env.FIXTURE_CLAUDE_TOKEN = OTHER_TOKEN
  const revived = await run(login.start('tim', null, old.id))
  assert.equal(revived.state, 'done', revived.error ?? '')
  assert.equal(revived.account?.label, 'Perso · perso@exemple.fr')
})

test('jauge : adoptée si elle mène à l’adresse du compte, refusée sinon', async (t) => {
  const { store, login, run } = await harness(t)
  const account = store.create('tim', { email: 'boulot@exemple.fr', alias: null }, TOKEN)

  // Une connexion dont l'adresse ne se lit pas n'est pas adoptée : rien ne dit qu'elle est la bonne.
  withEnv(t, 'FIXTURE_CLAUDE_EMAIL', 'muette')
  const mute = await run(login.startGauge('tim', account.id))
  assert.equal(mute.state, 'failed')
  assert.match(mute.error ?? '', /ne dit pas à quel compte/)
  assert.equal(store.find('tim', account.id)?.gauge, false)

  process.env.FIXTURE_CLAUDE_EMAIL = 'perso@exemple.fr'
  const wrong = await run(login.startGauge('tim', account.id))
  assert.equal(wrong.state, 'failed')
  assert.match(wrong.error ?? '', /perso@exemple\.fr, pas boulot@exemple\.fr/)
  assert.equal(store.find('tim', account.id)?.gauge, false)

  process.env.FIXTURE_CLAUDE_EMAIL = 'boulot@exemple.fr'
  const right = await run(login.startGauge('tim', account.id))
  assert.equal(right.state, 'done', right.error ?? '')
  assert.equal(store.find('tim', account.id)?.gauge, true)
})

test('démarrage : une jauge d’une autre adresse est retirée, une jauge muette est laissée', async (t) => {
  const { checkGauges } = await import('../src/claude-accounts/identity.js')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { store } = await harness(t)
  const gauge = (id: string, email: string) => {
    mkdirSync(store.gauges!.path(id), { recursive: true })
    writeFileSync(join(store.gauges!.path(id), '.credentials.json'), JSON.stringify({ email }))
  }
  const right = store.create('tim', { email: 'boulot@exemple.fr', alias: null }, TOKEN)
  const wrong = store.create('tim', { email: 'perso@exemple.fr', alias: null }, OTHER_TOKEN)
  const mute = store.create('tim', { email: 'muet@exemple.fr', alias: null }, 'sk-ant-oat01-' + 'm'.repeat(80))
  gauge(right.id, 'boulot@exemple.fr')
  gauge(wrong.id, 'boulot@exemple.fr')
  gauge(mute.id, 'muette')

  assert.deepEqual(await checkGauges(store, identify), [wrong.id])
  assert.equal(store.find('tim', right.id)?.gauge, true)
  assert.equal(store.find('tim', wrong.id)?.gauge, false, 'À refaire depuis l’écran')
  assert.equal(store.find('tim', mute.id)?.gauge, true, 'Rien ne dit qu’elle est fausse')
})

test('jeton sans adresse, comme sous le vrai CLI : rangé quand même, la jauge donne l’adresse', async (t) => {
  const { store, login, run } = await harness(t, identifyLikeTheCli)
  withEnv(t, 'FIXTURE_CLAUDE_TOKEN', TOKEN)

  // Un compte neuf : le jeton est rangé sans adresse, puis la jauge la lui pose.
  const fresh = await run(login.start('tim', 'Boulot'))
  assert.equal(fresh.state, 'done', fresh.error ?? '')
  assert.equal(fresh.account?.email, null)
  assert.equal(store.resolveToken('tim', fresh.account!.id)?.token, TOKEN)
  withEnv(t, 'FIXTURE_CLAUDE_EMAIL', 'boulot@exemple.fr')
  const gauge = await run(login.startGauge('tim', fresh.account!.id))
  assert.equal(gauge.state, 'done', gauge.error ?? '')
  assert.equal(store.find('tim', fresh.account!.id)?.label, 'Boulot · boulot@exemple.fr')

  // Un compte d'avant les adresses se reconnecte : le jeton est remplacé, plus de refus.
  const old = store.create('tim', { email: null, alias: 'Perso' }, 'sk-ant-oat01-' + 'y'.repeat(80))
  process.env.FIXTURE_CLAUDE_TOKEN = OTHER_TOKEN
  const revived = await run(login.start('tim', null, old.id))
  assert.equal(revived.state, 'done', revived.error ?? '')
  assert.equal(store.resolveToken('tim', old.id)?.token, OTHER_TOKEN)
  process.env.FIXTURE_CLAUDE_EMAIL = 'perso@exemple.fr'
  assert.equal((await run(login.startGauge('tim', old.id))).state, 'done')
  assert.equal(store.find('tim', old.id)?.label, 'Perso · perso@exemple.fr')

  // Une jauge qui révèle une adresse déjà prise : posée quand même, les deux signalés.
  const twin = store.create('tim', { email: null, alias: 'Boulot bis' }, TOKEN)
  process.env.FIXTURE_CLAUDE_EMAIL = 'boulot@exemple.fr'
  assert.equal((await run(login.startGauge('tim', twin.id))).state, 'done')
  assert.equal(store.find('tim', twin.id)?.duplicate, true)
  assert.equal(store.find('tim', fresh.account!.id)?.duplicate, true)
})

test('démarrage : un compte sans adresse la retrouve par sa jauge quand le jeton se tait', async (t) => {
  const { backfillClaudeEmails } = await import('../src/claude-accounts/identity.js')
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { store } = await harness(t, identifyLikeTheCli)
  const withGauge = store.create('tim', { email: null, alias: 'Tim perso' }, TOKEN)
  const without = store.create('tim', { email: null, alias: 'Sans jauge' }, OTHER_TOKEN)
  mkdirSync(store.gauges!.path(withGauge.id), { recursive: true })
  writeFileSync(join(store.gauges!.path(withGauge.id), '.credentials.json'), JSON.stringify({ email: 'perso@exemple.fr' }))

  assert.equal(await backfillClaudeEmails(store, identifyLikeTheCli), 1)
  assert.equal(store.find('tim', withGauge.id)?.label, 'Tim perso · perso@exemple.fr')
  assert.equal(store.find('tim', without.id)?.email, null, 'Sans jauge, il reste à reconnecter')
})

test('reconnexion sous le vrai CLI : le jeton attend que la jauge confirme l’adresse', async (t) => {
  const { store, login, run } = await harness(t, identifyLikeTheCli)
  const OLD = 'sk-ant-oat01-' + 'z'.repeat(80)
  const account = store.create('tim', { email: 'boulot@exemple.fr', alias: null }, OLD)

  // Le code d'un autre compte : le jeton n'est pas rangé, la jauge le refuse et le jette.
  withEnv(t, 'FIXTURE_CLAUDE_TOKEN', OTHER_TOKEN)
  assert.equal((await run(login.start('tim', null, account.id))).state, 'done')
  assert.equal(store.resolveToken('tim', account.id)?.token, OLD, 'Rien de remplacé avant la jauge')
  withEnv(t, 'FIXTURE_CLAUDE_EMAIL', 'perso@exemple.fr')
  const wrong = await run(login.startGauge('tim', account.id))
  assert.equal(wrong.state, 'failed')
  assert.match(wrong.error ?? '', /perso@exemple\.fr, pas boulot@exemple\.fr/)
  assert.equal(store.resolveToken('tim', account.id)?.token, OLD)

  // Le bon compte : la jauge confirme, le jeton remplace l'ancien.
  process.env.FIXTURE_CLAUDE_TOKEN = TOKEN
  assert.equal((await run(login.start('tim', null, account.id))).state, 'done')
  process.env.FIXTURE_CLAUDE_EMAIL = 'boulot@exemple.fr'
  assert.equal((await run(login.startGauge('tim', account.id))).state, 'done')
  assert.equal(store.resolveToken('tim', account.id)?.token, TOKEN)
})
