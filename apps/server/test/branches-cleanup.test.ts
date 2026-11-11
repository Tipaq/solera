import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import type { BranchCleanupResultDto } from '@solera/protocol'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerGitActionRoutes } from '../src/http/routes/git-actions.js'
import type { MergedPullRequest } from '../src/worktrees/landed.js'
import { WorktreeStatusService } from '../src/worktrees/status-service.js'

/**
 * Supprimer en lot les branches fusionnées (S8, #170) : le serveur rejuge « fusionnée »
 * lui-même, comme la liste des branches le fait, et refuse en le disant la base, une
 * branche sortie dans un arbre, une branche au travail non fusionné ou inconnue. La
 * suppression passe par le verrou des écritures git et s'annule d'un geste.
 *
 * Un dépôt temporaire, sans remote : aucune vraie branche n'est jamais touchée.
 */

const isolation = mkdtempSync(join(tmpdir(), 'solera-branches-isolation-'))
writeFileSync(join(isolation, 'gitconfig'), '')
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_GLOBAL = join(isolation, 'gitconfig')
for (const name of ['EMAIL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
  delete process.env[name]
}
after(() => rmSync(isolation, { recursive: true, force: true }))

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function commit(cwd: string, file: string, content: string, message: string): string {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

const branches = (repo: string) => git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/').split('\n').sort()

/**
 * Un dépôt sur `main` et, autour :
 * - `ancetre`, ancêtre de main (fusionnée par fast-forward) ;
 * - `squashee`, son contenu squashé dans main ;
 * - `via-pr`, squashée par une PR puis main a réécrit le même fichier : seul le contenu
 *   ne la dirait pas fusionnée, la PR fusionnée sur la forge le dit ;
 * - `en-cours`, du travail que main n'a pas ;
 * - `feat/extraite`, fusionnée elle aussi, mais sortie dans un arbre.
 */
function repository(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'solera-branches-cleanup-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Branches test')
  git(repo, 'config', 'user.email', 'branches@example.test')
  commit(repo, 'README.md', 'base\n', 'root')

  git(repo, 'branch', 'ancetre')
  git(repo, 'worktree', 'add', '-b', 'feat/extraite', join(dir, 'extraite'), 'main')

  git(repo, 'switch', '-q', '-c', 'squashee')
  commit(repo, 'b.ts', 'b\n', 'b')
  git(repo, 'switch', '-q', 'main')
  commit(repo, 'b.ts', 'b\n', 'b squash')

  git(repo, 'switch', '-q', '-c', 'via-pr')
  const viaPr = commit(repo, 'c.ts', 'c\n', 'c')
  git(repo, 'switch', '-q', 'main')
  commit(repo, 'c.ts', 'c\n', 'c squash (#7)')
  commit(repo, 'c.ts', 'c réécrit\n', 'c réécrit')

  git(repo, 'switch', '-q', '-c', 'en-cours')
  commit(repo, 'd.ts', 'd\n', 'd')
  git(repo, 'switch', '-q', 'main')

  return { dir, repo, viaPr }
}

async function harness(t: TestContext) {
  const { dir, repo, viaPr } = repository(t)
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'guest']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects).values({ id: 'project', name: 'Demo', workspacePath: repo, ownerId: 'owner', visibility: 'shared', createdAt: 1 }).run()

  const merged: MergedPullRequest[] = [{ number: 7, branch: 'via-pr', base: 'main', head: viaPr, mergedAt: 1 }]
  const status = new WorktreeStatusService(db, new EventLog(db), async () => merged)

  let userId = 'owner'
  const app = Fastify()
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, userId)).get()
  })
  registerGitActionRoutes(app, { db, config: { paths: { data: dir, database: join(dir, 'test.sqlite') } } } as never, status)
  t.after(() => app.close())

  const clean = (names: string[]) =>
    app.inject({ method: 'POST', url: '/api/projects/project/branches/cleanup', payload: { names } })
  return { app, db, repo, status, clean, as: (id: string) => (userId = id) }
}

