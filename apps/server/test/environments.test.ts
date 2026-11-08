import assert from 'node:assert/strict'
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'
import { eq } from 'drizzle-orm'
import { conversations, openDatabase, projects, runMigrations, users } from '@solera/db'
import {
  autonomousEnvironment,
  DEFAULT_CLAUDE_CONFIG,
  HOST_CONFINED_ENVIRONMENT,
  HOST_ENVIRONMENT,
  type AgentConfig,
  type ProjectEnvironmentsDto,
} from '@solera/protocol'
import { AcpClient } from '../src/agents/acp/client.js'
import { withControlSession } from '../src/agents/claude/control-session.js'
import { ClaudeRunner } from '../src/agents/claude/runner.js'
import { CliBinary } from '../src/agents/cli-binary.js'
import { CodexAppServerClient } from '../src/agents/codex/app-server-client.js'
import { OpencodeServer } from '../src/agents/opencode/server.js'
import type { RunnerContext } from '../src/agents/types.js'
import type { AttachmentStore } from '../src/attachments/store.js'
import type { CloneJobs } from '../src/clone-jobs.js'
import type { Config } from '../src/config.js'
import { createConversation } from '../src/conversations/create.js'
import { hasNativeConfinement, nativeConfinement } from '../src/environments/confined/native.js'
import { Environments } from '../src/environments/environments.js'
import { hostEnvironment } from '../src/environments/host.js'
import { EnvironmentUnavailableError } from '../src/environments/provider.js'
import { registerErrorHandler } from '../src/http/errors.js'
import { registerProjectRoutes } from '../src/http/routes/projects.js'
import type { SessionManager } from '../src/sessions/session-manager.js'
import { TerminalManager } from '../src/terminals/terminal-manager.js'
import { fixture as codexFixture } from './codex-support.js'
import { recordingEnvironment } from './environment-support.js'
import { fixture as opencodeFixture } from './opencode-support.js'

const DEVCONTAINER = { where: 'devcontainer', confined: false } as const
const DEVCONTAINER_CONFINED = { where: 'devcontainer', confined: true } as const
const SRC = fileURLToPath(new URL('../src/', import.meta.url))

async function database(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'solera-environments-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  db.insert(projects).values({ id: 'project', name: 'project', workspacePath: dir, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  return { dir, db }
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
}

/**
 * Ceux qui lancent un CLI d'agent ou un terminal : ils ne doivent le faire que par un
 * fournisseur. Les autres modules (git, services, mise à jour…) lancent des outils de
 * l'hôte pour le serveur, pas pour une session.
 */
const AGENT_LAUNCHERS = ['agents/', 'terminals/', 'actions/', 'claude-accounts/', 'codex-accounts/', 'grok-accounts/']

/** Les exceptions, chacune pour une raison qui n'est pas un lancement de session. */
const ALLOWED: Record<string, string> = {
  // L'installation d'un CLI par npm pose des fichiers sur l'hôte, où Solera les garde.
  'agents/cli-install.ts': 'npm',
  // `pgrep` regarde si un shell de l'hôte a un enfant, pour ne pas faucher un serveur de dev.
  'terminals/terminal-manager.ts': 'pgrep',
}

