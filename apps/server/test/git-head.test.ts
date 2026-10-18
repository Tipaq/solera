import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { readGitHead } from '../src/git.js'

/** La pastille du fil dit ce qui est extrait : branche, tête détachée, ou rebase en cours. */

const repo = mkdtempSync(join(tmpdir(), 'solera-head-'))
const outside = mkdtempSync(join(tmpdir(), 'solera-head-out-'))
after(() => {
  rmSync(repo, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

const git = (...args: string[]): string =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@x' },
  }).trim()

test('hors dépôt, rien ; dans un dépôt sans commit, la branche à naître', async () => {
  assert.equal(await readGitHead(outside), null)
  git('init', '-q', '-b', 'main')
  assert.deepEqual(await readGitHead(repo), { branch: 'main', detached: null, rebasing: null })
})

test('la branche extraite, puis la tête détachée, puis la branche d\'un rebase en conflit', async () => {
  writeFileSync(join(repo, 'a.txt'), 'base\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')
  assert.deepEqual(await readGitHead(repo), { branch: 'main', detached: null, rebasing: null })

  const hash = git('rev-parse', '--short', 'HEAD')
  git('checkout', '-q', '--detach')
  assert.deepEqual(await readGitHead(repo), { branch: null, detached: hash, rebasing: null })

  git('checkout', '-q', 'main')
  git('checkout', '-q', '-b', 'feat/x')
  writeFileSync(join(repo, 'a.txt'), 'feat\n')
  git('commit', '-q', '-am', 'feat')
  git('checkout', '-q', 'main')
  writeFileSync(join(repo, 'a.txt'), 'main\n')
  git('commit', '-q', '-am', 'main')
  git('checkout', '-q', 'feat/x')
  assert.throws(() => git('rebase', 'main'))
  const head = await readGitHead(repo)
  assert.equal(head?.rebasing, 'feat/x')
  assert.equal(head?.branch, null)
})
