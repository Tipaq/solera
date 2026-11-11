import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import Fastify from 'fastify'
import { fileURLToPath } from 'node:url'
import { asc, eq } from 'drizzle-orm'
import {
  conversations,
  openDatabase,
  projects,
  runMigrations,
  scheduledRuns,
  scheduledTasks,
  users,
  worktrees,
} from '@solera/db'
import {
  CHECK_SKIP_EXIT_CODE,
  DEFAULT_CLAUDE_CONFIG,
  checkScriptSchema,
  createScheduledTaskBodySchema,
  createScopedScheduledTaskBodySchema,
  updateScheduledTaskBodySchema,
  nextScheduleRun,
  upcomingScheduleRuns,
  type AgentConfig,
  type ScheduleCadence,
  type ScheduleOverlapPolicy,
  type ScheduledTaskDto,
} from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { TaskScheduler, buildRunPrompt } from '../src/scheduler/task-scheduler.js'
import { runCheck } from '../src/scheduler/check.js'
import { approveScheduleCheck, createScheduledTask, deleteScheduledTask, tasksToDto, updateScheduledTask } from '../src/scheduler/tasks.js'
import { instanceInfo } from '../src/instance/profile.js'
import { HttpError, registerErrorHandler } from '../src/http/errors.js'
import { registerScheduleRoutes } from '../src/http/routes/schedules.js'
import { agentCwd } from '../src/workspace.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { Environments } from '../src/environments/environments.js'

const MINUTE = 60_000

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-scheduled-tasks-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()

  const sent: { to: string; text: string }[] = []
  const terminated: string[] = []
  let failSend = false
  const sessions = {
    async sendMessage(to: string, _id: string, text: string) {
      if (failSend) throw new Error('CLI introuvable')
      sent.push({ to, text })
      // Le vrai gestionnaire passe le fil en `running` dès que le CLI prend le tour.
      db.update(conversations).set({ status: 'running' }).where(eq(conversations.id, to)).run()
    },
    async terminate(id: string) {
      terminated.push(id)
      db.update(conversations).set({ status: 'interrupted' }).where(eq(conversations.id, id)).run()
    },
    // Le daemon y annonce les listes qu'une demande a changées.
    statusBus: new EventEmitter(),
    // La création d'un fil résout les défauts du CLI (#120) : rien à résoudre ici.
    resolveDefaults: async (config: AgentConfig) => config,
    // La session prend l'environnement du projet, l'hôte ici.
    environments: new Environments(db),
  } as unknown as SessionManager
  const registry = {
    adapter: () => ({
      models: async () => ({ models: [] }),
      resolveDefaults: async (config: AgentConfig) => (config.model ? config : { ...config, model: 'default' }),
    }),
  } as unknown as AgentRegistry
  const config = {
    paths: { worktrees: join(dir, 'worktrees'), data: join(dir, 'data'), threads: join(dir, 'threads') },
    server: { publicUrl: 'https://solera.example/' },
    vault: { path: '' },
  } as unknown as Config
  const log = new EventLog(db)
  const scheduler = new TaskScheduler({ db, config }, sessions, registry, log)

  const task = (cadence: ScheduleCadence, overlapPolicy: ScheduleOverlapPolicy = 'skip', maxDurationMinutes = 30) =>
    createScheduledTask(
      db,
      { projectId: 'project', userId: 'owner' },
      { name: 'Veille', agent: 'claude', config: DEFAULT_CLAUDE_CONFIG, prompt: 'Sonde les CLI.', cadence, overlapPolicy, maxDurationMinutes, enabled: true },
    )

  /** Fait finir le tour d'un fil comme le ferait le CLI : une réponse, puis le repos. */
  const finish = (conversationId: string, reply: string) => {
    log.append(conversationId, {
      type: 'message.completed',
      messageId: `m-${reply}`,
      role: 'assistant',
      blocks: [{ type: 'text', text: reply }],
      parentToolCallId: null,
    })
    log.append(conversationId, {
      type: 'turn.completed',
      stopReason: 'end_turn',
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    })
    db.update(conversations).set({ status: 'idle' }).where(eq(conversations.id, conversationId)).run()
  }

  /** Une tâche avec vérification, écrite dans l'interface (validée) ou par un agent. */
  const checkedTask = (checkScript: string, options: { byAgent?: boolean; prompt?: string; timeoutSeconds?: number } = {}) =>
    createScheduledTask(
      db,
      { projectId: 'project', userId: 'owner', conversationId: options.byAgent ? 'agent-conversation' : undefined },
      {
        name: 'Veille',
        agent: 'claude',
        config: DEFAULT_CLAUDE_CONFIG,
        prompt: options.prompt ?? 'Sonde les CLI.',
        cadence: { kind: 'interval', minutes: 60 },
        overlapPolicy: 'skip',
        maxDurationMinutes: 30,
        enabled: true,
        checkScript,
        checkTimeoutSeconds: options.timeoutSeconds ?? 30,
      },
    )

  /** La vérification ne bloque pas le balayage : on attend que son tir ait tranché. */
  const settled = async (taskId: string) => {
    for (let i = 0; i < 300; i++) {
      const open = db.select().from(scheduledRuns).where(eq(scheduledRuns.taskId, taskId)).all()
      if (open.length > 0 && open.every((run) => run.status !== 'checking')) return open
      await new Promise((done) => setTimeout(done, 50))
    }
    throw new Error('La vérification ne s’est pas terminée')
  }

  const runs = () => db.select().from(scheduledRuns).orderBy(asc(scheduledRuns.startedAt), asc(scheduledRuns.scheduledFor)).all()
  const reload = (id: string) => db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get()!

  return {
    db, dir, dbPath, sessions, registry, config, scheduler, task, checkedTask, settled, finish, runs, reload, sent, terminated,
    failNextSends: () => { failSend = true },
  }
}

test('nextScheduleRun counts an interval from the last run and never catches up', () => {
  const every10: ScheduleCadence = { kind: 'interval', minutes: 10 }
  assert.equal(nextScheduleRun(every10, 1000), 1000 + 10 * MINUTE)
  assert.equal(nextScheduleRun(every10, 5 * MINUTE, MINUTE), 11 * MINUTE)
  // Le daemon est resté arrêté trois intervalles : un seul tir à venir, pas trois.
  assert.equal(nextScheduleRun(every10, 40 * MINUTE, MINUTE), 50 * MINUTE)

  assert.equal(nextScheduleRun({ kind: 'once', at: 500 }, 100), 500)
  assert.equal(nextScheduleRun({ kind: 'once', at: 500 }, 500), null)

  const monday = nextScheduleRun({ kind: 'cron', expression: '0 9 * * 1' }, Date.now())!
  assert.equal(new Date(monday).getDay(), 1)
  assert.equal(new Date(monday).getHours(), 9)
})

