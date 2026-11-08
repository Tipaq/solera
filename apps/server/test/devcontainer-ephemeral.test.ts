import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { openDatabase, projects, runMigrations, users } from '@solera/db'
import { DEVCONTAINER_CONFINED_ENVIRONMENT } from '@solera/protocol'
import type { Paths } from '../src/config.js'
import { terminalScope } from '../src/environments/confined/scope.js'
import { composeFilesOf, Devcontainers } from '../src/environments/devcontainer/containers.js'
import {
  copiedCompose,
  copiedNetwork,
  ephemeralConfig,
  EphemeralContainer,
  ephemeralMounts,
  ephemeralPlan,
  unconfinedParts,
  type EphemeralLauncher,
  type StartedEphemeral,
} from '../src/environments/devcontainer/ephemeral.js'
import { usesCompose } from '../src/environments/devcontainer/managed.js'
import { Environments } from '../src/environments/environments.js'

async function tempDir(t: TestContext): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'solera-ephemeral-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, stdio: 'pipe' })

/** Un dépôt et un worktree lié, comme ceux que Solera crée pour une session. */
async function repoWithWorktree(t: TestContext): Promise<{ repo: string; worktree: string }> {
  const dir = await tempDir(t)
  const repo = join(dir, 'repo')
  await mkdir(repo)
  git(repo, 'init', '-q')
  await writeFile(join(repo, 'a.txt'), 'a')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
  const worktree = join(dir, 'wt')
  git(repo, 'worktree', 'add', '-q', worktree, '-b', 'session')
  return { repo, worktree }
}

test('le devcontainer.json du conteneur confiné : l’image du projet, sans ce qui construit ni ce qui ouvre l’hôte', () => {
  const config = ephemeralConfig({
    configuration: {
      name: 'app',
      dockerComposeFile: 'docker-compose.yml',
      service: 'app',
      features: { 'ghcr.io/devcontainers/features/node:1': {} },
      mounts: ['source=/home/me/.ssh,target=/root/.ssh,type=bind'],
      runArgs: ['--privileged', '-v', '/var/run/docker.sock:/var/run/docker.sock'],
      initializeCommand: 'echo on the host',
      privileged: true,
      capAdd: ['SYS_ADMIN'],
      appPort: [3000],
      remoteUser: 'node',
      postCreateCommand: 'npm ci',
      forwardPorts: [3000],
      containerEnv: { OWN: '1' },
    },
    image: 'vsc-app-uid',
    cwd: '/work/wt',
    workspaceMount: 'type=bind,source=/work/wt,target=/work/wt',
    mounts: ['type=bind,source=/m,target=/m'],
    runArgs: ['--network=app_default'],
    containerEnv: { DATABASE_URL: 'postgres://db', OWN: '0' },
  })
  for (const key of ['dockerComposeFile', 'service', 'features', 'initializeCommand', 'privileged', 'capAdd', 'appPort']) {
    assert.equal(key in config, false, key)
  }
  assert.equal(config.image, 'vsc-app-uid')
  assert.equal(config.workspaceFolder, '/work/wt')
  assert.deepEqual(config.mounts, ['type=bind,source=/m,target=/m'])
  assert.deepEqual(config.runArgs, ['--network=app_default'])
  // Ce que le projet dit de l'utilisateur et du cycle de vie reste.
  assert.equal(config.remoteUser, 'node')
  assert.equal(config.postCreateCommand, 'npm ci')
  assert.deepEqual(config.forwardPorts, [3000])
  // L'environnement de docker-compose suit, celui du devcontainer.json l'emporte.
  assert.deepEqual(config.containerEnv, { DATABASE_URL: 'postgres://db', OWN: '1' })
  assert.equal(config.updateRemoteUserUID, false)
  assert.equal(config.overrideCommand, true)
})

