import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import { soleraEventSchema, type CommitDetailDto, type CommitTurnDto } from '@solera/protocol'
import { captureSnapshot, checkpointRef, copyCheckpoints } from '../src/checkpoints.js'
import { EventLog } from '../src/events/event-log.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerGitViewRoutes } from '../src/http/routes/git-views.js'

/**
 * Commit → tour (S4, #171) : le tour qui a produit un commit se lit dans les points de
 * reprise, dont la méta garde HEAD avant et après. Le commit est du tour quand HEAD
 * d'avant ne le contient pas et que HEAD d'après le contient ; une fusion qui l'apporte
 * d'ailleurs ne le revendique pas, et deux tours qui le revendiquent font taire la route.
 *
 * Un dépôt temporaire par test, et des tours simulés par les captures elles-mêmes :
 * aucune session ne tourne.
 */

const isolation = mkdtempSync(join(tmpdir(), 'solera-commit-turn-isolation-'))
writeFileSync(join(isolation, 'gitconfig'), '')
process.env.GIT_CONFIG_NOSYSTEM = '1'
process.env.GIT_CONFIG_GLOBAL = join(isolation, 'gitconfig')
for (const name of ['EMAIL', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
  delete process.env[name]
}
after(() => rmSync(isolation, { recursive: true, force: true }))

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).trim()
}

/** Un commit ; `date` l'antidate, comme un commit venu d'ailleurs bien avant le tour. */
function commit(cwd: string, file: string, message: string, date?: string): string {
  writeFileSync(join(cwd, file), `${message}\n`)
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '-q', '-m', message], date ? { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : undefined)
  return git(cwd, ['rev-parse', 'HEAD'])
}

async function harness(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'solera-commit-turn-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Testeur'])
  git(repo, ['config', 'user.email', 'testeur@example.test'])
  const root = commit(repo, 'README.md', 'racine', '2026-01-01T00:00:00Z')

  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'Demo', workspacePath: repo, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'other', name: 'Autre', workspacePath: repo, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()

  const log = new EventLog(db)
  log.thread.stop()

  let created = 10
  const conversation = (id: string, title: string, extra: { projectId?: string; forkedFromId?: string } = {}) => {
    db.insert(conversations)
      .values({ id, projectId: extra.projectId ?? 'project', userId: 'owner', title, agent: 'claude', config: '{}', status: 'idle', createdAt: created++, updatedAt: Date.now(), forkedFromId: extra.forkedFromId ?? null })
      .run()
  }
  const say = (conversationId: string, messageId: string, text: string) =>
    log.append(conversationId, soleraEventSchema.parse({ type: 'message.completed', messageId, role: 'user', parentToolCallId: null, blocks: [{ type: 'text', text }] }))

  /**
   * Un tour comme le gestionnaire de sessions l'écrit : la capture d'avant, son
   * événement, le message qui l'ouvre ; puis `work` ; puis la capture d'après.
   */
  let keys = 0
  const turn = async (conversationId: string, text: string, work: () => void, cwd = repo) => {
    const key = `key-${++keys}`
    await captureSnapshot(cwd, checkpointRef(conversationId, key, 'before'))
    log.append(conversationId, soleraEventSchema.parse({ type: 'checkpoint.started', key }))
    say(conversationId, `${key}-opener`, text)
    work()
    await captureSnapshot(cwd, checkpointRef(conversationId, key, 'after'))
    return key
  }

  const app = Fastify()
  registerErrorHandler(app)
  app.addHook('onRequest', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerGitViewRoutes(app, { db, config: { paths: { data: dir, database: join(dir, 'test.sqlite') } } } as never)
  t.after(() => app.close())

  const turnOf = async (hash: string, base = '/api/projects/project') => {
    const res = await app.inject({ method: 'GET', url: `${base}/commits/${hash}/turn` })
    assert.equal(res.statusCode, 200, res.body)
    return res.json<CommitTurnDto | null>()
  }
  return { app, db, dir, repo, root, log, conversation, say, turn, turnOf }
}

