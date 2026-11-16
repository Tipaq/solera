import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { eq } from 'drizzle-orm'
import { cardNotes, cards, openDatabase, projects, runMigrations, users } from '@solera/db'
import type { CardDto } from '@solera/protocol'
import { AttachmentStore } from '../src/attachments/store.js'
import type { Config } from '../src/config.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerCardRoutes } from '../src/http/routes/cards.js'
import { registerPullRequestRoutes } from '../src/http/routes/pull-requests.js'
import { ForgeError, type Forge, type PullRequest } from '../src/reviews/forge.js'
import { ParentPullRequests } from '../src/reviews/parent-pr.js'
import { ProjectPullRequests } from '../src/reviews/pull-requests.js'
import type { WorktreeStatusService } from '../src/worktrees/status-service.js'

/**
 * La PR finale d'un jalon (#187) : ce que la carte en dit, l'état fusionné relu sur la
 * forge, et la fusion depuis Solera. La forge est simulée : aucun `gh` ne part.
 */

const BRANCH = 'jalon/6-jalon-vite'
const URL_PR = 'https://github.com/t/nimbus/pull/101'

function forged(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 101,
    url: URL_PR,
    head: BRANCH,
    headSha: 'c0ffee',
    base: 'main',
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    checks: { passed: 1, pending: 0, failed: [] },
    ...overrides,
  }
}

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-parent-pr-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'solera.db'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Tim', passwordHash: '', createdAt: 1 }).run()
  db.insert(users).values({ id: 'guest', username: 'guest', displayName: 'Invité', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects)
    .values({ id: 'project', name: 'Nimbus', workspacePath: dir, ownerId: 'owner', visibility: 'shared', createdAt: 1 })
    .run()
  // Le jalon : sa branche, et la PR que Solera a ouverte vers la branche par défaut.
  db.insert(cards)
    .values({
      id: 'parent', projectId: 'project', number: 6, title: 'Jalon vite', description: '', column: 'done', position: 0,
      milestone: true, branch: BRANCH, branchPrNumber: 101, branchPrUrl: URL_PR, createdBy: 'owner', createdAt: 1, updatedAt: 1,
    })
    .run()
  db.insert(cards)
    .values({
      id: 'child', projectId: 'project', number: 7, title: 'Monter vite', description: '', column: 'done', position: 1,
      parentId: 'parent', createdBy: 'owner', createdAt: 1, updatedAt: 1,
    })
    .run()

  let pr = forged()
  let failRead: string | null = null
  let failMerge: string | null = null
  const reads: string[] = []
  const merges: unknown[][] = []
  const forge: Forge = {
    async readPullRequest(cwd, ref, token) {
      assert.equal(cwd, dir)
      assert.equal(token, 'jeton-owner')
      reads.push(ref)
      if (failRead) throw new ForgeError(failRead)
      return pr
    },
    async mergePullRequest(...args) {
      if (failMerge) throw new ForgeError(failMerge)
      merges.push(args)
      pr = { ...pr, state: 'MERGED' }
    },
    async createPullRequest() {
      throw new Error('jamais ici : la PR du jalon est déjà ouverte')
    },
  }

  let userId = 'owner'
  const app = Fastify()
  await app.register(multipart)
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, userId)).get()
  })
  registerErrorHandler(app)
  const ctx = { db, config: {} as Config }
  registerCardRoutes(app, ctx, new AttachmentStore(db, join(dir, 'attachments')))
  const invalidated: string[] = []
  const pullRequests = new ProjectPullRequests(db, async () => [])
  pullRequests.invalidate = (id: string) => void invalidated.push(`prs:${id}`)
  const worktreeStatus = { invalidate: (id: string) => invalidated.push(`trees:${id}`) } as unknown as WorktreeStatusService
  registerPullRequestRoutes(app, ctx as never, pullRequests, { forge, worktreeStatus, token: (id) => `jeton-${id}` })
  t.after(() => app.close())

  const sweeper = new ParentPullRequests(ctx as never, forge, (id) => `jeton-${id}`)

  return {
    db,
    cwd: dir,
    sweeper,
    reads,
    merges,
    invalidated,
    merge: (id = 'parent') => app.inject({ method: 'POST', url: `/api/cards/${id}/branch-pr/merge` }),
    read: async (id: string): Promise<CardDto> =>
      ((await app.inject('/api/projects/project/cards')).json() as CardDto[]).find((card) => card.id === id)!,
    row: (id = 'parent') => db.select().from(cards).where(eq(cards.id, id)).get()!,
    notes: (id = 'parent') => db.select().from(cardNotes).where(eq(cardNotes.cardId, id)).all().map((note) => note.body),
    setPr: (next: Partial<PullRequest>) => (pr = forged(next)),
    failRead: (reason: string | null) => (failRead = reason),
    failMerge: (reason: string | null) => (failMerge = reason),
    as: (id: string) => (userId = id),
  }
}

// --- La carte dit sa branche et sa PR ---------------------------------------------

