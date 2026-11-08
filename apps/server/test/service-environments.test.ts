import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Backend } from '../src/environments/confined/backend.js'
import { ConfinedEnvironment } from '../src/environments/confined/confined.js'
import type { Devcontainers } from '../src/environments/devcontainer/containers.js'
import { hostEnvironment } from '../src/environments/host.js'
import {
  containerState,
  directoryBytes,
  EnvironmentInventory,
  listeningPorts,
  parseBytes,
  parseContainerSize,
  parseDockerPs,
  parseDockerStats,
  sandboxUsage,
  vscodeIn,
} from '../src/services/environments.js'

test('les tailles de Docker : décimales pour le disque, binaires pour la mémoire', () => {
  assert.equal(parseBytes('73.7kB'), 73_700)
  assert.equal(parseBytes('1.188MiB'), Math.round(1.188 * 1024 ** 2))
  assert.equal(parseBytes('0B'), 0)
  assert.equal(parseBytes('beaucoup'), null)
  // L'image se compte à part : « virtual » comprend la couche du conteneur.
  assert.deepEqual(parseContainerSize('2MB (virtual 1.77GB)'), { writableBytes: 2e6, imageBytes: 1.77e9 - 2e6 })
  assert.deepEqual(parseContainerSize(''), { writableBytes: null, imageBytes: null })
})

test('docker ps : un dev container, son dossier et son docker-compose', () => {
  const [app, db] = parseDockerPs(
    '638e669ec447\ts140_app-1\trunning\tUp 20 minutes\t73.7kB (virtual 1.77GB)\t/tmp/s140\ts140_devcontainer\n' +
      '626bd87226c6\ts140_db-1\texited\tExited (0) 2 minutes ago\t\t\ts140_devcontainer\n',
  )
  assert.equal(app?.localFolder, '/tmp/s140')
  assert.equal(app?.writableBytes, 73_700)
  assert.equal(db?.composeProject, 's140_devcontainer')
  assert.equal(db?.writableBytes, null)
})

test('docker stats : la part d’un cœur, et la mémoire utilisée sans la limite', () => {
  const stats = parseDockerStats('638e669ec447\t150.5%\t1.5GiB / 11.68GiB\n')
  assert.deepEqual(stats.get('638e669ec447'), { cpu: 1.505, memoryBytes: Math.round(1.5 * 1024 ** 3) })
})

test("l'état d'un dev container : arrêté par docker stop n'est pas un échec", () => {
  const idle = { starting: false, failure: null }
  assert.equal(containerState({ state: 'running', status: 'Up' }, idle).state, 'running')
  assert.equal(containerState({ state: 'exited', status: 'Exited (137) 1 minute ago' }, idle).state, 'stopped')
  assert.deepEqual(containerState({ state: 'exited', status: 'Exited (1) 1 minute ago' }, idle), {
    state: 'failed',
    error: 'Exited (1) 1 minute ago',
  })
  // Solera le démarre : c'est ce qui compte, quel que soit l'état de l'ancien.
  assert.equal(containerState({ state: 'exited', status: 'Exited (0)' }, { starting: true, failure: null }).state, 'starting')
  // Pas de conteneur, mais un démarrage raté : l'échec reste visible avec sa raison.
  assert.deepEqual(containerState(null, { starting: false, failure: 'image introuvable' }), {
    state: 'failed',
    error: 'image introuvable',
  })
})

test('les ports en écoute du conteneur, et VS Code attaché', () => {
  const tables =
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' +
    '   0: 00000000:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 41 1\n' +
    '   1: 0100007F:A1B2 0100007F:1435 01 00000000:00000000 00:00000000 00000000  1000        0 42 1\n' +
    '  sl  local_address                         remote_address                        st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n' +
    '   0: 00000000000000000000000000000000:0BB8 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 43 1\n'
  assert.deepEqual(listeningPorts(tables), [3000, 5173])
  assert.equal(vscodeIn('COMMAND\nsleep infinity\n/home/node/.vscode-server/bin/abc/node server-main.js'), true)
  // Le volume de l'extension Dev Containers : sans point.
  assert.equal(vscodeIn('COMMAND\nsh /vscode/vscode-server/bin/linux-x64/abc/bin/code-server --port 0'), true)
  assert.equal(vscodeIn('COMMAND\nsleep infinity'), false)
})