test('les montages d’un worktree : lui seul, git en liste blanche, les CLI en lecture seule', async (t) => {
  const { repo, worktree } = await repoWithWorktree(t)
  const plan = ephemeralPlan(terminalScope(worktree))
  const { workspaceMount, mounts, sources } = ephemeralMounts(plan, worktree, { source: '/agents', target: '/opt/solera/agents' })
  assert.equal(workspaceMount, `type=bind,source=${worktree},target=${worktree}`)
  const common = join(repo, '.git')
  assert.ok(mounts.includes(`type=bind,source=${common},target=${common},readonly`), 'le dossier commun en lecture')
  for (const writable of ['objects', 'refs', 'logs', 'worktrees/wt']) {
    const path = join(common, writable)
    assert.ok(mounts.includes(`type=bind,source=${path},target=${path}`), writable)
  }
  const pointer = join(worktree, '.git')
  assert.ok(mounts.includes(`type=bind,source=${pointer},target=${pointer},readonly`), 'le fichier .git du worktree')
  assert.ok(mounts.includes('type=bind,source=/agents,target=/opt/solera/agents,readonly'))
  assert.equal(mounts.some((mount) => mount.includes(`source=${repo},`)), false, 'pas le dépôt principal')
  assert.ok(sources.includes(worktree) && sources.includes(common))
})

test('un conteneur démarré qui ouvre l’hôte est repéré', () => {
  const allowed = ['/work/wt', '/agents']
  assert.deepEqual(
    unconfinedParts({ privileged: false, mounts: [{ Type: 'bind', Source: '/work/wt', Destination: '/work/wt' }, { Type: 'volume', Source: '/var/lib/docker/volumes/x', Destination: '/cache' }] }, allowed),
    [],
  )
  assert.deepEqual(
    unconfinedParts({ privileged: true, mounts: [{ Type: 'bind', Source: '/var/run/docker.sock', Destination: '/var/run/docker-host.sock' }] }, allowed),
    ['privileged mode', '/var/run/docker.sock mounted at /var/run/docker-host.sock'],
  )
})

test('docker-compose : les fichiers de la configuration, le réseau de la copie', () => {
  assert.deepEqual(composeFilesOf({ dockerComposeFile: ['../compose.yml', '/abs/extra.yml'] }, '/p/.devcontainer/devcontainer.json'), [
    '/p/compose.yml',
    '/abs/extra.yml',
  ])
  assert.deepEqual(composeFilesOf({ image: 'x' }, '/p/.devcontainer/devcontainer.json'), [])
  assert.equal(copiedNetwork('app_devcontainer_default', 'app_devcontainer', 'solera-1'), 'solera-1_default')
  assert.equal(copiedNetwork('shared-external', 'app_devcontainer', 'solera-1'), 'shared-external')
  assert.equal(usesCompose('{ // jsonc\n "dockerComposeFile": "c.yml" }'), true)
  assert.equal(usesCompose('{ "image": "debian" }'), false)
  assert.equal(usesCompose(null), false)
})

function fakeLauncher(): EphemeralLauncher & { removed: StartedEphemeral[]; release?: () => void } {
  const launcher: EphemeralLauncher & { removed: StartedEphemeral[]; release?: () => void } = {
    removed: [],
    docker: () => 'docker',
    start: () =>
      new Promise((resolve) => {
        launcher.release = () =>
          resolve({
            label: 'l',
            composeCopy: null,
            ports: null,
            container: {
              id: 'c1',
              user: 'node',
              loginShell: '/bin/sh',
              workspace: '/w',
              remoteWorkspaceFolder: '/w',
              solerasMounts: true,
              env: {},
              agents: new Map([['claude', '/opt/solera/agents/claude']]),
              hostAddress: 'host.docker.internal',
            },
          })
      }),
    remove: async (started) => {
      launcher.removed.push(started)
    },
  }
  return launcher
}

test('le conteneur d’une session : rien n’y tourne avant son ouverture, et sa fermeture le supprime', async (t) => {
  const dir = await tempDir(t)
  const launcher = fakeLauncher()
  const container = new EphemeralContainer(launcher, { projectId: 'p', plan: ephemeralPlan(terminalScope(dir)), cwd: dir, services: 'shared' })
  // Hors dépôt, un `.git` vide empêche `git init` ; la fermeture le retire.
  assert.ok(existsSync(join(dir, '.git')))
  assert.throws(() => container.spawn({ command: 'claude', args: [] }), /not been started/)
  assert.equal(container.resolveBinary('claude'), null)
  const opened = container.open()
  launcher.release!()
  await opened
  assert.equal(container.resolveBinary('claude'), '/opt/solera/agents/claude')
  assert.equal(container.urlOfHost('http://127.0.0.1:7517/mcp'), 'http://host.docker.internal:7517/mcp')
  assert.equal(container.containerId, 'c1')
  await container.close()
  assert.equal(launcher.removed.length, 1)
  assert.equal(existsSync(join(dir, '.git')), false)
  assert.throws(() => container.spawn({ command: 'claude', args: [] }), /closed/)
})