test('les fusionnées partent, par le contenu comme par une PR squash ; les autres sont refusées une à une, avec leur raison', async (t) => {
  const { repo, clean } = await harness(t)
  const res = await clean(['ancetre', 'squashee', 'via-pr', 'en-cours', 'main', 'feat/extraite', 'inconnue'])
  assert.equal(res.statusCode, 200, res.body)
  const body = res.json<BranchCleanupResultDto>()
  assert.deepEqual(body.deleted, ['ancetre', 'squashee', 'via-pr'])
  assert.deepEqual(body.refused, [
    { name: 'en-cours', reason: 'not_merged' },
    { name: 'main', reason: 'base' },
    { name: 'feat/extraite', reason: 'checked_out' },
    { name: 'inconnue', reason: 'not_found' },
  ])
  assert.deepEqual(branches(repo), ['en-cours', 'feat/extraite', 'main'])
})

test("la suppression s'annule d'un geste, comme un geste de l'onglet Git", async (t) => {
  const { app, repo, clean } = await harness(t)
  const before = Object.fromEntries(['ancetre', 'squashee'].map((name) => [name, git(repo, 'rev-parse', name)]))
  assert.equal((await clean(['ancetre', 'squashee'])).statusCode, 200)

  const state = await app.inject({ method: 'GET', url: '/api/projects/project/git/state' })
  assert.deepEqual(
    { kind: state.json().undo.kind, subject: state.json().undo.subject },
    { kind: 'branches-delete', subject: 'ancetre, squashee' },
  )

  const undo = await app.inject({ method: 'POST', url: '/api/projects/project/git/undo' })
  assert.equal(undo.statusCode, 200, undo.body)
  assert.equal(git(repo, 'rev-parse', 'ancetre'), before.ancetre)
  assert.equal(git(repo, 'rev-parse', 'squashee'), before.squashee)

  // Une seule branche : la phrase du singulier.
  assert.equal((await clean(['ancetre'])).statusCode, 200)
  const single = await app.inject({ method: 'GET', url: '/api/projects/project/git/state' })
  assert.deepEqual(
    { kind: single.json().undo.kind, subject: single.json().undo.subject },
    { kind: 'branch-delete', subject: 'ancetre' },
  )
})

test("rien à supprimer : rien n'est touché, le journal d'annulation non plus", async (t) => {
  const { app, repo, clean } = await harness(t)
  const res = await clean(['en-cours', 'main'])
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json<BranchCleanupResultDto>().deleted, [])
  assert.equal(res.json<BranchCleanupResultDto>().refused.length, 2)
  assert.equal((await app.inject({ method: 'GET', url: '/api/projects/project/git/state' })).json().undo, null)
  assert.equal(branches(repo).length, 6)
})

test("la liste des arbres est oubliée : la branche supprimée n'y reparaît pas", async (t) => {
  const { db, status, clean } = await harness(t)
  const project = db.select().from(projects).get()!
  assert.ok((await status.current(project)).branches.some((branch) => branch.name === 'ancetre'))
  assert.equal((await clean(['ancetre'])).statusCode, 200)
  const list = await status.get(project)
  assert.equal(list.fresh, true)
  assert.ok(!list.branches.some((branch) => branch.name === 'ancetre'))
})

test('seul le propriétaire supprime ; un agent au travail à la racine ferme la route ; un corps vide est refusé', async (t) => {
  const { db, repo, clean, as } = await harness(t)
  as('guest')
  const forbidden = await clean(['ancetre'])
  assert.equal(forbidden.statusCode, 403)
  assert.equal(forbidden.json().error.code, 'branch_delete_forbidden')

  as('owner')
  assert.equal((await clean([])).statusCode, 400)

  db.insert(conversations).values({
    id: 'thread', projectId: 'project', userId: 'owner', title: 'Un agent au travail',
    agent: 'claude', config: '{}', status: 'running', createdAt: 1, updatedAt: 2,
  }).run()
  const locked = await clean(['ancetre'])
  assert.equal(locked.statusCode, 409)
  assert.equal(locked.json().error.code, 'turn_running')
  assert.ok(branches(repo).includes('ancetre'), 'rien n’a été supprimé')
})
