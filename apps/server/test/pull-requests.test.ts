import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { cardReviews, cards, openDatabase, projects, runMigrations, users } from '@solera/db'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerPullRequestRoutes } from '../src/http/routes/pull-requests.js'
import { ForgeError, type Forge, type PullRequest } from '../src/reviews/forge.js'
import { mergeRefusalOf } from '../src/reviews/merge.js'
import type { WorktreeStatusService } from '../src/worktrees/status-service.js'
import {
  ProjectPullRequests,
  badgeStateOf,
  countChecks,
  pullRequestsByBranch,
  type RawPullRequest,
} from '../src/reviews/pull-requests.js'

/**
 * Le badge de PR de l'onglet Activité (#115) : l'état tiré de ce que `gh pr list`
 * rend, une PR par branche, et une seule lecture de la forge par minute.
 */

function raw(overrides: Partial<RawPullRequest> = {}): RawPullRequest {
  return {
    number: 18,
    title: 'Worktree disparu',
    url: 'https://github.com/o/r/pull/18',
    headRefName: 'fix/worktree-disparu',
    baseRefName: 'main',
    state: 'OPEN',
    isDraft: false,
    mergedAt: null,
    updatedAt: '2026-10-26T10:00:00Z',
    statusCheckRollup: [],
    ...overrides,
  }
}

const run = (conclusion: string, name = 'ci') => ({ status: 'COMPLETED', conclusion, name })

test('les checks se comptent : réussis, en attente, tombés par leur nom ; un check sauté ne compte pas', () => {
  assert.deepEqual(
    countChecks([
      run('SUCCESS'),
      run('FAILURE', 'macos'),
      run('SKIPPED', 'desktop'),
      { status: 'IN_PROGRESS', name: 'lint' },
      { state: 'PENDING', context: 'deploy' },
      { state: 'ERROR', context: 'preview' },
    ]),
    { passed: 1, pending: 2, failed: ['macos', 'preview'] },
  )
  assert.deepEqual(countChecks(null), { passed: 0, pending: 0, failed: [] })
})

test("les cinq états : fusionnée, brouillon, échec avant l'attente, prête sans check ; fermée sans badge", () => {
  const none = { passed: 0, pending: 0, failed: [] }
  assert.equal(badgeStateOf({ state: 'MERGED', isDraft: false }, { ...none, failed: ['ci'] }), 'merged')
  assert.equal(badgeStateOf({ state: 'OPEN', isDraft: true }, { ...none, failed: ['ci'] }), 'draft')
  assert.equal(badgeStateOf({ state: 'OPEN', isDraft: false }, { ...none, pending: 1, failed: ['ci'] }), 'failing')
  assert.equal(badgeStateOf({ state: 'OPEN', isDraft: false }, { ...none, pending: 1, passed: 2 }), 'checks')
  assert.equal(badgeStateOf({ state: 'OPEN', isDraft: false }, none), 'ready')
  assert.equal(badgeStateOf({ state: 'CLOSED', isDraft: false }, none), null)
})

test("une PR par branche : l'ouverte passe devant la fusionnée, puis la plus récente ; la revue de Solera y est jointe", () => {
  const list = pullRequestsByBranch(
    [
      raw({ number: 12, state: 'MERGED', mergedAt: '2026-10-20T10:00:00Z' }),
      raw({ number: 18 }),
      raw({ number: 9, headRefName: 'feat/vue-git', state: 'MERGED', mergedAt: '2026-10-10T10:00:00Z' }),
      raw({ number: 11, headRefName: 'feat/vue-git', state: 'MERGED', mergedAt: '2026-10-12T10:00:00Z' }),
      raw({ number: 5, headRefName: 'feat/abandon', state: 'CLOSED' }),
    ],
    new Map([[18, 'reviewing' as const]]),
  )
  assert.deepEqual(
    list.map((pr) => [pr.branch, pr.number, pr.state, pr.review]),
    [
      ['fix/worktree-disparu', 18, 'ready', 'reviewing'],
      ['feat/vue-git', 11, 'merged', null],
    ],
  )
})

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-prs-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'solera.db'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Tim', passwordHash: '', createdAt: 1 }).run()
  const project = { id: 'project', name: 'Nimbus', workspacePath: dir, ownerId: 'owner', visibility: 'private' as const, createdAt: 1 }
  db.insert(projects).values(project).run()
  db.insert(cards)
    .values({ id: 'card', projectId: 'project', number: 61, title: 'Worktree disparu', description: '', column: 'review', position: 0, createdBy: 'owner', createdAt: 1, updatedAt: 1 })
    .run()
  db.insert(cardReviews)
    .values({
      id: 'review', projectId: 'project', cardId: 'card', authorConversationId: 'author', prNumber: 18,
      prUrl: 'https://github.com/o/r/pull/18', branch: 'fix/worktree-disparu', base: 'main', headSha: 'abc',
      state: 'approved', createdAt: 1, updatedAt: 1,
    })
    .run()
  return { db, project: db.select().from(projects).get()! }
}

