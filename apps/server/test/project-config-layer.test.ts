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

/**
 * Le niveau du projet dans le brouillon des réglages (page projet v2, PP-22) : plusieurs
 * changements de niveau, et le reste des réglages, dans un seul `PATCH`.
 */
async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-project-config-layer-'))
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

  const listed = async (): Promise<ProjectDto> =>
    ((await app.inject('/api/projects')).json() as ProjectDto[]).find((project) => project.id === 'project')!
  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/projects/project', headers: { 'x-user': 'owner' }, payload })
  return { listed, patch }
}

test('niveau du projet : une liste de changements part avec le reste, en un seul PATCH', async (t) => {
  const { patch, listed } = await harness(t)
  const first = await patch({ configLayer: { scope: 'claude', set: { model: 'opus', effort: 'high' } } })
  assert.equal(first.statusCode, 200, first.body)

  const saved = await patch({
    name: 'Nimbus',
    configLayer: [
      { scope: 'shared', set: { decisions: 'auto' } },
      { scope: 'claude', unset: ['model'] },
      { scope: 'codex', set: { sandbox: 'read-only' } },
    ],
  })
  assert.equal(saved.statusCode, 200, saved.body)
  const project = await listed()
  assert.equal(project.name, 'Nimbus')
  assert.deepEqual(project.configLayer.shared, { decisions: 'auto' })
  assert.deepEqual(project.configLayer.claude, { effort: 'high' })
  assert.deepEqual(project.configLayer.codex, { sandbox: 'read-only' })
})

test('niveau du projet : une liste vide ne change rien, une liste démesurée est refusée', async (t) => {
  const { patch, listed } = await harness(t)
  await patch({ configLayer: { scope: 'shared', set: { decisions: 'ask' } } })
  assert.equal((await patch({ configLayer: [] })).statusCode, 200)
  assert.deepEqual((await listed()).configLayer.shared, { decisions: 'ask' })
  const many = Array.from({ length: 20 }, () => ({ scope: 'claude', set: { model: 'opus' } }))
  assert.equal((await patch({ configLayer: many })).statusCode, 400)
})
