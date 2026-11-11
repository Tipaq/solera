import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import type { ActionSuggestion, TerminalDto } from '@solera/protocol'
import { ActionRunner, createAction } from '../src/actions/actions.js'
import {
  justRecipes,
  makeTargets,
  packageManagerOf,
  packageScripts,
  readSuggestions,
  withoutExisting,
} from '../src/actions/suggestions.js'
import type { Config } from '../src/config.js'
import { Environments } from '../src/environments/environments.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerActionRoutes } from '../src/http/routes/actions.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { TerminalManager } from '../src/terminals/terminal-manager.js'

const brief = (list: ActionSuggestion[]) => list.map((s) => `${s.kind} ${s.subdir || '.'} $ ${s.command}`)

test('package.json scripts: the package manager comes from the lockfile, the nature from the name', () => {
  assert.equal(packageManagerOf(new Set(['pnpm-lock.yaml'])), 'pnpm')
  assert.equal(packageManagerOf(new Set(['yarn.lock'])), 'yarn')
  assert.equal(packageManagerOf(new Set(['bun.lock'])), 'bun')
  assert.equal(packageManagerOf(new Set(['package-lock.json'])), 'npm')
  assert.equal(packageManagerOf(new Set()), 'npm')

  const scripts = packageScripts('package.json', { scripts: { dev: 'vite', test: 'vitest', storybook: 'storybook dev' } }, 'pnpm', '')
  assert.deepEqual(scripts[0], {
    source: 'package.json', name: 'dev', kind: 'service', reason: 'service-name',
    command: 'pnpm dev', subdir: '', url: 'http://localhost:{port}',
  })
  assert.deepEqual(scripts[1], {
    source: 'package.json', name: 'test', kind: 'task', reason: 'task',
    command: 'pnpm test', subdir: '', url: null,
  })
  assert.equal(scripts[2]!.kind, 'service')

  assert.deepEqual(
    packageScripts('package.json', { scripts: { start: 'node .', 'dev:web': 'vite' } }, 'npm', '').map((s) => [s.command, s.kind]),
    [['npm run start', 'service'], ['npm run dev:web', 'service']],
  )
  assert.equal(packageScripts('package.json', { scripts: { lint: 'eslint' } }, 'bun', '')[0]!.command, 'bun run lint')
})

test('package.json scripts: install hooks and pre/post hooks are not buttons, malformed scripts are ignored', () => {
  const scripts = packageScripts('apps/web/package.json', {
    scripts: {
      build: 'tsc', prebuild: 'rm -rf dist', postbuild: 'echo ok', prepare: 'husky', postinstall: 'x',
      preview: 'vite preview', broken: 3, empty: '',
    },
  }, 'pnpm', 'apps/web')
  assert.deepEqual(scripts.map((s) => s.name), ['build', 'preview'])
  assert.equal(scripts[0]!.subdir, 'apps/web')
  assert.equal(scripts[0]!.source, 'apps/web/package.json')
  // « preview » n'est pas le crochet d'un script « view » : c'est un serveur.
  assert.equal(scripts[1]!.kind, 'service')

  assert.deepEqual(packageScripts('package.json', null, 'npm', ''), [])
  assert.deepEqual(packageScripts('package.json', { scripts: ['dev'] }, 'npm', ''), [])
})

test('Makefile targets: real targets only, not variables, special targets, pattern rules or files', () => {
  const makefile = [
    '.PHONY: dev test',
    'CC := gcc',
    'VERSION ?= 1',
    'FLAGS = -a:b',
    'dev: deps',
    '\tnpm run dev',
    'test:',
    '\tgo test ./...',
    '%.o: %.c',
    'build/app.o: app.c',
    'two words: x',
    'check-all::',
    'test: again',
    '.DEFAULT_GOAL := dev',
  ].join('\n')
  assert.deepEqual(makeTargets(makefile), ['dev', 'test'])
})

test('justfile recipes: without parameters, neither private nor settings', () => {
  const justfile = [
    'set shell := ["bash", "-c"]',
    'alias b := build',
    'export FOO := "1"',
    '',
    'default:',
    '  just --list',
    '',
    '@build:',
    '  cargo build',
    '',
    'serve port="8080": build',
    '  ./serve {{port}}',
    '',
    'deploy env:',
    '  ./deploy {{env}}',
    '',
    '_helper:',
    '  echo',
    '',
    '[private]',
    'hidden:',
    '  echo',
    '',
    '[private]',
    '# a comment does not lift the attribute',
    'quiet:',
    '  echo',
    '',
    'lint: build',
    '  cargo clippy',
  ].join('\n')
  assert.deepEqual(justRecipes(justfile), ['default', 'build', 'lint'])
})

