import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { actionRuns, conversations, openDatabase, projectActions, projects, runMigrations, users } from '@solera/db'
import {
  createProjectActionBodySchema,
  updateProjectActionBodySchema,
  type ActionRunDetailDto,
  type ProjectActionDto,
  type ScheduleCadence,
} from '@solera/protocol'
import { ActionRunner, approveAction, createAction, loadAction, rejectAction, updateAction } from '../src/actions/actions.js'
import { CommandScheduler, runDetached, type DetachedCommand, type DetachedResult } from '../src/actions/scheduled.js'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { Environments } from '../src/environments/environments.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerActionRoutes } from '../src/http/routes/actions.js'
import type { OutgoingNotification } from '../src/notifications/dispatcher.js'
import { TaskScheduler } from '../src/scheduler/task-scheduler.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { TerminalManager } from '../src/terminals/terminal-manager.js'

/**
 * Commandes planifiées (AC-03) : le Quand d'une commande. Une commande `task` porte une
 * cadence ; le balayage des tâches planifiées la tire, détachée de tout terminal, et
 * écrit son passage `schedule`.
 */

const MINUTE = 60_000
const HOURLY: ScheduleCadence = { kind: 'interval', minutes: 60 }

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-scheduled-commands-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  db.insert(conversations).values({
    id: 'agent', projectId: 'project', userId: 'owner', title: 'Session', agent: 'claude', config: '{}', status: 'running',
    createdAt: 1, updatedAt: Date.now(),
  }).run()

  const config = {
    paths: { data: join(dir, 'data'), worktrees: join(dir, 'worktrees'), agents: join(dir, 'agents') },
    limits: { ptyIdleTimeoutMin: 5 },
    server: { publicUrl: 'https://solera.example/' },
  } as unknown as Config
  const terminals = new TerminalManager(config)
  t.after(() => terminals.shutdown())
  const environments = new Environments(db)
  const runner = new ActionRunner(db, config, terminals, environments)
  const sessions = { workingDirectory: () => dir } as unknown as SessionManager
  const requests = new AgentRequests({ db, config }, sessions, {} as AgentRegistry, {} as EventLog, undefined, undefined, runner)

  // La doublure de l'exécution détachée : elle note ce qu'on lui demande et répond ce
  // que le test a prévu, sans lancer de processus.
  const executed: DetachedCommand[] = []
  let answer: (command: DetachedCommand) => DetachedResult = () => ({ exitCode: 0, timedOut: false, output: 'ok\n' })
  const notified: { userId: string; notification: OutgoingNotification }[] = []
  const commands = new CommandScheduler(db, config, environments, {
    execute: async (command) => {
      executed.push(command)
      return answer(command)
    },
    notifications: { dispatch: async (userId, notification) => void notified.push({ userId, notification }) },
  })

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerActionRoutes(app, { db, config } as never, sessions, runner)
  t.after(() => app.close())

  const mcp = async (name: string, args: object) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: 'project', SOLERA_MCP_CONVERSATION: 'agent' },
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) + '\n')
    const deadline = Date.now() + 10000
    while (!stdout.includes('\n') && Date.now() < deadline) {
      await requests.sweep()
      await new Promise((done) => setTimeout(done, 50))
    }
    child.kill()
    return JSON.parse(stdout).result as { content: { text: string }[]; isError?: boolean }
  }

  /** Une commande planifiée écrite dans l'interface, donc relue. */
  const scheduled = (overrides: Partial<Parameters<typeof createAction>[2]> = {}, agent: string | null = null) =>
    createAction(db, 'project', { label: 'Purge', kind: 'task', command: 'scripts/purge.sh', schedule: { cadence: HOURLY }, onDemand: false, ...overrides }, agent)

  /** Un balayage, puis la fin des exécutions qu'il a lancées. */
  const sweep = async (now: number) => {
    await commands.tick(now)
    await commands.idle()
  }

  const runsOf = (actionId: string) => db.select().from(actionRuns).where(eq(actionRuns.actionId, actionId)).all()

  return {
    db, dir, config, app, mcp, commands, executed, notified, scheduled, sweep, runsOf, environments,
    answer: (next: typeof answer) => { answer = next },
  }
}

// --- le protocole ---------------------------------------------------------------

