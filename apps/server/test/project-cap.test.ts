import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, projects, runMigrations, users } from '@solera/db'
import type { ProjectDto } from '@solera/protocol'
import type { AttachmentStore } from '../src/attachments/store.js'
import type { CloneJobs } from '../src/clone-jobs.js'
import type { Config } from '../src/config.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerProjectRoutes } from '../src/http/routes/projects.js'
import type { TerminalManager } from '../src/terminals/terminal-manager.js'

/** Le cap d'un projet (jalons.md CAP-1..3) : une phrase, ou rien. */
async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-project-cap-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  for (const id of ['owner', 'guest']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects).values({ id: 'project', name: 'Test', workspacePath: dir, ownerId: 'owner', visibility: 'shared', createdAt: 1 }).run()

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, String(request.headers['x-user'] ?? 'owner'))).get()
  })
  registerErrorHandler(app)
  registerProjectRoutes(app, { db, config: { paths: { data: dir } } as Config }, {} as AttachmentStore, {} as CloneJobs, {
    aliveCount: () => 0,
  } as unknown as TerminalManager)
  t.after(() => app.close())

  const setCap = (cap: unknown, user = 'owner') =>
    app.inject({ method: 'PATCH', url: '/api/projects/project', headers: { 'x-user': user }, payload: { cap } })
  const listed = async (): Promise<ProjectDto> =>
    ((await app.inject('/api/projects')).json() as ProjectDto[]).find((project) => project.id === 'project')!
  return { setCap, listed }
}

test('cap : absent par défaut, posé sans ses espaces, relu dans ProjectDto', async (t) => {
  const { setCap, listed } = await harness(t)
  assert.equal((await listed()).cap, null)

  const set = await setCap('  Un Solera qui se pilote depuis le téléphone.  ')
  assert.equal(set.statusCode, 200, set.body)
  assert.equal((await listed()).cap, 'Un Solera qui se pilote depuis le téléphone.')
})

test('cap : vide ou null le retire', async (t) => {
  const { setCap, listed } = await harness(t)
  await setCap('Une phrase')
  assert.equal((await setCap('   ')).statusCode, 200)
  assert.equal((await listed()).cap, null)

  await setCap('Une phrase')
  assert.equal((await setCap(null)).statusCode, 200)
  assert.equal((await listed()).cap, null)
})

test('cap : 280 caractères au plus, et seul le propriétaire l’écrit', async (t) => {
  const { setCap, listed } = await harness(t)
  assert.equal((await setCap('a'.repeat(280))).statusCode, 200)
  // Les espaces autour ne comptent pas dans la borne.
  assert.equal((await setCap(` ${'b'.repeat(280)} `)).statusCode, 200)
  assert.equal((await setCap('c'.repeat(281))).statusCode, 400)
  assert.equal((await listed()).cap, 'b'.repeat(280))

  assert.equal((await setCap('Autre cap', 'guest')).statusCode, 403)
  assert.equal((await listed()).cap, 'b'.repeat(280))
})
