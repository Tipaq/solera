import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, userSettings, users, type Db } from '@solera/db'
import {
  DEFAULT_CLAUDE_CONFIG,
  DEFAULT_CODEX_CONFIG,
  parseAgentConfig,
  readProjectLayer,
  type AgentConfig,
} from '@solera/protocol'
import { backfillConfigLayers } from '../src/conversations/config-backfill.js'
import {
  patchOverrides,
  readOverrides,
  refreshConversationConfig,
  refreshConversationConfigs,
  resolveConversationConfig,
} from '../src/conversations/config-inheritance.js'
import { createConversation } from '../src/conversations/create.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { readUserSettings, writeUserAgentDefault, writeUserAgentLayer } from '../src/settings/user-settings.js'

/**
 * La migration de l'héritage vivant (#120) et l'héritage lui-même, sur une vraie base.
 *
 * Le critère de la migration est écrit dans la carte : aucun réglage déjà posé ne se perd.
 * Chaque test le vérifie de la même façon — la configuration effective d'avant égale celle
 * d'après — avant de regarder ce qui est devenu hérité.
 */

async function database(t: TestContext): Promise<Db> {
  const dir = await mkdtemp(join(tmpdir(), 'solera-config-backfill-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  for (const id of ['tim', 'other']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects)
    .values({ id: 'solera', name: 'Solera', workspacePath: dir, ownerId: 'tim', visibility: 'shared', createdAt: 1 })
    .run()
  return db
}

function legacyAccount(db: Db, userId: string, agentDefaults: Record<string, AgentConfig>): void {
  db.insert(userSettings)
    .values({ userId, data: JSON.stringify({ agentDefaults, collapsedProjects: ['p'] }) })
    .run()
}

function legacyConversation(db: Db, id: string, config: AgentConfig, projectId: string | null = 'solera', userId = 'tim'): void {
  db.insert(conversations)
    .values({
      id,
      projectId,
      userId,
      title: id,
      agent: config.agent,
      config: JSON.stringify(config),
      status: 'idle',
      createdAt: 1,
      updatedAt: 1,
    })
    .run()
}

function row(db: Db, id: string) {
  const found = db.select().from(conversations).where(eq(conversations.id, id)).get()
  assert.ok(found, `conversation ${id}`)
  return found
}

const identity = { adapter: () => ({ resolveDefaults: async (config: AgentConfig) => config }) }

test('la migration ne perd aucun réglage, et ne retient que les écarts', async (t) => {
  const db = await database(t)
  const timClaude: AgentConfig = { ...DEFAULT_CLAUDE_CONFIG, model: 'opus', effort: 'high', cardFiling: false }
  legacyAccount(db, 'tim', { claude: timClaude, codex: { ...DEFAULT_CODEX_CONFIG, cardFiling: false } })
  // Le préréglage du projet : les défauts du propriétaire, plus les décisions.
  db.update(projects)
    .set({ defaultConfig: JSON.stringify({ claude: { ...timClaude, decisions: true }, codex: null }) })
    .where(eq(projects.id, 'solera'))
    .run()

  // Un fil qui n'a rien changé, au modèle résolu à la création ; un fil qui a changé son
  // mode ; un fil libre ; un fil Codex ; un fil de l'autre compte, sans réglages.
  legacyConversation(db, 'inchange', { ...timClaude, decisions: true })
  legacyConversation(db, 'plan', { ...timClaude, decisions: true, permissionMode: 'plan' })
  legacyConversation(db, 'libre', { ...timClaude, effort: 'max' }, null)
  legacyConversation(db, 'codex', { ...DEFAULT_CODEX_CONFIG, cardFiling: false, model: 'gpt-5.5' })
  legacyConversation(db, 'autre', { ...DEFAULT_CLAUDE_CONFIG, model: 'default' }, 'solera', 'other')

  const before = new Map(
    ['inchange', 'plan', 'libre', 'codex', 'autre'].map((id) => [id, parseAgentConfig(row(db, id).config)]),
  )

  const report = backfillConfigLayers(db)
  assert.deepEqual(report, { accounts: 1, projects: 1, conversations: 5 })

  // Ce qui s'applique n'a pas bougé, fil par fil.
  for (const [id, config] of before) {
    const resolved = resolveConversationConfig(db, row(db, id))
    const expected = id === 'autre' ? { ...config, model: '' } : config
    assert.deepEqual(resolved, expected, id)
  }

  // Le compte : tout est retenu, les autres réglages de la charge sont intacts.
  const stored = JSON.parse(db.select().from(userSettings).where(eq(userSettings.userId, 'tim')).get()!.data)
  assert.equal('agentDefaults' in stored, false)
  assert.deepEqual(stored.collapsedProjects, ['p'])
  assert.equal(stored.agentLayer.claude.model, 'opus')
  assert.equal(stored.agentLayer.shared.cardFiling, false)

  // Le projet : seul l'écart au compte de Tim.
  const project = readProjectLayer(db.select().from(projects).where(eq(projects.id, 'solera')).get()!.defaultConfig)
  assert.deepEqual(project.shared, { decisions: true })
  assert.deepEqual(project.claude, {})

  // Les fils : leurs seuls changements.
  assert.deepEqual(readOverrides(row(db, 'inchange')), {})
  assert.deepEqual(readOverrides(row(db, 'plan')), { permissionMode: 'plan' })
  assert.deepEqual(readOverrides(row(db, 'libre')), { effort: 'max' })
  // Le modèle de Codex résolu à la création ne se distingue pas d'un choix : il est gardé.
  // Les décisions du préréglage Claude valent désormais pour tout le projet (un champ
  // partagé) : le fil Codex, qui ne les avait pas, le garde en écart.
  assert.deepEqual(readOverrides(row(db, 'codex')), { model: 'gpt-5.5', decisions: false })
  // L'alias `default` de Claude, lui, était le défaut du CLI : il redevient hérité. Le
  // compte de « other » n'a rien réglé, et le projet ne lui ouvre que les décisions —
  // qu'il n'avait pas : c'est un écart, gardé.
  assert.deepEqual(readOverrides(row(db, 'autre')), { decisions: false })

  // Une seconde passe ne trouve plus rien à faire.
  assert.deepEqual(backfillConfigLayers(db), { accounts: 0, projects: 0, conversations: 0 })
})

test('un défaut changé au compte rejoint les fils qui ne l’avaient pas changé', async (t) => {
  const db = await database(t)
  legacyAccount(db, 'tim', { claude: { ...DEFAULT_CLAUDE_CONFIG, model: 'opus' } })
  legacyConversation(db, 'suit', { ...DEFAULT_CLAUDE_CONFIG, model: 'opus' })
  legacyConversation(db, 'garde', { ...DEFAULT_CLAUDE_CONFIG, model: 'sonnet' })
  backfillConfigLayers(db)

  writeUserAgentLayer(db, 'tim', { scope: 'claude', set: { model: 'haiku' } })
  writeUserAgentLayer(db, 'tim', { scope: 'shared', set: { agentMemory: false } })

  assert.equal(await refreshConversationConfigs(db, identity, { userId: 'tim' }), 2)
  const suit = parseAgentConfig(row(db, 'suit').config)
  const garde = parseAgentConfig(row(db, 'garde').config)
  assert.equal(suit.model, 'haiku')
  assert.equal(garde.model, 'sonnet')
  // Le champ partagé vaut pour les deux.
  assert.equal(suit.agentMemory, false)
  assert.equal(garde.agentMemory, false)
})

test('un fil rend un champ à l’héritage, et une valeur égale à l’héritage n’est pas retenue', async (t) => {
  const db = await database(t)
  legacyAccount(db, 'tim', { claude: { ...DEFAULT_CLAUDE_CONFIG, effort: 'high' } })
  legacyConversation(db, 'fil', { ...DEFAULT_CLAUDE_CONFIG, effort: 'max', permissionMode: 'plan' })
  backfillConfigLayers(db)

  const overrides = patchOverrides(db, row(db, 'fil'), { set: { effort: 'high' }, unset: ['permissionMode'] })
  assert.deepEqual(overrides, {})
})

test('créer un fil ne retient que ce qu’il change, même résolu avant d’arriver', async (t) => {
  const db = await database(t)
  writeUserAgentLayer(db, 'tim', { scope: 'claude', set: { effort: 'high' } })
  const sessions = {
    resolveDefaults: async (config: AgentConfig) =>
      config.agent === 'claude' && config.model === '' ? { ...config, model: 'default' } : config,
  } as unknown as SessionManager

  const created = await createConversation(db, sessions, {
    projectId: 'solera',
    userId: 'tim',
    agent: 'claude',
    // Ce que les routes envoient : l'héritage résolu, plus un changement du brouillon.
    config: { ...DEFAULT_CLAUDE_CONFIG, model: 'default', effort: 'high', permissionMode: 'acceptEdits' },
    worktreeId: null,
    cardId: null,
    origin: null,
  })
  assert.deepEqual(readOverrides(created), { permissionMode: 'acceptEdits' })
  const config = parseAgentConfig(created.config)
  assert.equal(config.model, 'default')
  assert.equal(config.agent === 'claude' && config.permissionMode, 'acceptEdits')
})

test('l’écran d’avant, qui envoie une configuration entière, n’écrit que ses écarts', async (t) => {
  const db = await database(t)
  writeUserAgentDefault(db, 'tim', { ...DEFAULT_CLAUDE_CONFIG, model: 'opus', additionalDirectories: ['/srv'] })
  const settings = readUserSettings(db, 'tim')
  assert.deepEqual(settings.agentLayer.claude, { model: 'opus' })
  assert.deepEqual(settings.agentLayer.shared, {})
  assert.equal(settings.agentDefaults.claude.model, 'opus')
})

test('le recalcul n’écrit que si la configuration a bougé', async (t) => {
  const db = await database(t)
  legacyConversation(db, 'fil', { ...DEFAULT_CLAUDE_CONFIG })
  backfillConfigLayers(db)
  const first = row(db, 'fil')
  assert.equal(await refreshConversationConfig(db, identity, first), first)

  // Une ligne que la migration n'a pas vue : tout vaut changement, rien ne bouge.
  db.update(conversations).set({ configOverrides: null }).where(eq(conversations.id, 'fil')).run()
  writeUserAgentLayer(db, 'tim', { scope: 'claude', set: { model: 'haiku' } })
  assert.equal(resolveConversationConfig(db, row(db, 'fil')).model, DEFAULT_CLAUDE_CONFIG.model)
})
