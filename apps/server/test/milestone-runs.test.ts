import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import {
  cardBlocks,
  cardNotes,
  cardReviews,
  cards,
  conversations,
  milestoneRunCards,
  milestoneRuns,
  openDatabase,
  projects,
  runMigrations,
  users,
  worktrees,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, startMilestoneBodySchema, type AgentConfig, type CardColumn, type ConversationStatus } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { HttpError } from '../src/http/errors.js'
import { deriveStatus, layerCards, LAUNCH_GRACE_MS, type CardFacts } from '../src/milestones/graph.js'
import { MilestoneRuns, type MilestoneNotifier } from '../src/milestones/milestone-runs.js'
import type { SessionManager } from '../src/sessions/session-manager.js'

/**
 * Lancer un jalon (#72) : le serveur fait partir les enfants d'une carte parente dans
 * l'ordre de leurs liens « bloque », avec une concurrence bornée.
 *
 * Le dépôt est un vrai git avec une forge locale, parce que chaque carte part d'une
 * branche du jalon poussée sur la forge ; les sessions sont simulées.
 */

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  }).trim()

/**
 * Le jalon #10 et ses enfants :
 *
 *   #11 ──▶ #12 ──▶ #14
 *   #13
 *   #15
 */
async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-milestones-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo')
  git(dir, 'init', '-q', '-b', 'main', repo)
  await writeFile(join(repo, 'a.txt'), 'un\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'départ')
  const origin = join(dir, 'origin.git')
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin)
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'push', '-q', 'origin', 'main')

  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Tim', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects)
    .values({ id: 'project', name: 'Nimbus', workspacePath: repo, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()
  const ids = new Map<number, string>()
  const addCard = (number: number, extra: Partial<typeof cards.$inferInsert> = {}) => {
    const id = `00000000-0000-4000-8000-0000000000${number}`
    ids.set(number, id)
    db.insert(cards)
      .values({
        id, projectId: 'project', number, title: `Carte ${number}`, description: '', column: 'todo', position: number,
        createdBy: 'owner', createdAt: 1, updatedAt: 1, acceptedAt: 1, ...extra,
      })
      .run()
    return id
  }
  const parentId = addCard(10, { title: 'Jalon vite', column: 'todo' })
  for (const n of [11, 12, 13, 14, 15]) addCard(n, { parentId })
  const block = (source: number, target: number) =>
    db.insert(cardBlocks).values({ sourceId: ids.get(source)!, targetId: ids.get(target)!, createdAt: 1 }).run()
  block(11, 12)
  block(12, 14)

  const sent: Array<{ id: string; text: string }> = []
  const bus = new EventEmitter()
  const sessions = {
    statusBus: bus,
    sendMessage: async (id: string, _client: string, text: string) => {
      sent.push({ id, text })
    },
    // La création d'un fil résout les défauts du CLI (#120) : rien à résoudre ici.
    resolveDefaults: async (config: AgentConfig) => config,
  } as unknown as SessionManager
  const registry = { adapter: () => ({ resolveDefaults: async (config: unknown) => config }) } as unknown as AgentRegistry
  const ctx = { db, config: { paths: { worktrees: join(dir, 'worktrees') } } as unknown as Config }
  const pushed: Array<{ title: string; body: string }> = []
  const notifier: MilestoneNotifier = {
    dispatch: async (_user, notification) => {
      pushed.push({ title: notification.push.title, body: notification.push.body })
    },
  }
  const milestones = new MilestoneRuns(ctx, sessions, registry, notifier)

  const card = (n: number) => db.select().from(cards).where(eq(cards.id, ids.get(n)!)).get()!
  const parent = () => card(10)
  const project = () => db.select().from(projects).where(eq(projects.id, 'project')).get()!
  const launch = (body: object = {}) => milestones.launch(parent(), project(), 'owner', startMilestoneBodySchema.parse(body))
  const status = () => {
    const run = milestones.latestRun(parentId)!
    return Object.fromEntries(milestones.read(run).cards.map((entry) => [entry.number, entry.status]))
  }
  const sessionOf = (n: number) =>
    db.select().from(conversations).where(eq(conversations.cardId, ids.get(n)!)).all().at(-1)
  const setSession = (n: number, value: ConversationStatus) =>
    db.update(conversations).set({ status: value }).where(eq(conversations.id, sessionOf(n)!.id)).run()
  const setColumn = (n: number, column: CardColumn) =>
    db.update(cards).set({ column }).where(eq(cards.id, ids.get(n)!)).run()
  const notes = () => db.select().from(cardNotes).where(eq(cardNotes.cardId, parentId)).all().map((note) => note.body)

  return { db, repo, origin, ids, parentId, addCard, block, sent, pushed, milestones, card, parent, launch, status, sessionOf, setSession, setColumn, notes }
}

test('jalon : les étages du graphe, et un cycle mis à part', () => {
  const { layers, cycle } = layerCards(
    ['a', 'b', 'c', 'd', 'x', 'y'],
    [
      { sourceId: 'a', targetId: 'b' },
      { sourceId: 'b', targetId: 'd' },
      { sourceId: 'c', targetId: 'd' },
      { sourceId: 'x', targetId: 'y' },
      { sourceId: 'y', targetId: 'x' },
      // Un bloqueur hors du jalon ne change pas l'étage.
      { sourceId: 'dehors', targetId: 'c' },
    ],
  )
  assert.deepEqual(Object.fromEntries(layers), { a: 0, c: 0, b: 1, d: 2 })
  assert.deepEqual(cycle, ['x', 'y'])
})

test('jalon : l’état d’une carte se déduit de sa session et de sa revue', () => {
  const now = 1_000_000
  const base: CardFacts = {
    column: 'in_progress', toClarify: false, launch: 'launched', launchedAt: now - LAUNCH_GRACE_MS * 2,
    blocked: false, session: { status: 'running' }, review: null,
  }
  const of = (facts: Partial<CardFacts>) => deriveStatus({ ...base, ...facts }, now)
  assert.deepEqual(of({}), { status: 'working', blockReason: null })
  assert.equal(of({ launch: 'queued', blocked: true }).status, 'waiting')
  assert.equal(of({ launch: 'queued' }).status, 'queued')
  assert.equal(of({ column: 'done' }).status, 'done')
  assert.equal(of({ toClarify: true }).blockReason, 'to_clarify')
  assert.equal(of({ session: { status: 'error' } }).blockReason, 'error')
  assert.equal(of({ session: { status: 'awaiting_input' }, review: 'reviewing' }).blockReason, 'awaiting_input')
  assert.equal(of({ session: { status: 'idle' }, review: 'reviewing' }).status, 'reviewing')
  assert.equal(of({ session: { status: 'idle' }, review: 'to_merge' }).status, 'merging')
  assert.equal(of({ session: { status: 'idle' }, review: 'escalated' }).blockReason, 'escalated')
  assert.equal(of({ session: { status: 'idle' }, review: 'merge_failed' }).blockReason, 'merge_failed')
  assert.equal(of({ session: { status: 'interrupted' }, review: 'changes' }).blockReason, 'interrupted')
  // Au repos sans PR : bloquée, sauf juste après le lancement.
  assert.equal(of({ session: { status: 'idle' } }).blockReason, 'idle')
  assert.equal(of({ session: { status: 'idle' }, launchedAt: now - 1000 }).status, 'working')
  assert.equal(of({ session: null }).blockReason, 'idle')
})

test('jalon : l’aperçu dit ce qui part, ce qui attend et ce qui est écarté', async (t) => {
  const { db, milestones, parent, addCard, parentId } = await harness(t)
  addCard(16, { parentId, acceptedAt: null })
  addCard(17, { parentId, column: 'done' })
  addCard(18, { parentId })
  addCard(19, { parentId: (await Promise.resolve(db.select().from(cards).where(eq(cards.number, 18)).get()!)).id })

  const plan = milestones.plan(parent())
  const by = Object.fromEntries(plan.cards.map((entry) => [entry.number, entry]))
  assert.equal(by[11]!.status, 'ready')
  assert.equal(by[11]!.layer, 0)
  assert.equal(by[12]!.status, 'waiting')
  assert.deepEqual(by[12]!.blockedBy.map((b) => b.number), [11])
  assert.equal(by[14]!.layer, 2)
  assert.equal(by[16]!.excludedReason, 'not_accepted')
  assert.equal(by[17]!.excludedReason, 'closed')
  assert.equal(by[18]!.excludedReason, 'has_children')
  assert.deepEqual(plan.cycle, [])
  assert.equal(plan.branch, 'jalon/10-jalon-vite')
  assert.equal(by[19], undefined, 'une petite-fille ne part pas avec le jalon')
})

test('jalon : un cycle de blocages refuse le lancement', async (t) => {
  const { launch, block, milestones, parent } = await harness(t)
  block(14, 11)
  assert.deepEqual(milestones.plan(parent()).cycle, [11, 12, 14])
  await assert.rejects(launch(), (err: unknown) => err instanceof HttpError && err.code === 'milestone_cycle')
})

test('jalon : les cartes prêtes partent dans la limite de la concurrence, depuis la branche du jalon', async (t) => {
  const { db, repo, origin, launch, milestones, status, sent, sessionOf, card, notes } = await harness(t)

  await launch({ concurrency: 2 })
  await milestones.sweep()

  assert.deepEqual(status(), { 11: 'working', 13: 'working', 15: 'queued', 12: 'waiting', 14: 'waiting' })
  assert.equal(sent.length, 2)
  assert.match(sent[0]!.text, /Prends en charge la carte #11/)
  assert.match(sent[0]!.text, /jalon #10 « Jalon vite »/)
  assert.equal(card(11).column, 'in_progress')

  // La branche du jalon est poussée, et l'arbre de la carte en part, sur sa propre branche.
  assert.ok(git(origin, 'rev-parse', '--verify', 'refs/heads/jalon/10-jalon-vite'))
  const session = sessionOf(11)!
  const tree = db.select().from(worktrees).where(eq(worktrees.id, session.worktreeId!)).get()!
  assert.equal(tree.name, 'feat/11-carte-11')
  assert.equal(tree.baseRef, 'jalon/10-jalon-vite')
  assert.equal(git(repo, 'rev-parse', 'feat/11-carte-11'), git(repo, 'rev-parse', 'jalon/10-jalon-vite'))
  assert.match(notes()[0]!, /Jalon lancé : 5 carte\(s\), 2 session\(s\)/)

  // Un second tour ne relance rien.
  await milestones.sweep()
  assert.equal(sent.length, 2)
  await assert.rejects(launch(), (err: unknown) => err instanceof HttpError && err.code === 'milestone_running')
})

test('jalon : une carte bloquée libère sa place et n’arrête que celles qui en dépendent', async (t) => {
  const { launch, milestones, status, sent, setSession, pushed, notes } = await harness(t)
  await launch({ concurrency: 2 })
  await milestones.sweep()

  setSession(11, 'error')
  await milestones.sweep()
  assert.deepEqual(status(), { 11: 'blocked', 13: 'working', 15: 'working', 12: 'waiting', 14: 'waiting' })
  assert.equal(sent.length, 3)
  assert.equal(pushed.length, 1)
  assert.match(pushed[0]!.title, /carte #11 bloquée/)
  assert.ok(notes().some((note) => /Carte #11 bloquée : sa session est en erreur\. #12, #14 l'attend/.test(note)))

  // Prévenu une seule fois pour la même raison.
  await milestones.sweep()
  assert.equal(pushed.length, 1)

  // Reprise : elle redemande une place, et ne passe pas devant celles déjà lancées.
  setSession(11, 'running')
  await milestones.sweep()
  assert.equal(status()[11], 'working')
})

test('jalon : une carte terminée débloque la suivante, qui part de la branche du jalon', async (t) => {
  const { launch, milestones, status, setColumn, sessionOf, db } = await harness(t)
  await launch({ concurrency: 2 })
  await milestones.sweep()
  assert.deepEqual(status(), { 11: 'working', 13: 'working', 15: 'queued', 12: 'waiting', 14: 'waiting' })

  // #11 terminée libère sa place et débloque #12 ; #15, d'un étage plus bas, passe d'abord.
  setColumn(11, 'done')
  await milestones.sweep()
  assert.deepEqual(status(), { 11: 'done', 13: 'working', 15: 'working', 12: 'queued', 14: 'waiting' })
  setColumn(13, 'done')
  await milestones.sweep()
  assert.equal(status()[12], 'working')
  const tree = db.select().from(worktrees).where(eq(worktrees.id, sessionOf(12)!.worktreeId!)).get()!
  assert.equal(tree.baseRef, 'jalon/10-jalon-vite')
})

test('jalon : une revue au plafond bloque sans notification de plus', async (t) => {
  const { db, launch, milestones, status, sessionOf, pushed, ids, setSession } = await harness(t)
  await launch({ concurrency: 1 })
  await milestones.sweep()
  setSession(11, 'idle')
  db.insert(cardReviews)
    .values({
      id: 'r', projectId: 'project', cardId: ids.get(11)!, authorConversationId: sessionOf(11)!.id, prNumber: 1,
      prUrl: 'u', branch: 'feat/11-carte-11', base: 'jalon/10-jalon-vite', headSha: 'x', state: 'reviewing',
      createdAt: 1, updatedAt: 1,
    })
    .run()
  await milestones.sweep()
  assert.equal(status()[11], 'reviewing')
  db.update(cardReviews).set({ state: 'escalated' }).run()
  await milestones.sweep()
  assert.equal(status()[11], 'blocked')
  assert.equal(pushed.length, 0, 'la décision du plafond a déjà prévenu')
  assert.equal(status()[13], 'working')
})

test('jalon : pause, reprise, arrêt', async (t) => {
  const { launch, milestones, status, sent, parentId, setColumn } = await harness(t)
  await launch({ concurrency: 1 })
  await milestones.sweep()
  const run = milestones.latestRun(parentId)!
  milestones.update(run, 'owner', { state: 'paused' })
  setColumn(11, 'done')
  await milestones.sweep()
  assert.equal(sent.length, 1, 'rien ne part en pause')
  assert.equal(status()[12], 'queued')

  milestones.update(milestones.latestRun(parentId)!, 'owner', { state: 'running' })
  await milestones.sweep()
  assert.equal(sent.length, 2)

  const stopped = milestones.update(milestones.latestRun(parentId)!, 'owner', { state: 'stopped' })
  assert.equal(stopped.state, 'stopped')
  setColumn(12, 'done')
  await milestones.sweep()
  assert.equal(sent.length, 2, 'un jalon arrêté ne lance plus rien')
  assert.throws(() => milestones.update(milestones.latestRun(parentId)!, 'owner', { state: 'running' }), /ended/)
})

test('jalon : une carte déjà au travail est suivie sans être relancée, et le jalon se termine', async (t) => {
  const { db, launch, milestones, status, sent, ids, setColumn, parentId, notes } = await harness(t)
  const now = Date.now()
  db.insert(conversations)
    .values({
      id: 'deja', projectId: 'project', userId: 'owner', title: 'À la main', agent: 'claude', cardId: ids.get(13)!,
      config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'running', createdAt: now, updatedAt: now,
    })
    .run()
  assert.equal(milestones.plan((await Promise.resolve(db.select().from(cards).where(eq(cards.id, parentId)).get()!))).cards.find((c) => c.number === 13)!.status, 'running')

  await launch({ concurrency: 2 })
  await milestones.sweep()
  assert.equal(status()[13], 'working')
  assert.equal(status()[11], 'working')
  assert.equal(sent.length, 1, 'seule #11 est lancée : #13 occupe déjà une place')

  for (const n of [11, 12, 13, 14, 15]) setColumn(n, 'done')
  await milestones.sweep()
  const run = db.select().from(milestoneRuns).get()!
  assert.equal(run.state, 'finished')
  assert.ok(run.endedAt)
  assert.ok(notes().some((note) => note.startsWith('Jalon terminé')))
  assert.equal(db.select().from(milestoneRunCards).all().length, 5)
})

test('jalon : une enfant ajoutée après le lancement entre dans la file', async (t) => {
  const { launch, milestones, status, addCard, parentId } = await harness(t)
  await launch({ concurrency: 1 })
  await milestones.sweep()
  addCard(20, { parentId })
  await milestones.sweep()
  assert.equal(status()[20], 'queued')
})
