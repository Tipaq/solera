import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { brotliCompressSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { openDatabase, projects, runMigrations, users } from '@solera/db'
import { DEVCONTAINER_ENVIRONMENT, HOST_ENVIRONMENT } from '@solera/protocol'
import type { Paths } from '../src/config.js'
import { AGENTS_MOUNT, ContainerAgents, linuxPackage } from '../src/environments/devcontainer/agents.js'
import { Devcontainers, parseEnv, targetArch, unreachableAdvice } from '../src/environments/devcontainer/containers.js'
import { DevcontainerEnvironment, type RunningContainer } from '../src/environments/devcontainer/environment.js'
import { DevcontainerTools, hostAddressOf, parseUpResult } from '../src/environments/devcontainer/tools.js'
import { Environments } from '../src/environments/environments.js'

async function tempDir(t: TestContext, prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Un `docker` qui note ses arguments et les variables que Solera lui confie, sans rien lancer. */
async function fakeDocker(t: TestContext): Promise<{ docker: string; calls: () => Promise<string[][]>; envOf: () => Promise<string> }> {
  const dir = await tempDir(t, 'solera-fake-docker-')
  const docker = join(dir, 'docker')
  await writeFile(
    docker,
    `#!/bin/sh\nfor a in "$@"; do printf '%s\\037' "$a"; done >> "${dir}/calls"\nprintf '\\n' >> "${dir}/calls"\n[ -f "${dir}/env" ] || env > "${dir}/env"\n`,
  )
  await chmod(docker, 0o755)
  return {
    docker,
    calls: async () =>
      (await readFile(join(dir, 'calls'), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => line.split('\x1f').slice(0, -1)),
    envOf: () => readFile(join(dir, 'env'), 'utf8'),
  }
}

function container(overrides: Partial<RunningContainer> = {}): RunningContainer {
  return {
    id: 'c0ffee',
    user: 'vscode',
    loginShell: '/bin/bash',
    workspace: '/home/me/project',
    remoteWorkspaceFolder: '/workspaces/project',
    solerasMounts: true,
    env: { PATH: '/home/vscode/.nvm/bin:/usr/bin', LANG: 'C.UTF-8' },
    agents: new Map([['claude', `${AGENTS_MOUNT}/claude/2.1.301-linux-x64/package/claude`]]),
    hostAddress: 'host.docker.internal',
    ...overrides,
  }
}

function exited(child: { once(event: 'exit', listener: () => void): unknown }): Promise<void> {
  return new Promise((resolve) => child.once('exit', () => resolve()))
}

test("un CLI se lance dans le conteneur par docker exec, sous l'utilisateur du devcontainer.json, dans son dossier", async (t) => {
  const fake = await fakeDocker(t)
  const host = { PATH: process.env.PATH, HOME: '/home/me', SOLERA_SECRET_ALREADY: 'x' }
  const environment = new DevcontainerEnvironment(container(), fake.docker, host)
  const binary = environment.resolveBinary('claude')
  assert.equal(binary, `${AGENTS_MOUNT}/claude/2.1.301-linux-x64/package/claude`)

  const child = environment.spawn({
    command: binary!,
    args: ['--print', 'hi'],
    cwd: '/home/me/data/worktrees/p/feat',
    env: { ...host, PATH: '/host/only', CLAUDE_CODE_OAUTH_TOKEN: 'sk-secret', LANG: 'fr_FR.UTF-8' },
  })
  await exited(child)
  const [args] = await fake.calls()
  assert.ok(args)
  const at = (flag: string) => args[args.indexOf(flag) + 1]
  assert.deepEqual(args.slice(0, 2), ['exec', '-i'])
  assert.equal(args.includes('-t'), false)
  assert.equal(at('-u'), 'vscode')
  // Monté au même chemin : le worktree n'est pas traduit, et ses liens git tiennent.
  assert.equal(at('-w'), '/home/me/data/worktrees/p/feat')
  // L'environnement du conteneur passe en valeur, ce que Solera ajoute par son seul nom.
  assert.ok(args.includes('PATH=/home/vscode/.nvm/bin:/usr/bin'))
  assert.ok(args.includes('CLAUDE_CODE_OAUTH_TOKEN'))
  assert.ok(args.includes('LANG'))
  assert.equal(args.some((arg) => arg.includes('sk-secret')), false, 'un jeton ne passe jamais sur la ligne de commande')
  assert.equal(args.includes('PATH=/host/only'), false)
  assert.match(await fake.envOf(), /^CLAUDE_CODE_OAUTH_TOKEN=sk-secret$/m)
  const id = args.indexOf('c0ffee')
  assert.deepEqual(args.slice(id + 1, id + 3), ['/bin/sh', '-c'])
  assert.deepEqual(args.slice(id + 5), [binary, '--print', 'hi'])

  // Tuer le client ne tue pas le processus du conteneur : à sa sortie, on le tue par son pid.
  const pidFile = args[id + 4]
  let reap: string[] | undefined
  for (let tries = 0; tries < 50 && !reap; tries++) {
    reap = (await fake.calls())[1]
    if (!reap) await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.ok(reap)
  assert.deepEqual(reap.slice(0, 4), ['exec', '-u', 'root', 'c0ffee'])
  assert.deepEqual(reap.slice(-2), [pidFile, binary])
  // Le groupe entier, et KILL pour ce qui ignore TERM ; sans `--`, que dash refuse.
  const script = reap.at(-3) ?? ''
  assert.match(script, /kill -TERM "-\$p"/)
  assert.match(script, /kill -KILL "-\$p"/)
  assert.doesNotMatch(script, /kill -\w+ --/)
})

test("un terminal ouvre le shell de connexion du conteneur, pas celui de l'hôte", async (t) => {
  const fake = await fakeDocker(t)
  const environment = new DevcontainerEnvironment(container(), fake.docker, { PATH: process.env.PATH })
  const pty = environment.spawnPty({ command: '/usr/bin/zsh', args: [], cwd: '/home/me/project', name: 'xterm-256color', cols: 80, rows: 24 })
  await new Promise<void>((resolve) => pty.onExit(() => resolve()))
  const [args] = await fake.calls()
  assert.ok(args)
  assert.deepEqual(args.slice(0, 3), ['exec', '-i', '-t'])
  assert.deepEqual(args.slice(-2), ['/bin/bash', '-l'])

  const action = environment.spawnPty({ command: '/usr/bin/zsh', args: ['-lc', 'pnpm test'], name: 'xterm', cols: 80, rows: 24 })
  await new Promise<void>((resolve) => action.onExit(() => resolve()))
  const calls = await fake.calls()
  const run = calls.find((call) => call.includes('pnpm test'))
  assert.ok(run)
  assert.deepEqual(run.slice(-3), ['/bin/bash', '-lc', 'pnpm test'])
})

test("un conteneur démarré hors de Solera voit le projet là où le devcontainer.json le monte", () => {
  const environment = new DevcontainerEnvironment(container({ solerasMounts: false }), '/usr/bin/docker')
  assert.equal(environment.pathInside('/home/me/project/src'), '/workspaces/project/src')
  assert.equal(environment.pathInside('/home/me/project'), '/workspaces/project')
  assert.equal(new DevcontainerEnvironment(container(), '/usr/bin/docker').pathInside('/home/me/project/src'), '/home/me/project/src')
})

test("le MCP de Solera, sur la boucle locale de l'hôte, se joint depuis le conteneur par l'adresse de l'hôte", () => {
  const environment = new DevcontainerEnvironment(container(), '/usr/bin/docker')
  assert.equal(environment.urlOfHost('http://127.0.0.1:7517'), 'http://host.docker.internal:7517')
  assert.equal(environment.urlOfHost('http://100.64.0.2:7517'), 'http://100.64.0.2:7517')
})

test("sous Linux natif, l'hôte vu du conteneur est sa passerelle, la boucle locale sur le réseau de l'hôte, et rien sans réseau", () => {
  assert.equal(hostAddressOf('bridge|172.17.0.1, \n'), '172.17.0.1')
  assert.equal(hostAddressOf('proj_default|,fd00::1 172.18.0.1,fd01::1 \n'), '172.18.0.1')
  assert.equal(hostAddressOf('proj_default|,fd00::1 \n'), 'fd00::1')
  assert.equal(hostAddressOf('host|\n'), '127.0.0.1')
  assert.equal(hostAddressOf('none|\n'), null)
  assert.equal(hostAddressOf('container:abc|\n'), null)
})

test("l'URL du MCP met une passerelle IPv6 entre crochets, et garde la boucle locale sur le réseau de l'hôte", () => {
  const v6 = new DevcontainerEnvironment(container({ hostAddress: 'fd00::1' }), 'docker')
  assert.equal(v6.urlOfHost('http://127.0.0.1:7517'), 'http://[fd00::1]:7517')
  const host = new DevcontainerEnvironment(container({ hostAddress: '127.0.0.1' }), 'docker')
  assert.equal(host.urlOfHost('http://127.0.0.1:7517'), 'http://127.0.0.1:7517')
  assert.equal(host.urlOfHost('http://[::1]:7517'), 'http://[::1]:7517')
})

test('la sonde dit si le conteneur joint le serveur, ici joué sur la machine même', async (t) => {
  const dir = await tempDir(t, 'solera-reach-')
  const bin = join(dir, 'bin')
  await mkdir(bin)
  // Un faux docker qui joue sur place ce que `docker exec -u root <id>` jouerait dedans.
  await writeFile(join(bin, 'docker'), '#!/bin/sh\nshift 4\nexec "$@"\n')
  await chmod(join(bin, 'docker'), 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${bin}:${previous}`
  t.after(() => {
    process.env.PATH = previous
  })
  const server = createServer((socket) => socket.end())
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  const closed = port
  const open = createServer((socket) => socket.end())
  await new Promise<void>((resolve) => open.listen(0, '127.0.0.1', resolve))
  t.after(() => open.close())

  const tools = new DevcontainerTools(join(dir, 'managed'))
  assert.equal(await tools.reaches('c0ffee', `http://127.0.0.1:${(open.address() as AddressInfo).port}`), true)
  assert.equal(await tools.reaches('c0ffee', `http://127.0.0.1:${closed}`), false)
  // Une erreur du CLI docker (conteneur arrêté) ne dit rien du réseau.
  await writeFile(join(bin, 'docker'), '#!/bin/sh\necho "Error response from daemon" >&2\nexit 1\n')
  assert.equal(await tools.reaches('c0ffee', `http://127.0.0.1:${closed}`), null)
})

test("un pare-feu n'est mis en cause que si l'URL vise la passerelle Docker", () => {
  const firewall = unreachableAdvice('http://172.17.0.1:7517', '172.17.0.1')
  assert.match(firewall, /ufw allow in to 172\.17\.0\.1 port 7517 proto tcp/)
  assert.match(firewall, /family="ipv4" destination address="172\.17\.0\.1" port port="7517"/)
  assert.match(unreachableAdvice('http://[fd00::1]:7517', 'fd00::1'), /family="ipv6" destination address="fd00::1"/)
  // server.agentUrl, Docker Desktop, réseau de l'hôte : rien à ouvrir sur la passerelle.
  assert.doesNotMatch(unreachableAdvice('https://solera.example.ts.net', '172.17.0.1'), /ufw/)
  assert.doesNotMatch(unreachableAdvice('http://host.docker.internal:7517', 'host.docker.internal'), /ufw/)
  assert.doesNotMatch(unreachableAdvice('http://127.0.0.1:7517', '127.0.0.1'), /ufw/)
})

test('le verdict de devcontainer up se lit sur sa dernière ligne', () => {
  assert.deepEqual(
    parseUpResult('noise\n{"outcome":"success","containerId":"abc","remoteUser":"node","remoteWorkspaceFolder":"/workspaces/x"}\n'),
    { containerId: 'abc', remoteUser: 'node', remoteWorkspaceFolder: '/workspaces/x' },
  )
  assert.deepEqual(parseUpResult('{"outcome":"error","message":"Command failed","description":"no such image"}'), {
    outcome: 'error',
    message: 'Command failed: no such image',
  })
  assert.equal(parseUpResult(''), null)
})

test("l'environnement de l'utilisateur du conteneur garde ses variables, pas celles du shell de la sonde", () => {
  assert.deepEqual(parseEnv('PATH=/a:/b\nPWD=/x\nSHLVL=1\nNVM_DIR=/n\n  suite d’une valeur sur deux lignes\n'), {
    PATH: '/a:/b',
    NVM_DIR: '/n',
  })
})

test("seuls x86_64 et aarch64 ont des CLI : une autre architecture est refusée, pas prise pour x64", () => {
  assert.equal(targetArch('x86_64'), 'x64')
  assert.equal(targetArch('aarch64'), 'arm64')
  assert.equal(targetArch('armv7l'), null)
  assert.equal(targetArch(''), null)
})

test('chaque CLI a son paquet Linux, et la libc du conteneur choisit la variante', () => {
  assert.deepEqual(linuxPackage('claude', '2.1.301', { arch: 'x64', musl: true }), {
    spec: '@anthropic-ai/claude-code-linux-x64-musl@2.1.301',
    binary: 'claude',
  })
  assert.deepEqual(linuxPackage('codex', '0.163.0', { arch: 'arm64', musl: false }), {
    spec: '@openai/codex@0.163.0-linux-arm64',
    binary: 'vendor/aarch64-unknown-linux-musl/bin/codex',
  })
  assert.equal(linuxPackage('opencode', '1.19.3', { arch: 'x64', musl: false }).spec, 'opencode-linux-x64@1.19.3')
  assert.equal(linuxPackage('grok', '1.0.62', { arch: 'x64', musl: false }).binary, 'bin/grok')
})

test('le CLI Linux se télécharge une fois par version, décompressé, et se désigne par son chemin dans le conteneur', async (t) => {
  const dir = await tempDir(t, 'solera-container-agents-')
  // Un faux npm : `pack` écrit l'archive d'un paquet Grok, binaire compressé en brotli.
  const source = join(dir, 'source', 'package', 'bin')
  await mkdir(source, { recursive: true })
  await writeFile(join(source, 'grok.br'), brotliCompressSync(Buffer.from('#!/bin/sh\necho grok\n')))
  const tarball = join(dir, 'grok.tgz')
  execFileSync('tar', ['-czf', tarball, '-C', join(dir, 'source'), 'package'])
  const bin = join(dir, 'bin')
  await mkdir(bin)
  await writeFile(
    join(bin, 'npm'),
    `#!/bin/sh\necho "$@" >> "${dir}/npm-calls"\nwhile [ "$1" != "--pack-destination" ]; do shift; done\ncp "${tarball}" "$2/grok.tgz"\necho grok.tgz\n`,
  )
  await chmod(join(bin, 'npm'), 0o755)
  const previous = process.env.PATH
  process.env.PATH = `${bin}:${previous}`
  t.after(() => {
    process.env.PATH = previous
  })

  const agents = new ContainerAgents(join(dir, 'cache'))
  const target = { arch: 'x64', musl: false } as const
  const [first, second] = await Promise.all([agents.ensure('grok', '1.0.62', target), agents.ensure('grok', '1.0.62', target)])
  assert.equal(first, `${AGENTS_MOUNT}/grok/1.0.62-linux-x64/package/bin/grok`)
  assert.equal(second, first)
  const onHost = agents.hostPathOf(first)
  assert.ok(onHost)
  assert.equal(await readFile(onHost, 'utf8'), '#!/bin/sh\necho grok\n')
  await agents.ensure('grok', '1.0.62', target)
  assert.equal((await readFile(join(dir, 'npm-calls'), 'utf8')).trim().split('\n').length, 1, 'un seul téléchargement')
})

test("le dev container n'est proposé qu'à un projet qui a un devcontainer.json, et l'est par défaut à confirmer", async (t) => {
  const dir = await tempDir(t, 'solera-devcontainer-choice-')
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  const workspace = join(dir, 'workspace')
  await mkdir(workspace)
  db.insert(projects).values({ id: 'p', name: 'p', workspacePath: workspace, ownerId: 'owner', visibility: 'private', createdAt: 1 }).run()
  const environments = new Environments(db, new Devcontainers({ data: dir, agents: join(dir, 'agents') } as Paths))

  assert.equal(environments.hasDevcontainer('p'), false)
  assert.equal(environments.choices('p').some((choice) => choice.where === 'devcontainer'), false)
  assert.throws(() => environments.assertAvailable('p', DEVCONTAINER_ENVIRONMENT), { code: 'environment_unavailable' })

  await mkdir(join(workspace, '.devcontainer'))
  await writeFile(join(workspace, '.devcontainer', 'devcontainer.json'), '{ "image": "debian" }')
  assert.equal(environments.hasDevcontainer('p'), true)
  assert.deepEqual(environments.choices('p').at(-1), DEVCONTAINER_ENVIRONMENT)
  environments.assertAvailable('p', DEVCONTAINER_ENVIRONMENT)
  // L'hôte ne se prépare pas, il n'a rien à démarrer.
  await environments.prepare(HOST_ENVIRONMENT, 'p', { cwd: workspace })
  // Un fil libre n'a pas de dev container.
  await assert.rejects(environments.prepare(DEVCONTAINER_ENVIRONMENT, null, { cwd: dir }), { code: 'environment_unavailable' })
})
