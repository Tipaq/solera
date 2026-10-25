import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, runMigrations, users } from '@solera/db'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerUserSettingsRoutes } from '../src/http/routes/user-settings.js'
import type { AppContext } from '../src/http/context.js'

test('apparence : la présentation des outils s’enregistre sur le compte, et un client plus ancien n’en dit rien', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-tool-appearance-'))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  db.insert(users).values({ id: 'u', username: 'u', displayName: 'u', passwordHash: '', isAdmin: true, createdAt: 1 }).run()
  const app = Fastify()
  registerErrorHandler(app)
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, String(request.headers['x-user']))).get()
  })
  registerUserSettingsRoutes(app, { db } as AppContext)
  t.after(async () => {
    await app.close()
    sqlite.close()
    await rm(dir, { recursive: true, force: true })
  })

  for (const toolStyle of ['inline', 'timeline', 'intent', 'cards', 'console', 'classic']) {
    const appearance = { theme: 'dark', syntax: 'solera', toolStyle, values: { readingSize: 16 } }
    const saved = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: { 'x-user': 'u' }, payload: { appearance } })
    assert.equal(saved.statusCode, 200, saved.body)
    const reread = await app.inject({ url: '/api/me/settings', headers: { 'x-user': 'u' } })
    assert.deepEqual(reread.json().appearance, appearance)
  }
  // Un client qui ignore ce champ garde ses autres réglages valides.
  const old = await app.inject({ method: 'PATCH', url: '/api/me/settings', headers: { 'x-user': 'u' }, payload: { appearance: { theme: 'light', syntax: null, values: {} } } })
  assert.equal(old.statusCode, 200, old.body)
  assert.equal(old.json().appearance.toolStyle, undefined)
})
