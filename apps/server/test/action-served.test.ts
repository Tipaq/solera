import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { openDatabase, projects, runMigrations, users, worktrees } from '@solera/db'
import type { ProjectActionDto, ProjectActionRunResult } from '@solera/protocol'
import { ActionRunner, createAction } from '../src/actions/actions.js'
import { treeOf } from '../src/actions/served.js'
import type { ServiceUnits, ServiceUnitState } from '../src/services/apps.js'
import type { Config } from '../src/config.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { TerminalManager } from '../src/terminals/terminal-manager.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerActionRoutes } from '../src/http/routes/actions.js'
import { Environments } from '../src/environments/environments.js'

/**
 * « Ce qu'il sert » (AC-05) : la version qu'un service sert, le refus de rendre en
 * silence celui qui tourne depuis un autre arbre, et l'endroit où il tourne.
 *
 * systemd est simulé : un service n'y est qu'une entrée (unité, état, dossier). Git est
 * réel, dans un dépôt jetable : c'est ce qu'on lit dans le dossier de l'unité.
 */

const isolation = mkdtempSync(join(tmpdir(), 'solera-served-isolation-'))
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

function commit(cwd: string, file: string, content: string, message: string): void {
  writeFileSync(join(cwd, file), content)
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', message)
}

/** Les unités d'un systemd simulé, et ce qu'on lui a demandé, dans l'ordre. */
function fakeUnits() {
  const units = new Map<string, ServiceUnitState>()
  const calls: string[] = []
  const impl: ServiceUnits = {
    available: async () => true,
    scan: async () => [...units.values()],
    start: async (launch) => {
      calls.push(`start ${launch.cwd}`)
      units.set(launch.unit, { unit: launch.unit, state: 'active', cwd: launch.cwd, ports: [5173], startedAt: 1000 })
    },
    stop: async (unit) => {
      calls.push('stop')
      units.delete(unit)
    },
    control: async (unit, op) => {
      calls.push(op)
      if (op === 'stop') units.delete(unit)
    },
  }
  return { units, calls, impl }
}

/**
 * Un projet dont la racine est un dépôt sur `main`, et un worktree Solera sur
 * `feat/vue` : un commit d'avance, et la racine en a pris un depuis.
 */
async function harness(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'solera-served-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const root = join(dir, 'repo')
  const tree = join(dir, 'vue')
  mkdirSync(root)
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.name', 'Served test')
  git(root, 'config', 'user.email', 'served@example.test')
  commit(root, 'README.md', 'base\n', 'base')
  git(root, 'branch', 'feat/libre')
  git(root, 'worktree', 'add', '-q', '-b', 'feat/vue', tree, 'main')
  commit(tree, 'vue.ts', 'vue\n', 'vue')
  commit(root, 'main.ts', 'main\n', 'main avance')
  mkdirSync(join(tree, 'web'))
  mkdirSync(join(root, 'web'))

  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: root, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  db.insert(worktrees).values({ id: 'wt', projectId: 'project', name: 'feat/vue', path: tree, baseRef: 'main', createdBy: 'owner', createdAt: 1 }).run()

  const config = {
    paths: { data: join(dir, 'data'), worktrees: join(dir, 'worktrees'), agents: join(dir, 'agents') },
    limits: { ptyIdleTimeoutMin: 5 },
  } as unknown as Config
  const terminals = new TerminalManager(config)
  t.after(() => terminals.shutdown())
  const systemd = fakeUnits()
  const runner = new ActionRunner(db, config, terminals, new Environments(db), systemd.impl)
  const sessions = { workingDirectory: () => root } as unknown as SessionManager

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerActionRoutes(app, { db, config } as never, sessions, runner)
  t.after(() => app.close())

  const run = (actionId: string, payload: object = {}) =>
    app.inject({ method: 'POST', url: `/api/actions/${actionId}/run`, payload })
  const listed = async (actionId: string) =>
    (await app.inject({ method: 'GET', url: '/api/actions' })).json<ProjectActionDto[]>().find((action) => action.id === actionId)!

  return { db, root, tree, systemd, app, run, listed }
}

// --- ce qu'il sert --------------------------------------------------------------

test('un service lancé à la racine sert sa branche et son commit, à jour sur la base', async (t) => {
  const { db, root, run, listed } = await harness(t)
  const row = createAction(db, 'project', { label: 'Dev', kind: 'service', command: 'pnpm dev' }, null)
  assert.equal((await run(row.id)).statusCode, 201)

  const served = (await listed(row.id)).service!.served
  assert.deepEqual(served, {
    path: root,
    worktreeId: null,
    root: true,
    branch: 'main',
    head: git(root, 'rev-parse', '--short', 'HEAD'),
    ahead: 0,
    behind: 0,
    dirtyFiles: 0,
  })
})