test('un commit écrit pendant un tour rend la conversation, le numéro du tour et son message', async (t) => {
  const h = await harness(t)
  h.conversation('c1', 'Ajoute le changelog')
  // Un premier tour sans point de reprise : le numéro suit les tours de la conversation,
  // pas les captures.
  h.say('c1', 'm1', 'Bonjour')
  let written = ''
  const key = await h.turn('c1', 'Commite le changelog', () => {
    written = commit(h.repo, 'CHANGELOG.md', 'changelog')
  })

  assert.deepEqual(await h.turnOf(written), {
    conversationId: 'c1',
    title: 'Ajoute le changelog',
    turn: 2,
    message: 'Commite le changelog',
    key,
  })
  // Par un hash abrégé, et depuis la portée d'une conversation : même réponse.
  assert.equal((await h.turnOf(written.slice(0, 8), '/api/conversations/c1'))?.turn, 2)
})

test('un commit posé entre deux tours, ou un tour qui ne bouge pas HEAD, ne rend rien', async (t) => {
  const h = await harness(t)
  h.conversation('c1', 'Fil')
  await h.turn('c1', 'Lis seulement', () => {
    writeFileSync(join(h.repo, 'brouillon.txt'), 'sans commit\n')
  })
  const between = commit(h.repo, 'main.txt', 'à la main')
  await h.turn('c1', 'Encore un tour', () => {})

  assert.equal(await h.turnOf(between), null)
  assert.equal(await h.turnOf(h.root), null)
})

test("une fusion qui apporte le commit ne le revendique pas : le tour qui l'a écrit le garde", async (t) => {
  const h = await harness(t)
  h.conversation('writer', 'Écrit sur la branche')
  h.conversation('merger', 'Fusionne à la racine')
  const tree = join(h.dir, 'arbre')
  git(h.repo, ['worktree', 'add', '-q', '-b', 'feat/x', tree, 'main'])

  let written = ''
  const key = await h.turn('writer', 'Écris la fonctionnalité', () => {
    written = commit(tree, 'x.txt', 'fonctionnalité')
  }, tree)
  await h.turn('merger', 'Fusionne feat/x', () => {
    commit(h.repo, 'main.txt', 'travail sur main')
    git(h.repo, ['merge', '-q', '--no-ff', '-m', 'Fusion de feat/x', 'feat/x'])
  })

  assert.deepEqual(await h.turnOf(written), {
    conversationId: 'writer',
    title: 'Écrit sur la branche',
    turn: 1,
    message: 'Écris la fonctionnalité',
    key,
  })
})

test("un commit ancien qu'un tour amène par avance rapide n'est pas de ce tour", async (t) => {
  const h = await harness(t)
  h.conversation('c1', 'Avance')
  git(h.repo, ['switch', '-q', '-c', 'ancienne'])
  const old = commit(h.repo, 'old.txt', 'ancien', '2026-02-01T00:00:00Z')
  git(h.repo, ['switch', '-q', 'main'])
  await h.turn('c1', 'Avance main', () => {
    git(h.repo, ['merge', '-q', '--ff-only', 'ancienne'])
  })
  assert.equal(await h.turnOf(old), null)
})

test('deux tours qui revendiquent le même commit : la route se tait plutôt que de choisir', async (t) => {
  const h = await harness(t)
  h.conversation('a', 'Premier')
  h.conversation('b', 'Second')
  let written = ''
  // Deux tours ouverts en même temps à la racine : chacun voit HEAD passer sur le commit.
  const before = (id: string, key: string) => captureSnapshot(h.repo, checkpointRef(id, key, 'before'))
  const afterTurn = (id: string, key: string) => captureSnapshot(h.repo, checkpointRef(id, key, 'after'))
  await before('a', 'ka')
  await before('b', 'kb')
  for (const [id, key] of [['a', 'ka'], ['b', 'kb']] as const) {
    h.log.append(id, soleraEventSchema.parse({ type: 'checkpoint.started', key }))
    h.say(id, `${key}-opener`, 'Commite')
  }
  written = commit(h.repo, 'both.txt', 'les deux')
  await afterTurn('a', 'ka')
  await afterTurn('b', 'kb')

  assert.equal(await h.turnOf(written), null)
})