test('fermé pendant son démarrage, le conteneur ne survit pas à son propriétaire', async (t) => {
  const dir = await tempDir(t)
  git(dir, 'init', '-q')
  const launcher = fakeLauncher()
  const container = new EphemeralContainer(launcher, { projectId: 'p', plan: ephemeralPlan(terminalScope(dir)), cwd: dir, services: 'copy' })
  const opened = container.open()
  await container.close()
  launcher.release!()
  await assert.rejects(opened, /closed while it started/)
  assert.equal(launcher.removed.length, 1)
})

test('une session confinée dans le dev container reçoit un conteneur à elle, sur l’image du projet', async (t) => {
  const dir = await tempDir(t)
  const { db, sqlite } = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, fileURLToPath(new URL('../../../packages/db/migrations', import.meta.url)))
  t.after(() => sqlite.close())
  db.insert(users).values({ id: 'owner', username: 'owner', displayName: 'owner', passwordHash: '', createdAt: 1 }).run()
  const workspace = join(dir, 'w')
  await mkdir(join(workspace, '.devcontainer'), { recursive: true })
  await writeFile(join(workspace, '.devcontainer', 'devcontainer.json'), '{ "image": "debian" }')
  db.insert(projects)
    .values({ id: 'p', name: 'p', workspacePath: workspace, ownerId: 'owner', visibility: 'private', createdAt: 1, confinedServices: 'copy' })
    .run()
  const environments = new Environments(db, new Devcontainers({ data: dir, agents: join(dir, 'agents') } as Paths))
  git(workspace, 'init', '-q')
  const provider = environments.provider(DEVCONTAINER_CONFINED_ENVIRONMENT, terminalScope(workspace), 'p')
  assert.ok(provider instanceof EphemeralContainer)
  assert.equal(provider.projectId, 'p')
  await provider.close()
})

test('la copie des services : ni port publié, ni nom fixe, ni dossier de l’hôte partagé avec le projet', () => {
  const { config, services } = copiedCompose(
    {
      name: 'solera-x',
      services: {
        app: { image: 'node', volumes: [{ type: 'bind', source: '/p', target: '/workspaces/p' }] },
        db: {
          image: 'postgres',
          container_name: 'fixed-db',
          ports: [{ target: 5432, published: '5432' }],
          volumes: [
            { type: 'bind', source: '/p/data', target: '/var/lib/postgresql/data' },
            { type: 'volume', source: 'cache', target: '/cache' },
          ],
          depends_on: { app: { condition: 'service_started' }, redis: { condition: 'service_started' } },
          privileged: true,
        },
        redis: { image: 'redis', network_mode: 'host' },
        docs: { image: 'nginx' },
      },
      volumes: { cache: { name: 'solera-x_cache' } },
    },
    { exclude: 'app', only: ['app', 'db', 'redis'] },
  )
  assert.deepEqual(services, ['db', 'redis'])
  const db = (config.services as Record<string, Record<string, unknown>>).db!
  assert.equal('ports' in db || 'container_name' in db || 'privileged' in db, false)
  assert.deepEqual(db.volumes, [{ type: 'volume', target: '/var/lib/postgresql/data' }, { type: 'volume', source: 'cache', target: '/cache' }])
  assert.deepEqual(db.depends_on, { redis: { condition: 'service_started' } })
  assert.equal('network_mode' in (config.services as Record<string, Record<string, unknown>>).redis!, false)
  assert.deepEqual(config.volumes, { cache: { name: 'solera-x_cache' } })
  assert.equal('name' in config, false)
})
