import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
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
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { HttpError } from '../src/http/errors.js'
import type { SecretStore } from '../src/secrets/store.js'
import { SessionManager } from '../src/sessions/session-manager.js'

/**
 * Une conversation dont le dossier a disparu (carte #60).
 *
 * Un worktree supprimé hors de Solera, au merge d'une PR avec `--delete-branch`, garde
 * sa ligne sans `removedAt` : la conversation pointe toujours dessus. Lancer le CLI là
 * finit en `ENOENT` que le SDK présente comme une affaire de libc. Ce qu'on garde ici :
 * aucun CLI ne part, et le fil dit pourquoi en nommant le worktree.
 */

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-missing-cwd-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  const workspace = join(dir, 'project')
  await mkdir(workspace)
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: workspace, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  // Jamais créé sur le disque : c'est l'état où le laisse un worktree retiré par git.
  db.insert(worktrees).values({
    id: 'wt', projectId: 'project', name: 'feat/familles', path: join(dir, 'worktrees', 'feat__familles'),
    baseRef: 'main', createdBy: 'owner', createdAt: 1, removedAt: null,
  }).run()

  const row: ConversationRow = {
    id: 'conv', projectId: 'project', worktreeId: 'wt', cardId: null, userId: 'owner', title: 'conv',
    titleSetByUser: false, agent: 'claude', agentSessionId: 'native', forkedFromId: null,
    createdByTokenId: null, originLabel: null, scheduleId: null,
    config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle',
    backgroundCount: 0, loopCount: 0, lastSeq: 0, lastNotableSeq: 0, turnCount: 0,
    journalBytes: 0, contextUsedTokens: null, contextMaxTokens: null, model: null,
    costUsd: 0, inputTokens: 0, outputTokens: 0, pinned: false, position: 0,
    archivedAt: null, createdAt: 1, updatedAt: 1,
  }
  db.insert(conversations).values(row).run()

  const launched: string[] = []
  const registry = {
    adapter: (agent: string) => {
      launched.push(agent)
      throw new Error('aucun CLI ne devait être lancé')
    },
  } as unknown as AgentRegistry
  const config = { paths: { threads: join(dir, 'threads') } } as unknown as Config
  const log = new EventLog(db)
  const sessions = new SessionManager(db, log, config, registry, {} as SecretStore)

  return { log, sessions, launched }
}

test('un message à une conversation dont le worktree a disparu ne lance aucun CLI, et le fil le dit', async (t) => {
  const { log, sessions, launched } = await harness(t)

  await assert.rejects(
    sessions.sendMessage('conv', 'client-1', 'Tu vois mes messages ?'),
    (err: unknown) =>
      err instanceof HttpError && err.statusCode === 409 && err.code === 'working_directory_missing',
  )
  assert.deepEqual(launched, [])

  const errors = log
    .read('conv', 0, 100)
    .map((entry) => entry.event)
    .filter((event) => event.type === 'error')
  assert.equal(errors.length, 1)
  const [error] = errors
  assert.ok(error?.type === 'error')
  assert.equal(error.code, 'working_directory_missing')
  assert.match(error.message, /worktree « feat\/familles »/)
  assert.doesNotMatch(error.message, /libc/)
})
