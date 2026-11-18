import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { conversations, openDatabase, projects, runMigrations, users, type ConversationRow } from '@solera/db'
import { MEMORY_INDEX_FILE, defaultConfigFor, type AgentConfig, type AgentKind } from '@solera/protocol'
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

// Une ligne qu'on ne trouve que dans l'index semé.
const MARKER = 'Note témoin du garde agentMemory'

/**
 * L'index absent, vu des deux façons dont le garde peut lâcher. Sans `memory !== null`,
 * l'appendice part avec un dossier nul : l'index ne se lit pas, mais l'en-tête et « La
 * mémoire est encore vide » entrent quand même — seul le titre le voit. Un garde qui
 * retomberait sur le vrai dossier ferait, lui, entrer la note témoin.
 */
function assertNoMemory(text: string) {
  assert.ok(!text.includes(MARKER), text)
  assert.doesNotMatch(text, /# Mémoire du projet/)
}

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
    adapter: (agent: AgentKind) => ({ rawFormat: 'test@1', binary: agent, cli: { managedDir: join(dir, 'agents') } }),
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
  }
  // Crée la conversation, puis rend le contexte que son runner transmettrait au CLI.
  const overviewOfNew = (id: string, agent: AgentKind, agentMemory: boolean) => {
    const agentConfig = { ...defaultConfigFor(agent), account: null, agentMemory } as AgentConfig
    db.insert(conversations).values({
      id, projectId: 'project', userId: 'owner', title: id, agent,
      config: JSON.stringify(agentConfig), status: 'idle', createdAt: 1, updatedAt: 1,
    }).run()
    const row = db.select().from(conversations).all().find((conversation) => conversation.id === id)!
    const context = (sessions as unknown as { buildContext(row: ConversationRow): RunnerContext }).buildContext(row)
    return context.projectOverview(agentConfig) ?? ''
  }
  return { memoryRoot, seedIndex, overviewOfNew }
}

test('Codex, mémoire permise : l’index entre dans le contexte transmis', async (t) => {
  const { seedIndex, overviewOfNew } = await manager(t)
  await seedIndex()
  const text = overviewOfNew('codex-on', 'codex', true)
  // Le témoin positif : sans lui, l'absence vérifiée plus bas pourrait venir d'un
  // contexte qui ne contient jamais l'index, quoi qu'on fasse.
  assert.match(text, /# Mémoire du projet/)
  assert.ok(text.includes(MARKER), text)
})

test('Codex, mémoire refusée par la conversation : l’index reste dehors', async (t) => {
  const { seedIndex, overviewOfNew } = await manager(t)
  await seedIndex()
  const text = overviewOfNew('codex-off', 'codex', false)
  assertNoMemory(text)
  // Le reste du contexte est bien là, serveur MCP compris : c'est la mémoire seule
  // qui manque, pas un contexte vide ou un serveur coupé qui l'aurait emportée avec lui.
  assert.match(text, /read_instructions/)
})

test('Codex, mémoire refusée par l’instance : la conversation qui la veut ne l’a pas', async (t) => {
  const { seedIndex, overviewOfNew } = await manager(t, { agentMemory: false })
  await seedIndex()
  const text = overviewOfNew('codex-instance-off', 'codex', true)
  assertNoMemory(text)
})

test('Codex, mémoire refusée sans index semé : le dossier n’est même pas créé', async (t) => {
  const { memoryRoot, overviewOfNew } = await manager(t)
  const text = overviewOfNew('codex-off-empty', 'codex', false)
  assertNoMemory(text)
  assert.equal(existsSync(join(memoryRoot, 'projects')), false, 'une mémoire refusée ne laisse pas de trace')
})

test('opencode suit le même garde que Codex', async (t) => {
  const { seedIndex, overviewOfNew } = await manager(t)
  await seedIndex()
  assert.ok(overviewOfNew('opencode-on', 'opencode', true).includes(MARKER))
  assertNoMemory(overviewOfNew('opencode-off', 'opencode', false))
})

test('Claude, mémoire permise : pas d’index injecté, il le charge de lui-même', async (t) => {
  const { seedIndex, overviewOfNew } = await manager(t)
  await seedIndex()
  const text = overviewOfNew('claude-on', 'claude', true)
  assertNoMemory(text)
})