test('buildRunPrompt tells the agent it runs alone and hands over the previous run', () => {
  const task = { name: 'Veille', prompt: 'Compare à {{previous_run_summary}} ({{previous_run_date}}).', projectId: 'p', maxDurationMinutes: 20 }
  const first = buildRunPrompt({ task, trigger: 'schedule', firedAt: Date.now(), previous: null, publicUrl: '' })
  assert.match(first, /personne n'est au clavier/)
  assert.match(first, /premier tir/)
  assert.match(first, /20 min/)

  const next = buildRunPrompt({
    task,
    trigger: 'manual',
    firedAt: Date.now(),
    previous: { startedAt: Date.now() - MINUTE, status: 'succeeded', conversationId: 'c1', summary: 'Rien de neuf.', error: null },
    publicUrl: 'https://solera.example/',
  })
  assert.match(next, /lancé à la main/)
  assert.match(next, /https:\/\/solera\.example\/p\/p\/c\/c1/)
  assert.match(next, /> Rien de neuf\./)
  assert.match(next, /Compare à Rien de neuf\. \(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)\./)
})

test('a due task opens a tagged session, then settles with the last reply as summary', async (t) => {
  const { db, scheduler, task, finish, runs, reload, sent } = await harness(t)
  const created = task({ kind: 'interval', minutes: 10 })
  const due = created.nextRunAt!

  await scheduler.tick(due - 1)
  assert.equal(runs().length, 0)

  await scheduler.tick(due)
  const [run] = runs()
  assert.equal(run?.status, 'running')
  assert.equal(run?.trigger, 'schedule')
  const thread = db.select().from(conversations).where(eq(conversations.id, run!.conversationId!)).get()!
  assert.equal(thread.scheduleId, created.id)
  assert.match(thread.title, /^Veille · \d{4}-/)
  assert.match(sent[0]!.text, /Sonde les CLI\.$/)
  assert.ok(reload(created.id).nextRunAt! > due)
  assert.ok(reload(created.id).lastRunAt)

  // Le fil tourne : rien ne bouge.
  await scheduler.tick(due + MINUTE)
  assert.equal(runs()[0]?.status, 'running')

  finish(thread.id, 'Aucune nouvelle version.')
  await scheduler.tick(due + 2 * MINUTE)
  assert.equal(runs()[0]?.status, 'succeeded')
  assert.equal(runs()[0]?.summary, 'Aucune nouvelle version.')
})

test('a thread that has not started its turn yet is not mistaken for a finished one', async (t) => {
  const { db, scheduler, task, runs } = await harness(t)
  const created = task({ kind: 'interval', minutes: 10 })
  await scheduler.tick(created.nextRunAt!)
  db.update(conversations).set({ status: 'idle' }).run()

  await scheduler.tick(created.nextRunAt! + MINUTE)
  assert.equal(runs()[0]?.status, 'running')
})

test('overlap: skip records a skipped run, wait fires once the previous one is done', async (t) => {
  const { scheduler, task, finish, runs, reload } = await harness(t)
  const skipping = task({ kind: 'interval', minutes: 10 }, 'skip')
  await scheduler.tick(skipping.nextRunAt!)
  const second = reload(skipping.id).nextRunAt!
  await scheduler.tick(second)
  assert.deepEqual(runs().map((run) => run.status), ['running', 'skipped'])
  assert.ok(reload(skipping.id).nextRunAt! > second)

  finish(runs()[0]!.conversationId!, 'ok')
  await scheduler.tick(second + MINUTE)

  const waiting = task({ kind: 'interval', minutes: 10 }, 'wait')
  const mine = () => runs().filter((run) => run.taskId === waiting.id)
  await scheduler.tick(waiting.nextRunAt!)
  const dueAgain = reload(waiting.id).nextRunAt!
  await scheduler.tick(dueAgain)
  assert.equal(mine().length, 1)
  assert.equal(reload(waiting.id).nextRunAt, dueAgain)

  finish(mine()[0]!.conversationId!, 'ok')
  await scheduler.tick(dueAgain + MINUTE)
  assert.deepEqual(mine().map((run) => run.status).sort(), ['running', 'succeeded'])
})

test('a run that outlives its maximum duration is terminated', async (t) => {
  const { scheduler, task, runs, terminated } = await harness(t)
  const created = task({ kind: 'interval', minutes: 60 }, 'skip', 5)
  await scheduler.tick(created.nextRunAt!)
  const startedAt = runs()[0]!.startedAt

  await scheduler.tick(startedAt + 4 * MINUTE)
  assert.equal(runs()[0]?.status, 'running')

  await scheduler.tick(startedAt + 5 * MINUTE)
  assert.equal(runs()[0]?.status, 'timed_out')
  assert.deepEqual(terminated, [runs()[0]!.conversationId])
})

test('a one-off task fires once and pauses itself; a failed launch is recorded, not retried', async (t) => {
  const { db, scheduler, task, runs, reload, failNextSends } = await harness(t)
  const once = task({ kind: 'once', at: Date.now() + MINUTE })
  await scheduler.tick(once.nextRunAt!)
  assert.equal(runs().length, 1)
  assert.equal(reload(once.id).enabled, false)
  assert.equal(reload(once.id).nextRunAt, null)

  failNextSends()
  const broken = task({ kind: 'interval', minutes: 10 })
  await scheduler.tick(broken.nextRunAt!)
  const failed = runs().find((run) => run.taskId === broken.id)!
  assert.equal(failed.status, 'failed')
  assert.match(failed.error!, /CLI introuvable/)
  // Le fil créé pour rien a été retiré, et la tâche attend son prochain créneau.
  assert.equal(db.select().from(conversations).where(eq(conversations.scheduleId, broken.id)).all().length, 0)
  assert.ok(reload(broken.id).nextRunAt! > broken.nextRunAt!)
})

test('run now refuses to double a run in flight and leaves the schedule alone', async (t) => {
  const { scheduler, task, runs, reload } = await harness(t)
  const created = task({ kind: 'interval', minutes: 10 })

  const run = await scheduler.runNow(created.id)
  assert.equal(run.trigger, 'manual')
  assert.equal(reload(created.id).nextRunAt, created.nextRunAt)
  await assert.rejects(scheduler.runNow(created.id), /still in progress/)
  assert.equal(runs().length, 1)
})

test('deleting a task archives its threads and hands them back to the ordinary list', async (t) => {
  const { db, scheduler, task } = await harness(t)
  const created = task({ kind: 'interval', minutes: 10 })
  await scheduler.runNow(created.id)

  const running = deleteScheduledTask(db, created.id)
  const [thread] = db.select().from(conversations).all()
  assert.deepEqual(running, [thread!.id])
  assert.equal(thread?.scheduleId, null)
  assert.ok(thread?.archivedAt)
  assert.equal(db.select().from(scheduledRuns).all().length, 0)
})

test('schedule_task creates a task from a session, within the agent guard rails', async (t) => {
  const { db, dbPath, sessions, registry, config } = await harness(t)
  db.insert(conversations).values({
    id: 'parent', projectId: 'project', userId: 'owner', title: 'Session', agent: 'claude', config: '{}', status: 'running',
    createdAt: 1, updatedAt: Date.now(),
  }).run()
  db.insert(conversations).values({
    id: 'scheduled', projectId: 'project', userId: 'owner', title: 'Tir', agent: 'claude', config: '{}', status: 'running',
    scheduleId: 'some-task', createdAt: 1, updatedAt: Date.now(),
  }).run()
  const requests = new AgentRequests({ db, config }, sessions, registry, new EventLog(db))

  const mcp = async (from: string, args: object) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: 'project', SOLERA_MCP_CONVERSATION: from },
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'schedule_task', arguments: args } }) + '\n')
    const deadline = Date.now() + 10000
    while (!stdout.includes('\n') && Date.now() < deadline) {
      await requests.sweep()
      await new Promise((done) => setTimeout(done, 50))
    }
    child.kill()
    return JSON.parse(stdout).result as { content: { text: string }[]; isError?: boolean }
  }

  const created = await mcp('parent', { name: 'Veille des CLI', prompt: 'Sonde les binaires.', cron: '0 9 * * 1' })
  assert.equal(created.isError, undefined, created.content[0]?.text)
  assert.match(created.content[0]!.text, /Tâche planifiée « Veille des CLI » créée/)
  // Les défauts sont en permissions manuelles : la réponse doit le signaler.
  assert.match(created.content[0]!.text, /personne ne donnera/)
  const row = db.select().from(scheduledTasks).get()!
  assert.equal(row.createdByConversationId, 'parent')
  assert.deepEqual(JSON.parse(row.cadence), { kind: 'cron', expression: '0 9 * * 1' })
  assert.equal(new Date(row.nextRunAt!).getDay(), 1)

  const tooTight = await mcp('parent', { name: 'x', prompt: 'x', every_minutes: 5 })
  assert.equal(tooTight.isError, true)
  assert.match(tooTight.content[0]!.text, /15 minutes au moins/)

  const tightCron = await mcp('parent', { name: 'x', prompt: 'x', cron: '* * * * *' })
  assert.match(tightCron.content[0]!.text, /trop serré/)

  const ambiguous = await mcp('parent', { name: 'x', prompt: 'x', every_minutes: 60, cron: '0 9 * * 1' })
  assert.match(ambiguous.content[0]!.text, /au plus une cadence/)

  const selfReplicating = await mcp('scheduled', { name: 'x', prompt: 'x', every_minutes: 60 })
  assert.equal(selfReplicating.isError, true)
  assert.match(selfReplicating.content[0]!.text, /elle-même un tir planifié/)

  assert.equal(db.select().from(scheduledTasks).all().length, 1)
})

