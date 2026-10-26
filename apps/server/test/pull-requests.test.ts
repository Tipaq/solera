import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { cardReviews, cards, openDatabase, projects, runMigrations, users } from '@solera/db'
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
