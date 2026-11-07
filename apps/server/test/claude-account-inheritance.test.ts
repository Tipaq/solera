import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { openDatabase, projects, runMigrations, users, type Db } from '@solera/db'
import { ClaudeAccountStore } from '../src/claude-accounts/store.js'
import { inheritedConfig } from '../src/conversations/config-inheritance.js'
import { writeUserAgentLayer } from '../src/settings/user-settings.js'

/**
 * Un fil Claude qui n'a choisi aucun compte part sur un compte de Solera, plus sur la
 * connexion du terminal : c'est elle qui tombait sans prévenir, et les sessions lancées
 * par un agent échouaient au premier tour (2026-11-07).
 */

const TOKEN = 'sk-ant-oat01-' + 'a'.repeat(40)

async function database(t: TestContext): Promise<Db> {
  const dir = await mkdtemp(join(tmpdir(), 'solera-claude-account-inheritance-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  for (const id of ['tim', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects)
    .values({ id: 'solera', name: 'Solera', workspacePath: dir, ownerId: 'tim', visibility: 'shared', createdAt: 1 })
    .run()
  return db
}

const accountOf = (db: Db, userId: string, agent: 'claude' | 'codex' = 'claude') => {
  const config = inheritedConfig(db, { userId, projectId: 'solera', agent })
  return 'account' in config ? config.account : undefined
}

test('sans compte de Solera, le fil reste sur la connexion du terminal', async (t) => {
  const db = await database(t)
  assert.equal(accountOf(db, 'tim'), null)
})

test('sans choix, le fil hérite du premier compte de la liste, et de lui seul', async (t) => {
  const db = await database(t)
  const store = new ClaudeAccountStore(db, randomBytes(32))
  const perso = store.create('tim', { email: 'perso@exemple.fr', alias: null }, TOKEN)
  store.create('tim', { email: 'travail@exemple.fr', alias: null }, TOKEN)
  store.create('other', { email: 'autre@exemple.fr', alias: null }, TOKEN)
  assert.equal(accountOf(db, 'tim'), perso.id)
  // Le compte d'un autre utilisateur ne se prête pas.
  assert.equal(accountOf(db, 'other') === perso.id, false)
  // Codex garde son propre choix : la règle ne vaut que pour Claude.
  assert.equal(accountOf(db, 'tim', 'codex'), null)
})

test('un choix explicite au compte l’emporte, la connexion du terminal comprise', async (t) => {
  const db = await database(t)
  const store = new ClaudeAccountStore(db, randomBytes(32))
  store.create('tim', { email: 'perso@exemple.fr', alias: null }, TOKEN)
  const travail = store.create('tim', { email: 'travail@exemple.fr', alias: null }, TOKEN)
  writeUserAgentLayer(db, 'tim', { scope: 'claude', set: { account: travail.id } })
  assert.equal(accountOf(db, 'tim'), travail.id)
  writeUserAgentLayer(db, 'tim', { scope: 'claude', set: { account: null } })
  assert.equal(accountOf(db, 'tim'), null)
})

test('un compte désigné puis supprimé retombe sur le premier qui reste', async (t) => {
  const db = await database(t)
  const store = new ClaudeAccountStore(db, randomBytes(32))
  const perso = store.create('tim', { email: 'perso@exemple.fr', alias: null }, TOKEN)
  const travail = store.create('tim', { email: 'travail@exemple.fr', alias: null }, TOKEN)
  writeUserAgentLayer(db, 'tim', { scope: 'claude', set: { account: travail.id } })
  store.delete('tim', travail.id)
  assert.equal(accountOf(db, 'tim'), perso.id)
})