test('runCheck turns the exit code into a verdict and keeps the output', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-check-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const context = {
    taskId: 'task',
    taskName: 'Veille',
    projectId: 'project',
    cwd: dir,
    stateDir: join(dir, 'state'),
    firedAt: Date.now(),
    trigger: 'schedule' as const,
    previous: null,
    timeoutMs: 20_000,
  }

  const launch = await runCheck('echo "nouvelle version"; echo oops >&2', context)
  assert.equal(launch.verdict, 'launch')
  assert.equal(launch.exitCode, 0)
  assert.equal(launch.stdout.trim(), 'nouvelle version')
  assert.equal(launch.stderr.trim(), 'oops')

  const skip = await runCheck(`echo "rien de neuf"; exit ${CHECK_SKIP_EXIT_CODE}`, context)
  assert.equal(skip.verdict, 'skip')

  // Un plantage n'est jamais pris pour « rien à faire ».
  const crash = await runCheck('exit 1', context)
  assert.equal(crash.verdict, 'error')
  assert.equal(crash.exitCode, 1)

  const python = await runCheck('#!/usr/bin/env python3\nimport os\nprint(os.environ["SOLERA_TASK_NAME"])', context)
  assert.equal(python.stdout.trim(), 'Veille')

  const slow = await runCheck('sleep 30', { ...context, timeoutMs: 300 })
  assert.equal(slow.verdict, 'error')
  assert.equal(slow.timedOut, true)
  assert.ok(slow.durationMs < 10_000)
})

test('runCheck concludes on the script exit, even when a descendant keeps the pipes open', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-check-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const context = {
    taskId: 'task', taskName: 'Veille', projectId: 'project', cwd: dir, stateDir: join(dir, 'state'),
    firedAt: Date.now(), trigger: 'schedule' as const, previous: null, timeoutMs: 20_000,
  }

  // Un descendant d'arrière-plan hérite des tuyaux : le script est pourtant sorti en 0.
  const background = await runCheck('sleep 5 & echo ok; exit 0', { ...context, timeoutMs: 2000 })
  assert.equal(background.verdict, 'launch')
  assert.equal(background.timedOut, false)
  assert.equal(background.exitCode, 0)
  assert.equal(background.stdout.trim(), 'ok')
  assert.ok(background.durationMs < 1500, `${background.durationMs} ms`)

  // Détaché par `setsid`, il échappe même au groupe de processus.
  const detached = await runCheck('setsid sleep 30 & echo ok; exit 0', context)
  assert.equal(detached.verdict, 'launch')
  assert.equal(detached.stdout.trim(), 'ok')
  assert.ok(detached.durationMs < 5000, `${detached.durationMs} ms`)
})

