import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { type TestContext } from 'node:test'
import { DevcontainerEnvironment } from '../src/environments/devcontainer/environment.js'
import { attributesFor, parseListening, PortForwarder, portsConfigOf } from '../src/environments/devcontainer/ports.js'

/** Une ligne de `/proc/net/tcp` : l'adresse locale en hexadécimal, et l'état. */
function procLine(local: string, state: string): string {
  return `   0: ${local} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000  1000        0 1 1 0 100 0 0 10 0`
}

const HEADER = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode'

test('les ports en écoute se lisent dans /proc/net/tcp et tcp6, chacun avec l’adresse qui le joint', () => {
  const proc = [
    HEADER,
    procLine('0100007F:1435', '0A'), // 127.0.0.1:5173
    procLine('00000000:0BB8', '0A'), // 0.0.0.0:3000
    procLine('0B00007F:A1B2', '0A'), // 127.0.0.11 : le DNS de Docker
    procLine('0100007F:1F90', '01'), // établie, pas en écoute
    HEADER,
    procLine('00000000000000000000000001000000:22B8', '0A'), // [::1]:8888
    procLine('00000000000000000000000000000000:0BB8', '0A'), // [::]:3000, déjà vu en IPv4
    procLine('0000000000000000FFFF00000100007F:1F91', '0A'), // ::ffff:127.0.0.1:8081
  ].join('\n')
  assert.deepEqual(parseListening(proc), [
    { port: 3000, address: '127.0.0.1' },
    { port: 5173, address: '127.0.0.1' },
    { port: 8081, address: '127.0.0.1' },
    { port: 8888, address: '::1' },
  ])
})

test('forwardPorts et portsAttributes se lisent comme VS Code les écrit', () => {
  const config = portsConfigOf({
    forwardPorts: [3000, '5173', 'db:5432', 'localhost:8080', 3000, 'nonsense', 70000],
    portsAttributes: {
      '3000': { label: 'Application', protocol: 'https' },
      '9000-9100': { onAutoForward: 'ignore' },
      '5432': { requireLocalPort: true },
    },
    otherPortsAttributes: { label: 'autre' },
  })
  assert.deepEqual(config.forward, [
    { host: 'localhost', port: 3000 },
    { host: 'localhost', port: 5173 },
    { host: 'db', port: 5432 },
    { host: 'localhost', port: 8080 },
  ])
  assert.equal(attributesFor(config, 3000).label, 'Application')
  assert.equal(attributesFor(config, 3000).protocol, 'https')
  assert.equal(attributesFor(config, 9050).onAutoForward, 'ignore')
  assert.equal(attributesFor(config, 5432).requireLocalPort, true)
  assert.equal(attributesFor(config, 4000).label, 'autre')
  assert.deepEqual(portsConfigOf(null), { forward: [], attributes: [], other: {} })
})

/**
 * Un `docker` qui joue le conteneur sur l'hôte : `cat /proc/net/tcp*` rend le fichier
 * préparé par le test, et toute autre commande `exec` tourne ici même. Le relais joint
 * donc un serveur du test, comme il joindrait celui du conteneur.
 */
async function fakeContainer(
  t: TestContext,
  network = 'bridge',
): Promise<{ docker: string; listen: (lines: string[]) => Promise<void>; inspect: (answer: 'true' | 'false' | 'fail') => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'solera-fake-ports-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const proc = join(dir, 'proc')
  const running = join(dir, 'running')
  await writeFile(running, 'true')
  const docker = join(dir, 'docker')
  await writeFile(proc, HEADER)
  await writeFile(
    docker,
    `#!/bin/sh
case "$1" in
  inspect) case "$3" in *NetworkMode*) echo ${network}; exit 0 ;; esac
    r=$(cat "${running}"); [ "$r" = fail ] && exit 1; echo "$r"; exit 0 ;;
  exec) shift; [ "$1" = -i ] && shift; shift
    if [ "$1" = cat ]; then [ "$(cat "${running}")" = true ] || exit 1; cat "${proc}"; exit 0; fi
    exec "$@" ;;
esac
exit 1
`,
  )
  await chmod(docker, 0o755)
  return {
    docker,
    listen: (lines) => writeFile(proc, [HEADER, ...lines].join('\n')),
    inspect: (answer) => writeFile(running, answer),
  }
}

async function httpServer(t: TestContext, body: string): Promise<number> {
  const server: Server = createServer((_request, response) => response.end(body))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return (server.address() as { port: number }).port
}

function hex(port: number): string {
  return port.toString(16).toUpperCase().padStart(4, '0')
}