test('un service dans un sous-dossier d’un worktree sert ce worktree, avec son avance, son retard et ses fichiers non commités', async (t) => {
  const { db, tree, run, listed } = await harness(t)
  writeFileSync(join(tree, 'web', 'draft.ts'), 'draft\n')
  const row = createAction(db, 'project', { label: 'Web', kind: 'service', command: 'pnpm dev', subdir: 'web' }, null)
  assert.equal((await run(row.id, { worktreeId: 'wt' })).statusCode, 201)

  const service = (await listed(row.id)).service!
  assert.equal(service.cwd, join(tree, 'web'))
  assert.deepEqual(service.served, {
    path: tree,
    worktreeId: 'wt',
    root: false,
    branch: 'feat/vue',
    head: git(tree, 'rev-parse', '--short', 'HEAD'),
    ahead: 1,
    behind: 1,
    dirtyFiles: 1,
  })
})

test('un service arrêté ne sert rien', async (t) => {
  const { db, listed } = await harness(t)
  const row = createAction(db, 'project', { label: 'Dev', kind: 'service', command: 'pnpm dev' }, null)
  const service = (await listed(row.id)).service!
  assert.equal(service.state, 'inactive')
  assert.equal(service.served, null)
})

// --- le « déjà en marche » ------------------------------------------------------

test('lancer un service qui tourne depuis un autre arbre est refusé avec ce qu’il sert, au lieu de le rendre en silence', async (t) => {
  const { db, root, systemd, run } = await harness(t)
  const row = createAction(db, 'project', { label: 'Dev', kind: 'service', command: 'pnpm dev', url: 'http://host:{port}/' }, null)
  await run(row.id)

  const refused = await run(row.id, { worktreeId: 'wt' })
  assert.equal(refused.statusCode, 409)
  const { error } = refused.json<{ error: { code: string; params: Record<string, string> } }>()
  assert.equal(error.code, 'service_running_elsewhere')
  assert.equal(error.params.cwd, root)
  assert.equal(error.params.worktreeId, '')
  assert.equal(error.params.root, 'true')
  assert.equal(error.params.branch, 'main')
  assert.equal(error.params.head, git(root, 'rev-parse', '--short', 'HEAD'))
  assert.equal(error.params.ports, ':5173')
  assert.equal(error.params.href, 'http://host:5173/')
  assert.deepEqual(systemd.calls, [`start ${root}`])
})

test('le relancer depuis le même arbre rend celui qui tourne', async (t) => {
  const { db, root, systemd, run } = await harness(t)
  const row = createAction(db, 'project', { label: 'Dev', kind: 'service', command: 'pnpm dev' }, null)
  await run(row.id)

  const again = await run(row.id)
  assert.equal(again.statusCode, 200)
  assert.equal(again.json<ProjectActionRunResult>().alreadyRunning, true)
  assert.deepEqual(systemd.calls, [`start ${root}`])
})

test('switch arrête le service, puis le démarre dans le nouvel arbre', async (t) => {
  const { db, root, tree, systemd, run, listed } = await harness(t)
  const row = createAction(db, 'project', { label: 'Dev', kind: 'service', command: 'pnpm dev' }, null)
  await run(row.id)

  const switched = await run(row.id, { worktreeId: 'wt', switch: true })
  assert.equal(switched.statusCode, 201, switched.body)
  assert.equal(switched.json<ProjectActionRunResult>().service!.cwd, tree)
  assert.deepEqual(systemd.calls, [`start ${root}`, 'stop', `start ${tree}`])
  assert.equal((await listed(row.id)).service!.served!.branch, 'feat/vue')
})

// --- où il tourne ---------------------------------------------------------------

test('une nouvelle action suit l’arbre d’où on la lance', async (t) => {
  const { db, listed } = await harness(t)
  const row = createAction(db, 'project', { label: 'Dev', kind: 'service', command: 'pnpm dev' }, null)
  const action = await listed(row.id)
  assert.equal(action.placement, 'follow')
  assert.equal(action.pinnedBranch, null)
})

test('placement root : à la racine du projet, d’où qu’on le lance', async (t) => {
  const { db, root, systemd, run } = await harness(t)
  const row = createAction(db, 'project', { label: 'Dev', kind: 'service', command: 'pnpm dev', placement: 'root' }, null)
  assert.equal((await run(row.id, { worktreeId: 'wt' })).statusCode, 201)
  assert.deepEqual(systemd.calls, [`start ${root}`])
})