test('runCheck gives up after the timeout and its grace, whatever still holds the pipes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-check-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const context = {
    taskId: 'task', taskName: 'Veille', projectId: 'project', cwd: dir, stateDir: join(dir, 'state'),
    firedAt: Date.now(), trigger: 'schedule' as const, previous: null, timeoutMs: 300,
  }
  // Le shell ignore SIGTERM, et son descendant détaché survivrait au SIGKILL du groupe.
  const stubborn = await runCheck("trap '' TERM; setsid sleep 30 & while :; do sleep 1; done", context)
  assert.equal(stubborn.verdict, 'error')
  assert.equal(stubborn.timedOut, true)
  assert.equal(stubborn.exitCode, null)
  assert.ok(stubborn.durationMs < 6000, `${stubborn.durationMs} ms`)
})

test('a check script never keeps a carriage return', () => {
  assert.equal(checkScriptSchema.parse('echo a\r\necho b\rexit 0\r\n'), 'echo a\necho b\nexit 0\n')
  assert.equal(checkScriptSchema.parse('\r\n'), null)
  const created = createScheduledTaskBodySchema.parse({
    name: 'x', agent: 'claude', config: DEFAULT_CLAUDE_CONFIG, prompt: 'x',
    cadence: { kind: 'interval', minutes: 60 }, checkScript: 'echo a\r\nexit 0',
  })
  assert.equal(created.checkScript, 'echo a\nexit 0')
  assert.equal(updateScheduledTaskBodySchema.parse({ checkScript: 'echo a\r\nexit 0' }).checkScript, 'echo a\nexit 0')
})

test('saving a task from the interface does not approve a script nobody touched', async (t) => {
  const { db, checkedTask, reload } = await harness(t)
  const proposed = checkedTask('echo a\nexit 0', { byAgent: true })
  assert.equal(proposed.checkApprovedAt, null)

  // Le formulaire ne renvoie pas un script qu'on n'a pas édité : changer l'heure le laisse à valider.
  const retimed = updateScheduledTask(db, reload(proposed.id), updateScheduledTaskBodySchema.parse({
    cadence: { kind: 'cron', expression: '0 8 * * *' },
  }))
  assert.equal(retimed.checkApprovedAt, null)
  assert.equal(retimed.checkProposedBy, 'agent-conversation')

  // Et le même texte aux fins de ligne près n'est pas un script changé.
  const crlf = updateScheduledTask(db, retimed, updateScheduledTaskBodySchema.parse({ checkScript: 'echo a\r\nexit 0' }))
  assert.equal(crlf.checkApprovedAt, null)
  assert.equal(reload(proposed.id).checkScript, 'echo a\nexit 0')
})

test('runCheck keeps its state between runs, but an essay works on a copy', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-check-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const context = {
    taskId: 'task', taskName: 'Veille', projectId: 'project', cwd: dir, stateDir: join(dir, 'state'),
    firedAt: Date.now(), trigger: 'schedule' as const, previous: null, timeoutMs: 20_000,
  }
  const script = `last=$(cat "$SOLERA_STATE_DIR/seen" 2>/dev/null); [ "$last" = "1.2" ] && exit ${CHECK_SKIP_EXIT_CODE}; echo 1.2 > "$SOLERA_STATE_DIR/seen"; echo "1.2 publiée"`

  assert.equal((await runCheck(script, { ...context, trigger: 'test' })).verdict, 'launch')
  // L'essai n'a rien laissé : le vrai tir voit encore la nouveauté.
  assert.equal((await runCheck(script, context)).verdict, 'launch')
  assert.equal((await runCheck(script, context)).verdict, 'skip')
})

test('a checked task only wakes the LLM when its script says so', async (t) => {
  const { db, scheduler, checkedTask, settled, runs, sent, reload } = await harness(t)

  const quiet = checkedTask(`echo "Toujours 0.160.1"; exit ${CHECK_SKIP_EXIT_CODE}`)
  await scheduler.tick(quiet.nextRunAt!)
  const [skipped] = await settled(quiet.id)
  assert.equal(skipped?.status, 'skipped')
  assert.equal(skipped?.error, 'Toujours 0.160.1')
  assert.equal(skipped?.conversationId, null)
  assert.equal(sent.length, 0)
  // La cadence a avancé : le tir écarté compte comme un tir.
  assert.ok(reload(quiet.id).nextRunAt! > quiet.nextRunAt!)

  const busy = checkedTask('echo "Codex 0.161.0 publiée"', { prompt: 'Analyse : {{check_output}}' })
  await scheduler.tick(busy.nextRunAt!)
  const [launched] = await settled(busy.id)
  assert.equal(launched?.status, 'running')
  assert.equal(launched?.checkExitCode, 0)
  assert.ok(launched?.conversationId)
  assert.equal(db.select().from(conversations).where(eq(conversations.id, launched!.conversationId!)).get()?.scheduleId, busy.id)
  // Citée par la consigne, la sortie n'est pas répétée dans l'en-tête.
  assert.match(sent[0]!.text, /Analyse : Codex 0\.161\.0 publiée$/)
  assert.doesNotMatch(sent[0]!.text, /Sa sortie :/)

  const broken = checkedTask('echo "registre injoignable" >&2; exit 3')
  await scheduler.tick(broken.nextRunAt!)
  const [failed] = await settled(broken.id)
  assert.equal(failed?.status, 'failed')
  assert.match(failed!.error!, /code 3\) : registre injoignable/)
  assert.equal(runs().filter((run) => run.conversationId).length, 1)
})

test('a check written by an agent does not run before someone approves it', async (t) => {
  const { db, scheduler, checkedTask, settled, sent, reload } = await harness(t)
  const marker = join(tmpdir(), `solera-check-marker-${Date.now()}`)
  t.after(() => rm(marker, { force: true }))
  const proposed = checkedTask(`touch ${marker}`, { byAgent: true })
  assert.equal(proposed.checkApprovedAt, null)
  assert.equal(proposed.checkProposedBy, 'agent-conversation')

  await scheduler.tick(proposed.nextRunAt!)
  const [blocked] = await settled(proposed.id)
  assert.equal(blocked?.status, 'skipped')
  assert.match(blocked!.error!, /en attente de validation/)
  assert.equal(sent.length, 0)
  await assert.rejects(stat(marker))

  // Valider un texte qui a changé depuis l'affichage est refusé.
  assert.throws(() => approveScheduleCheck(db, reload(proposed.id), 'echo autre chose'), /changed/)
  approveScheduleCheck(db, reload(proposed.id), `touch ${marker}`)
  await scheduler.runNow(proposed.id)
  await settled(proposed.id)
  await stat(marker)
  assert.equal(sent.length, 1)

  // L'interface qui réécrit le script le valide ; un agent qui le réécrit le remet en proposition.
  const edited = updateScheduledTask(db, reload(proposed.id), { checkScript: 'exit 0' }, 'agent-conversation')
  assert.equal(edited.checkApprovedAt, null)
  assert.ok(updateScheduledTask(db, edited, { checkScript: 'exit 10' }).checkApprovedAt)
})

