import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, type ProjectBackgroundDto } from '@solera/protocol'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerProjectBackgroundRoutes, type BackgroundProcess } from '../src/http/routes/project-background.js'
import { summarizeCommand } from '../src/services/command-line.js'

/**
 * Les travaux de fond d'un projet (#206) : ce que chaque session vivante a laissé
 * tourner, avec son départ et sa commande exacte, rapproché du processus que la page
 * Services montre pour la même chose.
 */
async function harness(t: TestContext, as: 'owner' | 'stranger' = 'owner') {
  const dir = await mkdtemp(join(tmpdir(), 'solera-project-background-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'stranger']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  for (const id of ['project', 'other']) {
    db.insert(projects)
      .values({ id, name: id, workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 })
      .run()
  }

  const conversation = (id: string, background: number, projectId = 'project', agent: 'claude' | 'codex' = 'claude') =>
    db.insert(conversations)
      .values({
        id, projectId, userId: 'owner', title: `Fil ${id}`, agent,
        config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle', backgroundCount: background,
        createdAt: 1, updatedAt: 1,
      })
      .run()

  const log = new EventLog(db)
  let processes: BackgroundProcess[] | null = []
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, as)).get()
  })
  registerErrorHandler(app)
  registerProjectBackgroundRoutes(app, { db, config: {} } as never, log, async () => processes)
  t.after(() => app.close())

  const background = async (projectId = 'project') => {
    const response = await app.inject({ method: 'GET', url: `/api/projects/${projectId}/background` })
    return { status: response.statusCode, body: response.json() as ProjectBackgroundDto[] }
  }
  const scanned = (list: BackgroundProcess[] | null) => { processes = list }
  return { conversation, log, background, scanned, db }
}

/** Ce que l'adaptateur Claude journalise pour un `Bash` lancé avec `run_in_background`. */
function launchBash(log: EventLog, conversationId: string, taskId: string, command: string, description = command) {
  const toolCallId = `call-${taskId}`
  log.append(conversationId, {
    type: 'tool.started', toolCallId, name: 'Bash', parentToolCallId: null,
    input: { command, description, run_in_background: true },
  })
  const started = log.append(conversationId, { type: 'task.started', taskId, toolCallId, kind: 'local_bash', description })
  return { toolCallId, startedAt: started.ts }
}

const entry = (id: string, conversationId: string | null, command: string, startedAt: number, kind: BackgroundProcess['kind'] = 'command') =>
  ({ id, kind, conversationId, command, startedAt })

test('une commande lancée en fond rend son départ, sa commande exacte et son appel', async (t) => {
  const { conversation, log, background } = await harness(t)
  conversation('serving', 1)
  const { toolCallId, startedAt } = launchBash(log, 'serving', 'b1', 'pnpm --filter web dev --port 5418', 'Serveur de dev')
  log.append('serving', { type: 'background.updated', tasks: [{ id: 'b1', kind: 'local_bash', description: 'Serveur de dev' }] })

  const { status, body } = await background()
  assert.equal(status, 200)
  assert.deepEqual(body, [{
    conversationId: 'serving',
    title: 'Fil serving',
    agent: 'claude',
    tasks: [{
      id: 'b1', kind: 'local_bash', description: 'Serveur de dev',
      startedAt, toolCallId, command: 'pnpm --filter web dev --port 5418', serviceId: null,
    }],
  }])
})

test("un workflow lancé par le harnais n'a ni commande ni appel, et part à sa première annonce", async (t) => {
  const { conversation, log, background } = await harness(t)
  conversation('flow', 1)
  const announced = log.append('flow', { type: 'background.updated', tasks: [{ id: 'w1', kind: 'local_workflow', description: 'Revue' }] })
  log.append('flow', { type: 'background.updated', tasks: [{ id: 'w1', kind: 'local_workflow', description: 'Revue' }] })

  const [group] = (await background()).body
  assert.deepEqual(group!.tasks, [{
    id: 'w1', kind: 'local_workflow', description: 'Revue',
    startedAt: announced.ts, toolCallId: null, command: null, serviceId: null,
  }])
})

test('seules les sessions du projet qui ont encore un travail ouvert y figurent', async (t) => {
  const { conversation, log, background } = await harness(t)
  conversation('quiet', 0)
  log.append('quiet', { type: 'background.updated', tasks: [{ id: 'stale', kind: 'local_bash', description: 'vieux' }] })
  conversation('finished', 1)
  launchBash(log, 'finished', 'done', 'pnpm test')
  log.append('finished', { type: 'background.updated', tasks: [{ id: 'done', kind: 'local_bash', description: 'pnpm test' }] })
  log.append('finished', { type: 'task.completed', taskId: 'done', status: 'completed', summary: '', durationMs: 10, ambient: false })
  conversation('elsewhere', 1, 'other')
  log.append('elsewhere', { type: 'background.updated', tasks: [{ id: 'x', kind: 'local_bash', description: 'ailleurs' }] })
  conversation('alive', 2, 'project', 'codex')
  log.append('alive', { type: 'background.updated', tasks: [
    { id: 'a1', kind: 'subagent', description: 'Explorer' },
    { id: 'a2', kind: 'subagent', description: 'Relire' },
  ] })

  const { body } = await background()
  assert.deepEqual(body.map((group) => [group.conversationId, group.agent, group.tasks.map((task) => task.id)]), [
    ['alive', 'codex', ['a1', 'a2']],
  ])
})

