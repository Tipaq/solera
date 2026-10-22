import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { authSessions, openDatabase, runMigrations, users } from '@solera/db'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerLocalOriginGuard } from '../src/http/local-origin.js'
import { openDesktopSession } from '../src/instance/desktop.js'
import { instanceCapabilities } from '../src/instance/profile.js'

/** Une requête brute, pour forger `Host` et `Origin` comme le ferait une page hostile. */
function raw(port: number, path: string, headers: Record<string, string>): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on('error', reject)
    req.end()
  })
}

async function guarded(t: TestContext): Promise<number> {
  const app = Fastify()
  registerErrorHandler(app)
  registerLocalOriginGuard(app)
  app.get('/api/health', async () => ({ ok: true }))
  app.get('/ds/:token/*', async () => 'storybook')
  await app.listen({ host: '127.0.0.1', port: 0 })
  t.after(() => app.close())
  const address = app.server.address()
  assert.ok(address && typeof address === 'object')
  return address.port
}

test("la garde locale ne répond qu'à la fenêtre de l'app", async (t) => {
  const port = await guarded(t)
  const host = `127.0.0.1:${port}`
  assert.equal(await raw(port, '/api/health', { host }), 200)
  assert.equal(await raw(port, '/api/health', { host: `localhost:${port}` }), 200)
  assert.equal(await raw(port, '/api/health', { host, origin: `http://${host}` }), 200)
  // DNS rebinding : un domaine quelconque résolu vers 127.0.0.1.
  assert.equal(await raw(port, '/api/health', { host: `attacker.example:${port}` }), 403)
  // Une autre page locale, même site au sens des cookies.
  assert.equal(await raw(port, '/api/health', { host, origin: 'http://127.0.0.1:5173' }), 403)
  assert.equal(await raw(port, '/api/health', { host, origin: 'null' }), 403)
})

test('le relais des Storybook accepte ses pages opaques, pas un autre Host', async (t) => {
  const port = await guarded(t)
  const host = `127.0.0.1:${port}`
  assert.equal(await raw(port, '/ds/jeton/index.html', { host, origin: 'null' }), 200)
  assert.equal(await raw(port, '/ds/jeton/index.html', { host: `attacker.example:${port}` }), 403)
})

test("le profil desktop retire ce qui suppose plusieurs comptes ou un navigateur", () => {
  assert.deepEqual(instanceCapabilities('server'), { passwordAuth: true, webPush: true, pwa: true, sharedProjects: true })
  assert.deepEqual(instanceCapabilities('desktop'), {
    passwordAuth: false,
    webPush: false,
    pwa: false,
    sharedProjects: false,
  })
})

test("la session de bureau crée le compte local une fois, et repart à chaque lancement", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-desktop-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  const first = await openDesktopSession(db)
  const second = await openDesktopSession(db)
  assert.notEqual(first, second)
  const accounts = db.select().from(users).all()
  assert.equal(accounts.length, 1)
  assert.equal(accounts[0]?.isAdmin, true)
  // La session précédente tombe : un cookie resté sur le disque ne vaut plus rien.
  assert.equal(db.select().from(authSessions).all().length, 1)
})