test('a command is on demand, scheduled, or both, never neither', () => {
  const base = { label: 'Purge', kind: 'task' as const, command: 'scripts/purge.sh' }
  assert.equal(createProjectActionBodySchema.safeParse(base).success, true)
  assert.equal(createProjectActionBodySchema.safeParse({ ...base, schedule: { cadence: HOURLY }, onDemand: false }).success, true)
  assert.equal(createProjectActionBodySchema.safeParse({ ...base, schedule: { cadence: HOURLY } }).success, true)
  assert.equal(createProjectActionBodySchema.safeParse({ ...base, onDemand: false }).success, false)
  // Un service planifié (démarrer, arrêter à heure fixe) est un autre chantier.
  assert.equal(createProjectActionBodySchema.safeParse({ ...base, kind: 'service', schedule: { cadence: HOURLY } }).success, false)
  // La pause n'envoie que `enabled`.
  assert.equal(updateProjectActionBodySchema.safeParse({ schedule: { enabled: false } }).success, true)
  assert.equal(updateProjectActionBodySchema.safeParse({ schedule: null }).success, true)
})

// --- l'écriture, par l'interface ------------------------------------------------

test('creating a scheduled command arms its next run, and the list shows when', async (t) => {
  const { app } = await harness(t)
  const before = Date.now()
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects/project/actions',
    payload: { label: 'Purge', kind: 'task', command: 'scripts/purge.sh', schedule: { cadence: HOURLY }, onDemand: false },
  })
  assert.equal(created.statusCode, 201, created.body)
  const action = created.json<ProjectActionDto>()
  assert.equal(action.onDemand, false)
  assert.equal(action.schedule!.enabled, true)
  assert.deepEqual(action.schedule!.cadence, HOURLY)
  assert.ok(action.schedule!.nextRunAt! >= before + 60 * MINUTE)
  assert.equal(action.schedule!.maxDurationMinutes, 30)
  assert.deepEqual(action.approved!.cadence, HOURLY)

  const plain = await app.inject({ method: 'POST', url: '/api/projects/project/actions', payload: { label: 'Tests', kind: 'task', command: 'pnpm test' } })
  assert.equal(plain.json<ProjectActionDto>().onDemand, true)
  assert.equal(plain.json<ProjectActionDto>().schedule, null)
})

test('pausing sends only enabled: nothing is armed, and resuming arms again', async (t) => {
  const { app, scheduled } = await harness(t)
  const row = scheduled()

  const paused = await app.inject({ method: 'PATCH', url: `/api/actions/${row.id}`, payload: { schedule: { enabled: false } } })
  assert.equal(paused.statusCode, 200, paused.body)
  assert.equal(paused.json<ProjectActionDto>().schedule!.enabled, false)
  assert.equal(paused.json<ProjectActionDto>().schedule!.nextRunAt, null)
  assert.deepEqual(paused.json<ProjectActionDto>().schedule!.cadence, HOURLY)

  const resumed = await app.inject({ method: 'PATCH', url: `/api/actions/${row.id}`, payload: { schedule: { enabled: true } } })
  assert.equal(resumed.json<ProjectActionDto>().schedule!.enabled, true)
  assert.ok(resumed.json<ProjectActionDto>().schedule!.nextRunAt! > Date.now())
})

test('an edit that leaves a command neither on demand nor scheduled is refused', async (t) => {
  const { app, scheduled } = await harness(t)
  const row = scheduled()
  const refused = await app.inject({ method: 'PATCH', url: `/api/actions/${row.id}`, payload: { schedule: null } })
  assert.equal(refused.statusCode, 400)
  assert.equal(refused.json<{ error: { code: string } }>().error.code, 'action_never_runs')

  const both = await app.inject({ method: 'PATCH', url: `/api/actions/${row.id}`, payload: { schedule: null, onDemand: true } })
  assert.equal(both.statusCode, 200, both.body)
  assert.equal(both.json<ProjectActionDto>().schedule, null)
})

test('a schedule that never fires is refused, and a service cannot be scheduled by an edit either', async (t) => {
  const { app, scheduled, db } = await harness(t)
  const past = await app.inject({
    method: 'POST',
    url: '/api/projects/project/actions',
    payload: { label: 'Once', kind: 'task', command: 'true', schedule: { cadence: { kind: 'once', at: Date.now() - MINUTE } } },
  })
  assert.equal(past.statusCode, 400)
  assert.equal(past.json<{ error: { code: string } }>().error.code, 'schedule_never_fires')

  const row = scheduled()
  const service = await app.inject({ method: 'PATCH', url: `/api/actions/${row.id}`, payload: { kind: 'service' } })
  assert.equal(service.statusCode, 400)
  assert.equal(service.json<{ error: { code: string } }>().error.code, 'action_schedule_task_only')
  assert.equal(loadAction(db, row.id).kind, 'task')
})

