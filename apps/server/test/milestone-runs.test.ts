import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
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
import {
  DEFAULT_CLAUDE_CONFIG,
  launchMilestoneCardBodySchema,
  startMilestoneBodySchema,
  updateMilestoneRunBodySchema,
  type AgentConfig,
  type CardColumn,
  type ConversationStatus,
  type MilestoneRunDto,
} from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { conflict, HttpError, registerErrorHandler } from '../src/http/errors.js'
import { registerMilestoneRoutes } from '../src/http/routes/milestones.js'
import { deriveStatus, layerCards, LAUNCH_GRACE_MS, type CardFacts } from '../src/milestones/graph.js'
import { MilestoneRuns, type MilestoneNotifier } from '../src/milestones/milestone-runs.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { Environments } from '../src/environments/environments.js'

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
  const environments = new Environments(db)
  const sessions = {
    statusBus: bus,
    sendMessage: async (id: string, _client: string, text: string) => {
      sent.push({ id, text })
    },
    // La création d'un fil résout les défauts du CLI (#120) : rien à résoudre ici.
    resolveDefaults: async (config: AgentConfig) => config,
    // La session prend l'environnement du projet, l'hôte ici.
    environments,
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

  const byHand = (n: number, body: object = {}) =>
    milestones.launchByHand(parent(), project(), 'owner', ids.get(n)!, launchMilestoneCardBodySchema.parse(body))
  const openSession = (n: number, id: string) => {
    const now = Date.now()
    db.insert(conversations)
      .values({
        id, projectId: 'project', userId: 'owner', title: 'À la main', agent: 'claude', cardId: ids.get(n)!,
        config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'running', createdAt: now, updatedAt: now,
      })
      .run()
  }

  return {
    db, repo, origin, ids, parentId, addCard, block, sent, pushed, milestones, environments, registry, card, parent, project, launch, byHand,
    status, sessionOf, setSession, setColumn, notes, openSession,
  }
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
  const [active] = milestones.activeRuns('project').map((entry) => milestones.read(entry))
  assert.equal(active?.cardNumber, 10, 'le bandeau nomme la parente')
  assert.equal(active?.cardTitle, 'Jalon vite')
  milestones.update(run, 'owner', { state: 'paused' })
  assert.equal(milestones.activeRuns('project').length, 1, 'un jalon en pause reste lancé')
  setColumn(11, 'done')
  await milestones.sweep()
  assert.equal(sent.length, 1, 'rien ne part en pause')
  assert.equal(status()[12], 'queued')

  milestones.update(milestones.latestRun(parentId)!, 'owner', { state: 'running' })
  await milestones.sweep()
  assert.equal(sent.length, 2)

  const stopped = milestones.update(milestones.latestRun(parentId)!, 'owner', { state: 'stopped' })
  assert.equal(stopped.state, 'stopped')
  assert.equal(milestones.activeRuns('project').length, 0, 'un jalon arrêté n’a plus de bandeau')
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

// --- à la main, bascule de mode, confinement, lancement d'une carte (#186) -----------

const refused = (code: string) => (err: unknown) => err instanceof HttpError && err.code === code

test('jalon à la main : le tour ne lance rien, adopte une session ouverte ailleurs, et termine', async (t) => {
  const { launch, milestones, status, sent, openSession, setColumn, parentId, notes, db } = await harness(t)
  const run = await launch({ mode: 'manual' })
  assert.equal(run.mode, 'manual')
  await milestones.sweep()
  assert.equal(sent.length, 0, 'à la main, le pilotage ne lance rien')
  assert.deepEqual(status(), { 11: 'queued', 13: 'queued', 15: 'queued', 12: 'waiting', 14: 'waiting' })
  assert.match(notes()[0]!, /Jalon lancé à la main/)

  openSession(13, 'ouverte')
  await milestones.sweep()
  assert.equal(status()[13], 'working', 'une session ouverte depuis le board est adoptée')
  assert.equal(milestones.read(milestones.latestRun(parentId)!).cards.find((c) => c.number === 13)!.conversationId, 'ouverte')

  for (const n of [11, 12, 13, 14, 15]) setColumn(n, 'done')
  await milestones.sweep()
  assert.equal(db.select().from(milestoneRuns).get()!.state, 'finished')
  assert.equal(sent.length, 0)
})

test('jalon : la bascule à la main ↔ autonome en cours de route', async (t) => {
  const { launch, milestones, status, sent, parentId, setColumn, notes } = await harness(t)
  await launch({ mode: 'manual', concurrency: 1 })
  await milestones.sweep()
  assert.equal(sent.length, 0)

  const auto = milestones.update(milestones.latestRun(parentId)!, 'owner', { mode: 'auto' })
  assert.equal(auto.mode, 'auto')
  await milestones.sweep()
  assert.equal(sent.length, 1, 'passé en autonome, le tour reprend les lancements')
  assert.equal(status()[11], 'working')
  assert.ok(notes().some((note) => /^Jalon passé en autonome/.test(note)))

  const manual = milestones.update(milestones.latestRun(parentId)!, 'owner', { mode: 'manual' })
  assert.equal(manual.mode, 'manual')
  setColumn(11, 'done')
  await milestones.sweep()
  assert.equal(sent.length, 1, 'repassé à la main, plus aucun lancement')
  assert.equal(status()[13], 'queued')
  assert.ok(notes().some((note) => /^Jalon repassé à la main/.test(note)))

  // Le même mode ne laisse pas de note.
  const before = notes().length
  milestones.update(milestones.latestRun(parentId)!, 'owner', { mode: 'manual' })
  assert.equal(notes().length, before)
})

test('jalon : le confinement se change en cours de route, revérifié, pour les prochains lancements', async (t) => {
  const { launch, milestones, parentId, environments, notes, sessionOf, setColumn } = await harness(t)
  await launch({ concurrency: 1 })
  await milestones.sweep()
  assert.equal(sessionOf(11)!.environmentConfined, false)

  // Un confinement que ce serveur ne sait pas donner est refusé, et rien ne change.
  const available = environments.assertAvailable.bind(environments)
  environments.assertAvailable = (_projectId, environment) => {
    if (environment.confined) throw conflict('confinement_platform', 'No confinement here.')
  }
  assert.throws(() => milestones.update(milestones.latestRun(parentId)!, 'owner', { confined: true }), refused('confinement_platform'))
  assert.equal(milestones.latestRun(parentId)!.confined, null)

  environments.assertAvailable = () => {}
  const confined = milestones.update(milestones.latestRun(parentId)!, 'owner', { confined: true })
  assert.equal(confined.confined, true)
  assert.ok(notes().some((note) => /^Les prochaines sessions du jalon seront confinées/.test(note)))
  setColumn(11, 'done')
  await milestones.sweep()
  assert.equal(sessionOf(13)!.environmentConfined, true, 'la carte suivante part confinée')

  // null rend le réglage du projet.
  const reset = milestones.update(milestones.latestRun(parentId)!, 'owner', { confined: null })
  assert.equal(reset.confined, null)
  assert.ok(notes().some((note) => /réglage du projet/.test(note)))
  environments.assertAvailable = available

  // Omis, le confinement ne bouge pas.
  milestones.update(milestones.latestRun(parentId)!, 'owner', { concurrency: 2 })
  assert.equal(milestones.latestRun(parentId)!.confined, null)
})

test('lancer une carte à la main ouvre un pilotage à la main, et la carte livre dans la branche du jalon', async (t) => {
  const { db, byHand, milestones, status, sent, sessionOf, card, notes, parentId } = await harness(t)
  const run = await byHand(13)
  assert.equal(run.mode, 'manual')
  assert.equal(run.state, 'running')
  assert.equal(sent.length, 1)
  assert.match(sent[0]!.text, /Prends en charge la carte #13/)
  assert.equal(card(13).column, 'in_progress')
  const tree = db.select().from(worktrees).where(eq(worktrees.id, sessionOf(13)!.worktreeId!)).get()!
  assert.equal(tree.baseRef, 'jalon/10-jalon-vite')
  assert.equal(status()[13], 'working')
  assert.ok(notes().some((note) => /^Carte #13 lancée à la main/.test(note)))

  // Le tour suivant ne lance rien d'autre : le pilotage est à la main.
  await milestones.sweep()
  assert.equal(sent.length, 1)

  // Une deuxième carte rejoint le même pilotage.
  const again = await byHand(11)
  assert.equal(again.id, run.id)
  assert.equal(sent.length, 2)
  assert.equal(milestones.activeRuns('project').length, 1)
  assert.equal(milestones.latestRun(parentId)!.id, run.id)
})

test('lancer une carte à la main dans un jalon autonome passe outre la concurrence', async (t) => {
  const { byHand, launch, milestones, status, sent } = await harness(t)
  const run = await launch({ concurrency: 1 })
  await milestones.sweep()
  assert.equal(sent.length, 1)
  assert.equal(status()[13], 'queued')
  const after = await byHand(13)
  assert.equal(after.id, run.id)
  assert.equal(after.mode, 'auto', 'le mode du pilotage ne change pas')
  assert.equal(sent.length, 2)
  assert.equal(status()[13], 'working')
})

test('lancer une carte à la main : le confinement demandé vaut pour le pilotage créé', async (t) => {
  const { byHand, environments, milestones, parentId } = await harness(t)
  const seen: boolean[] = []
  environments.assertAvailable = (_projectId, environment) => {
    seen.push(environment.confined)
    if (environment.confined) throw conflict('confinement_platform', 'No confinement here.')
  }
  await assert.rejects(byHand(11, { confined: true }), refused('confinement_platform'))
  assert.equal(milestones.latestRun(parentId), null, 'refusé, aucun pilotage n’est créé')
  assert.deepEqual(seen, [true])
})

test('lancer une carte à la main : refusé si elle n’est pas prête', async (t) => {
  const { db, byHand, addCard, parentId, openSession, setColumn, block, launch, milestones, sent } = await harness(t)
  addCard(16, { parentId, acceptedAt: null })
  addCard(17, { parentId: null })
  addCard(18, { parentId })
  addCard(19, { parentId: db.select().from(cards).where(eq(cards.number, 18)).get()!.id })

  await assert.rejects(byHand(12), refused('milestone_card_not_ready'), 'un bloqueur ouvert')
  await assert.rejects(byHand(16), refused('milestone_card_not_ready'), 'pas acceptée')
  await assert.rejects(byHand(17), refused('milestone_card_not_ready'), 'hors du jalon')
  await assert.rejects(byHand(18), refused('milestone_card_not_ready'), 'elle a ses enfants')
  await assert.rejects(byHand(19), refused('milestone_card_not_ready'), 'une petite-fille')
  setColumn(15, 'done')
  await assert.rejects(byHand(15), refused('milestone_card_not_ready'), 'close')
  // Un cycle refuse comme le lancement du jalon, même pour une carte qui n'y est pas prise.
  block(14, 11)
  await assert.rejects(byHand(13), refused('milestone_cycle'))
  db.delete(cardBlocks).where(eq(cardBlocks.sourceId, db.select().from(cards).where(eq(cards.number, 14)).get()!.id)).run()

  openSession(13, 'deja')
  await assert.rejects(byHand(13), refused('milestone_card_running'), 'une session vivante')
  assert.equal(milestones.latestRun(parentId), null, 'aucun refus ne crée de pilotage')

  // Un pilotage arrêté n'empêche pas d'en ouvrir un nouveau, à la main.
  await launch({ mode: 'manual' })
  milestones.update(milestones.latestRun(parentId)!, 'owner', { state: 'stopped' })
  const fresh = await byHand(11)
  assert.equal(fresh.mode, 'manual')
  assert.equal(fresh.state, 'running')
  assert.equal(sent.length, 1)
})

test('routes : lancer une carte à la main, basculer le mode et le confinement', async (t) => {
  const { db, ids, milestones, parentId, sent, environments } = await harness(t)
  const app = Fastify()
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerMilestoneRoutes(app, { db } as never, milestones)
  t.after(() => app.close())

  const launched = await app.inject({ method: 'POST', url: `/api/cards/${parentId}/milestone/cards/${ids.get(11)}/launch`, payload: {} })
  assert.equal(launched.statusCode, 200, launched.body)
  assert.equal(launched.json<MilestoneRunDto>().mode, 'manual')
  assert.equal(sent.length, 1)

  const notReady = await app.inject({ method: 'POST', url: `/api/cards/${parentId}/milestone/cards/${ids.get(12)}/launch`, payload: {} })
  assert.equal(notReady.statusCode, 409)
  assert.equal(notReady.json<{ error: { code: string } }>().error.code, 'milestone_card_not_ready')

  environments.assertAvailable = () => {}
  const patched = await app.inject({ method: 'PATCH', url: `/api/cards/${parentId}/milestone`, payload: { mode: 'auto', confined: false } })
  assert.equal(patched.statusCode, 200, patched.body)
  assert.equal(patched.json<MilestoneRunDto>().mode, 'auto')
  assert.equal(patched.json<MilestoneRunDto>().confined, false)
  // Le tour relancé par la bascule doit finir avant qu'on efface le dépôt.
  await milestones.sweep()
})

test('protocole : le mode par défaut est autonome, et les corps acceptent mode et confinement', () => {
  assert.equal(startMilestoneBodySchema.parse({}).mode, 'auto')
  assert.equal(startMilestoneBodySchema.parse({ mode: 'manual' }).mode, 'manual')
  assert.throws(() => startMilestoneBodySchema.parse({ mode: 'other' }))
  assert.deepEqual(updateMilestoneRunBodySchema.parse({ mode: 'manual', confined: null }), { mode: 'manual', confined: null })
  assert.equal('confined' in updateMilestoneRunBodySchema.parse({}), false, 'omis, le confinement ne change pas')
  assert.deepEqual(launchMilestoneCardBodySchema.parse({}), { confined: null })
})

test('lancer une carte à la main : en pause aussi, au nom de qui lance, et un échec se dit', async (t) => {
  const { db, registry, launch, milestones, parentId, ids, parent, project, sessionOf, status, byHand, notes } = await harness(t)
  db.insert(users).values({ id: 'other', username: 'other', displayName: 'Léa', passwordHash: '', createdAt: 1 }).run()
  await launch({ mode: 'manual' })
  milestones.update(milestones.latestRun(parentId)!, 'owner', { state: 'paused' })

  // La pause arrête les lancements du serveur, pas le geste d'une personne.
  const run = await milestones.launchByHand(parent(), project(), 'other', ids.get(13)!, launchMilestoneCardBodySchema.parse({}))
  assert.equal(run.state, 'paused')
  assert.equal(status()[13], 'working')
  assert.equal(sessionOf(13)!.userId, 'other', 'la session est à qui la lance')

  // Un CLI qui ne répond pas : la carte est en échec, et la route le dit.
  registry.adapter = () => ({ resolveDefaults: async () => { throw new Error('CLI absent') } }) as never
  await assert.rejects(byHand(11), (err: unknown) => refused('milestone_card_launch_failed')(err) && (err as HttpError).params?.error === 'CLI absent')
  assert.equal(status()[11], 'failed')
  assert.ok(!notes().some((note) => /^Carte #11 lancée à la main/.test(note)))
})

test('lancer une carte à la main : refusé hors d’un dépôt git', async (t) => {
  const { db, byHand, milestones, parentId } = await harness(t)
  const plain = await mkdtemp(join(tmpdir(), 'solera-not-git-'))
  t.after(() => rm(plain, { recursive: true, force: true }))
  db.update(projects).set({ workspacePath: plain }).run()
  await assert.rejects(byHand(11), refused('not_a_repository'))
  assert.equal(milestones.latestRun(parentId), null)
})

test('jalon : passer en autonome pendant une pause ne lance rien avant la reprise', async (t) => {
  const { launch, milestones, parentId, sent, notes } = await harness(t)
  await launch({ mode: 'manual' })
  milestones.update(milestones.latestRun(parentId)!, 'owner', { state: 'paused' })
  milestones.update(milestones.latestRun(parentId)!, 'owner', { mode: 'auto' })
  await milestones.sweep()
  assert.equal(sent.length, 0)
  assert.ok(notes().some((note) => note === 'Jalon passé en autonome : les lancements reprendront avec lui.'))
  milestones.update(milestones.latestRun(parentId)!, 'owner', { state: 'running' })
  await milestones.sweep()
  assert.equal(sent.length, 3)
})