test('run now can skip the check, and a restart closes a check left in flight', async (t) => {
  const { db, scheduler, checkedTask, sent, runs } = await harness(t)
  const gated = checkedTask(`exit ${CHECK_SKIP_EXIT_CODE}`)

  const forced = await scheduler.runNow(gated.id, { skipCheck: true })
  assert.equal(forced.status, 'running')
  assert.equal(forced.checkDurationMs, null)
  assert.equal(sent.length, 1)

  db.update(scheduledRuns).set({ status: 'checking' }).where(eq(scheduledRuns.id, forced.id)).run()
  scheduler.start({ warn: () => undefined, error: () => undefined, info: () => undefined } as never)
  scheduler.stop()
  const [closed] = runs()
  assert.equal(closed?.status, 'failed')
  assert.match(closed!.error!, /redémarrage/)
})

test('schedule_task can propose a check, which waits for the user', async (t) => {
  const { db, dbPath, sessions, registry, config } = await harness(t)
  db.insert(conversations).values({
    id: 'parent', projectId: 'project', userId: 'owner', title: 'Session', agent: 'claude', config: '{}', status: 'running',
    createdAt: 1, updatedAt: Date.now(),
  }).run()
  const requests = new AgentRequests({ db, config }, sessions, registry)
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
    env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: 'project', SOLERA_MCP_CONVERSATION: 'parent' },
  })
  let stdout = ''
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
  child.stdin.write(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'schedule_task', arguments: { name: 'Veille Codex', prompt: 'Analyse {{check_output}}', cron: '0 9 * * *', check_script: 'set -e\r\nnpm view @openai/codex version' } },
  }) + '\n')
  const deadline = Date.now() + 10000
  while (!stdout.includes('\n') && Date.now() < deadline) {
    await requests.sweep()
    await new Promise((done) => setTimeout(done, 50))
  }
  child.kill()
  const result = JSON.parse(stdout).result as { content: { text: string }[]; isError?: boolean }
  assert.equal(result.isError, undefined, result.content[0]?.text)
  assert.match(result.content[0]!.text, /attend la validation/)
  const row = db.select().from(scheduledTasks).get()!
  // Les fins de ligne Windows sont ramenées à `\n` dès la proposition.
  assert.equal(row.checkScript, 'set -e\nnpm view @openai/codex version')
  assert.equal(row.checkApprovedAt, null)
  assert.equal(row.checkProposedBy, 'parent')
})

// --- À la demande, où il tourne, fuseau (AC-04) ------------------------------------

/** L'heure et le jour d'un instant, lus dans un fuseau donné. */
function wallClock(ts: number, timeZone: string): { hour: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(ts)
  return {
    hour: Number(parts.find((part) => part.type === 'hour')!.value),
    weekday: parts.find((part) => part.type === 'weekday')!.value,
  }
}

test('nextScheduleRun reads a cron in the time zone it is given', () => {
  const after = Date.UTC(2026, 10, 11, 12, 0)
  const nineEveryMonday: ScheduleCadence = { kind: 'cron', expression: '0 9 * * 1' }
  for (const timeZone of ['Asia/Tokyo', 'America/New_York', 'Europe/Paris']) {
    const next = nextScheduleRun(nineEveryMonday, after, null, timeZone)!
    assert.deepEqual(wallClock(next, timeZone), { hour: 9, weekday: 'Mon' }, timeZone)
  }
  // Tokyo et New York n'ont pas le même 9 h.
  assert.notEqual(
    nextScheduleRun(nineEveryMonday, after, null, 'Asia/Tokyo'),
    nextScheduleRun(nineEveryMonday, after, null, 'America/New_York'),
  )
})

test('upcomingScheduleRuns lists the next runs of a cadence, in order', () => {
  const after = Date.UTC(2026, 10, 11, 12, 0)
  const daily = upcomingScheduleRuns({ kind: 'cron', expression: '30 3 * * *' }, after, 5, { timeZone: 'Asia/Tokyo' })
  assert.equal(daily.length, 5)
  for (const [index, ts] of daily.entries()) {
    assert.equal(wallClock(ts, 'Asia/Tokyo').hour, 3)
    if (index > 0) assert.equal(ts - daily[index - 1]!, 24 * 60 * MINUTE)
  }

  const every90 = upcomingScheduleRuns({ kind: 'interval', minutes: 90 }, after, 3, { lastRunAt: after - 30 * MINUTE })
  assert.deepEqual(every90, [after + 60 * MINUTE, after + 150 * MINUTE, after + 240 * MINUTE])

  assert.deepEqual(upcomingScheduleRuns({ kind: 'once', at: after + MINUTE }, after, 5), [after + MINUTE])
  assert.deepEqual(upcomingScheduleRuns({ kind: 'once', at: after - MINUTE }, after, 5), [])
})

test('the instance tells its time zone, the one a cron is read in', () => {
  assert.equal(instanceInfo().timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone)
})

test('a task without fields of its own stays scheduled, on demand too, at the project root', async (t) => {
  const { db, task } = await harness(t)
  const created = task({ kind: 'interval', minutes: 10 })
  assert.equal(created.onDemand, true)
  assert.equal(created.worktreeMode, 'root')
  const [dto] = tasksToDto(db, [created])
  assert.deepEqual(dto!.cadence, { kind: 'interval', minutes: 10 })
  assert.equal(dto!.onDemand, true)
  assert.equal(dto!.worktreeMode, 'root')
})

test('the API body takes a null cadence, and defaults to on demand at the root', () => {
  const body = createScheduledTaskBodySchema.parse({ name: 'Revue', agent: 'claude', config: DEFAULT_CLAUDE_CONFIG, prompt: 'Relis.', cadence: null })
  assert.equal(body.cadence, null)
  assert.equal(body.onDemand, true)
  assert.equal(body.worktreeMode, 'root')
  assert.equal(createScheduledTaskBodySchema.safeParse({ ...body, worktreeMode: 'elsewhere' }).success, false)
  assert.deepEqual(updateScheduledTaskBodySchema.parse({ cadence: null, onDemand: true, worktreeMode: 'new' }), { cadence: null, onDemand: true, worktreeMode: 'new' })
})