test('a command that is not on demand cannot be clicked, nor run by an agent', async (t) => {
  const { app, mcp, scheduled, runsOf } = await harness(t)
  const row = scheduled()

  const clicked = await app.inject({ method: 'POST', url: `/api/actions/${row.id}/run`, payload: {} })
  assert.equal(clicked.statusCode, 409)
  assert.equal(clicked.json<{ error: { code: string } }>().error.code, 'action_not_on_demand')

  const ran = await mcp('run_action', { id: row.id })
  assert.equal(ran.isError, true)
  assert.match(ran.content[0]!.text, /planifiée|à la demande/)
  assert.equal(runsOf(row.id).length, 0)
})

// --- le balayage ----------------------------------------------------------------

test('a due command runs detached in the project root plus its subdirectory, with a schedule passage', async (t) => {
  const { dir, db, executed, scheduled, sweep, runsOf, answer } = await harness(t)
  await mkdir(join(dir, 'scripts'))
  const row = scheduled({ subdir: 'scripts', schedule: { cadence: HOURLY, maxDurationMinutes: 5 } })
  const due = loadAction(db, row.id).nextRunAt!

  await sweep(due - 1)
  assert.equal(executed.length, 0, 'not yet due')

  answer(() => ({ exitCode: 0, timedOut: false, output: '\x1b[32m124 fichiers supprimés\x1b[0m\n' }))
  await sweep(due)
  assert.equal(executed.length, 1)
  assert.equal(executed[0]!.command, 'scripts/purge.sh')
  assert.equal(executed[0]!.cwd, join(dir, 'scripts'))
  assert.equal(executed[0]!.timeoutMs, 5 * MINUTE)

  const [run] = runsOf(row.id)
  assert.equal(run!.trigger, 'schedule')
  assert.equal(run!.terminalId, null)
  assert.equal(run!.conversationId, null)
  assert.equal(run!.cwd, join(dir, 'scripts'))
  assert.equal(run!.status, 'succeeded')
  assert.equal(run!.exitCode, 0)
  assert.equal(run!.excerpt, '124 fichiers supprimés')
  assert.ok(run!.finishedAt)

  const after = loadAction(db, row.id)
  assert.equal(after.lastScheduledAt, due)
  assert.equal(after.nextRunAt, due + 60 * MINUTE)
})

test('a failing command is a failed passage, and running past its limit is a failure too', async (t) => {
  const { db, scheduled, sweep, runsOf, answer } = await harness(t)
  const row = scheduled()
  const due = loadAction(db, row.id).nextRunAt!

  answer(() => ({ exitCode: 2, timedOut: false, output: "find: 'logs/archive': No such file or directory\n" }))
  await sweep(due)
  answer(() => ({ exitCode: null, timedOut: true, output: 'still going\n' }))
  await sweep(due + 60 * MINUTE)

  const [timedOut, failed] = runsOf(row.id).sort((a, b) => b.startedAt - a.startedAt)
  assert.equal(failed!.status, 'failed')
  assert.equal(failed!.exitCode, 2)
  assert.match(failed!.excerpt!, /No such file/)
  assert.equal(timedOut!.status, 'failed')
  assert.equal(timedOut!.exitCode, null)
  assert.equal(timedOut!.excerpt, 'still going')
})

test('paused, proposed, or archived: nothing runs', async (t) => {
  const { db, executed, scheduled, sweep, app } = await harness(t)
  const paused = scheduled({ label: 'Paused' })
  const due = loadAction(db, paused.id).nextRunAt!
  await app.inject({ method: 'PATCH', url: `/api/actions/${paused.id}`, payload: { schedule: { enabled: false } } })
  // Écrite par un agent : elle partirait sans clic, donc pas avant d'avoir été relue.
  const proposed = scheduled({ label: 'Proposed' }, 'agent')
  db.update(projectActions).set({ nextRunAt: due }).where(eq(projectActions.id, proposed.id)).run()

  await sweep(due)
  assert.deepEqual(executed, [])
  // Pas d'arriéré à la validation : le tir manqué est passé, le suivant est armé.
  assert.ok(loadAction(db, proposed.id).nextRunAt! > due)

  approveAction(db, loadAction(db, proposed.id))
  db.update(projects).set({ archivedAt: Date.now() }).where(eq(projects.id, 'project')).run()
  await sweep(due + 2 * 60 * MINUTE)
  assert.deepEqual(executed, [])
})

