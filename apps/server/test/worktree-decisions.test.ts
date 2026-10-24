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
import { agentRequests, cards, conversations, openDatabase, projects, runMigrations, users, worktrees } from '@solera/db'
import { decisionAnswerSchema } from '@solera/protocol'
import type { Config } from '../src/config.js'
import { Decisions } from '../src/decisions/decisions.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerDecisionRoutes } from '../src/http/routes/decisions.js'
import { watchMergedCards } from '../src/worktrees/merged-cards.js'
import { WorktreeStatusService } from '../src/worktrees/status-service.js'

/**
 * Une fusion ne propose plus de nettoyer l'arbre dans « À décider », réservé à ce qu'un
 * agent demande à une personne. La détection de fusion, elle, reste : c'est elle qui
 * passe en « Terminé » la carte de la session qui vivait dans l'arbre (#86). Les
 * propositions qu'une version d'avant avait posées sont retirées, sans rien nettoyer.
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
  // Branché comme dans `main.ts`.
  service.retireWorktreeProposals()
  watchMergedCards(db, status)

  /** Recalcule comme après un tour, et laisse la détection passer. */
  const compute = async () => {
    status.invalidate('project')
    await status.current(project)
    await settle()
  }
  /** Les décisions, avec leur issue. */
  const rows = () =>
    db.select().from(agentRequests).all().map((row) => {
      const answer = row.answer ? decisionAnswerSchema.parse(JSON.parse(row.answer)) : null
      return { ...row, status: answer?.by ?? 'pending', answer }
    })

  /** Une proposition « nettoyer ? » telle que la posait une version d'avant. */
  const oldProposal = (path: string, id = 'old') =>
    db.insert(agentRequests).values({
      id,
      projectId: 'project',
      conversationId: '',
      kind: 'request_decision',
      payload: JSON.stringify({
        question: 'feat/done est fusionnée et propre : nettoyer ?',
        context: '',
        options: ['clean', 'keep'],
        defaultOption: null,
        worktree: { branch: 'feat/done', head: null, base: 'main', sessions: 0 },
      }),
      createdAt: 1,
      settledAt: 1,
      expiresAt: Date.now() + 3_600_000,
      worktreePath: path,
    }).run()

  return { db, repo, merged, compute, rows, service, announced, oldProposal }
}

test('une fusion passe la carte en « Terminé » et ne propose plus rien dans « À décider »', async (t) => {
  const { db, merged, compute, rows, announced, service } = harness(t)
  const path = merged('feat/done')
  db.insert(worktrees).values({ id: 'wt', projectId: 'project', name: 'feat/done', path, baseRef: 'main', createdBy: 'owner', createdAt: 1 }).run()
  db.insert(cards).values({
    id: 'card', projectId: 'project', number: 1, title: 'Carte', description: '', column: 'in_progress',
    position: 1, createdBy: 'owner', createdAt: 1, updatedAt: 1,
  }).run()
  db.insert(conversations).values({
    id: 'agent', projectId: 'project', userId: 'owner', title: 'Agent', agent: 'claude', config: '{}',
    status: 'idle', worktreeId: 'wt', cardId: 'card', createdAt: 1, updatedAt: 5,
  }).run()

  await compute()
  assert.equal(db.select().from(cards).where(eq(cards.id, 'card')).get()!.column, 'done')
  assert.equal(rows().length, 0)
  assert.deepEqual(announced, [])
  assert.deepEqual(service.awaiting('owner'), [])
  assert.equal(service.pendingCount('owner'), 0)
  assert.ok(existsSync(path), "l'arbre reste : le nettoyage se fait à la main")
})

test('les propositions en attente sont retirées au démarrage, sans nettoyer ni relancer', async (t) => {
  const { merged, rows, service, oldProposal } = harness(t)
  const path = merged('feat/done')
  oldProposal(path)
  assert.equal(service.pendingCount('owner'), 1)

  assert.equal(service.retireWorktreeProposals(), 1)
  const [row] = rows()
  assert.equal(row!.status, 'withdrawn')
  assert.ok(row!.resolvedAt)
  assert.equal(row!.acceptedAt, null)
  assert.equal(service.pendingCount('owner'), 0)
  assert.ok(existsSync(path))
  // Elle reste lisible dans l'historique.
  assert.equal(service.list('owner', 'all')[0]!.worktree?.path, path)
  assert.equal(service.retireWorktreeProposals(), 0)
})

test('le balayage retire aussi une proposition restée en attente', async (t) => {
  const { merged, rows, service, oldProposal } = harness(t)
  const path = merged('feat/done')
  oldProposal(path)
  service.sweep()
  assert.equal(rows()[0]!.status, 'withdrawn')
  assert.ok(existsSync(path))
})

test('répondre « Nettoyer » à une ancienne proposition la retire et ne nettoie rien', async (t) => {
  const { db, merged, rows, service, oldProposal } = harness(t)
  const path = merged('feat/done')
  oldProposal(path)

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerDecisionRoutes(app, service)
  t.after(() => app.close())
  const answered = await app.inject({ method: 'POST', url: '/api/decisions/old/answer', payload: { option: 'clean' } })
  assert.equal(answered.statusCode, 409, answered.body)
  assert.equal(rows()[0]!.status, 'withdrawn')
  assert.ok(existsSync(path))
})
