import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { asc, eq } from 'drizzle-orm'
import {
  agentRequests,
  cardMoves,
  cardReviews,
  cards,
  conversations,
  openDatabase,
  projects,
  runMigrations,
  sessionMessages,
  users,
} from '@solera/db'
import { DEFAULT_CLAUDE_CONFIG } from '@solera/protocol'
import { projectOverview } from '../src/agents/overview.js'
import type { AgentRegistry } from '../src/agents/registry.js'
import type { Config } from '../src/config.js'
import { Decisions } from '../src/decisions/decisions.js'
import { EventLog } from '../src/events/event-log.js'
import type { Forge, PullRequest } from '../src/reviews/forge.js'
import { ESCALATION_OPTIONS } from '../src/reviews/reviews.js'
import { AgentRequests } from '../src/sessions/agent-requests.js'
import type { SessionManager } from '../src/sessions/session-manager.js'

/**
 * La revue d'une PR de carte (#68), de `request_review` au verdict et au plafond.
 *
 * Le dépôt est un vrai git, parce que c'est lui qui dit la branche et le commit de
 * l'auteur ; la forge est simulée, et c'est elle qu'on fait mentir pour les refus.
 */

const AUTHOR = 'author'
const LOOSE = 'loose'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()

async function harness(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-reviews-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo')
  git(dir, 'init', '-q', '-b', 'main', repo)
  await writeFile(join(repo, 'a.txt'), 'un\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'départ')
  git(repo, 'checkout', '-qb', 'feat/7-monter-vite')
  const commit = async (text: string) => {
    await writeFile(join(repo, 'a.txt'), text)
    git(repo, 'commit', '-qam', text)
    return git(repo, 'rev-parse', 'HEAD')
  }
  await commit('deux\n')

  const dbPath = join(dir, 'test.sqlite')
  const { db, sqlite } = openDatabase(dbPath)
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'Tim', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects)
    .values({ id: 'project', name: 'Nimbus', workspacePath: repo, ownerId: 'owner', visibility: 'private', createdAt: 1 })
    .run()
  db.insert(cards)
    .values({
      id: 'card', projectId: 'project', number: 7, title: 'Monter vite', description: '', column: 'in_progress',
      position: 1, createdBy: 'owner', createdAt: 1, updatedAt: 1,
    })
    .run()
  const now = Date.now()
  for (const [id, cardId] of [[AUTHOR, 'card'], [LOOSE, null]] as const) {
    db.insert(conversations)
      .values({
        id, projectId: 'project', userId: 'owner', title: `Session ${id}`, agent: 'claude', cardId,
        config: JSON.stringify(DEFAULT_CLAUDE_CONFIG), status: 'idle', createdAt: now, updatedAt: now,
      })
      .run()
  }

  // La forge rend la PR telle que le test la règle : par défaut, la branche de l'arbre
  // poussée jusqu'à son dernier commit.
  const pr: PullRequest = {
    number: 42, url: 'https://github.com/t/nimbus/pull/42', head: 'feat/7-monter-vite',
    headSha: git(repo, 'rev-parse', 'HEAD'), base: 'main', state: 'OPEN',
  }
  const forge: Forge = { readPullRequest: async () => ({ ...pr }) }

  const sent: Array<{ id: string; text: string }> = []
  const bus = new EventEmitter()
  const sessions = {
    statusBus: bus,
    sendMessage: async (id: string, _client: string, text: string) => {
      sent.push({ id, text })
    },
  } as unknown as SessionManager
  const registry = { adapter: () => ({ resolveDefaults: async (config: unknown) => config }) } as unknown as AgentRegistry
  const ctx = { db, config: { mcp: { decisions: true } } as unknown as Config }
  const log = new EventLog(db)
  const decisions = new Decisions(ctx, log, bus, { dispatch: async () => {} })
  const requests = new AgentRequests(ctx, sessions, registry, log, decisions, undefined, undefined, { forge })

  const call = async (conversationId: string, kind: 'request_review' | 'submit_review', payload: object) => {
    const id = randomUUID()
    db.insert(agentRequests)
      .values({ id, projectId: 'project', conversationId, kind, payload: JSON.stringify(payload), createdAt: Date.now() })
      .run()
    await requests.sweep()
    return db.select().from(agentRequests).where(eq(agentRequests.id, id)).get()!
  }
  const review = () => db.select().from(cardReviews).get()!
  const inbox = (to: string) =>
    db.select().from(sessionMessages).where(eq(sessionMessages.toConversationId, to)).orderBy(asc(sessionMessages.createdAt)).all()
  const tools = (conversationId: string) => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL('../src/mcp/solera-mcp.mjs', import.meta.url))], {
      env: { ...process.env, SOLERA_MCP_DB: dbPath, SOLERA_MCP_PROJECT: 'project', SOLERA_MCP_CONVERSATION: conversationId, SOLERA_MCP_MEMORY: '' },
      encoding: 'utf8', timeout: 10000,
      input: `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`,
    })
    assert.equal(run.status, 0, run.stderr)
    return (JSON.parse(run.stdout).result as { tools: { name: string }[] }).tools.map((tool) => tool.name)
  }

  return { db, repo, pr, commit, sent, call, review, inbox, tools, decisions }
}