test('missed runs are not caught up one by one: one run, then the next from now', async (t) => {
  const { db, executed, scheduled, sweep } = await harness(t)
  const row = scheduled()
  const due = loadAction(db, row.id).nextRunAt!
  const late = due + 5 * 60 * MINUTE + 7 * MINUTE

  await sweep(late)
  assert.equal(executed.length, 1)
  assert.equal(loadAction(db, row.id).nextRunAt, late + 60 * MINUTE)
})

test('a run still going is not doubled: the due run is skipped and the next one armed', async (t) => {
  const { db, executed, scheduled, commands } = await harness(t)
  const row = scheduled()
  const due = loadAction(db, row.id).nextRunAt!
  let release!: () => void
  const blocked = new Promise<void>((done) => { release = done })
  ;(commands as unknown as { execute: (command: DetachedCommand) => Promise<DetachedResult> }).execute = async (command) => {
    executed.push(command)
    await blocked
    return { exitCode: 0, timedOut: false, output: '' }
  }

  await commands.tick(due)
  for (let i = 0; i < 100 && executed.length === 0; i++) await new Promise((done) => setTimeout(done, 10))
  await commands.tick(due + 60 * MINUTE)
  assert.equal(executed.length, 1)
  assert.equal(loadAction(db, row.id).nextRunAt, due + 2 * 60 * MINUTE)
  release()
  await commands.idle()
})

test('a one-off command runs once, then pauses', async (t) => {
  const { db, executed, scheduled, sweep } = await harness(t)
  const at = Date.now() + 10 * MINUTE
  const row = scheduled({ schedule: { cadence: { kind: 'once', at } } })
  await sweep(at)
  await sweep(at + 60 * MINUTE)
  assert.equal(executed.length, 1)
  const after = loadAction(db, row.id)
  assert.equal(after.scheduleEnabled, false)
  assert.equal(after.nextRunAt, null)
})

test('the task sweep carries the commands: same pass', async (t) => {
  const { db, config, executed, scheduled, commands } = await harness(t)
  const row = scheduled()
  const due = loadAction(db, row.id).nextRunAt!
  const sessions = { statusBus: new EventEmitter(), environments: new Environments(db) } as unknown as SessionManager
  const tasks = new TaskScheduler({ db, config }, sessions, {} as AgentRegistry, new EventLog(db))
  tasks.setCommands(commands)

  await tasks.tick(due)
  await commands.idle()
  assert.equal(executed.length, 1)
})

test('a command in a project that runs confined fails without leaving the host to run it', async (t) => {
  const { db, executed, scheduled, sweep, runsOf } = await harness(t)
  const row = scheduled()
  const due = loadAction(db, row.id).nextRunAt!
  db.update(projects).set({ environmentConfined: true }).where(eq(projects.id, 'project')).run()

  await sweep(due)
  assert.deepEqual(executed, [])
  const [run] = runsOf(row.id)
  assert.equal(run!.status, 'failed')
  assert.match(run!.excerpt!, /confin/)
})

test('a vanished directory is a failed passage, not a run elsewhere', async (t) => {
  const { db, executed, scheduled, sweep, runsOf } = await harness(t)
  const row = scheduled({ subdir: 'gone' })
  await sweep(loadAction(db, row.id).nextRunAt!)
  assert.deepEqual(executed, [])
  assert.equal(runsOf(row.id)[0]!.status, 'failed')
})

// --- les notifications d'échec --------------------------------------------------

test('the owner hears of the first failure of a streak, not of each one', async (t) => {
  const { db, scheduled, sweep, notified, answer } = await harness(t)
  const row = scheduled()
  const due = loadAction(db, row.id).nextRunAt!
  const hour = 60 * MINUTE

  answer(() => ({ exitCode: 1, timedOut: false, output: 'boom\n' }))
  await sweep(due)
  await sweep(due + hour)
  assert.equal(notified.length, 1)
  assert.equal(notified[0]!.userId, 'owner')
  assert.equal(notified[0]!.notification.kind, 'scheduleFailed')
  assert.match(notified[0]!.notification.push.body, /Purge/)
  assert.equal(notified[0]!.notification.push.url, '/p/project/actions')

  answer(() => ({ exitCode: 0, timedOut: false, output: '' }))
  await sweep(due + 2 * hour)
  answer(() => ({ exitCode: null, timedOut: true, output: '' }))
  await sweep(due + 3 * hour)
  assert.equal(notified.length, 2)
})

// --- la relecture, quand un agent planifie --------------------------------------

