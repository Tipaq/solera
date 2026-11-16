import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users, worktrees } from '@solera/db'
import type { CommitDetailDto, CompareDto, FileContentDto, GitStateDto, GraphDto } from '@solera/protocol'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerFileRoutes } from '../src/http/routes/files.js'
import { registerGitActionRoutes } from '../src/http/routes/git-actions.js'
import { registerGitViewRoutes } from '../src/http/routes/git-views.js'
import { WorktreeStatusService } from '../src/worktrees/status-service.js'

/**
 * La portée « worktree » du panneau (S5) et le diff d'une branche avec la base (S6),
 * carte #169.
 *
 * Un arbre sans session n'a pas de conversation par laquelle ouvrir le panneau : la
 * portée `/api/worktrees/:id` lit et écrit dans son dossier, avec le contrôle d'accès de
 * son projet. Le diff avec la base, lui, se lit sur le dépôt du projet, sans arbre.
 *
 * Un dépôt temporaire, sans remote : aucune vraie branche n'est jamais touchée.
 */

const isolation = mkdtempSync(join(tmpdir(), 'solera-worktree-scope-isolation-'))
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

/**
 * Un dépôt sur `main`, et un arbre `feat/x` sorti de lui : l'arbre a un commit que main
 * n'a pas (`feat.ts`), et main un commit venu après la fourche (`main.ts`).
 */
async function harness(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'solera-worktree-scope-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Scope test')
  git(repo, 'config', 'user.email', 'scope@example.test')
  commit(repo, 'README.md', 'base\n', 'root')

  const tree = join(dir, 'arbre')
  git(repo, 'worktree', 'add', '-b', 'feat/x', tree, 'main')
  const feat = commit(tree, 'feat.ts', 'export const feat = 1\n', 'feat')
  commit(repo, 'main.ts', 'export const main = 1\n', 'main avance')

  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'guest']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects).values({ id: 'project', name: 'Demo', workspacePath: repo, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  db.insert(worktrees).values({ id: 'wt', projectId: 'project', name: 'arbre', path: tree, baseRef: 'main', createdBy: 'owner', createdAt: 1 }).run()

  const status = new WorktreeStatusService(db, new EventLog(db), async () => [])

  let userId = 'owner'
  const app = Fastify()
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, userId)).get()
  })
  const ctx = { db, config: { paths: { data: dir, database: join(dir, 'test.sqlite') } } } as never
  registerGitViewRoutes(app, ctx)
  registerGitActionRoutes(app, ctx, status)
  registerFileRoutes(app, ctx)
  t.after(() => app.close())

  return { app, db, dir, repo, tree, feat, as: (id: string) => (userId = id) }
}

test('S5 — l’état git et le graphe d’un arbre se lisent dans son dossier, pas à la racine', async (t) => {
  const { app } = await harness(t)

  const state = await app.inject({ method: 'GET', url: '/api/worktrees/wt/git/state' })
  assert.equal(state.statusCode, 200, state.body)
  assert.equal(state.json<GitStateDto>().branch, 'feat/x')
  // Aucun fil : pas de co-auteur à proposer, comme en portée projet.
  assert.equal(state.json<GitStateDto>().coAuthor, null)

  const graph = await app.inject({ method: 'GET', url: '/api/worktrees/wt/graph' })
  assert.equal(graph.statusCode, 200, graph.body)
  assert.equal(graph.json<GraphDto>().branch, 'feat/x')
})

test('S5 — le détail d’un commit et les fichiers passent par la même portée', async (t) => {
  const { app, feat } = await harness(t)

  const detail = await app.inject({ method: 'GET', url: `/api/worktrees/wt/commits/${feat}/detail` })
  assert.equal(detail.statusCode, 200, detail.body)
  assert.deepEqual(detail.json<CommitDetailDto>().files.map((file) => file.path), ['feat.ts'])

  // `feat.ts` n'existe que dans l'arbre : le lire prouve qu'on n'est pas à la racine.
  const file = await app.inject({ method: 'GET', url: '/api/worktrees/wt/file?path=feat.ts' })
  assert.equal(file.statusCode, 200, file.body)
  assert.match(file.json<FileContentDto>().content, /feat = 1/)
})