test("une branche de conversation hérite des captures : le commit reste à l'originale", async (t) => {
  const h = await harness(t)
  h.conversation('source', 'Originale')
  let written = ''
  const key = await h.turn('source', 'Commite', () => {
    written = commit(h.repo, 'f.txt', 'fork')
  })
  h.conversation('fork', 'Branche', { forkedFromId: 'source' })
  h.log.copyThrough('source', 'fork', Number.MAX_SAFE_INTEGER)
  await copyCheckpoints(h.repo, 'source', 'fork')

  assert.deepEqual(await h.turnOf(written), { conversationId: 'source', title: 'Originale', turn: 1, message: 'Commite', key })
})

test("les captures d'un autre projet sur le même dépôt, et un tour encore ouvert, ne comptent pas", async (t) => {
  const h = await harness(t)
  h.conversation('ailleurs', 'Autre projet', { projectId: 'other' })
  let written = ''
  await h.turn('ailleurs', 'Commite', () => {
    written = commit(h.repo, 'a.txt', 'ailleurs')
  })
  assert.equal(await h.turnOf(written), null)
  assert.equal((await h.turnOf(written, '/api/projects/other'))?.conversationId, 'ailleurs')

  h.conversation('ouvert', 'Tour en cours')
  await captureSnapshot(h.repo, checkpointRef('ouvert', 'k-open', 'before'))
  const pending = commit(h.repo, 'b.txt', 'en cours')
  assert.equal(await h.turnOf(pending), null)
})

test("un message d'ouverture long est rendu sur une ligne et borné", async (t) => {
  const h = await harness(t)
  h.conversation('c1', 'Long')
  let written = ''
  await h.turn('c1', `Première ligne\n\n${'x'.repeat(600)}`, () => {
    written = commit(h.repo, 'l.txt', 'long')
  })
  const found = await h.turnOf(written)
  assert.ok(found)
  assert.ok(found.message.startsWith('Première ligne x'))
  assert.ok(found.message.length <= 280)
})

test('un hash invalide ou inconnu est refusé', async (t) => {
  const h = await harness(t)
  const bad = await h.app.inject({ method: 'GET', url: '/api/projects/project/commits/zzz/turn' })
  assert.equal(bad.statusCode, 400)
  const unknown = await h.app.inject({ method: 'GET', url: `/api/projects/project/commits/${'a'.repeat(40)}/turn` })
  assert.equal(unknown.statusCode, 400)
  assert.equal(unknown.json().error.code, 'bad_commit')
})

test('le détail d\'un commit porte les fils candidats quand les dates se recoupent', async (t) => {
  const h = await harness(t)
  const now = Date.now()
  h.conversation('a', 'Premier')
  h.conversation('b', 'Second')
  h.db.update(conversations).set({ createdAt: now - 60_000, updatedAt: now + 60_000 }).run()
  const written = commit(h.repo, 'c.txt', 'à deux')

  const res = await h.app.inject({ method: 'GET', url: `/api/projects/project/commits/${written}/detail` })
  assert.equal(res.statusCode, 200, res.body)
  const detail = res.json<CommitDetailDto>()
  assert.equal(detail.thread, null)
  assert.deepEqual(
    detail.threadCandidates.map((candidate) => candidate.id).sort(),
    ['a', 'b'],
  )
  assert.ok(detail.threadCandidates.every((candidate) => !candidate.sure))

  // Un seul fil à cette heure-là : il est le fil du commit, et la liste reste vide.
  h.db.update(conversations).set({ createdAt: 1, updatedAt: 2 }).where(eq(conversations.id, 'b')).run()
  const single = (await h.app.inject({ method: 'GET', url: `/api/projects/project/commits/${written}/detail` })).json<CommitDetailDto>()
  assert.equal(single.thread?.id, 'a')
  assert.deepEqual(single.threadCandidates, [])
})