test("la consommation d'un bac à sable : ses processus et tout ce qu'ils ont lancé", () => {
  const processes = [
    { id: 'a', pid: 10, launcherPid: null, memoryBytes: 100, ports: [], startedAt: 5 },
    { id: 'b', pid: 11, launcherPid: 10, memoryBytes: 50, ports: [5173], startedAt: 6 },
    { id: 'c', pid: 20, launcherPid: null, memoryBytes: 999, ports: [80], startedAt: 1 },
  ]
  const cpu = new Map([['a', 0.5], ['b', 0.25]])
  assert.deepEqual(sandboxUsage([10], processes, (id) => cpu.get(id) ?? null), {
    cpu: 0.75,
    memoryBytes: 150,
    ports: [5173],
    startedAt: 5,
  })
  assert.deepEqual(sandboxUsage([99], processes, () => null), { cpu: null, memoryBytes: null, ports: [], startedAt: null })
})

test("la taille d'un dossier privé", async () => {
  const root = mkdtempSync(join(tmpdir(), 'solera-env-size-'))
  try {
    mkdirSync(join(root, 'home', 'a'), { recursive: true })
    writeFileSync(join(root, 'home', 'a', 'f'), 'x'.repeat(10))
    writeFileSync(join(root, 'g'), 'x'.repeat(5))
    assert.equal(await directoryBytes(root), 15)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const fakeBackend: Backend = {
  name: 'bwrap',
  coveredRoots: [],
  deniedRoots: [],
  home: (dirs) => dirs.home,
  tmp: (dirs) => dirs.tmp,
  wrap: () => ({ command: 'true', args: [], detached: false }),
}

test("l'inventaire : un bac à sable par session ou terminal confinés, un dev container en échec", async () => {
  const sandbox = new ConfinedEnvironment(fakeBackend, { readable: [], writable: [], homeLinks: [] } as never)
  const devcontainers = {
    status: (projectId: string) => ({ starting: false, containerId: null, failure: projectId === 'p1' ? 'docker absent' : null }),
    forwardedPorts: () => [],
  } as unknown as Devcontainers
  const inventory = new EnvironmentInventory({
    sessions: {
      liveEnvironments: () => [
        { conversationId: 'c1', environment: sandbox },
        { conversationId: 'c2', environment: hostEnvironment },
      ],
    },
    terminals: { live: () => [{ id: 't1', projectId: 'p1', title: 'shell', pid: 42, environment: sandbox }] },
    devcontainers,
    projects: () => [
      { id: 'p1', workspacePath: '/nulle/part/p1' },
      { id: 'p2', workspacePath: '/nulle/part/p2' },
    ],
    projectOf: (conversationId) => (conversationId === 'c1' ? 'p1' : null),
  })
  const entries = await inventory.scan()
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  // Le projet sans conteneur ni échec n'a pas de ligne ; l'hôte non confiné non plus.
  assert.deepEqual([...byId.keys()].sort(), ['devcontainer:p1', 'sandbox:session:c1', 'sandbox:terminal:t1'])
  assert.deepEqual(
    { state: byId.get('devcontainer:p1')?.state, error: byId.get('devcontainer:p1')?.error },
    { state: 'failed', error: 'docker absent' },
  )
  const session = byId.get('sandbox:session:c1')!
  assert.equal(session.engine, 'bwrap')
  assert.equal(session.projectId, 'p1')
  assert.deepEqual(session.owner, { conversationId: 'c1' })
  assert.deepEqual(byId.get('sandbox:terminal:t1')?.terminals, [{ id: 't1', title: 'shell', pid: 42 }])
})