test('un travail est rapproché du processus de sa session qui porte la même commande', async (t) => {
  const { conversation, log, background, scanned } = await harness(t)
  conversation('serving', 1)
  conversation('twin', 1)
  const { startedAt } = launchBash(log, 'serving', 'b1', 'cd apps/web &&  vite --port 5418')
  log.append('serving', { type: 'background.updated', tasks: [{ id: 'b1', kind: 'local_bash', description: 'vite' }] })
  launchBash(log, 'twin', 't1', 'pnpm test --watch')
  log.append('twin', { type: 'background.updated', tasks: [{ id: 't1', kind: 'local_bash', description: 'tests' }] })
  scanned([
    // La même commande sous une autre session : ce n'est pas la sienne.
    entry('p-other', 'twin', 'cd apps/web && vite --port 5418', startedAt),
    // Le scan abrège les espaces : la commande du journal s'y compare abrégée de même.
    entry('p-vite', 'serving', 'cd apps/web && vite --port 5418', startedAt + 40),
    entry('p-tests', 'twin', 'pnpm test --watch', startedAt + 80),
    entry('p-helper', 'twin', 'pnpm test --watch', startedAt + 80, 'helper'),
  ])

  const { body } = await background()
  const serviceOf = Object.fromEntries(body.flatMap((group) => group.tasks.map((task) => [task.id, task.serviceId])))
  assert.deepEqual(serviceOf, { b1: 'p-vite', t1: 'p-tests' })
})

test("deux travaux à la même commande se rapprochent de leurs processus dans l'ordre de leur départ", async (t) => {
  const { conversation, log, background, scanned } = await harness(t)
  conversation('serving', 2)
  const first = launchBash(log, 'serving', 'b1', 'pnpm dev')
  const second = launchBash(log, 'serving', 'b2', 'pnpm dev')
  log.append('serving', { type: 'background.updated', tasks: [
    { id: 'b1', kind: 'local_bash', description: 'dev' },
    { id: 'b2', kind: 'local_bash', description: 'dev' },
  ] })
  scanned([
    entry('late', 'serving', 'pnpm dev', second.startedAt + 5_000),
    entry('early', 'serving', 'pnpm dev', first.startedAt - 5_000),
  ])

  const [group] = (await background()).body
  assert.deepEqual(group!.tasks.map((task) => [task.id, task.serviceId]), [['b1', 'early'], ['b2', 'late']])
})

test('sans scan des processus, les travaux restent, sans rapprochement', async (t) => {
  const { conversation, log, background, scanned } = await harness(t)
  conversation('serving', 1)
  launchBash(log, 'serving', 'b1', 'pnpm dev')
  log.append('serving', { type: 'background.updated', tasks: [{ id: 'b1', kind: 'local_bash', description: 'dev' }] })
  scanned(null)

  const [group] = (await background()).body
  assert.equal(group!.tasks[0]!.command, 'pnpm dev')
  assert.equal(group!.tasks[0]!.serviceId, null)
})

test('un projet privé reste fermé à qui ne le possède pas', async (t) => {
  const { background } = await harness(t, 'stranger')
  assert.equal((await background()).status, 404)
})

test("le processus réel d'un Bash de fond, enrobé par Claude, se reconnaît à la commande du journal", async (t) => {
  const { conversation, log, background, scanned } = await harness(t)
  conversation('serving', 1)
  const command = "npm run dev -- --port 5173 && echo 'ok'"
  const { startedAt } = launchBash(log, 'serving', 'b1', command)
  log.append('serving', { type: 'background.updated', tasks: [{ id: 'b1', kind: 'local_bash', description: 'dev' }] })
  // L'argv du shell tel que le scan le lit : snapshot, `eval '…'` aux apostrophes doublées,
  // entrée redirigée d'une tâche de fond, sauvegarde du dossier courant.
  const argv = ['/usr/bin/zsh', '-c', `source ~/.claude/shell-snapshots/snapshot-zsh-1.sh 2>/dev/null || true && eval 'npm run dev -- --port 5173 && echo '"'"'ok'"'"'' < /dev/null && pwd -P >| /tmp/claude-1-cwd`]
  scanned([entry('p-dev', 'serving', summarizeCommand(argv)!, startedAt + 30)])

  const [group] = (await background()).body
  assert.equal(group!.tasks[0]!.serviceId, 'p-dev')
})

test("un projet partagé s'ouvre à qui ne le possède pas", async (t) => {
  const { conversation, log, background, db } = await harness(t, 'stranger')
  db.update(projects).set({ visibility: 'shared' }).where(eq(projects.id, 'project')).run()
  conversation('serving', 1)
  launchBash(log, 'serving', 'b1', 'pnpm dev')
  log.append('serving', { type: 'background.updated', tasks: [{ id: 'b1', kind: 'local_bash', description: 'dev' }] })

  const { status, body } = await background()
  assert.equal(status, 200)
  assert.deepEqual(body.map((group) => group.conversationId), ['serving'])
})
