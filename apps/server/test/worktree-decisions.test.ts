import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { EventEmitter } from 'node:events'
import Fastify from 'fastify'
import { agentRequests, conversations, openDatabase, projects, runMigrations, users, worktrees } from '@solera/db'
import { decisionAnswerSchema } from '@solera/protocol'
import type { Config } from '../src/config.js'
import { Decisions } from '../src/decisions/decisions.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerDecisionRoutes } from '../src/http/routes/decisions.js'
import type { TerminalManager } from '../src/terminals/terminal-manager.js'
import { WorktreeCleanup } from '../src/worktrees/cleanup.js'
import { watchMergedWorktrees } from '../src/worktrees/merge-watch.js'
import { WorktreeStatusService } from '../src/worktrees/status-service.js'

/**
 * « À décider » propose de nettoyer un arbre fusionné et propre : détection, une seule
 * question par arbre, retrait quand l'arbre bouge, et réponse qui nettoie ou garde.
 */
const isolation = mkdtempSync(join(tmpdir(), 'solera-worktree-decision-isolation-'))
writeFileSync(join(isolation, 'gitconfig'), '')
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_GLOBAL = join(isolation, 'gitconfig')
after(() => rmSync(isolation, { recursive: true, force: true }))

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Laisse passer les abonnés du calcul, qui tournent hors du chemin de la réponse. */
const settle = () => new Promise((done) => setTimeout(done, 100))

