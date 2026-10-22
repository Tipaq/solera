import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import {
  conversations,
  openDatabase,
  projects,
  runMigrations,
  users,
  worktrees,
  type ConversationRow,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { AgentRunner } from '../src/agents/types.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { HttpError } from '../src/http/errors.js'
import type { SecretStore } from '../src/secrets/store.js'
import { SessionManager } from '../src/sessions/session-manager.js'
import { projectCwd, resolveConversationCwd } from '../src/workspace.js'
import { directoryGone } from '../src/worktrees/gone.js'

/**
 * Une conversation dont le worktree a disparu (cartes #60 et #61).
 *
 * Un worktree emporté par git, au merge d'une PR avec `--delete-branch`, garde sa ligne
 * sans `removedAt` : la conversation pointe toujours dessus, et un CLI lancé là finit en
 * `ENOENT` que le SDK présente comme une affaire de libc. Ce qu'on garde ici : aucun CLI
 * ne part, le worktree est marqué pour tout le monde, rien ne retombe en silence sur la
 * racine, et *Continuer à la racine* est la seule issue qui la rattache.
 */

const LAUNCH_ATTEMPT = 'tentative de lancement'

async function harness(t: TestContext, { agent = 'claude' as ConversationRow['agent'] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-worktree-gone-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  const workspace = join(dir, 'project')
  const worktreePath = join(dir, 'worktrees', 'feat__familles')
  await mkdir(workspace)
  await mkdir(worktreePath, { recursive: true })
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: workspace, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  db.insert(worktrees).values({
    id: 'wt', projectId: 'project', name: 'feat/familles', path: worktreePath,
    baseRef: 'main', createdBy: 'owner', createdAt: 1, removedAt: null,
  }).run()

  const conversation = (id: string, worktreeId: string | null): ConversationRow => ({
    id, projectId: 'project', worktreeId, cardId: null, userId: 'owner', title: id,
    titleSetByUser: false, agent, agentSessionId: 'native', forkedFromId: null,
    handoffFromId: null, createdByTokenId: null, originLabel: null, scheduleId: null,
    config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle',
    backgroundCount: 0, loopCount: 0, lastSeq: 0, lastNotableSeq: 0, turnCount: 0,
    journalBytes: 0, contextUsedTokens: null, contextMaxTokens: null, model: null,
    costUsd: 0, inputTokens: 0, outputTokens: 0, pinned: false, position: 0,
    archivedAt: null, createdAt: 1, updatedAt: 1,
  } as ConversationRow)
  db.insert(conversations).values(conversation('conv', 'wt')).run()
  db.insert(conversations).values(conversation('other', null)).run()

  // Le registre ne lance rien : un appel à `adapter` est une tentative de lancement,
  // qu'on compte et qu'on arrête là.
  const launched: string[] = []
  const registry = {
    adapter: (kind: string) => {
      launched.push(kind)
      throw new Error(LAUNCH_ATTEMPT)
    },
  } as unknown as AgentRegistry
  const config = {
    paths: { threads: join(dir, 'threads') },
    limits: { maxConcurrentSessions: 1, sessionIdleTimeoutMin: 30 },
    retention: { autoArchiveDays: 0, autoArchiveSchedule: '0 4 * * *' },
    vault: { path: '' },
  } as unknown as Config
  const log = new EventLog(db)
  const sessions = new SessionManager(db, log, config, registry, {} as SecretStore, {} as never, {} as never)
  const lists: string[] = []
  sessions.statusBus.on('lists', ({ conversationId }: { conversationId: string }) => lists.push(conversationId))

  /** Pose un runner vivant, comme si un envoi précédent l'avait démarré. */
  const liveRunner = (conversationId: string, status: ConversationRow['status'] = 'idle') => {
    const runner = {
      conversationId,
      sent: [] as string[],
      stopped: false,
      async send(text: string) { this.sent.push(text) },
      async stop() { this.stopped = true },
    }
    const internals = sessions as unknown as { runners: Map<string, unknown> }
    internals.runners.set(conversationId, {
      runner: runner as unknown as AgentRunner,
      lastActivity: Date.now(), status, idleTimer: null, background: 0, loops: 0, pendingRestart: null,
    })
    return runner
  }

  const removedAt = () => db.select().from(worktrees).where(eq(worktrees.id, 'wt')).get()?.removedAt ?? null
  const row = (id: string) => db.select().from(conversations).where(eq(conversations.id, id)).get()!
  const errors = (id: string) =>
    log.read(id, 0, 100).map((entry) => entry.event).filter((event) => event.type === 'error')

  return { db, dir, workspace, worktreePath, log, sessions, launched, lists, liveRunner, removedAt, row, errors }
}

const missing = (err: unknown) =>
  err instanceof HttpError && err.statusCode === 409 && err.code === 'working_directory_missing'

test('un worktree emporté par git refuse l\'envoi, sans lancer de CLI, et se marque retiré', async (t) => {
  const h = await harness(t)
  await rm(h.worktreePath, { recursive: true })

  await assert.rejects(h.sessions.sendMessage('conv', 'c1', 'Tu vois mes messages ?'), missing)
  assert.deepEqual(h.launched, [])
  assert.notEqual(h.removedAt(), null)
  assert.deepEqual(h.lists, ['conv'])
})

test('les essais répétés n\'empilent aucune erreur dans le fil : l\'état est porté par la conversation', async (t) => {
  const h = await harness(t)
  await rm(h.worktreePath, { recursive: true })

  for (const id of ['c1', 'c2', 'c3']) {
    await assert.rejects(h.sessions.sendMessage('conv', id, 'encore ?'), missing)
  }
  assert.deepEqual(h.errors('conv'), [])
})

test('un runner déjà vivant dont le worktree disparaît est arrêté, et ne reçoit rien', async (t) => {
  const h = await harness(t)
  const runner = h.liveRunner('conv')
  await rm(h.worktreePath, { recursive: true })

  await assert.rejects(h.sessions.sendMessage('conv', 'c1', 'et maintenant ?'), missing)
  assert.deepEqual(runner.sent, [])
  assert.equal(runner.stopped, true)
  assert.equal(h.sessions.activeCount(), 0)
})

test('un fichier à la place du dossier ne fait pas un cwd', async (t) => {
  const h = await harness(t)
  await rm(h.worktreePath, { recursive: true })
  await writeFile(h.worktreePath, 'pas un dossier')

  await assert.rejects(h.sessions.sendMessage('conv', 'c1', 'bonjour'), missing)
  assert.deepEqual(h.launched, [])
})

test('le dossier du projet supprimé refuse aussi, sans rien marquer', async (t) => {
  const h = await harness(t)
  await rm(h.workspace, { recursive: true })

  await assert.rejects(
    h.sessions.sendMessage('other', 'c1', 'bonjour'),
    (err: unknown) => missing(err) && (err as HttpError).params?.path === h.workspace,
  )
  assert.deepEqual(h.launched, [])
  assert.equal(h.removedAt(), null)
})

test('le refus passe avant `makeRoom` : il n\'évince pas un runner vivant', async (t) => {
  const h = await harness(t)
  // Plafond à 1, occupé par une autre conversation au repos : `makeRoom` l'arrêterait.
  const other = h.liveRunner('other')
  await rm(h.worktreePath, { recursive: true })

  await assert.rejects(h.sessions.sendMessage('conv', 'c1', 'bonjour'), missing)
  assert.equal(other.stopped, false)
  assert.equal(h.sessions.activeCount(), 1)
})

test('un message en file reste en file quand le worktree disparaît, et part après *Continuer à la racine*', async (t) => {
  const h = await harness(t)
  h.liveRunner('conv', 'running')
  await h.sessions.sendMessage('conv', 'c1', 'à la fin du tour')
  await rm(h.worktreePath, { recursive: true })

  // Fin du tour : la file tente de partir et tombe sur le dossier disparu.
  const internals = h.sessions as unknown as { flushQueue(id: string): Promise<void>; runners: Map<string, { status: string }> }
  internals.runners.get('conv')!.status = 'idle'
  await internals.flushQueue('conv')
  assert.deepEqual(h.errors('conv'), [])
  const dequeued = h.log.read('conv', 0, 100).map((entry) => entry.event).filter((event) => event.type === 'message.dequeued')
  assert.deepEqual(dequeued, [])

  const row = await h.sessions.continueAtProjectRoot('conv')
  assert.equal(row.worktreeId, null)
  // Claude reprend sa session depuis un autre dossier : l'identifiant reste.
  assert.equal(row.agentSessionId, 'native')
  assert.equal(h.sessions.workingDirectory('conv'), h.workspace)
  // Le message en attente part, depuis la racine : le lancement est tenté.
  for (let i = 0; i < 100 && h.errors('conv').length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.deepEqual(h.launched, ['claude'])
  const [failure] = h.errors('conv')
  assert.ok(failure?.type === 'error')
  assert.equal(failure.code, 'queued_message_failed')
  assert.match(failure.message, new RegExp(LAUNCH_ATTEMPT))
})

test('*Continuer à la racine* est refusé tant que le worktree existe', async (t) => {
  const h = await harness(t)
  await assert.rejects(
    h.sessions.continueAtProjectRoot('conv'),
    (err: unknown) => err instanceof HttpError && err.code === 'worktree_not_gone',
  )
  assert.equal(h.row('conv').worktreeId, 'wt')
})

test('opencode repart sur une session neuve à la racine', async (t) => {
  const h = await harness(t, { agent: 'opencode' })
  await rm(h.worktreePath, { recursive: true })

  const row = await h.sessions.continueAtProjectRoot('conv')
  assert.equal(row.agentSessionId, null)
  assert.equal(h.row('conv').agentSessionId, null)
})

test('un worktree retiré ne retombe plus en silence sur le workspace', async (t) => {
  const h = await harness(t)
  h.db.update(worktrees).set({ removedAt: 5 }).where(eq(worktrees.id, 'wt')).run()

  assert.throws(() => resolveConversationCwd(h.db, h.row('conv')), missing)
  assert.throws(
    () => projectCwd(h.db, 'project', 'owner', 'wt'),
    (err: unknown) => err instanceof HttpError && err.code === 'worktree_not_found',
  )
})

test('le message d\'une erreur en file interpole ses paramètres', async (t) => {
  const h = await harness(t)
  h.liveRunner('other', 'running')
  await h.sessions.sendMessage('other', 'c1', 'plus tard')
  await rm(h.workspace, { recursive: true })

  const internals = h.sessions as unknown as { flushQueue(id: string): Promise<void>; runners: Map<string, { status: string }> }
  internals.runners.get('other')!.status = 'idle'
  await internals.flushQueue('other')
  const [failure] = h.errors('other')
  assert.ok(failure?.type === 'error')
  assert.equal(failure.code, 'queued_message_failed')
  assert.ok(failure.message.includes(h.workspace))
  assert.doesNotMatch(failure.message, /\{path\}/)
})

test('une erreur passagère du disque ne marque rien : seuls ENOENT et ENOTDIR disent une absence', async (t) => {
  const h = await harness(t)
  // Un parent illisible : `stat` répond EACCES, comme un montage momentanément absent.
  const parent = join(h.dir, 'worktrees')
  await chmod(parent, 0o000)
  try {
    assert.equal(directoryGone(h.worktreePath), false)
    await assert.rejects(h.sessions.sendMessage('conv', 'c1', 'bonjour'))
  } finally {
    // Avant le nettoyage du dossier de test, qui ne saurait pas le parcourir.
    await chmod(parent, 0o755)
  }
  assert.equal(h.removedAt(), null)
})

test('une conversation supprimée avec un message en file ne fait pas de rejet non géré', async (t) => {
  const h = await harness(t)
  h.liveRunner('conv', 'running')
  await h.sessions.sendMessage('conv', 'c1', 'à la fin du tour')
  h.db.delete(conversations).where(eq(conversations.id, 'conv')).run()

  const internals = h.sessions as unknown as { flushQueue(id: string): Promise<void>; runners: Map<string, { status: string }> }
  internals.runners.get('conv')!.status = 'idle'
  await internals.flushQueue('conv')
})
