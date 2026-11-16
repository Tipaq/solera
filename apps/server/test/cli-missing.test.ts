import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { openDatabase, projects, runMigrations, scheduledRuns, users } from '@solera/db'
import {
  DEFAULT_CLAUDE_CONFIG,
  DEFAULT_CODEX_CONFIG,
  DEFAULT_GROK_CONFIG,
  DEFAULT_OPENCODE_CONFIG,
  type AgentConfig,
  type AgentKind,
} from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { HttpError } from '../src/http/errors.js'
import { TaskScheduler } from '../src/scheduler/task-scheduler.js'
import { createScheduledTask } from '../src/scheduler/tasks.js'
import type { SecretStore } from '../src/secrets/store.js'
import { SessionManager } from '../src/sessions/session-manager.js'
import { createConversation } from '../src/conversations/create.js'

/**
 * Un CLI introuvable (#41).
 *
 * Lancé sous son nom nu, il mourait loin du lancement : `spawn ENOENT` pour Codex,
 * OpenCode et Grok, sans rien au journal, et pour Claude la phrase du SDK sur son option
 * `pathToClaudeCodeExecutable`. Ce qu'on garde ici : aucun runner ne naît, le refus
 * nomme le CLI et où il a été cherché, et le tir planifié le recopie.
 */

const AGENTS: [AgentKind, AgentConfig, string][] = [
  ['claude', DEFAULT_CLAUDE_CONFIG, 'Claude Code'],
  ['codex', DEFAULT_CODEX_CONFIG, 'Codex'],
  ['opencode', DEFAULT_OPENCODE_CONFIG, 'OpenCode'],
  ['grok', DEFAULT_GROK_CONFIG, 'Grok Build'],
]

async function harness(t: TestContext, agent: AgentKind, label: string, binary = `solera-absent-${agent}`) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-cli-missing-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  const workspace = join(dir, 'project')
  await mkdir(workspace)
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: workspace, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()

  // Le préfixe géré existe, vide : le CLI n'est ni là, ni dans le PATH.
  const managedDir = join(dir, 'agents')
  await mkdir(join(managedDir, 'bin'), { recursive: true })
  const runners: string[] = []
  const registry = {
    adapter: () => ({
      label,
      binary,
      cli: { managedDir },
      resolveDefaults: async (config: AgentConfig) => config,
      createRunner: () => {
        runners.push(agent)
        throw new Error('un runner est né')
      },
    }),
  } as unknown as AgentRegistry
  const config = {
    paths: { threads: join(dir, 'threads'), worktrees: join(dir, 'worktrees'), data: join(dir, 'data') },
    server: { publicUrl: 'https://solera.example/' },
    limits: { maxConcurrentSessions: 1, sessionIdleTimeoutMin: 30 },
    retention: { autoArchiveDays: 0, autoArchiveSchedule: '0 4 * * *' },
    vault: { path: '' },
  } as unknown as Config
  const log = new EventLog(db)
  const sessions = new SessionManager(db, log, config, registry, {} as SecretStore, {} as never, {} as never)
  const scheduler = new TaskScheduler({ db, config }, sessions, registry, log)
  return { db, dir, managedDir, sessions, scheduler, runners }
}

const refusal = (code: string, ...fragments: string[]) => (err: unknown) => {
  assert.ok(err instanceof HttpError, String(err))
  assert.equal(err.code, code)
  const message = err.message.replace(/\{(\w+)\}/g, (_, key: string) => String(err.params?.[key]))
  for (const fragment of fragments) assert.ok(message.includes(fragment), `« ${fragment} » manque à : ${message}`)
  return true
}

for (const [agent, config, label] of AGENTS) {
  test(`${agent} : un CLI introuvable refuse l'envoi en le nommant, sans lancer de runner`, async (t) => {
    const h = await harness(t, agent, label)
    await assert.rejects(
      createConversation(h.db, h.sessions, {
        projectId: 'project', userId: 'owner', agent, config, worktreeId: null, cardId: null,
        firstMessage: { clientMessageId: 'c1', text: 'bonjour', attachments: [], mentions: [], skills: [] },
      } as Parameters<typeof createConversation>[2]),
      refusal('agent_cli_not_found', label, `"solera-absent-${agent}"`, join(h.managedDir, 'bin'), 'PATH'),
    )
    assert.deepEqual(h.runners, [])
  })

  test(`${agent} : le tir planifié dit que le CLI est introuvable`, async (t) => {
    const h = await harness(t, agent, label)
    const task = createScheduledTask(
      h.db,
      { projectId: 'project', userId: 'owner' },
      { name: 'Veille', agent, config, prompt: 'Sonde.', cadence: { kind: 'interval', minutes: 10 }, overlapPolicy: 'skip', maxDurationMinutes: 30, enabled: true },
    )
    await h.scheduler.tick(task.nextRunAt!)
    const [run] = h.db.select().from(scheduledRuns).all()
    assert.equal(run?.status, 'failed')
    assert.equal(
      run?.error,
      `Lancement impossible : The ${label} CLI cannot be found: "solera-absent-${agent}" is neither in ${join(h.managedDir, 'bin')} nor on the PATH of the Solera service. Install it from Settings › Agents.`,
    )
    assert.deepEqual(h.runners, [])
  })
}

test('un chemin réglé qui n\'est pas exécutable est refusé en le citant', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-cli-configured-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const configured = join(dir, 'claude')
  await writeFile(configured, '#!/bin/sh\n')
  await chmod(configured, 0o600)
  const h = await harness(t, 'claude', 'Claude Code', configured)
  await assert.rejects(
    createConversation(h.db, h.sessions, {
      projectId: 'project', userId: 'owner', agent: 'claude', config: DEFAULT_CLAUDE_CONFIG, worktreeId: null, cardId: null,
      firstMessage: { clientMessageId: 'c1', text: 'bonjour', attachments: [], mentions: [], skills: [] },
    } as Parameters<typeof createConversation>[2]),
    refusal('agent_cli_unavailable', 'Claude Code', `"${configured}"`),
  )
  assert.deepEqual(h.runners, [])
})
