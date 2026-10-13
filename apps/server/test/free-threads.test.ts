import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { and, eq } from 'drizzle-orm'
import {
  agentRequests,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  users,
  type ConversationRow,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { conversationVisibleTo, inProject } from '../src/conversations/scope.js'
import { EventLog } from '../src/events/event-log.js'
import { HttpError } from '../src/http/errors.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { agentCwd, conversationWorkspace, resolveConversationCwd } from '../src/workspace.js'

/**
 * Le fil libre : une conversation qui n'appartient à aucun projet.
 *
 * Ce que ces tests gardent, c'est la part que le typage ne garde pas. Rendre
 * `project_id` nullable fait échouer à la compilation tout ce qui supposait un dossier,
 * mais une jointure interne sur `projects`, elle, compile parfaitement et se contente de
 * ne jamais rendre les fils libres. C'est le seul endroit où l'oubli est silencieux.
 */

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-free-threads-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  const user = (id: string) =>
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  user('owner')
  user('other')

  db.insert(projects).values({ id: 'private', name: 'private', workspacePath: join(dir, 'private'), ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'shared', name: 'shared', workspacePath: join(dir, 'shared'), ownerId: 'other', visibility: 'shared', createdAt: 1 }).run()

  const thread = (id: string, projectId: string | null, userId: string): ConversationRow => {
    const row: ConversationRow = {
      id, projectId, worktreeId: null, cardId: null, userId, title: id,
      titleSetByUser: false, agent: 'claude', agentSessionId: null, forkedFromId: null,
      createdByTokenId: null, originLabel: null, scheduleId: null,
      config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle',
      backgroundCount: 0, loopCount: 0, lastSeq: 0, lastNotableSeq: 0, turnCount: 0,
      journalBytes: 0, contextUsedTokens: null, contextMaxTokens: null, model: null,
      costUsd: 0, inputTokens: 0, outputTokens: 0, pinned: false, position: 0,
      archivedAt: null, createdAt: 1, updatedAt: 1,
    }
    db.insert(conversations).values(row).run()
    return row
  }

  return { db, dir, thread }
}

test('un fil libre n’a pas de répertoire de travail, mais l’agent tourne quelque part', async (t) => {
  const { db, dir, thread } = await harness(t)
  const free = thread('free', null, 'owner')
  const owned = thread('owned', 'private', 'owner')

  assert.equal(resolveConversationCwd(db, free), null)
  assert.equal(resolveConversationCwd(db, owned), join(dir, 'private'))

  // Un dossier à lui, vide et créé à la demande : le home donnerait la machine entière
  // à lire à un agent dont l'interface annonce qu'il n'a pas de dossier.
  const threads = join(dir, 'threads')
  const cwd = agentCwd(db, threads, free)
  assert.equal(cwd, join(threads, 'free'))
  assert.ok(existsSync(cwd))
  assert.equal(agentCwd(db, threads, owned), join(dir, 'private'))
})

test('les routes du panneau refusent un fil libre, sans le rendre introuvable', async (t) => {
  const { db, thread } = await harness(t)
  thread('free', null, 'owner')
  thread('owned', 'private', 'owner')

  // 400 et non 404 : la conversation existe, c'est la question qui n'a pas de sens.
  assert.throws(
    () => conversationWorkspace(db, 'free', 'owner'),
    (err: unknown) =>
      err instanceof HttpError && err.statusCode === 400 && err.code === 'conversation_without_workspace',
  )
  assert.doesNotThrow(() => conversationWorkspace(db, 'owned', 'owner'))
  // Et un fil qu'on n'a pas le droit de voir reste introuvable, lui.
  assert.throws(
    () => conversationWorkspace(db, 'owned', 'other'),
    (err: unknown) => err instanceof HttpError && err.statusCode === 404,
  )
})

