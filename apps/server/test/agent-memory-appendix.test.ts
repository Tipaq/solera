import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { conversations, openDatabase, projects, runMigrations, users, type ConversationRow } from '@solera/db'
import {
  DEFAULT_CLAUDE_CONFIG,
  DEFAULT_CODEX_CONFIG,
  DEFAULT_OPENCODE_CONFIG,
  MEMORY_INDEX_FILE,
  type AgentConfig,
} from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { RunnerContext } from '../src/agents/types.js'
import { CodexAccountHomes } from '../src/codex-accounts/homes.js'
import { CodexAccountStore } from '../src/codex-accounts/store.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { ensureProjectMemory } from '../src/memory/store.js'
import type { SecretStore } from '../src/secrets/store.js'
import { SessionManager } from '../src/sessions/session-manager.js'

/**
 * Le troisième chemin de la famille `agentMemory` : l'index de mémoire que `buildContext`
 * injecte à Codex et opencode, qui n'ont pas de mémoire native. Les deux autres (le
 * dossier de Claude, les outils du serveur MCP) ont leurs tests ; celui-ci passe par le
 * garde `memory !== null`, et c'est ce garde qu'on éprouve ici, pas
 * `memoryAppendixForCodex` lui-même.
 */

// Une ligne qu'on ne trouve que dans l'index semé : sa présence dit que l'index est
// entré, son absence qu'il est resté dehors.
const MARKER = 'Note témoin du garde agentMemory'

type Agent = 'claude' | 'codex' | 'opencode'
const DEFAULTS = { claude: DEFAULT_CLAUDE_CONFIG, codex: DEFAULT_CODEX_CONFIG, opencode: DEFAULT_OPENCODE_CONFIG }

async function manager(t: TestContext, instance: { agentMemory: boolean } = { agentMemory: true }) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-agent-memory-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Owner', passwordHash: '', createdAt: 1 }).run()
  const workspace = join(dir, 'project')
  await mkdir(workspace)
  db.insert(projects).values({ id: 'project', name: 'Projet', workspacePath: workspace, ownerId: 'owner', visibility: 'private', instructionsMode: 'solera', createdAt: 1 }).run()

  // Une session Codex part sur le premier compte connecté : sans lui, pas de runner.
  const previous = process.env.CODEX_HOME
  process.env.CODEX_HOME = join(dir, 'user-codex')
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous })
  const codexAccounts = { store: new CodexAccountStore(db), homes: new CodexAccountHomes(join(dir, 'codex-accounts')) }
  const perso = codexAccounts.store.create('owner', 'Perso')
  codexAccounts.store.setIdentity(perso.id, { authMode: 'chatgpt', email: null, planType: null })

  const memoryRoot = join(dir, 'memory')
  const registry = {
    adapter: (agent: Agent) => ({ rawFormat: 'test@1', binary: agent, cli: { managedDir: join(dir, 'agents') } }),
  } as unknown as AgentRegistry
  const config = {
    server: { host: '0.0.0.0', port: 7517, publicUrl: '', agentUrl: '' },
    paths: { threads: join(dir, 'threads'), memory: memoryRoot, attachments: join(dir, 'attachments'), data: dir, skillLibrary: join(dir, 'skills') },
    limits: { maxConcurrentSessions: 2, sessionIdleTimeoutMin: 30 },
    mcp: { soleraServer: true, agentMemory: instance.agentMemory, projectFiling: false, cardFiling: true, decisions: true },
    skills: {},
  } as unknown as Config
  const sessions = new SessionManager(db, new EventLog(db), config, registry, {} as SecretStore, {} as never, codexAccounts, {} as never)

  const seedIndex = async () => {
    const memory = ensureProjectMemory(memoryRoot, 'project', workspace)
    await writeFile(join(memory, MEMORY_INDEX_FILE), `- [Témoin](temoin.md) — ${MARKER}\n`)
    return memory
  }
  const overview = (id: string, agent: Agent, agentMemory: boolean) => {
    const config = { ...DEFAULTS[agent], account: null, agentMemory } as AgentConfig
    db.insert(conversations).values({
      id, projectId: 'project', userId: 'owner', title: id, agent,
      config: JSON.stringify(config), status: 'idle', createdAt: 1, updatedAt: 1,
    }).run()
    const row = db.select().from(conversations).all().find((conversation) => conversation.id === id)!
    const context = (sessions as unknown as { buildContext(row: ConversationRow): RunnerContext }).buildContext(row)
    return context.projectOverview(config) ?? ''
  }
  return { memoryRoot, seedIndex, overview }
}

test('Codex, mémoire permise : l index entre dans le contexte transmis', async (t) => {
  const { seedIndex, overview } = await manager(t)
  await seedIndex()
  const text = overview('codex-on', 'codex', true)
  // Le témoin positif : sans lui, l'absence vérifiée plus bas pourrait venir d'un
  // contexte qui ne contient jamais l'index, quoi qu'on fasse.
  assert.match(text, /# Mémoire du projet/)
  assert.ok(text.includes(MARKER), text)
})

test('Codex, mémoire refusée par la conversation : l index reste dehors', async (t) => {
  const { seedIndex, overview } = await manager(t)
  await seedIndex()
  const text = overview('codex-off', 'codex', false)
  assert.ok(!text.includes(MARKER), text)
  assert.doesNotMatch(text, /# Mémoire du projet/)
  // Le reste du contexte est bien là : c'est l'index seul qui manque, pas tout.
  assert.notEqual(text, '')
})

test('Codex, mémoire refusée par l instance : la conversation qui la veut ne l a pas', async (t) => {
  const { seedIndex, overview } = await manager(t, { agentMemory: false })
  await seedIndex()
  const text = overview('codex-instance-off', 'codex', true)
  assert.ok(!text.includes(MARKER), text)
  assert.doesNotMatch(text, /# Mémoire du projet/)
})

test('Codex, mémoire refusée sans index semé : le dossier n est même pas créé', async (t) => {
  const { memoryRoot, overview } = await manager(t)
  const text = overview('codex-off-empty', 'codex', false)
  assert.doesNotMatch(text, /# Mémoire du projet/)
  assert.equal(existsSync(join(memoryRoot, 'projects')), false, 'une mémoire refusée ne laisse pas de trace')
})

test('opencode suit le même garde que Codex', async (t) => {
  const { seedIndex, overview } = await manager(t)
  await seedIndex()
  assert.ok(overview('opencode-on', 'opencode', true).includes(MARKER))
  assert.ok(!overview('opencode-off', 'opencode', false).includes(MARKER))
})

test('Claude, mémoire permise : pas d index injecté, il le charge de lui-même', async (t) => {
  const { seedIndex, overview } = await manager(t)
  await seedIndex()
  const text = overview('claude-on', 'claude', true)
  assert.ok(!text.includes(MARKER), text)
  assert.doesNotMatch(text, /# Mémoire du projet/)
})