test('S5 — « Rebaser » d’un arbre sans session rejoue sa branche sur la base, et laisse la racine en place', async (t) => {
  const { app, repo, tree } = await harness(t)
  const rootHead = git(repo, 'rev-parse', 'HEAD')

  const res = await app.inject({ method: 'POST', url: '/api/worktrees/wt/git/act', payload: { kind: 'branch-rebase', name: 'main' } })
  assert.equal(res.statusCode, 200, res.body)

  assert.equal(git(tree, 'rev-parse', '--abbrev-ref', 'HEAD'), 'feat/x')
  git(tree, 'merge-base', '--is-ancestor', 'main', 'HEAD')
  assert.equal(git(tree, 'rev-list', '--count', 'main..HEAD'), '1')
  assert.equal(git(repo, 'rev-parse', 'HEAD'), rootHead)
  assert.equal(git(repo, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main')
})

test('S5 — un agent au travail dans l’arbre en garde les écritures', async (t) => {
  const { app, db } = await harness(t)
  db.insert(conversations).values({
    id: 'thread', projectId: 'project', worktreeId: 'wt', userId: 'owner', title: 'Un agent dans l’arbre',
    agent: 'claude', config: '{}', status: 'running', createdAt: 1, updatedAt: 2,
  }).run()

  const res = await app.inject({ method: 'POST', url: '/api/worktrees/wt/git/act', payload: { kind: 'branch-rebase', name: 'main' } })
  assert.equal(res.statusCode, 409, res.body)
  assert.equal(res.json<{ error: { code: string } }>().error.code, 'turn_running')
})

test('S5 — hors de son projet, un arbre est introuvable ; un arbre retiré ou disparu est refusé', async (t) => {
  const { app, db, tree, as } = await harness(t)

  as('guest')
  for (const url of ['/api/worktrees/wt/git/state', '/api/worktrees/wt/graph']) {
    const res = await app.inject({ method: 'GET', url })
    assert.equal(res.statusCode, 404, `${url} ${res.body}`)
    assert.equal(res.json<{ error: { code: string } }>().error.code, 'worktree_not_found')
  }
  const act = await app.inject({ method: 'POST', url: '/api/worktrees/wt/git/act', payload: { kind: 'branch-rebase', name: 'main' } })
  assert.equal(act.statusCode, 404, act.body)

  as('owner')
  const unknown = await app.inject({ method: 'GET', url: '/api/worktrees/inconnu/git/state' })
  assert.equal(unknown.statusCode, 404, unknown.body)

  // Le dossier part par git, sans que la ligne le sache : la portée le constate et le marque.
  rmSync(tree, { recursive: true, force: true })
  const gone = await app.inject({ method: 'GET', url: '/api/worktrees/wt/git/state' })
  assert.equal(gone.statusCode, 409, gone.body)
  assert.equal(gone.json<{ error: { code: string } }>().error.code, 'working_directory_missing')
  assert.notEqual(db.select().from(worktrees).where(eq(worktrees.id, 'wt')).get()?.removedAt, null)

  const removed = await app.inject({ method: 'GET', url: '/api/worktrees/wt/graph' })
  assert.equal(removed.statusCode, 409, removed.body)
})

test('S6 — le diff d’une branche avec la base ne montre que ce que la branche apporte', async (t) => {
  const { app } = await harness(t)

  const res = await app.inject({ method: 'GET', url: '/api/projects/project/compare?base=main&head=feat/x' })
  assert.equal(res.statusCode, 200, res.body)
  const body = res.json<CompareDto>()
  // `main.ts`, venu sur main après la fourche, n'est pas un apport de la branche.
  assert.deepEqual(body.files, [{ path: 'feat.ts', added: 1, removed: 0 }])
  assert.match(body.patch, /\+export const feat = 1/)
  assert.doesNotMatch(body.patch, /main\.ts/)
  assert.equal(body.truncated, false)
  assert.equal(body.ahead, 1)
  assert.equal(body.behind, 1)
})

test('S6 — une référence inconnue ou qui ressemble à une option est refusée ; hors du projet, introuvable', async (t) => {
  const { app, as } = await harness(t)

  for (const query of ['base=main&head=inconnue', 'base=--all&head=feat/x', 'base=main', 'head=feat/x']) {
    const res = await app.inject({ method: 'GET', url: `/api/projects/project/compare?${query}` })
    assert.equal(res.statusCode, 400, `${query} ${res.body}`)
  }

  as('guest')
  const hidden = await app.inject({ method: 'GET', url: '/api/projects/project/compare?base=main&head=feat/x' })
  assert.equal(hidden.statusCode, 404, hidden.body)
})