test('une carte dit sa branche et sa PR finale, fusionnée ou non ; une carte sans branche, rien', async (t) => {
  const h = await harness(t)
  const parent = await h.read('parent')
  assert.equal(parent.branch, BRANCH)
  assert.deepEqual(parent.branchPr, { number: 101, url: URL_PR, base: null, mergedAt: null, closedAt: null })

  h.db.update(cards).set({ branchPrMergedAt: 1234, branchPrBase: 'main' }).where(eq(cards.id, 'parent')).run()
  assert.deepEqual((await h.read('parent')).branchPr, { number: 101, url: URL_PR, base: 'main', mergedAt: 1234, closedAt: null })

  const child = await h.read('child')
  assert.equal(child.branch, null)
  assert.equal(child.branchPr, null)
})

// --- Le balayage relit les PR ouvertes ---------------------------------------------

test('balayage : une PR de jalon fusionnée sur la forge pose sa date, une fois, avec une note', async (t) => {
  const h = await harness(t)
  await h.sweeper.checkMerged(10_000)
  assert.deepEqual(h.reads, ['101'], 'la PR ouverte est relue par son numéro')
  assert.equal(h.row().branchPrMergedAt, null, 'encore ouverte : rien ne change')
  assert.deepEqual(h.notes(), [])

  h.setPr({ state: 'MERGED' })
  await h.sweeper.checkMerged(10_000 + 60_000)
  assert.equal(h.row().branchPrMergedAt, 70_000)
  assert.equal(h.notes().length, 1)
  assert.match(h.notes()[0]!, /PR #101/)
  assert.match(h.notes()[0]!, /fusionnée/)

  await h.sweeper.checkMerged(10_000 + 10 * 60_000)
  assert.equal(h.reads.length, 2, 'une PR fusionnée ne se relit plus')
  assert.equal(h.notes().length, 1)
})

test('balayage : la date de fusion est celle de la forge quand elle la donne', async (t) => {
  const h = await harness(t)
  h.setPr({ state: 'MERGED', mergedAt: 4242 })
  await h.sweeper.checkMerged(10_000)
  assert.equal(h.row().branchPrMergedAt, 4242, 'fusionnée pendant une panne : livrée ce jour-là, pas au balayage')
})

test('balayage : la PR d’un projet archivé ne se relit pas', async (t) => {
  const h = await harness(t)
  h.db.update(projects).set({ archivedAt: 1 }).run()
  await h.sweeper.checkMerged(0)
  assert.deepEqual(h.reads, [])
})

test('balayage : une PR ouverte se relit une fois par minute, pas à chaque passage', async (t) => {
  const h = await harness(t)
  await h.sweeper.checkMerged(0)
  await h.sweeper.checkMerged(500)
  await h.sweeper.checkMerged(59_000)
  assert.equal(h.reads.length, 1)
  await h.sweeper.checkMerged(60_000)
  assert.equal(h.reads.length, 2)
})

test('balayage : une forge muette ou une PR fermée attendent la demi-heure', async (t) => {
  const h = await harness(t)
  h.failRead('HTTP 502')
  await h.sweeper.checkMerged(0)
  await h.sweeper.checkMerged(5 * 60_000)
  assert.equal(h.reads.length, 1, 'la forge en panne n’est pas relancée tout de suite')
  assert.equal(h.row().branchPrMergedAt, null)

  h.failRead(null)
  h.setPr({ state: 'CLOSED' })
  await h.sweeper.checkMerged(30 * 60_000)
  assert.equal(h.reads.length, 2)
  await h.sweeper.checkMerged(45 * 60_000)
  assert.equal(h.reads.length, 2, 'une PR fermée peut être rouverte, mais pas chaque minute')
  assert.equal(h.row().branchPrMergedAt, null, 'fermée n’est pas fusionnée')
})

test('balayage : une PR fermée sans fusion pose sa date de fermeture, une fois, et la rouvrir la lève', async (t) => {
  const h = await harness(t)
  h.setPr({ state: 'CLOSED' })
  await h.sweeper.checkMerged(10_000)
  assert.equal(h.row().branchPrClosedAt, 10_000)
  assert.equal(h.row().branchPrMergedAt, null)
  assert.equal(h.notes().length, 1)
  assert.match(h.notes()[0]!, /PR #101/)
  assert.match(h.notes()[0]!, /fermée/)
  assert.equal((await h.read('parent')).branchPr?.closedAt, 10_000)

  await h.sweeper.checkMerged(10_000 + 30 * 60_000)
  assert.equal(h.row().branchPrClosedAt, 10_000, 'toujours fermée : la date ne bouge pas')
  assert.equal(h.notes().length, 1, 'la note ne se répète pas')

  h.setPr({ state: 'OPEN' })
  await h.sweeper.checkMerged(10_000 + 60 * 60_000)
  assert.equal(h.row().branchPrClosedAt, null, 'rouverte sur la forge : elle se fusionne de nouveau')
})

test('balayage : la base de la PR est relevée sur la forge quand la carte ne la connaît pas', async (t) => {
  const h = await harness(t)
  h.setPr({ base: 'trunk' })
  await h.sweeper.checkMerged(0)
  assert.equal(h.row().branchPrBase, 'trunk')
  assert.equal((await h.read('parent')).branchPr?.base, 'trunk')
})

// --- La fusion depuis Solera -------------------------------------------------------

test('fusionner la PR du jalon : en squash au commit lu, la date posée, une note, les caches tombent', async (t) => {
  const h = await harness(t)
  const before = Date.now()
  const res = await h.merge()
  assert.equal(res.statusCode, 200, res.body)
  const body = res.json()
  assert.equal(body.number, 101)
  assert.equal(body.url, URL_PR)
  assert.ok(body.mergedAt >= before)
  assert.deepEqual(h.merges, [[h.cwd, 101, 'c0ffee', 'jeton-owner']])
  assert.equal(h.row().branchPrMergedAt, body.mergedAt)
  assert.equal(h.row().column, 'done', 'la carte n’est pas close pour autant : sa colonne ne bouge pas')
  assert.equal(h.notes().length, 1)
  assert.match(h.notes()[0]!, /PR #101/)
  assert.match(h.notes()[0]!, /`main`/)
  assert.deepEqual(h.invalidated, ['prs:project', 'trees:project'])
  assert.equal(body.base, 'main')
  assert.deepEqual((await h.read('parent')).branchPr, { number: 101, url: URL_PR, base: 'main', mergedAt: body.mergedAt, closedAt: null })
})

test('une PR déjà fusionnée est refusée, et la date manquante est posée au passage', async (t) => {
  const h = await harness(t)
  h.setPr({ state: 'MERGED' })
  const res = await h.merge()
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().error.code, 'pull_request_merged')
  assert.deepEqual(h.merges, [])
  assert.ok(h.row().branchPrMergedAt !== null, 'fusionnée sur GitHub : le jalon est livré')
  assert.equal(h.notes().length, 1)

  const again = await h.merge()
  assert.equal(again.statusCode, 409)
  assert.equal(h.notes().length, 1, 'la note ne se répète pas')
})

test('une PR fermée, en brouillon, en conflit ou aux checks pas verts est refusée en 409, sans rien fusionner', async (t) => {
  const h = await harness(t)
  const cases: [Partial<PullRequest>, string][] = [
    [{ state: 'CLOSED' }, 'pull_request_closed'],
    [{ isDraft: true }, 'pull_request_draft'],
    [{ mergeable: 'CONFLICTING' }, 'pull_request_conflicting'],
    [{ checks: { passed: 0, pending: 0, failed: ['ci'] } }, 'pull_request_checks_failing'],
    [{ checks: { passed: 0, pending: 1, failed: [] } }, 'pull_request_checks_pending'],
  ]
  for (const [pr, code] of cases) {
    h.setPr(pr)
    const res = await h.merge()
    assert.equal(res.statusCode, 409, code)
    assert.equal(res.json().error.code, code)
    assert.equal(res.json().error.params.number, 101)
    // Le refus dit ce que la forge a vu : fermée, le jalon le dit ; rouverte, il ne le dit plus.
    assert.equal(h.row().branchPrClosedAt !== null, pr.state === 'CLOSED', code)
  }
  assert.deepEqual(h.merges, [])
  assert.equal(h.row().branchPrMergedAt, null)
  assert.equal(h.notes().length, 1, 'la seule note : celle de la fermeture')
  assert.deepEqual(h.invalidated, [])
})

test('une carte sans PR finale est refusée sans interroger la forge', async (t) => {
  const h = await harness(t)
  const res = await h.merge('child')
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().error.code, 'branch_pr_missing')
  assert.deepEqual(h.reads, [])
})

test('seul le propriétaire fusionne ; une carte inconnue est introuvable', async (t) => {
  const h = await harness(t)
  h.as('guest')
  const res = await h.merge()
  assert.equal(res.statusCode, 403)
  assert.equal(res.json().error.code, 'pull_request_merge_forbidden')

  h.as('owner')
  assert.equal((await h.merge('ailleurs')).statusCode, 404)
  assert.deepEqual(h.reads, [])
  assert.deepEqual(h.merges, [])
})

test('la forge qui refuse de lire ou de fusionner rend un 502 avec son message', async (t) => {
  const h = await harness(t)
  h.failMerge('Pull request is not mergeable')
  const refused = await h.merge()
  assert.equal(refused.statusCode, 502)
  assert.equal(refused.json().error.code, 'forge_failed')
  assert.match(refused.json().error.params.error, /not mergeable/)

  h.failRead('HTTP 502')
  const unread = await h.merge()
  assert.equal(unread.statusCode, 502)
  assert.match(unread.json().error.params.error, /HTTP 502/)
  assert.equal(h.row().branchPrMergedAt, null)
  assert.deepEqual(h.invalidated, [])
})