test('un fil libre n’appartient qu’à son auteur, et ne disparaît pas des listes', async (t) => {
  const { db, thread } = await harness(t)
  thread('free-owner', null, 'owner')
  thread('free-other', null, 'other')
  thread('in-private', 'private', 'owner')
  thread('in-shared', 'shared', 'other')

  const visible = (userId: string) =>
    db
      .select({ id: conversations.id })
      .from(conversations)
      // Externe, et c'est tout l'enjeu : une jointure interne écarterait les fils libres
      // en silence, sans qu'aucun type ni aucun test de route ne s'en aperçoive.
      .leftJoin(projects, eq(projects.id, conversations.projectId))
      .where(conversationVisibleTo(userId))
      .all()
      .map((row) => row.id)
      .sort()

  // Le fil libre d'autrui n'est pas partagé : il n'y a pas de projet dont il hériterait
  // une visibilité, et l'inventer reviendrait à publier une boîte de réception.
  assert.deepEqual(visible('owner'), ['free-owner', 'in-private', 'in-shared'])
  assert.deepEqual(visible('other'), ['free-other', 'in-shared'])
})

test('« les fils de ce projet » comprend le groupe des fils libres', async (t) => {
  const { db, thread } = await harness(t)
  thread('free', null, 'owner')
  thread('owned', 'private', 'owner')

  const ids = (projectId: string | null) =>
    db
      .select({ id: conversations.id })
      .from(conversations)
      .where(and(inProject(projectId), eq(conversations.userId, 'owner')))
      .all()
      .map((row) => row.id)

  // `project_id = NULL` ne rend jamais vrai en SQL : sans `IS NULL`, ce groupe serait
  // toujours vide, et la boîte de réception resterait désespérément propre.
  assert.deepEqual(ids(null), ['free'])
  assert.deepEqual(ids('private'), ['owned'])
})

test('un déplacement accordé s’applique au premier balayage où la conversation se tait', async (t) => {
  const { db, thread } = await harness(t)
  const free = thread('free', null, 'owner')
  db.update(conversations).set({ status: 'running' }).where(eq(conversations.id, free.id)).run()

  const log = new EventLog(db)
  // Le vrai gestionnaire refuse de relâcher un runner qui travaille, et c'est ce refus
  // qui sert de condition de réessai au balayage.
  const sessions = {
    async releaseRunner(id: string) {
      return db.select().from(conversations).where(eq(conversations.id, id)).get()?.status !== 'running'
    },
    statusBus: new EventEmitter(),
  } as unknown as SessionManager
  const requests = new AgentRequests(
    { db, config: { mcp: { projectFiling: true } } as unknown as Config },
    sessions,
    {} as unknown as AgentRegistry,
    log,
  )

  // L'état d'une demande déjà déposée et déjà accordée : l'agent a eu sa réponse
  // (`settled_at`), l'utilisateur a cliqué (`accepted_at`), et rien n'est encore fait.
  log.append(free.id, {
    type: 'filing.requested',
    requestId: 'r1',
    conversationId: free.id,
    conversationTitle: free.title,
    projectId: 'private',
    projectName: 'private',
    worktree: null,
    card: null,
    resumable: false,
  })
  db.insert(agentRequests).values({
    id: 'r1', projectId: 'private', conversationId: free.id, kind: 'move_conversation',
    payload: JSON.stringify({ project: 'private' }), createdAt: 1,
    settledAt: 2, result: 'Demande déposée.', isError: false, acceptedAt: 3,
  }).run()

  const projectOf = (id: string) =>
    db.select({ projectId: conversations.projectId }).from(conversations).where(eq(conversations.id, id)).get()
      ?.projectId ?? null
  const resolutions = () =>
    db.select().from(agentRequests).where(eq(agentRequests.id, 'r1')).all().map((row) => row.resolvedAt)

  // Et pas avant : un tour tourne, le fil reste où il est et la demande reste ouverte.
  await requests.sweep()
  assert.equal(projectOf(free.id), null)
  assert.deepEqual(resolutions(), [null])

  db.update(conversations).set({ status: 'idle' }).where(eq(conversations.id, free.id)).run()
  await requests.sweep()
  assert.equal(projectOf(free.id), 'private')
  assert.ok(resolutions()[0])

  // La résolution est dans le fil déplacé : c'est là que la demande s'affichait.
  const resolved = log
    .readForReplay(free.id, 0, { rows: 100, bytes: 1_000_000 })
    .entries.map((entry) => entry.event)
    .filter((event) => event.type === 'filing.resolved')
  assert.deepEqual(
    resolved.map((event) => (event.type === 'filing.resolved' ? event.decision : null)),
    ['accepted'],
  )
})