test('revue : la PR signalée lance une relectrice sur la carte, dans l’arbre de l’auteure', async (t) => {
  const { db, sent, call, review, tools } = await harness(t)

  const asked = await call(AUTHOR, 'request_review', { pr: '42' })
  assert.equal(asked.isError, false, asked.result ?? '')
  assert.match(asked.result ?? '', /tour 1 sur 3/)

  const row = review()
  assert.equal(row.state, 'reviewing')
  assert.equal(row.branch, 'feat/7-monter-vite')
  assert.equal(row.base, 'main')
  assert.ok(row.reviewerConversationId)
  const reviewer = db.select().from(conversations).where(eq(conversations.id, row.reviewerConversationId!)).get()!
  assert.equal(reviewer.cardId, 'card')
  assert.equal(sent.length, 1)
  assert.equal(sent[0]!.id, reviewer.id)
  assert.match(sent[0]!.text, /solera:code-review/)
  assert.match(sent[0]!.text, /submit_review/)

  // Chacune ne voit que son bout de la boucle.
  const forAuthor = tools(AUTHOR)
  assert.ok(forAuthor.includes('request_review'))
  assert.ok(!forAuthor.includes('submit_review'))
  const forReviewer = tools(reviewer.id)
  assert.ok(forReviewer.includes('submit_review'))
  assert.ok(!forReviewer.includes('request_review'))

  // Le briefing le dit aussi, chacune à sa façon.
  const brief = (id: string) => projectOverview(db, { projectId: 'project', conversationId: id, soleraMcp: true } as Parameters<typeof projectOverview>[1]) ?? ''
  assert.match(brief(AUTHOR), /request_review/)
  assert.match(brief(reviewer.id), /Tu es la revue/)

  const again = await call(AUTHOR, 'request_review', { pr: '42' })
  assert.equal(again.isError, true)
  assert.match(again.result ?? '', /déjà en cours/)
})

test('revue : refusée hors carte, sur une autre branche, ou avant la poussée', async (t) => {
  const { pr, commit, call, db } = await harness(t)

  const loose = await call(LOOSE, 'request_review', { pr: '42' })
  assert.equal(loose.isError, true)
  assert.match(loose.result ?? '', /aucune carte/)

  pr.head = 'feat/autre'
  const elsewhere = await call(AUTHOR, 'request_review', { pr: '42' })
  assert.equal(elsewhere.isError, true)
  assert.match(elsewhere.result ?? '', /feat\/autre/)

  pr.head = 'feat/7-monter-vite'
  await commit('trois\n')
  const unpushed = await call(AUTHOR, 'request_review', { pr: '42' })
  assert.equal(unpushed.isError, true)
  assert.match(unpushed.result ?? '', /Pousse/)

  assert.equal(db.select().from(cardReviews).all().length, 0, 'Aucune revue ouverte par un refus')
})