test("aucun CLI d'agent ni terminal ne se lance hors d'un fournisseur d'environnement", async () => {
  const offenders: string[] = []
  for (const file of await sourceFiles(SRC)) {
    const path = relative(SRC, file)
    const source = await readFile(file, 'utf8')
    // `launchOf` déplie les lanceurs Windows de l'hôte : seul l'hôte s'en sert.
    // npm et le CLI `devcontainer` du dev container tournent sur l'hôte, pour le serveur.
    const hostTools = ['agents/launch.ts', 'environments/host.ts', 'agents/cli-install.ts', 'environments/devcontainer/agents.ts', 'environments/devcontainer/tools.ts']
    if (/\blaunchOf\b/.test(source) && !hostTools.includes(path)) {
      offenders.push(`${path} : launchOf`)
    }
    // Une session Claude lancée par le SDK sans `spawnClaudeCodeProcess` partirait sur l'hôte.
    if (/\bquery\(\{/.test(source) && /from '@anthropic-ai\/claude-agent-sdk'/.test(source) && !source.includes('spawnClaudeCodeProcess')) {
      offenders.push(`${path} : query() sans spawnClaudeCodeProcess`)
    }
    if (!AGENT_LAUNCHERS.some((prefix) => path.startsWith(prefix)) || ALLOWED[path]) continue
    // Toute importation qui n'est pas seulement de types, sous toutes ses formes.
    for (const module of ['child_process', 'node-pty']) {
      const name = module === 'child_process' ? "(node:)?child_process" : 'node-pty'
      const imported = new RegExp(`^import (?!type )[^']*?from '${name}'`, 'm').test(source)
      const required = new RegExp(`(require|import)\\(\\s*'${name}'`).test(source)
      if (imported || required) offenders.push(`${path} : ${module}`)
    }
  }
  assert.deepEqual(offenders, [])
})

test('hôte : exec rend le code de sortie, spawn et pty lancent, les chemins ne bougent pas', async (t) => {
  const { dir } = await database(t)
  const result = await hostEnvironment.exec({ command: process.execPath, args: ['-e', 'process.stdout.write("hi"); process.exit(3)'], timeoutMs: 5000 })
  assert.deepEqual(result, { stdout: 'hi', stderr: '', code: 3 })
  await assert.rejects(hostEnvironment.exec({ command: join(dir, 'absent'), args: [], timeoutMs: 5000 }))

  const child = hostEnvironment.spawn({ command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'], cwd: dir })
  const echoed = new Promise<string>((resolve) => child.stdout.once('data', (data: Buffer) => resolve(data.toString())))
  child.stdin.write('ping')
  assert.equal(await echoed, 'ping')
  child.kill()

  const pty = hostEnvironment.spawnPty({ command: process.execPath, args: ['-e', 'console.log("pty")'], cwd: dir, name: 'xterm', cols: 80, rows: 24 })
  const exit = await new Promise<number>((resolve) => pty.onExit(({ exitCode }) => resolve(exitCode)))
  assert.equal(exit, 0)

  assert.equal(hostEnvironment.pathInside(dir), dir)
  assert.deepEqual(hostEnvironment.environment, HOST_ENVIRONMENT)
})

test("environnements : l'hôte, et l'hôte confiné là où la plateforme en a un ; un autre est refusé avec son code", async (t) => {
  const { db } = await database(t)
  const environments = new Environments(db)
  assert.deepEqual(environments.choices('project'), hasNativeConfinement() ? [HOST_ENVIRONMENT, HOST_CONFINED_ENVIRONMENT] : [HOST_ENVIRONMENT])
  assert.equal(environments.provider(HOST_ENVIRONMENT), hostEnvironment)
  assert.throws(() => environments.provider(DEVCONTAINER), (err: EnvironmentUnavailableError) =>
    err.code === 'environment_unavailable' && err.statusCode === 409 && err.params?.environment === 'devcontainer')
  assert.throws(() => environments.assertAvailable('project', { where: 'devcontainer', confined: true }), EnvironmentUnavailableError)
  assert.deepEqual(environments.ofProject('project'), HOST_ENVIRONMENT)
  assert.deepEqual(environments.ofProject('disparu'), HOST_ENVIRONMENT)
})

test('un terminal suit la session qui l’ouvre, et hors session le projet', async (t) => {
  const { db } = await database(t)
  db.insert(conversations).values({
    id: 'session', projectId: 'project', userId: 'owner', title: 's', agent: 'claude', config: '{}', status: 'idle',
    environmentWhere: 'devcontainer', environmentConfined: false, createdAt: 1, updatedAt: 1,
  }).run()
  const environments = new Environments(db)
  assert.equal(await environments.forTerminal('project', null, '/tmp'), hostEnvironment)
  // La session est dans un environnement que ce serveur ne sait pas lancer : son
  // terminal refuse, il ne s'ouvre pas sur l'hôte à sa place.
  await assert.rejects(environments.forTerminal('project', 'session', '/tmp'), EnvironmentUnavailableError)
})

test("créer une session fige l'environnement du projet, et refuse celui qu'on ne sait pas lancer", async (t) => {
  const { db } = await database(t)
  const sessions = {
    resolveDefaults: async (config: AgentConfig) => config,
    environments: new Environments(db),
  } as unknown as SessionManager
  const input = {
    projectId: 'project', userId: 'owner', agent: 'claude' as const, config: DEFAULT_CLAUDE_CONFIG,
    worktreeId: null, cardId: null, origin: null,
  }
  const row = await createConversation(db, sessions, input)
  assert.deepEqual([row.environmentWhere, row.environmentConfined], ['host', false])

  await assert.rejects(createConversation(db, sessions, { ...input, environment: DEVCONTAINER }), EnvironmentUnavailableError)
  assert.equal(db.select().from(conversations).all().length, 1, 'aucun fil condamné ne reste')
})

test("une session autonome prend l'environnement du projet, confiné si son lancement ou le projet le demandent", async (t) => {
  const { db } = await database(t)
  const sessions = {
    resolveDefaults: async (config: AgentConfig) => config,
    environments: new Environments(db),
  } as unknown as SessionManager
  const input = {
    projectId: 'project', userId: 'owner', agent: 'claude' as const, config: DEFAULT_CLAUDE_CONFIG,
    worktreeId: null, cardId: null, origin: null,
  }
  const permissionOf = (row: { config: string }) => (JSON.parse(row.config) as { permissionMode: string }).permissionMode

  // Un projet qui n'a rien réglé ne change pas : l'hôte, non confiné, ses autorisations.
  const plain = await createConversation(db, sessions, { ...input, autonomous: { confined: null } })
  assert.deepEqual([plain.environmentWhere, plain.environmentConfined, permissionOf(plain)], ['host', false, 'manual'])

  db.update(projects).set({ autonomousConfined: true }).run()
  // Le lancement passe outre le réglage du projet, dans un sens comme dans l'autre.
  const free = await createConversation(db, sessions, { ...input, autonomous: { confined: false } })
  assert.deepEqual([free.environmentWhere, free.environmentConfined, permissionOf(free)], ['host', false, 'manual'])
  // Une session que l'utilisateur ouvre lui-même garde l'environnement du projet.
  const opened = await createConversation(db, sessions, input)
  assert.equal(opened.environmentConfined, false)

  const before = db.select().from(conversations).all().length
  if ('backend' in nativeConfinement()) {
    const confined = await createConversation(db, sessions, { ...input, autonomous: { confined: null } })
    assert.deepEqual([confined.environmentWhere, confined.environmentConfined, permissionOf(confined)], ['host', true, 'bypassPermissions'])
  } else {
    // Sans confinement sur cette plateforme, elle refuse de démarrer, et ne tourne pas libre.
    await assert.rejects(createConversation(db, sessions, { ...input, autonomous: { confined: null } }), EnvironmentUnavailableError)
    assert.equal(db.select().from(conversations).all().length, before)
  }

  // `false` rend l'environnement du projet tel quel : on confine, on ne déconfine pas.
  assert.deepEqual(autonomousEnvironment(DEVCONTAINER_CONFINED, false, false), DEVCONTAINER_CONFINED)
  assert.deepEqual(autonomousEnvironment(DEVCONTAINER, true, null), DEVCONTAINER_CONFINED)
  assert.deepEqual(autonomousEnvironment(DEVCONTAINER, true, false), DEVCONTAINER)

  // Un fil libre n'a rien à confiner : refusé plutôt que lancé libre.
  await assert.rejects(
    createConversation(db, sessions, { ...input, projectId: null, autonomous: { confined: true } }),
    EnvironmentUnavailableError,
  )
})

test('projet : lire ses environnements, régler le sien, refuser ce qui ne se lance pas', async (t) => {
  const { db, dir } = await database(t)
  const app = Fastify()
  app.addHook('preHandler', async (request) => {
    request.user = db.select().from(users).where(eq(users.id, 'owner')).get()
  })
  registerErrorHandler(app)
  registerProjectRoutes(app, { db, config: { paths: { data: dir } } as Config }, {} as AttachmentStore, {} as CloneJobs, { aliveCount: () => 0 } as unknown as TerminalManager)
  t.after(() => app.close())

  const read = await app.inject({ method: 'GET', url: '/api/projects/project/environments' })
  assert.equal(read.statusCode, 200, read.body)
  assert.deepEqual(read.json<ProjectEnvironmentsDto>(), {
    default: HOST_ENVIRONMENT,
    choices: new Environments(db).choices('project'),
    suggested: null,
    autonomousConfined: false,
  })

  const host = await app.inject({ method: 'PATCH', url: '/api/projects/project', payload: { environment: HOST_ENVIRONMENT } })
  assert.equal(host.statusCode, 200, host.body)

  const refused = await app.inject({ method: 'PATCH', url: '/api/projects/project', payload: { environment: DEVCONTAINER } })
  assert.equal(refused.statusCode, 409)
  assert.equal(refused.json<{ error: { code: string } }>().error.code, 'environment_unavailable')
  assert.equal(db.select().from(projects).get()?.environmentWhere, 'host')
})

// Un faux `claude` : répond aux requêtes de contrôle, assez pour le SDK.
const fakeClaude = `
import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.type === 'control_request') {
    process.stdout.write(JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: message.request_id,
        response: { commands: [{ name: 'probe', description: '', argumentHint: '' }], models: [], agents: [], mcpServers: [] } }
    }) + '\\n');
  }
}
`

async function claudeBinary(t: TestContext): Promise<{ cwd: string; binary: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'solera-environments-claude-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const binary = join(cwd, 'claude.mjs')
  await writeFile(binary, fakeClaude)
  return { cwd, binary }
}

test("Claude : la session et la sonde passent par le fournisseur, par spawnClaudeCodeProcess", async (t) => {
  const { cwd, binary } = await claudeBinary(t)
  const environment = recordingEnvironment()
  const ctx: RunnerContext = {
    conversationId: 'test', cwd, binary, environment, config: DEFAULT_CLAUDE_CONFIG, resumeSessionId: null,
    attachmentsRoot: cwd, prototypesDir: null,
    projectOverview: () => null, maskedInstructionRoots: () => [], memoryDir: () => null,
    resolveMcpServers: () => ({ servers: [], failures: [] }), skillRoots: () => [],
    emit: () => {}, setStatus: () => {}, setAgentSessionId: () => {},
    updateConfig: () => {}, openPermissionRequest: () => 'permission', closePermissionRequest: () => {},
  }
  const runner = new ClaudeRunner(ctx)
  t.after(() => runner.stop())
  await runner.start()
  const deadline = Date.now() + 5000
  while (environment.launched.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.equal(environment.launched[0]?.via, 'spawn')
  assert.ok([environment.launched[0]!.command, ...environment.launched[0]!.args].includes(binary))

  const probe = recordingEnvironment()
  const commands = await withControlSession(
    { cli: { environment: probe, executable: async () => binary }, cwd, tag: 'test' },
    (session) => session.supportedCommands(),
  )
  assert.deepEqual(commands.map((command) => command.name), ['probe'])
  assert.equal(probe.launched.length, 1)
})

test("Claude mort au démarrage : la fin de son stderr dit pourquoi, dans le fil comme à la sonde", async (t) => {
  const { cwd } = await claudeBinary(t)
  const binary = join(cwd, 'dying.mjs')
  await writeFile(binary, "process.stderr.write('config illisible : ~/.claude.json\\n'); process.exit(1)\n")
  const errors: string[] = []
  const ctx: RunnerContext = {
    conversationId: 'test', cwd, binary, environment: hostEnvironment, config: DEFAULT_CLAUDE_CONFIG, resumeSessionId: null,
    attachmentsRoot: cwd, prototypesDir: null,
    projectOverview: () => null, maskedInstructionRoots: () => [], memoryDir: () => null,
    resolveMcpServers: () => ({ servers: [], failures: [] }), skillRoots: () => [],
    emit: (event) => { if (event.type === 'error') errors.push(event.message) },
    setStatus: () => {}, setAgentSessionId: () => {},
    updateConfig: () => {}, openPermissionRequest: () => 'permission', closePermissionRequest: () => {},
  }
  const runner = new ClaudeRunner(ctx)
  t.after(() => runner.stop())
  await runner.start()
  await runner.send('bonjour', [], [], []).catch(() => undefined)
  const deadline = Date.now() + 5000
  while (errors.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10))
  assert.match(errors.join('\n'), /config illisible/)

  await assert.rejects(
    withControlSession({ cli: { environment: hostEnvironment, executable: async () => binary }, cwd, tag: 'test' }, (session) => session.supportedCommands()),
    /config illisible/,
  )
})

test('Codex, ACP et OpenCode lancent leur CLI par le fournisseur', async (t) => {
  const codex = await codexFixture(t)
  const codexEnvironment = recordingEnvironment()
  const client = new CodexAppServerClient({ ...codex, environment: codexEnvironment })
  t.after(() => client.close())
  await client.initialize({ name: 'test', version: '1', title: null })
  assert.deepEqual(codexEnvironment.launched, [{ via: 'spawn', command: codex.binary, args: ['app-server'] }])

  const acpEnvironment = recordingEnvironment()
  const acp = new AcpClient({ label: 'grok', binary: codex.binary, environment: acpEnvironment, args: ['agent', 'stdio'], cwd: codex.cwd })
  acp.close()
  assert.deepEqual(acpEnvironment.launched, [{ via: 'spawn', command: codex.binary, args: ['agent', 'stdio'] }])

  const opencode = await opencodeFixture(t)
  const opencodeEnvironment = recordingEnvironment()
  const server = await OpencodeServer.start({ binary: opencode.binary, environment: opencodeEnvironment, cwd: opencode.cwd, config: {} })
  server.close()
  // La version est sondée dans l'environnement, avant d'y lancer le serveur.
  assert.deepEqual(opencodeEnvironment.launched.map(({ via, args }) => [via, args[0]]), [['exec', '--version'], ['spawn', 'serve']])
})

test("la détection d'un CLI se fait dans l'environnement", async (t) => {
  const { cwd } = await claudeBinary(t)
  const binary = join(cwd, 'probe-cli')
  await writeFile(binary, `#!${process.execPath}\nconsole.log('probe-cli 4.5.6')\n`)
  await chmod(binary, 0o755)
  const environment = recordingEnvironment()
  const cli = new CliBinary('codex', binary, true, join(cwd, 'managed'), environment)
  const status = await cli.status()
  assert.deepEqual(status, { found: true, path: binary, version: '4.5.6' })
  assert.deepEqual(environment.launched, [{ via: 'exec', command: binary, args: ['--version'] }])
})

test('un terminal se lance par le pty du fournisseur', async (t) => {
  const { dir } = await database(t)
  const terminals = new TerminalManager({
    paths: { data: join(dir, 'data'), agents: join(dir, 'agents') },
    limits: { ptyIdleTimeoutMin: 5 },
  } as unknown as Config)
  t.after(() => terminals.shutdown())
  const environment = recordingEnvironment()
  const terminal = terminals.open('project', dir, { environment, conversationId: 'session' }, { command: 'true', title: 'true', actionId: null })
  assert.equal(environment.launched.length, 1)
  assert.equal(environment.launched[0]!.via, 'pty')
  assert.equal(environment.launched[0]!.args.at(-1), 'true')
  // Retenue pour la relance : le shell repartira dans l'environnement de cette session.
  assert.equal(terminal.conversationId, 'session')
  terminals.close(terminal.id)
})