const onDemandInput = (overrides: Partial<Parameters<typeof createScheduledTask>[2]> = {}) => ({
  name: 'Revue',
  agent: 'claude' as const,
  config: DEFAULT_CLAUDE_CONFIG,
  prompt: 'Relis la dernière PR.',
  cadence: null,
  overlapPolicy: 'skip' as const,
  maxDurationMinutes: 30,
  enabled: true,
  onDemand: true,
  ...overrides,
})

test('an on-demand agent task has no cadence: it never fires alone, but runs when asked', async (t) => {
  const { db, scheduler, runs, reload } = await harness(t)
  const created = createScheduledTask(db, { projectId: 'project', userId: 'owner' }, onDemandInput())
  assert.equal(created.cadence, null)
  assert.equal(created.nextRunAt, null)
  assert.equal(tasksToDto(db, [created])[0]!.cadence, null)

  await scheduler.tick(Date.now() + 400 * 24 * 60 * MINUTE)
  assert.equal(runs().length, 0)

  const run = await scheduler.runNow(created.id)
  assert.equal(run.status, 'running')
  assert.ok(run.conversationId)
  // Un tir à la main n'arme rien : il n'y a pas de cadence à suivre.
  assert.equal(reload(created.id).nextRunAt, null)
})

test('a task neither on demand nor scheduled is refused, at creation as at update', async (t) => {
  const { db, task } = await harness(t)
  const neither = () => createScheduledTask(db, { projectId: 'project', userId: 'owner' }, onDemandInput({ onDemand: false }))
  assert.throws(neither, (err: unknown) => err instanceof HttpError && err.code === 'schedule_needs_trigger')

  const scheduledOnly = createScheduledTask(
    db,
    { projectId: 'project', userId: 'owner' },
    onDemandInput({ cadence: { kind: 'interval', minutes: 60 }, onDemand: false }),
  )
  assert.equal(scheduledOnly.onDemand, false)
  assert.throws(
    () => updateScheduledTask(db, scheduledOnly, { cadence: null }),
    (err: unknown) => err instanceof HttpError && err.code === 'schedule_needs_trigger',
  )

  // Retirer la cadence d'une tâche à la demande la désarme, sans la mettre en pause.
  const both = task({ kind: 'interval', minutes: 10 })
  const unscheduled = updateScheduledTask(db, both, { cadence: null })
  assert.equal(unscheduled.cadence, null)
  assert.equal(unscheduled.nextRunAt, null)
  assert.equal(unscheduled.enabled, true)
  // Et la lui rendre la réarme.
  const rescheduled = updateScheduledTask(db, unscheduled, { cadence: { kind: 'interval', minutes: 10 } })
  assert.ok(rescheduled.nextRunAt)
})

/** Fait du dossier du projet un dépôt git sur `main`, avec un commit. */
function initRepository(dir: string): void {
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('commit', '-q', '--allow-empty', '-m', 'init')
}

test('a run in « new worktree » mode opens its session in a fresh worktree named after the task', async (t) => {
  const { db, dir, scheduler, sent } = await harness(t)
  initRepository(dir)
  const created = createScheduledTask(db, { projectId: 'project', userId: 'owner' }, onDemandInput({ name: 'Revue nocturne', worktreeMode: 'new' }))
  assert.equal(tasksToDto(db, [created])[0]!.worktreeMode, 'new')

  const first = await scheduler.runNow(created.id)
  assert.equal(first.status, 'running', first.error ?? undefined)
  const thread = db.select().from(conversations).where(eq(conversations.id, first.conversationId!)).get()!
  assert.ok(thread.worktreeId)
  const tree = db.select().from(worktrees).where(eq(worktrees.id, thread.worktreeId)).get()!
  assert.match(tree.name, /^planifiee\/revue-nocturne-\d{8}-\d{4}$/)
  assert.equal(tree.baseRef, 'main')
  assert.equal(tree.createdBy, 'owner')
  assert.ok((await stat(tree.path)).isDirectory())
  // L'agent sait où il est : il ne doit pas chercher son travail à la racine.
  assert.ok(sent[0]!.text.includes(tree.name))

  // Le tir suivant, dans la même minute, ne reprend pas la branche du précédent.
  db.update(scheduledRuns).set({ status: 'succeeded', finishedAt: Date.now() }).where(eq(scheduledRuns.id, first.id)).run()
  const second = await scheduler.runNow(created.id)
  const secondThread = db.select().from(conversations).where(eq(conversations.id, second.conversationId!)).get()!
  assert.notEqual(secondThread.worktreeId, thread.worktreeId)
  const secondTree = db.select().from(worktrees).where(eq(worktrees.id, secondThread.worktreeId!)).get()!
  assert.notEqual(secondTree.name, tree.name)
  assert.ok(secondTree.name.startsWith(tree.name))
})

test('a run at the root keeps opening its session without a worktree', async (t) => {
  const { db, scheduler } = await harness(t)
  const created = createScheduledTask(db, { projectId: 'project', userId: 'owner' }, onDemandInput())
  const run = await scheduler.runNow(created.id)
  const thread = db.select().from(conversations).where(eq(conversations.id, run.conversationId!)).get()!
  assert.equal(thread.worktreeId, null)
  assert.equal(db.select().from(worktrees).all().length, 0)
})

test('a « new worktree » run in a project that is not a repository fails and says why', async (t) => {
  const { db, scheduler, sent } = await harness(t)
  const created = createScheduledTask(db, { projectId: 'project', userId: 'owner' }, onDemandInput({ worktreeMode: 'new' }))
  const run = await scheduler.runNow(created.id)
  assert.equal(run.status, 'failed')
  assert.match(run.error ?? '', /git/i)
  assert.equal(sent.length, 0)
})