async function repository(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'solera-suggestions-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const write = async (path: string, content: string) => {
    await mkdir(join(dir, path, '..'), { recursive: true })
    await writeFile(join(dir, path), content)
  }
  await write('pnpm-lock.yaml', '')
  await write('package.json', JSON.stringify({ scripts: { start: 'node .', build: 'tsc -b', lint: 'eslint .', test: 'node --test', dev: 'vite' } }))
  await write('pnpm-workspace.yaml', 'packages:\n  - "apps/*"\n  - packages/db\n  - "!apps/ignored"\n')
  await write('apps/catalog/package.json', JSON.stringify({ name: '@x/catalog', scripts: { storybook: 'storybook dev' } }))
  await write('apps/ignored/package.json', JSON.stringify({ scripts: { dev: 'vite' } }))
  await write('apps/empty/README.md', '')
  await write('packages/db/package.json', JSON.stringify({ scripts: { migrate: 'drizzle-kit migrate' } }))
  await write('packages/other/package.json', JSON.stringify({ scripts: { dev: 'vite' } }))
  await write('Makefile', 'seed:\n\t./seed\n')
  await write('justfile', 'fmt:\n  cargo fmt\n')
  await write('compose.yaml', 'services: {}\n')
  await write('scripts/release.sh', '#!/bin/sh\n')
  await chmod(join(dir, 'scripts/release.sh'), 0o755)
  await write('scripts/clean.sh', 'rm -rf dist\n')
  await write('scripts/notes.md', '')
  return dir
}

test('a repository is read source by source, the root and its most useful scripts first', async (t) => {
  const dir = await repository(t)
  const found = await readSuggestions(dir)
  assert.deepEqual(brief(found), [
    'service . $ pnpm dev',
    'task . $ pnpm test',
    'task . $ pnpm lint',
    'task . $ pnpm build',
    'service . $ pnpm start',
    'task . $ make seed',
    'task . $ just fmt',
    'service . $ docker compose up',
    'task . $ bash scripts/clean.sh',
    'task . $ ./scripts/release.sh',
    'service apps/catalog $ pnpm storybook',
    'task packages/db $ pnpm migrate',
  ])
  const compose = found.find((s) => s.command === 'docker compose up')!
  assert.equal(compose.reason, 'compose')
  assert.equal(compose.source, 'compose.yaml')
  assert.equal(compose.url, null)
  assert.equal(found.find((s) => s.name === 'release')!.source, 'scripts/release.sh')
})

test('workspaces declared by package.json are read too, and a bare folder yields nothing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'solera-suggestions-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  assert.deepEqual(await readSuggestions(dir), [])

  await writeFile(join(dir, 'package.json'), JSON.stringify({ workspaces: { packages: ['web'] } }))
  await mkdir(join(dir, 'web'))
  await writeFile(join(dir, 'web/package.json'), JSON.stringify({ scripts: { start: 'node .' } }))
  await writeFile(join(dir, 'yarn.lock'), '')
  assert.deepEqual(brief(await readSuggestions(dir)), ['service web $ yarn start'])

  // Un package.json illisible ne fait pas taire les autres sources.
  await writeFile(join(dir, 'package.json'), '{ nope')
  await writeFile(join(dir, 'Makefile'), 'test:\n\techo\n')
  assert.deepEqual(brief(await readSuggestions(dir)), ['task . $ make test'])
})

test('a suggestion already saved as an action of the project is not suggested again', () => {
  const suggestion = (command: string, subdir: string): ActionSuggestion => ({
    source: 'package.json', name: 'x', kind: 'task', reason: 'task', command, subdir, url: null,
  })
  const list = [suggestion('pnpm dev', ''), suggestion('pnpm test', ''), suggestion('pnpm test', 'apps/web')]
  assert.deepEqual(
    brief(withoutExisting(list, [{ command: '  pnpm dev ', subdir: null }, { command: 'pnpm test', subdir: 'apps/web/' }])),
    ['task . $ pnpm test'],
  )
})

