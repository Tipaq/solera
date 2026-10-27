import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, projects, runMigrations, users, type ProjectRow } from '@solera/db'
import type { PortfolioPullRequestsDto, PortfolioWorktreeStatusDto, ProjectPullRequestListDto, WorktreeStatusListDto } from '@solera/protocol'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerPullRequestRoutes } from '../src/http/routes/pull-requests.js'
import { registerWorktreeRoutes } from '../src/http/routes/worktrees.js'
import type { ProjectPullRequests } from '../src/reviews/pull-requests.js'
import type { WorktreeStatusService } from '../src/worktrees/status-service.js'

/**
 * Les arbres et les PR de tous les projets, d'une requête chacun, pour l'Activité du
 * portefeuille (#117) : les projets visibles et non archivés, hors dépôt git exclus, et
 * un projet dont le calcul échoue retiré sans faire tomber les autres.
 */

for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete process.env[name]

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-portfolio-routes-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  const repo = join(dir, 'repo')
  await mkdir(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'base')
  const plain = join(dir, 'plain')
  await mkdir(plain)

  for (const id of ['owner', 'stranger']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  const project = (id: string, values: Partial<typeof projects.$inferInsert> = {}) =>
    db.insert(projects)
      .values({ id, name: id, workspacePath: repo, ownerId: 'owner', visibility: 'private', createdAt: 1, ...values })
      .run()
  project('mine')
  project('shared', { ownerId: 'stranger', visibility: 'shared' })
  project('foreign', { ownerId: 'stranger' })
  project('archived', { archivedAt: 2 })
  project('plain', { workspacePath: plain })
  project('broken')

  const worktreeStatus = {
    async get(row: ProjectRow): Promise<WorktreeStatusListDto> {
      if (row.id === 'broken') throw new Error('calcul en échec')
      return { base: 'main', computedAt: 1, fresh: true, worktrees: [], branches: [] }
    },
  } as unknown as WorktreeStatusService
  const pullRequests = {
    async get(row: ProjectRow): Promise<ProjectPullRequestListDto> {
      if (row.id === 'broken') throw new Error('base indisponible')
      return { available: true, fetchedAt: 1, pullRequests: [] }
    },
  } as unknown as ProjectPullRequests

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerWorktreeRoutes(app, { db, config: {} } as never, {} as never, worktreeStatus, {} as never)
  registerPullRequestRoutes(app, { db, config: {} } as never, pullRequests)
  t.after(() => app.close())

  const read = async <T>(url: string) => {
    const response = await app.inject({ method: 'GET', url })
    return { status: response.statusCode, body: response.json() as T }
  }
  return { read }
}

test('les arbres du portefeuille : les projets visibles et non archivés, sans celui hors git ni celui en échec', async (t) => {
  const { read } = await harness(t)
  const { status, body } = await read<PortfolioWorktreeStatusDto>('/api/worktrees/status')
  assert.equal(status, 200)
  assert.deepEqual(Object.keys(body.projects).sort(), ['mine', 'shared'])
})

test('les PR du portefeuille : le même tri, et un projet en échec ne fait pas tomber les autres', async (t) => {
  const { read } = await harness(t)
  const { status, body } = await read<PortfolioPullRequestsDto>('/api/pull-requests')
  assert.equal(status, 200)
  assert.deepEqual(Object.keys(body.projects).sort(), ['mine', 'shared'])
})