test('revue : corrections, nouveau tour, puis vert qui range la carte « à vérifier »', async (t) => {
  const { db, pr, commit, call, review, inbox } = await harness(t)
  await call(AUTHOR, 'request_review', { pr: '42' })
  const reviewer = review().reviewerConversationId!

  const intruder = await call(AUTHOR, 'submit_review', { verdict: 'approve', summary: 'ok' })
  assert.equal(intruder.isError, true, "L'auteure ne rend pas son propre verdict")

  const changes = await call(reviewer, 'submit_review', { verdict: 'changes', summary: 'Le cas vide plante.' })
  assert.equal(changes.isError, false, changes.result ?? '')
  assert.equal(review().state, 'changes')
  assert.match(inbox(AUTHOR).at(-1)!.body, /Le cas vide plante/)

  const same = await call(AUTHOR, 'request_review', { pr: '42' })
  assert.equal(same.isError, true)
  assert.match(same.result ?? '', /déjà été relu/)

  pr.headSha = await commit('corrigé\n')
  const round2 = await call(AUTHOR, 'request_review', { pr: '42' })
  assert.equal(round2.isError, false, round2.result ?? '')
  assert.equal(review().round, 2)
  assert.equal(review().state, 'reviewing')
  assert.match(inbox(reviewer).at(-1)!.body, /tour 2 sur 3/)

  const approve = await call(reviewer, 'submit_review', { verdict: 'approve', summary: 'Tout est traité.' })
  assert.equal(approve.isError, false, approve.result ?? '')
  assert.equal(review().state, 'approved')
  assert.equal(review().reviewedSha, pr.headSha)
  assert.equal(db.select().from(cards).where(eq(cards.id, 'card')).get()!.column, 'review')
  const move = db.select().from(cardMoves).where(eq(cardMoves.cardId, 'card')).get()!
  assert.equal(move.toColumn, 'review')
  assert.equal(move.userId, null)
  assert.match(inbox(AUTHOR).at(-1)!.body, /Ne fusionne pas/)
})

test('revue : au plafond, une décision part, et « un tour de plus » relève le plafond', async (t) => {
  const { db, pr, commit, call, review, inbox, decisions } = await harness(t)
  await call(AUTHOR, 'request_review', { pr: '42' })
  const reviewer = review().reviewerConversationId!

  for (let round = 1; round <= 3; round += 1) {
    if (round > 1) {
      pr.headSha = await commit(`tour ${round}\n`)
      const asked = await call(AUTHOR, 'request_review', { pr: '42' })
      assert.equal(asked.isError, false, asked.result ?? '')
    }
    const verdict = await call(reviewer, 'submit_review', { verdict: 'changes', summary: `Encore faux au tour ${round}.` })
    assert.equal(verdict.isError, false, verdict.result ?? '')
  }

  const escalated = review()
  assert.equal(escalated.state, 'escalated')
  assert.ok(escalated.decisionId)
  const decision = db.select().from(agentRequests).where(eq(agentRequests.id, escalated.decisionId!)).get()!
  assert.equal(decision.kind, 'request_decision')
  assert.equal(decision.conversationId, reviewer)
  assert.ok(decision.settledAt && decision.expiresAt, 'Déposée comme celle d’un agent : visible dans « À décider »')
  assert.match(inbox(AUTHOR).at(-1)!.body, /plafond/)

  const blocked = await call(AUTHOR, 'request_review', { pr: '42' })
  assert.equal(blocked.isError, true)
  const early = await call(reviewer, 'submit_review', { verdict: 'approve', summary: 'ok' })
  assert.equal(early.isError, true)
  assert.match(early.result ?? '', /pas encore tranché/)

  await decisions.answer('owner', escalated.decisionId!, { option: ESCALATION_OPTIONS.again, text: '' })
  const extra = await call(reviewer, 'submit_review', { verdict: 'changes', summary: 'Dernière chose.' })
  assert.equal(extra.isError, false, extra.result ?? '')
  assert.equal(review().state, 'changes')
  assert.equal(review().maxRounds, 4)
})