test('une seule lecture de la forge par minute ; une forge muette rend « indisponible », sans badge', async (t) => {
  const { db, project } = await harness(t)
  let now = 1_000_000
  let calls = 0
  let fail = false
  const tokens: (string | undefined)[] = []
  const service = new ProjectPullRequests(
    db,
    async (cwd, token) => {
      calls++
      tokens.push(token)
      assert.equal(cwd, project.workspacePath)
      if (fail) throw new Error('gh: not logged in')
      return [raw({ statusCheckRollup: [run('FAILURE')] })]
    },
    () => 'jeton',
    () => now,
  )

  const [a, b] = await Promise.all([service.get(project, 'owner'), service.get(project, 'owner')])
  assert.equal(calls, 1, 'deux appels simultanés partagent la lecture')
  assert.deepEqual(tokens, ['jeton'])
  assert.equal(a, b)
  assert.equal(a.available, true)
  assert.deepEqual(
    a.pullRequests.map((pr) => [pr.number, pr.state, pr.review, pr.checks.failed]),
    [[18, 'failing', 'approved', ['ci']]],
  )

  now += 30_000
  await service.get(project, 'owner')
  assert.equal(calls, 1, 'resservie avant la minute')

  // Après la minute : la liste périmée revient tout de suite, la suivante se lit derrière.
  now += 31_000
  fail = true
  const stale = await service.get(project, 'owner')
  assert.equal(stale, a)
  assert.equal(calls, 2)
  await new Promise((resolve) => setImmediate(resolve))
  const down = await service.get(project, 'owner')
  assert.deepEqual(down, { available: false, fetchedAt: now, pullRequests: [] })
})

// --- Fusionner une PR depuis Solera (S7, #170) ------------------------------------

function forged(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 18,
    url: 'https://github.com/o/r/pull/18',
    head: 'fix/worktree-disparu',
    headSha: 'f00dcafe',
    base: 'main',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    checks: { passed: 1, pending: 0, failed: [] },
    ...overrides,
  }
}

test("une PR n'est prête à fusionner qu'ouverte, hors brouillon, sans conflit et ses checks passés", () => {
  const none = { passed: 0, pending: 0, failed: [] }
  assert.equal(mergeRefusalOf(forged()), null)
  assert.equal(mergeRefusalOf(forged({ checks: none, mergeable: 'UNKNOWN' })), null, 'GitHub juge le conflit plus tard : il tranchera')
  assert.equal(mergeRefusalOf(forged({ state: 'MERGED' })), 'merged')
  assert.equal(mergeRefusalOf(forged({ state: 'CLOSED' })), 'closed')
  assert.equal(mergeRefusalOf(forged({ isDraft: true, mergeable: 'CONFLICTING' })), 'draft')
  assert.equal(mergeRefusalOf(forged({ mergeable: 'CONFLICTING' })), 'conflicting')
  assert.equal(mergeRefusalOf(forged({ checks: { ...none, pending: 1, failed: ['ci'] } })), 'checks_failing')
  assert.equal(mergeRefusalOf(forged({ checks: { ...none, pending: 1 } })), 'checks_pending')
})