test('placement branch : à la racine quand elle est sur la branche, d’où qu’on le lance', async (t) => {
  const { db, root, systemd, run } = await harness(t)
  const row = createAction(db, 'project', { label: 'Main', kind: 'service', command: 'pnpm dev', subdir: 'web', placement: 'branch', pinnedBranch: 'main' }, null)
  assert.equal((await run(row.id, { worktreeId: 'wt' })).statusCode, 201)
  assert.deepEqual(systemd.calls, [`start ${join(root, 'web')}`])
})

test('placement branch refuse explicitement quand la racine n’est pas sur la branche, même sortie dans un worktree de session', async (t) => {
  const { db, systemd, run } = await harness(t)
  for (const branch of ['feat/libre', 'feat/vue']) {
    const row = createAction(db, 'project', { label: branch, kind: 'service', command: 'pnpm dev', placement: 'branch', pinnedBranch: branch }, null)
    const refused = await run(row.id, { worktreeId: 'wt' })
    assert.equal(refused.statusCode, 409)
    const { error } = refused.json<{ error: { code: string; params: Record<string, string> } }>()
    assert.equal(error.code, 'action_branch_needs_worktree')
    assert.equal(error.params.branch, branch)
  }
  assert.deepEqual(systemd.calls, [])
})

test('une tâche tourne toujours là où on la lance : son placement est follow', async (t) => {
  const { db } = await harness(t)
  const row = createAction(db, 'project', { label: 'Tests', kind: 'task', command: 'pnpm test', placement: 'root' }, null)
  assert.equal(row.placement, 'follow')
  assert.equal(row.pinnedBranch, null)
})

test('treeOf : l’arbre le plus profond, sous-dossier compris, sans confondre un voisin de même préfixe', () => {
  const trees = [
    { path: '/w/repo', worktreeId: null, root: true },
    { path: '/w/repo/.trees/vue/', worktreeId: 'wt', root: false },
  ]
  assert.equal(treeOf('/w/repo', trees)?.root, true)
  assert.equal(treeOf('/w/repo/apps/web/', trees)?.root, true)
  assert.equal(treeOf('/w/repo/.trees/vue/web', trees)?.worktreeId, 'wt')
  assert.equal(treeOf('/w/repo/.trees/vue', trees)?.worktreeId, 'wt')
  assert.equal(treeOf('/w/repo-old', trees), null)
})

test('le placement s’enregistre et se relit, et une branche fixée ne va qu’avec branch', async (t) => {
  const { app, listed } = await harness(t)
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects/project/actions',
    payload: { label: 'Vue', kind: 'service', command: 'pnpm dev', placement: 'branch', pinnedBranch: 'feat/vue' },
  })
  assert.equal(created.statusCode, 201, created.body)
  const id = created.json<ProjectActionDto>().id
  assert.equal((await listed(id)).pinnedBranch, 'feat/vue')

  const followed = await app.inject({ method: 'PATCH', url: `/api/actions/${id}`, payload: { placement: 'follow' } })
  assert.equal(followed.statusCode, 200, followed.body)
  assert.equal(followed.json<ProjectActionDto>().placement, 'follow')
  // Une branche fixée n'a plus de sens hors de `branch` : elle est oubliée.
  assert.equal(followed.json<ProjectActionDto>().pinnedBranch, null)

  const noBranch = await app.inject({ method: 'PATCH', url: `/api/actions/${id}`, payload: { placement: 'branch' } })
  assert.equal(noBranch.statusCode, 400)
  assert.equal(noBranch.json<{ error: { code: string } }>().error.code, 'action_branch_required')
})

test('une instance par worktree est refusée tant qu’elle n’existe pas', async (t) => {
  const { db, app } = await harness(t)
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects/project/actions',
    payload: { label: 'Dev', kind: 'service', command: 'pnpm dev', placement: 'per-worktree' },
  })
  assert.equal(created.statusCode, 400)
  assert.equal(created.json<{ error: { code: string } }>().error.code, 'action_placement_unsupported')

  const row = createAction(db, 'project', { label: 'Dev', kind: 'service', command: 'pnpm dev' }, null)
  const patched = await app.inject({ method: 'PATCH', url: `/api/actions/${row.id}`, payload: { placement: 'per-worktree' } })
  assert.equal(patched.statusCode, 400)
  assert.equal(patched.json<{ error: { code: string } }>().error.code, 'action_placement_unsupported')
})