test('register_action accepts a schedule, and the command waits for review before running unattended', async (t) => {
  const { db, mcp } = await harness(t)
  const created = await mcp('register_action', {
    label: 'Sauvegarde',
    kind: 'task',
    command: 'scripts/backup.sh',
    schedule: { cron: '0 3 * * 0', max_duration_minutes: 10 },
    on_demand: false,
  })
  assert.equal(created.isError, undefined, created.content[0]?.text)
  const row = db.select().from(projectActions).get()!
  assert.equal(row.approvedAt, null)
  assert.deepEqual(JSON.parse(row.cadence!), { kind: 'cron', expression: '0 3 * * 0' })
  assert.equal(row.onDemand, false)
  assert.equal(row.scheduleMaxMinutes, 10)
  assert.match(created.content[0]!.text, /valid/)

  const listed = await mcp('list_actions', {})
  assert.match(listed.content[0]!.text, /planifiée/)
  assert.match(listed.content[0]!.text, /0 3 \* \* 0/)
})

test('register_action refuses a cadence tighter than an agent may set', async (t) => {
  const { db, mcp } = await harness(t)
  const refused = await mcp('register_action', { label: 'Spam', kind: 'task', command: 'true', schedule: { every_minutes: 1 } })
  assert.equal(refused.isError, true)
  assert.match(refused.content[0]!.text, /15 minutes/)
  assert.equal(db.select().from(projectActions).all().length, 0)
})

test('an agent scheduling a reviewed command asks for review again; pausing does not', async (t) => {
  const { db, mcp } = await harness(t)
  const row = createAction(db, 'project', { label: 'Purge', kind: 'task', command: 'scripts/purge.sh' }, null)

  const paused = updateAction(db, row, { schedule: { cadence: HOURLY } }, 'agent')
  assert.equal(paused.approvedAt, null, 'a command that starts running unattended is reviewed first')
  const approved = approveAction(db, paused)
  assert.ok(updateAction(db, approved, { schedule: { enabled: false } }, 'agent').approvedAt)

  const viaMcp = await mcp('register_action', { id: row.id, schedule: { every_minutes: 30 } })
  assert.equal(viaMcp.isError, undefined, viaMcp.content[0]?.text)
  assert.equal(loadAction(db, row.id).approvedAt, null)
})

test('rejecting a schedule an agent added brings back the reviewed cadence', async (t) => {
  const { db } = await harness(t)
  const row = createAction(db, 'project', { label: 'Purge', kind: 'task', command: 'scripts/purge.sh' }, null)
  const proposed = updateAction(db, row, { schedule: { cadence: HOURLY } }, 'agent')

  const restored = rejectAction(db, proposed)!
  assert.ok(restored.approvedAt)
  assert.equal(restored.cadence, null)
  assert.equal(restored.nextRunAt, null)
  assert.equal(restored.onDemand, true)
})

// --- l'exécution détachée, pour de vrai -----------------------------------------

test('a detached run captures output, exit code, and stops at its limit', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-detached-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const previousShell = process.env.SHELL
  process.env.SHELL = '/bin/sh'
  t.after(() => { process.env.SHELL = previousShell })

  const done = await runDetached({ command: 'pwd; echo out; echo err >&2; exit 3', cwd: dir, env: {}, timeoutMs: 10_000, label: 'test' })
  assert.equal(done.exitCode, 3)
  assert.equal(done.timedOut, false)
  assert.match(done.output, new RegExp(dir))
  assert.match(done.output, /out/)
  assert.match(done.output, /err/)

  const started = Date.now()
  const stopped = await runDetached({ command: 'echo begin; sleep 30', cwd: dir, env: {}, timeoutMs: 300, label: 'test' })
  assert.equal(stopped.timedOut, true)
  assert.equal(stopped.exitCode, null)
  assert.match(stopped.output, /begin/)
  assert.ok(Date.now() - started < 10_000)
})

test('the detail of a scheduled passage reads like any other', async (t) => {
  const { db, app, scheduled, sweep } = await harness(t)
  const row = scheduled()
  await sweep(loadAction(db, row.id).nextRunAt!)
  const [run] = (await app.inject({ method: 'GET', url: `/api/actions/${row.id}/runs` })).json<ActionRunDetailDto[]>()
  assert.equal(run!.trigger, 'schedule')
  assert.equal(run!.excerpt, 'ok')
  const listed = (await app.inject({ method: 'GET', url: '/api/actions' })).json<ProjectActionDto[]>()
  assert.equal(listed[0]!.schedule!.lastRunAt, run!.startedAt)
})