test('schedule_task creates an on-demand task, or one that runs in a new worktree', async (t) => {
  const { db, dbPath, sessions, registry, config } = await harness(t)
  db.insert(conversations).values({
    id: 'parent', projectId: 'project', userId: 'owner', title: 'Session', agent: 'claude', config: '{}', status: 'running',
    createdAt: 1, updatedAt: Date.now(),
  }).run()
  const requests = new AgentRequests({ db, config }, sessions, registry, new EventLog(db))
  const mcp = async (args: object) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: 'project', SOLERA_MCP_CONVERSATION: 'parent' },
    })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'schedule_task', arguments: args } }) + '\n')
    const deadline = Date.now() + 10000
    while (!stdout.includes('\n') && Date.now() < deadline) {
      await requests.sweep()
      await new Promise((done) => setTimeout(done, 50))
    }
    child.kill()
    return JSON.parse(stdout).result as { content: { text: string }[]; isError?: boolean }
  }

  const onDemand = await mcp({ name: 'Revue', prompt: 'Relis la dernière PR.' })
  assert.equal(onDemand.isError, undefined, onDemand.content[0]?.text)
  assert.match(onDemand.content[0]!.text, /à la demande/)
  const row = db.select().from(scheduledTasks).get()!
  assert.equal(row.cadence, null)
  assert.equal(row.onDemand, true)
  assert.equal(row.nextRunAt, null)
  assert.equal(row.worktreeMode, 'root')

  const nowhere = await mcp({ name: 'x', prompt: 'x', on_demand: false })
  assert.equal(nowhere.isError, true)
  assert.match(nowhere.content[0]!.text, /jamais/)

  const inTree = await mcp({ name: 'Audit', prompt: 'Audite.', cron: '0 9 * * 1', on_demand: false, worktree_mode: 'new' })
  assert.equal(inTree.isError, undefined, inTree.content[0]?.text)
  assert.match(inTree.content[0]!.text, /worktree neuf/)
  const audit = db.select().from(scheduledTasks).where(eq(scheduledTasks.name, 'Audit')).get()!
  assert.equal(audit.worktreeMode, 'new')
  assert.equal(audit.onDemand, false)

  const badMode = await mcp({ name: 'x', prompt: 'x', worktree_mode: 'elsewhere' })
  assert.equal(badMode.isError, true)

  assert.equal(db.select().from(scheduledTasks).all().length, 2)
})

/* ------------------------------------------------------------- portée (#208, AC-09) */

/** Le harnais, plus un vault sur le disque et les routes de l'interface. */
async function scopedHarness(t: TestContext) {
  const base = await harness(t)
  const { db, dir, sessions, registry, config, scheduler } = base
  const vault = join(dir, 'vault')
  await mkdir(vault, { recursive: true })
  await mkdir(config.paths.data, { recursive: true })
  db.insert(users).values({ id: 'admin', username: 'admin', displayName: 'admin', passwordHash: '', isAdmin: true, createdAt: 1 }).run()
  db.insert(users).values({ id: 'other', username: 'other', displayName: 'other', passwordHash: '', createdAt: 1 }).run()

  let as = 'owner'
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, as)).get()
  })
  registerErrorHandler(app)
  registerScheduleRoutes(app, { db, config } as never, sessions, registry, scheduler)
  t.after(() => app.close())

  const call = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, user = 'owner') => {
    as = user
    const response = await app.inject({ method, url, payload })
    return { status: response.statusCode, body: response.json() as ScheduledTaskDto & { error?: { code: string } } & { stdout?: string } }
  }
  const body = (overrides: object = {}) => ({ name: 'Ménage', agent: 'claude', config: DEFAULT_CLAUDE_CONFIG, prompt: 'Range.', cadence: null, ...overrides })
  const useVault = () => {
    ;(config as { vault: { path: string } }).vault.path = vault
  }
  return { ...base, vault, call, body, useVault }
}

test('a task created in a project has the project scope; one without, « no project »', async (t) => {
  const { db, task } = await harness(t)
  const inProject = task({ kind: 'interval', minutes: 10 })
  assert.equal(inProject.scope, 'project')
  assert.equal(tasksToDto(db, [inProject])[0]!.scope, 'project')

  const free = createScheduledTask(db, { projectId: null, userId: 'owner' }, onDemandInput())
  assert.equal(free.scope, 'none')
  assert.equal(free.projectId, null)
  const vault = createScheduledTask(db, { projectId: null, scope: 'vault', userId: 'owner' }, onDemandInput())
  assert.equal(tasksToDto(db, [vault])[0]!.scope, 'vault')
})

test('outside a project, a task runs neither in a new worktree nor confined', async (t) => {
  const { db } = await harness(t)
  const refused = (code: string) => (err: unknown) => err instanceof HttpError && err.code === code
  assert.throws(
    () => createScheduledTask(db, { projectId: null, scope: 'vault', userId: 'owner' }, onDemandInput({ worktreeMode: 'new' })),
    refused('schedule_worktree_needs_project'),
  )
  assert.throws(
    () => createScheduledTask(db, { projectId: null, scope: 'instance', userId: 'owner' }, onDemandInput({ confined: true })),
    refused('schedule_confined_needs_project'),
  )
  const free = createScheduledTask(db, { projectId: null, userId: 'owner' }, onDemandInput({ confined: false }))
  assert.throws(() => updateScheduledTask(db, free, { worktreeMode: 'new' }), refused('schedule_worktree_needs_project'))
  assert.throws(() => updateScheduledTask(db, free, { confined: true }), refused('schedule_confined_needs_project'))
})

test('the scoped body wants a project for the project scope, and none for the others', () => {
  const base = { name: 'x', agent: 'claude', config: DEFAULT_CLAUDE_CONFIG, prompt: 'x', cadence: null }
  assert.equal(createScopedScheduledTaskBodySchema.safeParse({ ...base, scope: 'project', projectId: 'p' }).success, true)
  assert.equal(createScopedScheduledTaskBodySchema.safeParse({ ...base, scope: 'project' }).success, false)
  assert.equal(createScopedScheduledTaskBodySchema.safeParse({ ...base, scope: 'vault', projectId: 'p' }).success, false)
  assert.equal(createScopedScheduledTaskBodySchema.safeParse({ ...base, scope: 'elsewhere' }).success, false)
  assert.equal(createScopedScheduledTaskBodySchema.parse({ ...base, scope: 'none' }).worktreeMode, 'root')
})

