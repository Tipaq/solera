import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { conversations, openDatabase, runMigrations, users, type ConversationRow } from '@solera/db'
import { DEFAULT_CODEX_CONFIG, type AgentConfig } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import { CodexAccountHomes, codexThreadFile } from '../src/codex-accounts/homes.js'
import { CodexLoginService } from '../src/codex-accounts/login.js'
import { CodexAccountStore } from '../src/codex-accounts/store.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import type { SecretStore } from '../src/secrets/store.js'
import { SessionManager } from '../src/sessions/session-manager.js'

/**
 * Sans dossier partagé entre les homes des comptes, une conversation Codex suit son
 * compte par copie de son thread : au changement de compte, au repli quand le compte
 * choisi a disparu, et après la suppression du compte où elle est née.
 */

const THREAD = '01a1bbd2-4486-7b50-bf34-da762a389b3b'

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-codex-account-env-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'tim', username: 'tim', displayName: 'tim', passwordHash: '', createdAt: 1 }).run()

  const previous = process.env.CODEX_HOME
  process.env.CODEX_HOME = join(dir, 'user-codex')
  t.after(() => { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous })

  const store = new CodexAccountStore(db)
  const homes = new CodexAccountHomes(join(dir, 'codex-accounts'))
  const config = { paths: { threads: join(dir, 'threads') }, limits: { maxConcurrentSessions: 1, sessionIdleTimeoutMin: 30 } } as unknown as Config
  const log = new EventLog(db)
  const sessions = new SessionManager(db, log, config, {} as AgentRegistry, {} as SecretStore, {} as never, { store, homes }, {} as never)

  const row = {
    id: 'conv', projectId: null, worktreeId: null, cardId: null, userId: 'tim', title: 'conv',
    titleSetByUser: false, agent: 'codex', agentSessionId: THREAD, forkedFromId: null,
    handoffFromId: null, createdByTokenId: null, originLabel: null, scheduleId: null,
    config: JSON.stringify(DEFAULT_CODEX_CONFIG), status: 'idle',
    backgroundCount: 0, loopCount: 0, lastSeq: 0, lastNotableSeq: 0, turnCount: 0,
    journalBytes: 0, contextUsedTokens: null, contextMaxTokens: null, model: null,
    costUsd: 0, inputTokens: 0, outputTokens: 0, pinned: false, position: 0,
    archivedAt: null, createdAt: 1, updatedAt: 1,
  } as ConversationRow
  db.insert(conversations).values(row).run()

  const accountEnv = (account: string | null): Record<string, string> =>
    (sessions as unknown as { accountEnv(row: ConversationRow, config: AgentConfig): Record<string, string> })
      .accountEnv(row, { ...DEFAULT_CODEX_CONFIG, account })
  const account = (label: string) => {
    const created = store.create('tim', label)
    store.setIdentity(created.id, { authMode: 'chatgpt', email: null, planType: null })
    mkdirSync(homes.path(created.id), { recursive: true })
    return created.id
  }
  const writeThread = (home: string, content: string) => {
    const day = join(home, 'sessions', '2026', '11', '08')
    mkdirSync(day, { recursive: true })
    writeFileSync(join(day, `rollout-2026-11-08T16-41-21-${THREAD}.jsonl`), content)
  }
  const thread = (home: string) => {
    const path = codexThreadFile(home, THREAD)
    return path ? readFileSync(path, 'utf8') : null
  }
  const errors = () => log.read('conv', 0, 100).flatMap(({ event }) => (event.type === 'error' ? [event.message] : []))
  return { store, homes, accountEnv, account, writeThread, thread, errors }
}

test('changer de compte reprend le thread né sur l’autre', async (t) => {
  const { homes, accountEnv, account, writeThread, thread } = await harness(t)
  const perso = account('Perso')
  const travail = account('Travail')
  writeThread(homes.path(perso), 'né sur perso')
  const env = accountEnv(travail)
  assert.equal(env.CODEX_HOME, homes.path(travail))
  assert.equal(thread(homes.path(travail)), 'né sur perso')
})

test('un compte choisi puis supprimé : la session part sur un compte connecté, avec le thread', async (t) => {
  const { store, homes, accountEnv, account, writeThread, thread, errors } = await harness(t)
  const perso = account('Perso')
  const parti = account('Parti')
  writeThread(homes.path(parti), 'né sur parti')
  homes.keepConversations(parti, 'tim')
  await rm(homes.path(parti), { recursive: true })
  store.delete('tim', parti)

  const env = accountEnv(parti)
  assert.equal(env.CODEX_HOME, homes.path(perso), 'pas la connexion du CLI, qui n’a pas le fil')
  assert.equal(thread(homes.path(perso)), 'né sur parti', 'le thread du compte supprimé a été gardé')
  assert.match(errors().at(-1) ?? '', /Perso/)
})

test('supprimer un compte garde ses threads hors du home de l’utilisateur', async (t) => {
  const { homes, account, writeThread, thread } = await harness(t)
  const parti = account('Parti')
  writeThread(homes.path(parti), 'né sur parti')
  const login = new CodexLoginService(homes, {} as CodexAccountStore, async () => 'codex')
  await login.forget(parti, 'tim')
  assert.equal(thread(homes.kept('tim')), 'né sur parti')
  assert.equal(thread(process.env.CODEX_HOME!), null)
})