async function mergeHarness(t: TestContext) {
  const { db, project } = await harness(t)
  db.insert(users).values({ id: 'guest', username: 'guest', displayName: 'Invité', passwordHash: '', createdAt: 1 }).run()
  db.update(projects).set({ visibility: 'shared' }).run()

  let pr = forged()
  let failRead = false
  let failMerge = false
  const merges: unknown[][] = []
  const forge: Forge = {
    async readPullRequest(cwd, ref, token) {
      assert.equal(cwd, project.workspacePath)
      assert.equal(ref, '18')
      assert.equal(token, 'jeton-owner')
      if (failRead) throw new ForgeError("Solera n'a pas pu lire la PR « 18 » : HTTP 502")
      return pr
    },
    async mergePullRequest(...args) {
      if (failMerge) throw new ForgeError("Solera n'a pas pu fusionner la PR #18 : Pull request is not mergeable")
      merges.push(args)
      pr = { ...pr, state: 'MERGED' }
    },
    async createPullRequest() {
      throw new Error('jamais ici')
    },
  }

  let lists = 0
  const pullRequests = new ProjectPullRequests(db, async () => {
    lists++
    return [raw()]
  })
  const invalidated: string[] = []
  const worktreeStatus = { invalidate: (id: string) => invalidated.push(id) } as unknown as WorktreeStatusService

  let userId = 'owner'
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, userId)).get()
  })
  registerErrorHandler(app)
  registerPullRequestRoutes(app, { db, config: {} } as never, pullRequests, {
    forge,
    worktreeStatus,
    token: (id) => `jeton-${id}`,
  })
  t.after(() => app.close())

  const merge = (url = '/api/projects/project/pull-requests/18/merge') => app.inject({ method: 'POST', url })
  return {
    app,
    cwd: project.workspacePath,
    merge,
    listed: () => pullRequests.get(project, 'owner'),
    merges,
    invalidated,
    lists: () => lists,
    setPr: (next: Partial<PullRequest>) => (pr = forged(next)),
    as: (id: string) => (userId = id),
    failRead: () => (failRead = true),
    failMerge: () => (failMerge = true),
  }
}

test('fusionner une PR prête : en squash, au commit lu sur la forge, puis les caches des PR et des arbres tombent', async (t) => {
  const h = await mergeHarness(t)
  await h.listed()
  assert.equal(h.lists(), 1)

  const res = await h.merge()
  assert.equal(res.statusCode, 200, res.body)
  assert.deepEqual(res.json(), { number: 18, url: 'https://github.com/o/r/pull/18', branch: 'fix/worktree-disparu', base: 'main' })
  assert.deepEqual(h.merges, [[h.cwd, 18, 'f00dcafe', 'jeton-owner']])
  assert.deepEqual(h.invalidated, ['project'])

  await h.listed()
  assert.equal(h.lists(), 2, 'la liste des PR est relue sur la forge, sans attendre la minute')
})

test("une PR qui n'est pas prête est refusée en 409, avec sa raison, sans rien fusionner", async (t) => {
  const h = await mergeHarness(t)
  const cases: [Partial<PullRequest>, string][] = [
    [{ state: 'MERGED' }, 'pull_request_merged'],
    [{ state: 'CLOSED' }, 'pull_request_closed'],
    [{ isDraft: true }, 'pull_request_draft'],
    [{ mergeable: 'CONFLICTING' }, 'pull_request_conflicting'],
    [{ checks: { passed: 0, pending: 0, failed: ['ci'] } }, 'pull_request_checks_failing'],
    [{ checks: { passed: 0, pending: 2, failed: [] } }, 'pull_request_checks_pending'],
  ]
  for (const [pr, code] of cases) {
    h.setPr(pr)
    const res = await h.merge()
    assert.equal(res.statusCode, 409, code)
    assert.equal(res.json().error.code, code)
    assert.equal(res.json().error.params.number, 18)
  }
  assert.deepEqual(h.merges, [])
  assert.deepEqual(h.invalidated, [])
})

test('seul le propriétaire fusionne ; un projet invisible est introuvable ; un numéro illisible est refusé', async (t) => {
  const h = await mergeHarness(t)
  h.as('guest')
  const res = await h.merge()
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'pull_request_merge_forbidden')

  h.as('owner')
  assert.equal((await h.merge('/api/projects/ailleurs/pull-requests/18/merge')).statusCode, 404)
  const bad = await h.merge('/api/projects/project/pull-requests/abc/merge')
  assert.equal(bad.statusCode, 400)
  assert.deepEqual(h.merges, [])
})

test('la forge qui refuse de lire ou de fusionner rend un 502 avec son message', async (t) => {
  const h = await mergeHarness(t)
  h.failMerge()
  const refused = await h.merge()
  assert.equal(refused.statusCode, 502)
  assert.equal(refused.json().error.code, 'forge_failed')
  assert.match(refused.json().error.params.error, /not mergeable/)

  h.failRead()
  const unread = await h.merge()
  assert.equal(unread.statusCode, 502)
  assert.match(unread.json().error.params.error, /HTTP 502/)
  assert.deepEqual(h.invalidated, [], 'rien ne change, rien ne tombe')
})
