import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import {
  agentRequests,
  cardNotes,
  cards,
  conversations,
  events,
  openDatabase,
  projects,
  runMigrations,
  users,
  worktrees,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG, type CardColumn } from '@solera/protocol'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import { CardClosure } from '../src/cards/close.js'
import type { Config } from '../src/config.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerConversationRoutes } from '../src/http/routes/conversations.js'
import type { Forge, PullRequest } from '../src/reviews/forge.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import type { TerminalManager } from '../src/terminals/terminal-manager.js'
import type { WebhookService } from '../src/webhooks/service.js'
import { WorktreeCleanup } from '../src/worktrees/cleanup.js'
import { WorktreeStatusService } from '../src/worktrees/status-service.js'

/**
 * Clore une carte finie (#69), de la proposition au worktree retiré.
 *
 * Sur un vrai dépôt et un vrai remote nu : ce qui compte ici, c'est ce que git perd ou ne
 * perd pas. Seule la forge est simulée — elle dit si une PR est fusionnée, et jusqu'à quel
 * commit.
 */
const isolation = mkdtempSync(join(tmpdir(), 'solera-card-close-isolation-'))
writeFileSync(join(isolation, 'gitconfig'), '')
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_GLOBAL = join(isolation, 'gitconfig')
for (const name of ['EMAIL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
  delete process.env[name]
}
after(() => rmSync(isolation, { recursive: true, force: true }))

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function remoteHas(repo: string, branch: string): boolean {
  return git(repo, 'ls-remote', '--heads', 'origin', `refs/heads/${branch}`) !== ''
}

async function harness(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'solera-card-close-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const origin = join(dir, 'origin.git')
  git(dir, 'init', '--bare', '-b', 'main', origin)
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Close test')
  git(repo, 'config', 'user.email', 'close@example.test')
  writeFileSync(join(repo, 'README.md'), 'base\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'root')
  git(repo, 'remote', 'add', 'origin', origin)
  git(repo, 'push', '--quiet', 'origin', 'main')

  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'Test', workspacePath: repo, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  const project = db.select().from(projects).where(eq(projects.id, 'project')).get()!

  let next = 1
  const card = (column: CardColumn, extra: { parentId?: string; branch?: string; branchPrNumber?: number } = {}) => {
    const id = randomUUID()
    const number = next++
    db.insert(cards)
      .values({ id, projectId: 'project', number, title: `Carte ${number}`, description: '', column, position: number, createdBy: 'owner', createdAt: 1, updatedAt: 1, ...extra })
      .run()
    return { id, number }
  }

  /** Un worktree et sa branche, avec un commit à lui ; poussé si `push`. */
  const tree = (branch: string, options: { push?: boolean } = {}) => {
    const path = join(dir, 'trees', branch.replace(/\//g, '__'))
    git(repo, 'worktree', 'add', '-b', branch, path, 'main')
    writeFileSync(join(path, `${branch.replace(/\//g, '-')}.txt`), `${branch}\n`)
    git(path, 'add', '-A')
    git(path, 'commit', '-m', branch)
    if (options.push) git(path, 'push', '--quiet', 'origin', branch)
    const id = randomUUID()
    db.insert(worktrees).values({ id, projectId: 'project', name: branch, path, baseRef: 'main', createdBy: 'owner', createdAt: 1 }).run()
    return { id, path, head: () => git(path, 'rev-parse', 'HEAD') }
  }

  const session = (id: string, cardId: string, worktreeId: string | null, status: 'idle' | 'running' = 'idle') => {
    db.insert(conversations)
      .values({
        id, projectId: 'project', userId: 'owner', title: id, agent: 'claude',
        config: JSON.stringify({ ...DEFAULT_CLAUDE_CONFIG, cardFiling: true }), status, worktreeId, cardId,
        createdAt: 1, updatedAt: 1,
      })
      .run()
  }

  // La forge : une PR par branche, et son état.
  const pulls = new Map<string, PullRequest>()
  const forge: Forge = {
    async readPullRequest(_cwd, ref) {
      const pr = pulls.get(ref) ?? [...pulls.values()].find((entry) => String(entry.number) === ref)
      if (!pr) throw new Error('no pull request')
      return pr
    },
    async mergePullRequest() {},
    async createPullRequest() {
      return { number: 0, url: '' }
    },
  }
  const pr = (number: number, head: string, headSha: string, state: PullRequest['state'] = 'MERGED') =>
    pulls.set(head, { number, url: `https://forge/pull/${number}`, head, headSha, base: 'main', state })

  const log = new EventLog(db)
  const status = new WorktreeStatusService(db, log)
  const terminals = { underCwd: () => [] as string[], close: () => undefined } as unknown as TerminalManager
  const cleanup = new WorktreeCleanup(db, dir, status, terminals, async () => undefined)
  const closure = new CardClosure(db, status, cleanup, forge)
  const ctx = { db, config: { mcp: { cardFiling: true } } as unknown as Config }
  const sessions = { statusBus: new EventEmitter() } as unknown as SessionManager
  const requests = new AgentRequests(ctx, sessions, {} as AgentRegistry, log, undefined, status, undefined, { forge, closure })

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerConversationRoutes(app, ctx, log, sessions, {} as AgentRegistry, {} as AttachmentStore, {} as WebhookService, closure)
  t.after(() => app.close())

  const propose = async (from: string, changes: Record<string, unknown>[]) => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({ id, projectId: 'project', conversationId: from, kind: 'request_card_change', payload: JSON.stringify({ changes }), createdAt: Date.now() })
      .run()
    await requests.sweep()
    return { id, row: db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()! }
  }
  const decide = (from: string, requestId: string) =>
    app.inject({ method: 'POST', url: `/api/conversations/${from}/card-filings/${requestId}`, payload: { decision: 'accepted' } })

  const lastEvent = (from: string, type: string) =>
    db.select().from(events).where(eq(events.conversationId, from)).all()
      .map((row) => JSON.parse(row.payload) as { type: string } & Record<string, unknown>)
      .filter((event) => event.type === type)
      .at(-1)
  const archived = (id: string) => db.select({ at: conversations.archivedAt }).from(conversations).where(eq(conversations.id, id)).get()?.at !== null
  const columnOf = (id: string) => db.select({ column: cards.column }).from(cards).where(eq(cards.id, id)).get()?.column
  const notes = (id: string) => db.select({ body: cardNotes.body }).from(cardNotes).where(eq(cardNotes.cardId, id)).all().map((row) => row.body)

  return { db, repo, card, tree, session, pr, propose, decide, lastEvent, archived, columnOf, notes }
}

test('une PR non fusionnée : la clôture est refusée au dépôt', async (t) => {
  const h = await harness(t)
  const c = h.card('review')
  const wt = h.tree('feat/ouverte', { push: true })
  h.session('author', c.id, wt.id)
  h.pr(10, 'feat/ouverte', wt.head(), 'OPEN')

  const { row } = await h.propose('author', [{ card: c.number, close: true, reason: 'Fini.' }])
  assert.equal(row.isError, true)
  assert.match(row.result ?? '', /n'est pas fusionnée/)
  assert.equal(h.columnOf(c.id), 'review')
})

test('PR fusionnée : un clic termine la carte, archive ses sessions, retire l’arbre et supprime ses branches', async (t) => {
  const h = await harness(t)
  const c = h.card('review')
  const wt = h.tree('feat/livree', { push: true })
  h.session('author', c.id, wt.id)
  h.session('reviewer', c.id, wt.id)
  h.session('earlier', c.id, null)
  h.pr(11, 'feat/livree', wt.head())

  const { id, row } = await h.propose('author', [{ card: c.number, close: true, reason: 'PR #11 fusionnée, vérifiée en dev.' }])
  assert.equal(row.isError, false, row.result ?? '')
  const requested = h.lastEvent('author', 'card_filing.requested') as { cards: { toColumn?: string; close?: unknown }[] }
  assert.equal(requested.cards[0]?.toColumn, 'done')
  assert.deepEqual(requested.cards[0]?.close, { conversations: 3, worktrees: ['feat/livree'], abandon: [], branch: null })
  // Rien avant le clic.
  assert.ok(existsSync(wt.path))
  assert.equal(h.archived('author'), false)

  const response = await h.decide('author', id)
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(h.columnOf(c.id), 'done')
  for (const s of ['author', 'reviewer', 'earlier']) assert.ok(h.archived(s), s)
  assert.ok(!existsSync(wt.path))
  assert.equal(git(h.repo, 'branch', '--list', 'feat/livree'), '')
  assert.equal(remoteHas(h.repo, 'feat/livree'), false)

  const resolved = h.lastEvent('author', 'card_filing.resolved') as { decision: string; closed: unknown[] }
  assert.equal(resolved.decision, 'accepted')
  assert.deepEqual(resolved.closed, [
    { number: c.number, archived: 3, removed: ['feat/livree'], kept: [], deleted: ['feat/livree'], abandoned: [] },
  ])
  assert.match(h.notes(c.id).at(-1) ?? '', /close : 3 conversation\(s\) archivée\(s\)/)
})

test('rien ne se perd : non commité, commits non poussés ou session au travail laissent l’arbre en place', async (t) => {
  const h = await harness(t)
  const c = h.card('done')

  // Fusionnée, puis un commit de plus, jamais poussé.
  const late = h.tree('feat/tardive', { push: true })
  h.pr(20, 'feat/tardive', late.head())
  writeFileSync(join(late.path, 'encore.txt'), 'encore\n')
  git(late.path, 'add', '-A')
  git(late.path, 'commit', '-m', 'après la fusion')
  h.session('late', c.id, late.id)

  // Fusionnée, avec une modification non commitée.
  const dirty = h.tree('feat/sale', { push: true })
  h.pr(21, 'feat/sale', dirty.head())
  writeFileSync(join(dirty.path, 'brouillon.txt'), 'brouillon\n')
  h.session('dirty', c.id, dirty.id)

  // Fusionnée, propre, mais une session y travaille.
  const busy = h.tree('feat/occupee', { push: true })
  h.pr(22, 'feat/occupee', busy.head())
  h.session('busy', c.id, busy.id, 'running')

  const { id, row } = await h.propose('late', [{ card: c.number, close: true, reason: 'Tout est fusionné.' }])
  assert.equal(row.isError, false, row.result ?? '')
  const response = await h.decide('late', id)
  assert.equal(response.statusCode, 200, response.body)

  for (const path of [late.path, dirty.path, busy.path]) assert.ok(existsSync(path), path)
  for (const branch of ['feat/tardive', 'feat/sale', 'feat/occupee']) assert.ok(remoteHas(h.repo, branch), branch)
  const resolved = h.lastEvent('late', 'card_filing.resolved') as { closed: { kept: { name: string; reason: string }[]; archived: number }[] }
  assert.deepEqual(
    resolved.closed[0]?.kept.map((kept) => `${kept.name}:${kept.reason}`).sort(),
    ['feat/occupee:busy', 'feat/sale:dirty', 'feat/tardive:unpushed'],
  )
  // Les sessions au repos sont archivées quand même ; celle qui travaille ne l'est pas.
  assert.equal(resolved.closed[0]?.archived, 2)
  assert.ok(h.archived('late'))
  assert.ok(h.archived('dirty'))
  assert.equal(h.archived('busy'), false)
})

test('une parente dont des enfants restent ouvertes : la demande les nomme, le clic les abandonne et nettoie leurs arbres', async (t) => {
  const h = await harness(t)
  const parent = h.card('in_progress', { branch: 'jalon/1-carte-1' })
  git(h.repo, 'branch', 'jalon/1-carte-1', 'main')
  git(h.repo, 'push', '--quiet', 'origin', 'jalon/1-carte-1')
  const finished = h.card('done', { parentId: parent.id })
  const open = h.card('in_progress', { parentId: parent.id })
  // L'enfant ouverte a poussé son travail, jamais fusionné.
  const wt = h.tree('feat/enfant', { push: true })
  h.session('child', open.id, wt.id)
  h.session('lead', parent.id, null)

  const { id, row } = await h.propose('lead', [{ card: parent.number, close: true, reason: '#3 ne se fera pas.' }])
  assert.equal(row.isError, false, row.result ?? '')
  const requested = h.lastEvent('lead', 'card_filing.requested') as { cards: { close: { abandon: { number: number }[]; branch: string | null; worktrees: string[] } }[] }
  assert.deepEqual(requested.cards[0]?.close.abandon.map((child) => child.number), [open.number])
  assert.deepEqual(requested.cards[0]?.close.worktrees, ['feat/enfant'])
  assert.equal(requested.cards[0]?.close.branch, 'jalon/1-carte-1')

  const response = await h.decide('lead', id)
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(h.columnOf(parent.id), 'done')
  assert.equal(h.columnOf(open.id), 'abandoned')
  assert.equal(h.columnOf(finished.id), 'done')
  assert.ok(h.archived('child'))
  assert.ok(h.archived('lead'))
  // Poussé : l'arbre part, et la branche abandonnée reste sur la forge.
  assert.ok(!existsSync(wt.path))
  assert.ok(remoteHas(h.repo, 'feat/enfant'))
  // La PR de la parente n'est pas fusionnée : sa branche reste.
  assert.ok(remoteHas(h.repo, 'jalon/1-carte-1'))

  const resolved = h.lastEvent('lead', 'card_filing.resolved') as { closed: { number: number; abandoned: number[]; kept: { name: string; reason: string }[]; removed: string[] }[] }
  assert.deepEqual(resolved.closed.map((outcome) => outcome.number), [parent.number, open.number])
  assert.deepEqual(resolved.closed[0]?.abandoned, [open.number])
  assert.deepEqual(resolved.closed[0]?.kept, [{ name: 'jalon/1-carte-1', reason: 'unmerged' }])
  assert.deepEqual(resolved.closed[1]?.removed, ['feat/enfant'])
  assert.match(h.notes(open.id).at(-1) ?? '', /Abandonnée à la clôture de la carte parente/)
})

test('une parente close une fois sa PR vers main fusionnée : sa branche part, en local et sur la forge', async (t) => {
  const h = await harness(t)
  git(h.repo, 'branch', 'jalon/1-carte-1', 'main')
  git(h.repo, 'push', '--quiet', 'origin', 'jalon/1-carte-1')
  const head = git(h.repo, 'rev-parse', 'jalon/1-carte-1')
  const parent = h.card('done', { branch: 'jalon/1-carte-1', branchPrNumber: 30 })
  h.card('done', { parentId: parent.id })
  h.session('lead', parent.id, null)

  h.pr(30, 'jalon/1-carte-1', head, 'OPEN')
  const refused = await h.propose('lead', [{ card: parent.number, close: true, reason: 'Toutes les enfants sont livrées.' }])
  assert.equal(refused.row.isError, true)
  assert.match(refused.row.result ?? '', /PR #30/)

  h.pr(30, 'jalon/1-carte-1', head)
  const { id, row } = await h.propose('lead', [{ card: parent.number, close: true, reason: 'PR #30 fusionnée dans main.' }])
  assert.equal(row.isError, false, row.result ?? '')
  const response = await h.decide('lead', id)
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(git(h.repo, 'branch', '--list', 'jalon/1-carte-1'), '')
  assert.equal(remoteHas(h.repo, 'jalon/1-carte-1'), false)
  assert.ok(remoteHas(h.repo, 'main'), 'la branche par défaut ne part jamais')
  assert.ok(h.archived('lead'))
})

test('close refuse une colonne autre que terminé ou abandonné', async (t) => {
  const h = await harness(t)
  const c = h.card('in_progress')
  h.session('author', c.id, null)
  const { row } = await h.propose('author', [{ card: c.number, close: true, column: 'review', reason: 'Fini.' }])
  assert.equal(row.isError, true)
  assert.match(row.result ?? '', /terminé|abandonné/)
})