function harness(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'solera-worktree-decisions-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'Decision test')
  git(repo, 'config', 'user.email', 'decision@example.test')
  writeFileSync(join(repo, 'README.md'), 'base\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'root')

  /** Une branche dans son arbre, fusionnée par squash dans main. */
  const merged = (branch: string) => {
    const path = join(dir, 'trees', branch.replace(/\//g, '__'))
    git(repo, 'worktree', 'add', '-q', '-b', branch, path, 'main')
    writeFileSync(join(path, `${branch.replace(/\//g, '-')}.txt`), `${branch}\n`)
    git(path, 'add', '-A')
    git(path, 'commit', '-q', '-m', branch)
    git(repo, 'merge', '-q', '--squash', branch)
    git(repo, 'commit', '-q', '-m', `squash ${branch}`)
    return path
  }

  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: repo, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  const project = db.select().from(projects).where(eq(projects.id, 'project')).get()!

  const log = new EventLog(db)
  const status = new WorktreeStatusService(db, log)
  const announced: string[] = []
  const service = new Decisions({ db, config: {} as Config }, log, new EventEmitter(), {
    dispatch: async (userId, notification) => {
      const toast = notification.toast as { question?: string; worktreeBranch?: string | null } | undefined
      announced.push(`${userId} ${toast?.worktreeBranch ?? ''} ${toast?.question ?? ''}`)
    },
  })
  const terminals = { underCwd: () => [] as string[], close: () => {} } as unknown as TerminalManager
  const cleanup = new WorktreeCleanup(db, dir, status, terminals, async () => {})
  watchMergedWorktrees(db, status, service, cleanup)

  /** Recalcule comme après un tour, et laisse la détection passer. */
  const compute = async () => {
    status.invalidate('project')
    await status.current(project)
    await settle()
  }
  /** Les propositions, lues comme les anciennes lignes `decisions` de l'amont. */
  const rows = () =>
    db.select().from(agentRequests).all().map((row) => {
      const answer = row.answer ? decisionAnswerSchema.parse(JSON.parse(row.answer)) : null
      return { ...row, status: answer?.by ?? 'pending', answer }
    })

  return { db, repo, merged, compute, rows, service, announced }
}

test('un arbre fusionné et propre est proposé une fois, au propriétaire', async (t) => {
  const { db, repo, merged, compute, rows, announced, service } = harness(t)
  const path = merged('feat/done')
  // Un arbre qui porte encore du travail n'est pas proposé.
  const busyTree = join(repo, '..', 'trees', 'feat__wip')
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/wip', busyTree, 'main')
  writeFileSync(join(busyTree, 'wip.txt'), 'wip\n')

  await compute()
  const [first, ...others] = rows()
  assert.equal(others.length, 0)
  const payload = JSON.parse(first!.payload) as { options: string[]; worktree: { branch: string } }
  assert.deepEqual(
    [first!.kind, payload.worktree.branch, first!.worktreePath, first!.status, payload.options],
    ['request_decision', 'feat/done', path, 'pending', ['clean', 'keep']],
  )
  assert.equal(first!.conversationId, '')
  assert.deepEqual(announced, ['owner feat/done feat/done est fusionnée et propre : nettoyer ?'])
  // Elle va au propriétaire du projet, dans « À décider » comme dans l'historique.
  assert.deepEqual(service.awaiting('owner').map((item) => item.kind === 'decision' && item.worktreeBranch), ['feat/done'])
  assert.equal(service.list('owner', 'pending')[0]!.worktree?.path, path)

  // Les calculs suivants ne reposent pas la question.
  await compute()
  assert.equal(rows().length, 1)

  // L'échéance la clôt sans rien remettre ni nettoyer : la session n'existe pas.
  db.update(agentRequests).set({ expiresAt: Date.now() - 1 }).run()
  service.sweep()
  assert.equal(rows()[0]!.status, 'expired')
  assert.ok(rows()[0]!.resolvedAt)
  assert.ok(existsSync(path))
  await compute()
  assert.equal(rows().length, 1, 'une question expirée ne revient pas')
})

test('toute session liée qui travaille repousse la question, mais seules celles de l’arbre comptent', async (t) => {
  const { db, merged, compute, rows } = harness(t)
  const path = merged('feat/agent')
  db.insert(worktrees).values({ id: 'wt', projectId: 'project', name: 'feat/agent', path, baseRef: 'main', createdBy: 'owner', createdAt: 1 }).run()
  db.insert(conversations).values([
    { id: 'agent', projectId: 'project', userId: 'owner', title: 'Agent', agent: 'claude', config: '{}', status: 'running', worktreeId: 'wt', createdAt: 1, updatedAt: 5 },
    // Une session de la racine qui a cité l'arbre dans une commande, et tourne encore.
    { id: 'root', projectId: 'project', userId: 'owner', title: 'Racine', agent: 'claude', config: '{}', status: 'running', createdAt: 1, updatedAt: 9 },
  ]).run()
  new EventLog(db).append('root', { type: 'tool.started', toolCallId: 't', name: 'Bash', input: { command: `git -C ${path} log` }, parentToolCallId: null })

  await compute()
  assert.equal(rows().length, 0)

  // Celle de l'arbre a fini, celle de la racine qui y a cité un chemin tourne encore :
  // elle y travaille peut-être, la question attend.
  db.update(conversations).set({ status: 'idle' }).where(eq(conversations.id, 'agent')).run()
  await compute()
  assert.equal(rows().length, 0)

  db.update(conversations).set({ status: 'idle' }).where(eq(conversations.id, 'root')).run()
  await compute()
  assert.equal(rows().length, 1)
  assert.equal(rows()[0]!.conversationId, 'agent')
  assert.equal((JSON.parse(rows()[0]!.payload) as { worktree: { sessions: number } }).worktree.sessions, 1)
})

test('la proposition se retire quand l’arbre reprend du travail ou disparaît', async (t) => {
  const { merged, compute, rows, repo } = harness(t)
  const reopened = merged('feat/reopened')
  const removed = merged('feat/removed')
  await compute()
  assert.equal(rows().filter((row) => row.status === 'pending').length, 2)

  writeFileSync(join(reopened, 'again.txt'), 'again\n')
  git(repo, 'worktree', 'remove', '--force', removed)
  await compute()
  const byPath = new Map(rows().map((row) => [row.worktreePath, row]))
  assert.equal(byPath.get(reopened)!.status, 'withdrawn')
  assert.equal(byPath.get(removed)!.status, 'withdrawn')

  // Fusionné de nouveau, l'arbre est reproposé : le retrait ne vaut pas réponse.
  rmSync(join(reopened, 'again.txt'))
  await compute()
  assert.equal(rows().filter((row) => row.worktreePath === reopened && row.status === 'pending').length, 1)
})

test('répondre « Garder » laisse l’arbre, « Nettoyer » le retire avec sa branche', async (t) => {
  const { repo, merged, compute, rows, service } = harness(t)
  const kept = merged('feat/kept')
  const cleaned = merged('feat/cleaned')
  await compute()
  const id = (path: string) => rows().find((row) => row.worktreePath === path)!.id

  const keep = await service.answer('owner', id(kept), { option: 'keep', text: '' })
  assert.equal(keep.status, 'user')
  assert.equal(keep.answer?.option, 'keep')
  assert.equal(keep.worktree?.path, kept)
  assert.ok(existsSync(kept))

  await assert.rejects(service.answer('owner', id(cleaned), { option: null, text: 'vas-y' }), /Choose one of the options/)
  const clean = await service.answer('owner', id(cleaned), { option: 'clean', text: '' })
  assert.equal(clean.status, 'user')
  assert.ok(!existsSync(cleaned))
  assert.equal(git(repo, 'branch', '--list', 'feat/cleaned'), '')
  assert.equal(git(repo, 'branch', '--list', 'feat/kept').replace(/^[*+ ]+/, ''), 'feat/kept')

  await compute()
  assert.equal(rows().filter((row) => row.status === 'pending').length, 0, 'ni l’arbre gardé ni le nettoyé ne reviennent')
})

test('« Nettoyer » sur un arbre qui a bougé depuis la question ne nettoie rien', async (t) => {
  const { merged, compute, rows, service } = harness(t)
  const path = merged('feat/moved')
  await compute()
  const decision = rows()[0]!
  // Du travail arrive après la question, sans nouveau calcul entre-temps.
  writeFileSync(join(path, 'late.txt'), 'late\n')

  await assert.rejects(service.answer('owner', decision.id, { option: 'clean', text: '' }), /changed since the question/)
  assert.ok(existsSync(join(path, 'late.txt')))
  assert.equal(rows()[0]!.status, 'withdrawn')
})

test('la route : seul le propriétaire du projet tranche, et « Nettoyer » répond par la décision close', async (t) => {
  const { db, merged, compute, rows, service } = harness(t)
  const path = merged('feat/route')
  await compute()
  const id = rows()[0]!.id
  db.insert(users).values({ id: 'other', username: 'other', displayName: 'Other', passwordHash: '', createdAt: 1 }).run()

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    const as = (request.headers['x-as'] as string | undefined) ?? 'owner'
    request.user = db.select().from(users).where(eq(users.id, as)).get()
  })
  registerErrorHandler(app)
  registerDecisionRoutes(app, service)
  t.after(() => app.close())

  const foreign = await app.inject({ method: 'GET', url: `/api/decisions/${id}`, headers: { 'x-as': 'other' } })
  assert.equal(foreign.statusCode, 404)
  const answered = await app.inject({ method: 'POST', url: `/api/decisions/${id}/answer`, payload: { option: 'clean' } })
  assert.equal(answered.statusCode, 200)
  assert.equal(answered.json().status, 'user')
  assert.ok(!existsSync(path))
})

test('un arbre qu’on vient de créer n’est jamais proposé, même sans rien en avance', async (t) => {
  const { repo, compute, rows } = harness(t)
  const fresh = join(repo, '..', 'trees', 'feat__fresh')
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/fresh', fresh, 'main')
  await compute()
  assert.equal(rows().length, 0)
  assert.ok(existsSync(fresh))
})

test('« Garder » vaut pour cet arbre-là : recréé et refusionné, il est reproposé', async (t) => {
  const { repo, merged, compute, rows, service } = harness(t)
  const path = merged('feat/again')
  await compute()
  await service.answer('owner', rows()[0]!.id, { option: 'keep', text: '' })
  await compute()
  assert.equal(rows().length, 1, 'gardé, et rien n’a bougé : la question ne revient pas')

  // Le même chemin, une autre vie : l'arbre est retiré, puis recréé et fusionné de nouveau.
  git(repo, 'worktree', 'remove', '--force', path)
  git(repo, 'branch', '-D', 'feat/again')
  git(repo, 'worktree', 'add', '-q', '-b', 'feat/again', path, 'main')
  writeFileSync(join(path, 'second.txt'), 'second\n')
  git(path, 'add', '-A')
  git(path, 'commit', '-q', '-m', 'second')
  git(repo, 'merge', '-q', '--squash', 'feat/again')
  git(repo, 'commit', '-q', '-m', 'squash again')
  await compute()
  assert.equal(rows().filter((row) => row.status === 'pending').length, 1)
})