test("un port qui écoute dans le conteneur est servi sur l'hôte, sous un autre numéro s'il y est pris", async (t) => {
  const fake = await fakeContainer(t)
  // Le serveur du « conteneur » écoute sur l'hôte : son numéro y est donc pris.
  const port = await httpServer(t, 'depuis le conteneur')
  await fake.listen([procLine(`0100007F:${hex(port)}`, '0A')])
  const forwarder = new PortForwarder('c0ffee', fake.docker, portsConfigOf({}), { pollMs: 60_000 })
  t.after(() => forwarder.close())
  await forwarder.start()

  const [forwarded] = forwarder.list()
  assert.ok(forwarded)
  assert.equal(forwarded.containerPort, port)
  assert.equal(forwarded.source, 'detected')
  assert.equal(forwarded.remapped, true)
  assert.notEqual(forwarded.hostPort, port)
  const response = await fetch(`http://127.0.0.1:${forwarded.hostPort}/`)
  assert.equal(await response.text(), 'depuis le conteneur')

  // Le serveur s'arrête dans le conteneur : son port est relâché sur l'hôte.
  await fake.listen([])
  await forwarder.poll()
  assert.deepEqual(forwarder.list(), [])
  // Une connexion neuve : celle de `fetch` resterait ouverte dans son pool.
  await assert.rejects(
    new Promise((resolve, reject) => connect(forwarded.hostPort!, '127.0.0.1').once('connect', resolve).once('error', reject)),
  )
})

test('un port déclaré est servi avant d’écouter ; requireLocalPort le laisse en erreur plutôt que de changer son numéro', async (t) => {
  const fake = await fakeContainer(t)
  const taken = await httpServer(t, 'hôte')
  const forwarder = new PortForwarder(
    'c0ffee',
    fake.docker,
    portsConfigOf({
      forwardPorts: [taken, 'db:5432'],
      portsAttributes: { [String(taken)]: { requireLocalPort: true, label: 'Web' } },
    }),
    { pollMs: 60_000 },
  )
  t.after(() => forwarder.close())
  await forwarder.start()

  const web = forwarder.list().find((entry) => entry.containerPort === taken)
  const db = forwarder.list().find((entry) => entry.containerPort === 5432)
  assert.equal(web?.label, 'Web')
  assert.equal(web?.hostPort, null)
  assert.equal(web?.error?.code, 'port_taken')
  assert.equal(db?.source, 'config')
  assert.equal(db?.host, 'db')
  assert.ok(db?.hostPort)
})

test('un port ignoré par portsAttributes ne se redirige pas', async (t) => {
  const fake = await fakeContainer(t)
  await fake.listen([procLine('00000000:2328', '0A')]) // 9000
  const forwarder = new PortForwarder(
    'c0ffee',
    fake.docker,
    portsConfigOf({ portsAttributes: { '9000': { onAutoForward: 'ignore' } } }),
    { pollMs: 60_000 },
  )
  t.after(() => forwarder.close())
  await forwarder.start()
  assert.deepEqual(forwarder.list(), [])
})

test("un conteneur sur le réseau de l'hôte n'est ni relayé ni sondé : Solera ne se redirige pas lui-même", async (t) => {
  const fake = await fakeContainer(t, 'host')
  const port = await httpServer(t, 'hôte')
  await fake.listen([procLine(`0100007F:${hex(port)}`, '0A')])
  const forwarder = new PortForwarder('c0ffee', fake.docker, portsConfigOf({ forwardPorts: [3000] }), { pollMs: 10 })
  t.after(() => forwarder.close())
  await forwarder.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(
    forwarder.list().map((entry) => [entry.containerPort, entry.hostPort, entry.remapped]),
    [[3000, 3000, false]],
  )
})

test("un docker inspect qui échoue en passant ne relâche pas les ports ; un conteneur arrêté, si", async (t) => {
  const fake = await fakeContainer(t)
  let gone = false
  const forwarder = new PortForwarder('c0ffee', fake.docker, portsConfigOf({ forwardPorts: [3000] }), {
    pollMs: 60_000,
    onGone: () => {
      gone = true
    },
  })
  t.after(() => forwarder.close())
  await forwarder.start()
  await fake.inspect('fail')
  await forwarder.poll()
  assert.equal(forwarder.list().length, 1)
  assert.equal(gone, false)
  await fake.inspect('false')
  await forwarder.poll()
  assert.deepEqual(forwarder.list(), [])
  assert.equal(gone, true)
})

test("un serveur de la boucle locale du conteneur se joint de l'hôte par un relais, jusqu'à sa fermeture", async (t) => {
  const fake = await fakeContainer(t)
  const port = await httpServer(t, 'opencode serve')
  const environment = new DevcontainerEnvironment(
    { id: 'c0ffee', user: 'node', loginShell: '/bin/sh', workspace: '/p', remoteWorkspaceFolder: '/p', solerasMounts: true, env: {}, agents: new Map(), hostAddress: 'host.docker.internal' },
    fake.docker,
  )
  const reach = await environment.urlFromHost(`http://127.0.0.1:${port}`)
  const relayed = new URL(reach.url)
  assert.equal(relayed.hostname, '127.0.0.1')
  assert.notEqual(Number(relayed.port), port)
  assert.equal(await (await fetch(`${reach.url}/session`)).text(), 'opencode serve')

  reach.close()
  await assert.rejects(
    new Promise((resolve, reject) => connect(Number(relayed.port), '127.0.0.1').once('connect', resolve).once('error', reject)),
  )

  // Sur le réseau de l'hôte, rien à relayer.
  const shared = new DevcontainerEnvironment(
    { id: 'c0ffee', user: 'node', loginShell: '/bin/sh', workspace: '/p', remoteWorkspaceFolder: '/p', solerasMounts: true, env: {}, agents: new Map(), hostAddress: '127.0.0.1' },
    fake.docker,
  )
  assert.equal((await shared.urlFromHost(`http://127.0.0.1:${port}`)).url, `http://127.0.0.1:${port}`)
})