test('POST /api/schedules creates a task in a project, in the vault, on the instance or nowhere', async (t) => {
  const { call, body, useVault } = await scopedHarness(t)

  const none = await call('POST', '/api/schedules', body({ scope: 'none' }))
  assert.equal(none.status, 201)
  assert.equal(none.body.scope, 'none')
  assert.equal(none.body.projectId, null)

  const inProject = await call('POST', '/api/schedules', body({ scope: 'project', projectId: 'project' }))
  assert.equal(inProject.status, 201)
  assert.equal(inProject.body.scope, 'project')
  assert.equal(inProject.body.projectId, 'project')
  // Un projet privé d'un autre ne se devine pas.
  assert.equal((await call('POST', '/api/schedules', body({ scope: 'project', projectId: 'project' }), 'other')).status, 404)

  // Sans vault configuré, une tâche Savoir n'aurait nulle part où tourner.
  const unconfigured = await call('POST', '/api/schedules', body({ scope: 'vault' }))
  assert.equal(unconfigured.status, 400)
  assert.equal(unconfigured.body.error?.code, 'vault_unconfigured')
  useVault()
  const vault = await call('POST', '/api/schedules', body({ scope: 'vault' }))
  assert.equal(vault.status, 201)
  assert.equal(vault.body.scope, 'vault')

  // Le dossier de données tient la base et les secrets de tous les comptes.
  const notAdmin = await call('POST', '/api/schedules', body({ scope: 'instance' }))
  assert.equal(notAdmin.status, 403)
  const instance = await call('POST', '/api/schedules', body({ scope: 'instance' }), 'admin')
  assert.equal(instance.status, 201)
  assert.equal(instance.body.scope, 'instance')

  const tree = await call('POST', '/api/schedules', body({ scope: 'vault', worktreeMode: 'new' }))
  assert.equal(tree.status, 400)
  assert.equal(tree.body.error?.code, 'schedule_worktree_needs_project')

  // Hors projet, une tâche n'est visible que de son créateur.
  const mine = await call('GET', '/api/schedules')
  assert.deepEqual(
    (mine.body as unknown as ScheduledTaskDto[]).map((task) => task.scope).sort(),
    ['none', 'project', 'vault'],
  )
  const others = await call('GET', '/api/schedules', undefined, 'other')
  assert.deepEqual(others.body, [])
})

test('a run opens its session where its scope lives: the vault, the data folder, a folder of its own', async (t) => {
  const { db, config, scheduler, vault, useVault } = await scopedHarness(t)
  useVault()
  const cwdOf = async (scope: 'vault' | 'instance' | 'none') => {
    // L'instance est réservée aux administrateurs, à chaque tir.
    const userId = scope === 'instance' ? 'admin' : 'owner'
    const created = createScheduledTask(db, { projectId: null, scope, userId }, onDemandInput({ name: scope }))
    const run = await scheduler.runNow(created.id)
    assert.equal(run.status, 'running', run.error ?? '')
    const thread = db.select().from(conversations).where(eq(conversations.id, run.conversationId!)).get()!
    assert.equal(thread.projectId, null)
    return { thread, cwd: agentCwd(db, config, thread) }
  }

  const inVault = await cwdOf('vault')
  assert.equal(inVault.thread.place, 'vault')
  assert.equal(inVault.cwd, vault)
  const onInstance = await cwdOf('instance')
  assert.equal(onInstance.thread.place, 'instance')
  assert.equal(onInstance.cwd, config.paths.data)
  const nowhere = await cwdOf('none')
  assert.equal(nowhere.thread.place, null)
  assert.equal(nowhere.cwd, join(config.paths.threads, nowhere.thread.id))
})

test('a vault run whose vault is gone fails and says why, without opening a session', async (t) => {
  const { db, scheduler, sent, useVault, config } = await scopedHarness(t)
  useVault()
  const created = createScheduledTask(db, { projectId: null, scope: 'vault', userId: 'owner' }, onDemandInput())
  ;(config as { vault: { path: string } }).vault.path = ''
  const run = await scheduler.runNow(created.id)
  assert.equal(run.status, 'failed')
  assert.match(run.error ?? '', /vault/i)
  assert.equal(sent.length, 0)
})

test('a check script runs where its scope lives', async (t) => {
  const { db, scheduler, settled, vault, useVault, config } = await scopedHarness(t)
  useVault()
  const where = async (scope: 'vault' | 'instance') => {
    const created = createScheduledTask(
      db,
      { projectId: null, scope, userId: scope === 'instance' ? 'admin' : 'owner' },
      onDemandInput({ name: scope, checkScript: `pwd\nexit ${CHECK_SKIP_EXIT_CODE}` }),
    )
    await scheduler.runNow(created.id)
    const [run] = await settled(created.id)
    return run!.checkOutput?.trim()
  }
  assert.equal(await where('vault'), await realpath(vault))
  assert.equal(await where('instance'), await realpath(config.paths.data))
})

test('trying a check outside a project runs it where the scope lives', async (t) => {
  const { call, vault, useVault } = await scopedHarness(t)
  useVault()
  const tried = await call('POST', '/api/schedules/check-test', { scope: 'vault', script: 'pwd' })
  assert.equal(tried.status, 200)
  assert.equal(tried.body.stdout?.trim(), await realpath(vault))
  assert.equal((await call('POST', '/api/schedules/check-test', { scope: 'instance', script: 'pwd' })).status, 403)
})

test('the prompt of a run outside a project links the previous thread where it lives', () => {
  const prompt = buildRunPrompt({
    task: { name: 'Ménage', prompt: 'Range.', projectId: null, scope: 'vault', maxDurationMinutes: 30 },
    trigger: 'schedule',
    firedAt: Date.now(),
    previous: { startedAt: Date.now() - MINUTE, status: 'succeeded', conversationId: 'prev', summary: 'Rangé.', error: null },
    publicUrl: 'https://solera.example/',
  })
  assert.match(prompt, /https:\/\/solera\.example\/c\/prev /)
  assert.doesNotMatch(prompt, /\/p\/null\//)
  assert.match(prompt, /vault/)
})

test('an instance task stops running, and can no longer be changed, once its creator is no longer an administrator', async (t) => {
  const { db, call, body, scheduler, sent } = await scopedHarness(t)
  const created = await call('POST', '/api/schedules', body({ scope: 'instance' }), 'admin')
  db.update(users).set({ isAdmin: false }).where(eq(users.id, 'admin')).run()

  const patched = await call('PATCH', `/api/schedules/${created.body.id}`, { name: 'Autre' }, 'admin')
  assert.equal(patched.status, 403)
  const run = await scheduler.runNow(created.body.id)
  assert.equal(run.status, 'failed')
  assert.match(run.error ?? '', /administrat/)
  assert.equal(sent.length, 0)
})
