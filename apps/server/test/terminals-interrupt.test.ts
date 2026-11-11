import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import type { TerminalDto } from '@solera/protocol'
import { ActionRunner, createAction } from '../src/actions/actions.js'
import type { Config } from '../src/config.js'
import { hostEnvironment } from '../src/environments/host.js'
import { Environments } from '../src/environments/environments.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerTerminalRoutes } from '../src/http/routes/terminals.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { TerminalManager } from '../src/terminals/terminal-manager.js'

const host = { environment: hostEnvironment, conversationId: null }

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-terminals-interrupt-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  for (const id of ['project', 'other']) {
    db.insert(projects).values({ id, name: id, workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  }
  db.insert(conversations).values({
    id: 'agent', projectId: 'project', userId: 'owner', title: 'Session', agent: 'claude', config: '{}', status: 'running',
    createdAt: 1, updatedAt: Date.now(),
  }).run()

  const config = {
    paths: { data: join(dir, 'data'), worktrees: join(dir, 'worktrees'), agents: join(dir, 'agents') },
    limits: { ptyIdleTimeoutMin: 5 },
  } as unknown as Config
  const managers: TerminalManager[] = []
  const manager = () => {
    const created = new TerminalManager(config)
    managers.push(created)
    return created
  }
  t.after(async () => { for (const created of managers) await created.shutdown() })
  const terminals = manager()

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerTerminalRoutes(app, { db, config }, {} as SessionManager, terminals)
  t.after(() => app.close())

  const interrupt = (terminalId: string, projectId = 'project') =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}/terminals/${terminalId}/interrupt` })

  return { db, dir, config, terminals, manager, app, interrupt }
}

/** Attend que le terminal ait fini, et rend son dernier état. */
async function finished(terminals: TerminalManager, projectId: string, terminalId: string): Promise<TerminalDto> {
  const deadline = Date.now() + 5000
  for (;;) {
    const found = terminals.list(projectId).find((terminal) => terminal.id === terminalId)
    assert.ok(found, 'the terminal is still listed')
    if (!found.alive || Date.now() > deadline) return found
    await new Promise((done) => setTimeout(done, 25))
  }
}

test('a finished command knows when it ended, and still does after a restart', async (t) => {
  const { dir, terminals, manager } = await harness(t)

  const opened = terminals.open('project', dir, host, { command: 'exit 3', title: 'Exit', actionId: 'action' })
  assert.equal(opened.finishedAt, null)

  const done = await finished(terminals, 'project', opened.id)
  assert.equal(done.alive, false)
  assert.equal(done.exitCode, 3)
  assert.equal(typeof done.finishedAt, 'number')
  assert.ok(done.finishedAt! >= done.createdAt)

  // Un arrêt du daemon après la fin ne transforme pas une commande finie en commande
  // interrompue : sa fin, son code et son état sont relus tels quels.
  await terminals.shutdown()
  const restored = manager().list('project').find((terminal) => terminal.id === opened.id)
  assert.ok(restored)
  assert.equal(restored.finishedAt, done.finishedAt)
  assert.equal(restored.exitCode, 3)
  assert.equal(restored.interrupted, false)
})

test('a command cut by a restart comes back interrupted, with no end date', async (t) => {
  const { dir, terminals, manager } = await harness(t)

  const opened = terminals.open('project', dir, host, { command: 'sleep 30', title: 'Sleep', actionId: 'action' })
  await terminals.shutdown()
  // La sortie du process tué par l'arrêt arrive après : elle ne doit rien réécrire.
  await new Promise((done) => setTimeout(done, 200))

  const restored = manager().list('project').find((terminal) => terminal.id === opened.id)
  assert.ok(restored)
  assert.equal(restored.interrupted, true)
  assert.equal(restored.finishedAt, null)
})

test('a terminal closed while running does not come back once its process ends', async (t) => {
  const { dir, terminals, manager } = await harness(t)

  const opened = terminals.open('project', dir, host, { command: 'sleep 30', title: 'Sleep', actionId: 'action' })
  terminals.close(opened.id)
  await new Promise((done) => setTimeout(done, 200))
  await terminals.shutdown()

  assert.deepEqual(manager().list('project'), [])
})

test('interrupt sends Ctrl-C: the command stops, its terminal and screen stay', async (t) => {
  const { dir, terminals, interrupt } = await harness(t)

  const opened = terminals.open('project', dir, host, { command: 'sleep 30', title: 'Sleep', actionId: 'action' })
  // Laisse au shell le temps de lancer `sleep` avant de l'interrompre.
  await new Promise((done) => setTimeout(done, 300))

  const response = await interrupt(opened.id)
  assert.equal(response.statusCode, 204, response.body)

  const done = await finished(terminals, 'project', opened.id)
  assert.equal(done.alive, false)
  assert.equal(done.exitCode, 130)
  assert.equal(typeof done.finishedAt, 'number')

  const screen = terminals.attach('project', opened.id, { onOutput: () => {}, onExit: () => {} })
  screen.detach()
  assert.match(screen.replay, /\$ sleep 30/)
})

test('interrupt refuses a finished terminal, and one from another project', async (t) => {
  const { dir, terminals, interrupt } = await harness(t)

  const opened = terminals.open('project', dir, host, { command: 'exit 0', title: 'Exit', actionId: 'action' })
  await finished(terminals, 'project', opened.id)

  const late = await interrupt(opened.id)
  assert.equal(late.statusCode, 409)
  assert.equal(late.json<{ error: { code: string } }>().error.code, 'terminal_finished')

  assert.equal((await interrupt(opened.id, 'other')).statusCode, 404)
  assert.equal((await interrupt('missing')).statusCode, 404)
})

test('running again recycles the finished terminal of the same place only', async (t) => {
  const { db, dir, config, terminals } = await harness(t)
  const previousShell = process.env.SHELL
  process.env.SHELL = '/bin/sh'
  t.after(() => { process.env.SHELL = previousShell })
  const runner = new ActionRunner(db, config, terminals, new Environments(db))

  const row = createAction(db, 'project', { label: 'Quick', kind: 'task', command: 'exit 0', subdir: null }, null)
  const atRoot = await runner.run(row, dir, null)
  await finished(terminals, 'project', atRoot.terminal!.id)
  const inSession = await runner.run(row, dir, 'agent')
  await finished(terminals, 'project', inSession.terminal!.id)

  // La fin d'une exécution lancée depuis la session ne remplace pas celle de la racine.
  assert.deepEqual(
    terminals.list('project').map((terminal) => terminal.id).sort(),
    [atRoot.terminal!.id, inSession.terminal!.id].sort(),
  )

  // Relancer depuis la racine prend la place de son terminal fini : le nombre ne monte pas.
  const again = await runner.run(row, dir, null)
  const ids = terminals.list('project').map((terminal) => terminal.id)
  assert.equal(ids.length, 2)
  assert.ok(ids.includes(again.terminal!.id))
  assert.ok(ids.includes(inSession.terminal!.id))
  assert.ok(!ids.includes(atRoot.terminal!.id))
})