async function harness(t: TestContext) {
  const dir = await repository(t)
  const data = await mkdtemp(join(tmpdir(), 'solera-suggestions-data-'))
  t.after(() => rm(data, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(data, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())

  for (const id of ['owner', 'stranger']) {
    db.insert(users).values({ id, username: id, displayName: id, passwordHash: '', createdAt: 1 }).run()
  }
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'theirs', name: 'theirs', workspacePath: dir, ownerId: 'stranger', visibility: 'private', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'other', name: 'other', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  for (const [id, projectId] of [['agent', 'project'], ['elsewhere', 'other']] as const) {
    db.insert(conversations).values({
      id, projectId, userId: 'owner', title: 'Session', agent: 'claude', config: '{}', status: 'running',
      createdAt: 1, updatedAt: Date.now(),
    }).run()
  }
  const worktree = join(dir, 'apps')

  const config = {
    paths: { data: join(data, 'data'), worktrees: join(data, 'worktrees'), agents: join(data, 'agents') },
    limits: { ptyIdleTimeoutMin: 5 },
  } as unknown as Config
  const terminals = new TerminalManager(config)
  t.after(() => terminals.shutdown())
  const runner = new ActionRunner(db, config, terminals, new Environments(db))
  const previousShell = process.env.SHELL
  process.env.SHELL = '/bin/sh'
  t.after(() => { process.env.SHELL = previousShell })

  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  const sessions = { workingDirectory: () => worktree } as unknown as SessionManager
  registerActionRoutes(app, { db, config }, sessions, runner)
  t.after(() => app.close())

  const tryCommand = (body: object, projectId = 'project') =>
    app.inject({ method: 'POST', url: `/api/projects/${projectId}/actions/try`, payload: body })

  return { db, dir, worktree, terminals, app, tryCommand }
}

async function finished(terminals: TerminalManager, terminalId: string): Promise<TerminalDto> {
  const deadline = Date.now() + 5000
  for (;;) {
    const found = terminals.list('project').find((terminal) => terminal.id === terminalId)
    assert.ok(found, 'the terminal is still listed')
    if (!found.alive || Date.now() > deadline) return found
    await new Promise((done) => setTimeout(done, 25))
  }
}

test('GET suggestions reads the project repository, minus what is already an action', async (t) => {
  const { db, app } = await harness(t)
  createAction(db, 'project', { label: 'Dev', kind: 'service', command: 'pnpm dev' }, null)
  createAction(db, 'project', { label: 'Storybook', kind: 'service', command: 'pnpm storybook', subdir: 'apps/catalog' }, null)

  const response = await app.inject({ method: 'GET', url: '/api/projects/project/actions/suggestions' })
  assert.equal(response.statusCode, 200)
  const commands = (response.json() as ActionSuggestion[]).map((s) => s.command)
  assert.equal(commands[0], 'pnpm test')
  assert.ok(!commands.includes('pnpm dev'))
  assert.ok(!commands.includes('pnpm storybook'))

  const hidden = await app.inject({ method: 'GET', url: '/api/projects/theirs/actions/suggestions' })
  assert.equal(hidden.statusCode, 404)
})

test('trying a command opens a terminal in the project, under the given title, without saving anything', async (t) => {
  const { db, dir, terminals, tryCommand } = await harness(t)
  const response = await tryCommand({ command: 'pwd; exit 4', subdir: 'packages/db', title: 'Essai · pwd' })
  assert.equal(response.statusCode, 201)
  const terminal = response.json() as TerminalDto
  assert.equal(terminal.title, 'Essai · pwd')
  // Un essai n'est l'exécution d'aucune action.
  assert.equal(terminal.actionId, null)
  assert.equal(terminal.trial, true)
  assert.equal(terminal.cwd, join(dir, 'packages/db'))
  assert.equal((await finished(terminals, terminal.id)).exitCode, 4)
  assert.equal(db.select().from(conversations).all().length, 2)

  // Sans titre, la première ligne de la commande en tient lieu.
  const untitled = (await tryCommand({ command: 'true\nfalse' })).json() as TerminalDto
  assert.equal(untitled.title, 'true')
  assert.equal(untitled.cwd, dir)
})

test('a new try replaces the previous one, even if it still runs', async (t) => {
  const { terminals, tryCommand } = await harness(t)
  const first = (await tryCommand({ command: 'sleep 30' })).json() as TerminalDto
  assert.equal(first.alive, true)
  const second = (await tryCommand({ command: 'echo hi' })).json() as TerminalDto
  assert.notEqual(second.id, first.id)
  assert.deepEqual(terminals.list('project').map((terminal) => terminal.id), [second.id])
})

test('a try from a conversation runs in its worktree; refusals match those of a terminal and an action', async (t) => {
  const { worktree, tryCommand } = await harness(t)
  const fromSession = (await tryCommand({ command: 'pwd', conversationId: 'agent' })).json() as TerminalDto
  assert.equal(fromSession.cwd, worktree)

  assert.equal((await tryCommand({ command: 'pwd', conversationId: 'elsewhere' })).statusCode, 404)
  assert.equal((await tryCommand({ command: 'pwd' }, 'theirs')).statusCode, 404)
  assert.equal((await tryCommand({ command: '  ' })).statusCode, 400)
  assert.equal((await tryCommand({ command: 'pwd', subdir: '../out' })).statusCode, 400)
  const missing = await tryCommand({ command: 'pwd', subdir: 'nowhere' })
  assert.equal(missing.statusCode, 409)
  assert.equal(missing.json().error.code, 'action_cwd_missing')
})
