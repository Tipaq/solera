import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import { openDatabase, projects, runMigrations, users } from '@solera/db'
import { EventLog } from '../src/events/event-log.js'
import { ProjectPullRequests, type RawPullRequest } from '../src/reviews/pull-requests.js'
import { assessWorktree, listWorktrees } from '../src/worktrees/assess.js'
import { landedPullRequests } from '../src/worktrees/landed.js'
import { WorktreeStatusService } from '../src/worktrees/status-service.js'

/**
 * Une branche fusionnée par squash sur la forge, puis la base qui avance par-dessus
 * (#126) : le contenu ne suffit plus à la dire fusionnée, la PR fusionnée le peut.
 *
 * Même cloisonnement que `worktree-status.test.ts` : la configuration git de la machine
 * ne doit pas décider du résultat.
 */
const isolation = mkdtempSync(join(tmpdir(), 'solera-squash-isolation-'))
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

function write(repo: string, file: string, content: string): void {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), content)
}

function commitAll(cwd: string, message: string): string {
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

function pr(number: number, branch: string, state: RawPullRequest['state'], head: string, base = 'main'): RawPullRequest {
  return {
    number,
    title: branch,
    url: `https://github.com/o/r/pull/${number}`,
    headRefName: branch,
    headRefOid: head,
    baseRefName: base,
    state,
    isDraft: false,
    mergedAt: state === 'MERGED' ? '2026-10-26T10:00:00Z' : null,
    updatedAt: '2026-10-26T10:00:00Z',
    statusCheckRollup: [],
  }
}

/**
 * Un dépôt où chaque branche a touché `src/app.ts`, fusionnée par squash ou non, puis
 * une base qui a réécrit la même ligne : toutes entrent en conflit avec elle.
 */
function setup(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'solera-squash-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'repo')
  const trees = join(dir, 'trees')
  mkdirSync(repo)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Squash test')
  git(repo, 'config', 'user.email', 'squash@example.test')
  write(repo, 'src/app.ts', 'export const app = 1\n')
  commitAll(repo, 'root')

  const branch = (name: string, content: string, worktree = true): { path: string; head: string } => {
    const path = join(trees, name.replace(/\//g, '__'))
    if (worktree) git(repo, 'worktree', 'add', '-b', name, path, 'main')
    else git(repo, 'branch', name, 'main')
    const cwd = worktree ? path : repo
    if (!worktree) git(repo, 'switch', name)
    write(cwd, 'src/app.ts', content)
    const head = commitAll(cwd, name)
    if (!worktree) git(repo, 'switch', 'main')
    return { path, head }
  }

  const squashed = branch('feat/squashed', 'export const app = 2\n')
  git(repo, 'merge', '--squash', 'feat/squashed')
  git(repo, 'commit', '-m', 'squash (#1)')
  const later = branch('feat/later', 'export const app = 3\n')
  git(repo, 'merge', '--squash', 'feat/later')
  git(repo, 'commit', '-m', 'squash (#2)')
  // Commité après la fusion de sa PR : ce commit-là n'est livré nulle part.
  write(later.path, 'src/extra.ts', 'extra\n')
  commitAll(later.path, 'après la fusion')
  const closed = branch('feat/closed', 'export const app = 4\n')
  const orphan = branch('feat/no-pr', 'export const app = 5\n')
  const loose = branch('feat/loose', 'export const app = 6\n', false)
  // La base avance sur la même ligne.
  write(repo, 'src/app.ts', 'export const app = 7\n')
  commitAll(repo, 'la base avance')

  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: repo, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  const project = db.select().from(projects).where(eq(projects.id, 'project')).get()!

  const forge = [
    pr(1, 'feat/squashed', 'MERGED', squashed.head),
    pr(2, 'feat/later', 'MERGED', later.head),
    pr(3, 'feat/closed', 'CLOSED', closed.head),
    pr(4, 'feat/loose', 'MERGED', loose.head),
  ]
  return { repo, db, project, forge, paths: { squashed: squashed.path, later: later.path, closed: closed.path, orphan: orphan.path } }
}

test('une PR fusionnée par squash rend la branche fusionnée, même après que la base a avancé', async (t) => {
  const { db, project, forge } = setup(t)
  const pullRequests = new ProjectPullRequests(db, async () => forge)
  const list = await new WorktreeStatusService(db, new EventLog(db), pullRequests.merged).get(project)
  const byName = Object.fromEntries(list.worktrees.map((tree) => [tree.name, tree]))

  const squashed = byName['feat/squashed']!
  assert.deepEqual(
    [squashed.state, squashed.mergedPullRequest, squashed.conflicts, squashed.unmergedCommits],
    ['merged', 1, false, false],
  )
  // Un commit de plus que la PR n'a pas porté : à fusionner encore.
  assert.deepEqual([byName['feat/later']!.state, byName['feat/later']!.mergedPullRequest], ['unmerged', null])
  // Une PR fermée sans fusion ne livre rien, et une branche sans PR reste jugée sur son contenu.
  assert.deepEqual([byName['feat/closed']!.state, byName['feat/closed']!.conflicts], ['unmerged', true])
  assert.deepEqual([byName['feat/no-pr']!.state, byName['feat/no-pr']!.conflicts], ['unmerged', true])
  // Une branche libre, sans arbre, se juge de même.
  assert.deepEqual(list.branches, [{ name: 'feat/loose', merged: true }])
})

test('sans forge, le contenu juge seul : le squash rattrapé par la base reste à fusionner', async (t) => {
  const { db, project } = setup(t)
  const offline = new ProjectPullRequests(db, async () => {
    throw new Error('gh absent')
  })
  for (const source of [offline.merged, undefined]) {
    const list = await new WorktreeStatusService(db, new EventLog(db), source).get(project)
    const squashed = list.worktrees.find((tree) => tree.name === 'feat/squashed')!
    assert.deepEqual([squashed.state, squashed.mergedPullRequest], ['unmerged', null])
    assert.deepEqual(list.branches, [{ name: 'feat/loose', merged: false }])
  }
})

test("une PR fusionnée dans la branche d'un jalon compte si le jalon est fusionné dans la base après elle", () => {
  const merged = [
    { number: 1, branch: 'feat/a', base: 'jalon/x', head: 'a', mergedAt: 10 },
    { number: 2, branch: 'jalon/x', base: 'main', head: 'x', mergedAt: 20 },
    // Fusionnée dans le jalon après sa fusion dans main : elle attend la suivante.
    { number: 3, branch: 'feat/late', base: 'jalon/x', head: 'l', mergedAt: 30 },
    { number: 4, branch: 'feat/b', base: 'jalon/y', head: 'b', mergedAt: 10 },
    // De proche en proche : une sous-branche du jalon, fusionnée avant lui.
    { number: 5, branch: 'feat/a-1', base: 'feat/a', head: 'a1', mergedAt: 5 },
  ]
  const landed = landedPullRequests(merged, 'origin/main')
  assert.deepEqual([...landed.keys()].sort(), ['feat/a', 'feat/a-1', 'jalon/x'])
  assert.deepEqual(landed.get('feat/a'), [{ number: 1, head: 'a' }])
})

test('du non commité sur une branche fusionnée par PR, et un commit de PR que le dépôt ne connaît pas', async (t) => {
  const { repo, paths, forge } = setup(t)
  const entry = (await listWorktrees(repo)).find((e) => e.path === paths.squashed)!
  const landed = [{ number: 1, head: forge[0]!.headRefOid! }]

  // Le non commité que la base a déjà : toujours fusionné.
  write(paths.squashed, 'src/app.ts', 'export const app = 7\n')
  let result = await assessWorktree(repo, 'main', entry, { landed })
  assert.deepEqual([result.state, result.mergedPullRequest], ['merged', 1])
  // Du vrai travail par-dessus : non commité, la PR n'y change rien.
  write(paths.squashed, 'src/app.ts', 'export const app = 8\n')
  result = await assessWorktree(repo, 'main', entry, { landed })
  assert.equal(result.state, 'dirty')
  // Sans `--merge-base`, le non commité ne se juge pas, mais ne dit pas de conflit inventé.
  write(paths.squashed, 'src/app.ts', 'export const app = 7\n')
  result = await assessWorktree(repo, 'main', entry, { landed, legacyGit: true })
  assert.deepEqual([result.state, result.conflicts], ['dirty', false])

  // Un commit fusionné qui n'est pas dans le dépôt ne prouve rien.
  git(paths.squashed, 'checkout', '--', '.')
  result = await assessWorktree(repo, 'main', entry, { landed: [{ number: 1, head: '0'.repeat(40) }] })
  assert.deepEqual([result.state, result.mergedPullRequest], ['unmerged', null])
})
