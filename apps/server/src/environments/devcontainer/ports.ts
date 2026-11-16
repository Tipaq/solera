import { execFile, spawn } from 'node:child_process'
import { createServer, type Server, type Socket } from 'node:net'
import { promisify } from 'node:util'
import type { ForwardedPortDto } from '@solera/protocol'

const run = promisify(execFile)

/** Le rythme de la détection : un `npm run dev` doit apparaître sans qu'on attende. */
const POLL_MS = 2000
const DOCKER_TIMEOUT_MS = 10_000
/** Combien de numéros suivants essayer avant de laisser le système en choisir un. */
const NEXT_PORTS = 10

/**
 * Ce que le `devcontainer.json` dit des ports, réduit à ce que Solera applique :
 * `forwardPorts`, `portsAttributes` et `otherPortsAttributes`.
 */
export interface PortsConfig {
  forward: { host: string; port: number }[]
  attributes: { match: (port: number) => boolean; attributes: PortAttributes }[]
  other: PortAttributes
}

/** Les attributs d'un port que Solera respecte ; les autres sont ceux de VS Code seul. */
export interface PortAttributes {
  label?: string
  /** `ignore` : un port détecté n'est pas redirigé. */
  onAutoForward?: string
  /** Vrai : le port garde son numéro sur l'hôte ou n'est pas redirigé. */
  requireLocalPort?: boolean
  protocol?: 'http' | 'https'
}

/** Lit `forwardPorts`, `portsAttributes` et `otherPortsAttributes` d'une configuration. */
export function portsConfigOf(configuration: unknown): PortsConfig {
  const config = (configuration ?? {}) as Record<string, unknown>
  const forward: PortsConfig['forward'] = []
  for (const entry of Array.isArray(config.forwardPorts) ? config.forwardPorts : []) {
    const parsed = forwardEntry(entry)
    if (parsed && !forward.some((known) => known.port === parsed.port)) forward.push(parsed)
  }
  const attributes: PortsConfig['attributes'] = []
  const declared = config.portsAttributes
  if (declared && typeof declared === 'object') {
    for (const [key, value] of Object.entries(declared as Record<string, unknown>)) {
      const match = portMatcher(key)
      if (match) attributes.push({ match, attributes: attributesOf(value) })
    }
  }
  return { forward, attributes, other: attributesOf(config.otherPortsAttributes) }
}

/** `3000`, `"3000"`, `"localhost:3000"`, ou `"db:5432"` pour un service docker-compose. */
function forwardEntry(entry: unknown): { host: string; port: number } | null {
  if (typeof entry === 'number') return validPort(entry) ? { host: 'localhost', port: entry } : null
  if (typeof entry !== 'string') return null
  const match = /^(?:([^:]+):)?(\d+)$/.exec(entry.trim())
  const port = Number(match?.[2])
  return match && validPort(port) ? { host: match[1] ?? 'localhost', port } : null
}

/** Une clé de `portsAttributes` : un port, ou une plage `40000-55000`. Les motifs de commande ne s'appliquent pas. */
function portMatcher(key: string): ((port: number) => boolean) | null {
  const single = /^\s*(\d+)\s*$/.exec(key)
  if (single) return (port) => port === Number(single[1])
  const range = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(key)
  if (range) return (port) => port >= Number(range[1]) && port <= Number(range[2])
  return null
}

function attributesOf(value: unknown): PortAttributes {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  return {
    label: typeof raw.label === 'string' ? raw.label : undefined,
    onAutoForward: typeof raw.onAutoForward === 'string' ? raw.onAutoForward : undefined,
    requireLocalPort: raw.requireLocalPort === true,
    protocol: raw.protocol === 'https' ? 'https' : raw.protocol === 'http' ? 'http' : undefined,
  }
}

/** Les attributs d'un port : la première clé qui le désigne, ou `otherPortsAttributes`. */
export function attributesFor(config: PortsConfig, port: number): PortAttributes {
  return config.attributes.find((entry) => entry.match(port))?.attributes ?? config.other
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port < 65536
}

/** Un port qui écoute dans le conteneur, et l'adresse par laquelle le joindre de l'intérieur. */
export interface Listening {
  port: number
  address: string
}

/**
 * Les ports en écoute d'après `/proc/net/tcp` et `/proc/net/tcp6`, lus ensemble.
 *
 * Un serveur lié à une adresse précise se joint par elle : un Vite qui n'écoute que sur
 * `::1` ne répond pas sur `127.0.0.1`. Le DNS embarqué de Docker (`127.0.0.11`) n'est
 * pas un serveur du projet.
 */
export function parseListening(procNet: string): Listening[] {
  const found = new Map<number, string>()
  for (const line of procNet.split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 4 || fields[3] !== '0A') continue
    const [hex, portHex] = (fields[1] ?? '').split(':')
    const port = Number.parseInt(portHex ?? '', 16)
    if (!hex || !validPort(port)) continue
    const address = hex.length === 8 ? ipv4(hex) : hex.length === 32 ? ipv6(hex) : null
    if (!address || address === '127.0.0.11') continue
    const reachable = address === '0.0.0.0' ? '127.0.0.1' : address === '::' ? '::1' : address
    // Une écoute sur toutes les adresses vaut mieux qu'une écoute sur une seule.
    const known = found.get(port)
    if (!known || address === '0.0.0.0') found.set(port, reachable)
  }
  return [...found].map(([port, address]) => ({ port, address })).sort((a, b) => a.port - b.port)
}

function ipv4(hex: string): string {
  const bytes = [0, 2, 4, 6].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
  return bytes.reverse().join('.')
}

/** Quatre mots de 32 bits, chacun dans l'ordre de l'hôte (petit-boutiste). */
function ipv6(hex: string): string | null {
  const bytes: number[] = []
  for (let word = 0; word < 4; word += 1) {
    const chunk = hex.slice(word * 8, word * 8 + 8)
    for (let at = 6; at >= 0; at -= 2) bytes.push(Number.parseInt(chunk.slice(at, at + 2), 16))
  }
  // Une adresse IPv4 vue en IPv6 (`::ffff:127.0.0.1`) se joint en IPv4.
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return bytes.slice(12).join('.')
  }
  const groups: string[] = []
  for (let at = 0; at < 16; at += 2) groups.push(((bytes[at]! << 8) | bytes[at + 1]!).toString(16))
  const full = groups.join(':')
  if (full === '0:0:0:0:0:0:0:0') return '::'
  if (full === '0:0:0:0:0:0:0:1') return '::1'
  return full
}

/**
 * Ce qui relaie une connexion dans le conteneur, du premier outil présent : l'image n'a
 * ni Node ni rien de garanti, et Solera n'y installe rien (ADR 0001). Chaque commande lit
 * l'adresse et le port en arguments et branche ses flux sur la connexion.
 */
const RELAYS: Record<string, (address: string, port: number) => string[]> = {
  socat: (address, port) => ['socat', '-', `TCP:${address.includes(':') ? `[${address}]` : address}:${port}`],
  python3: (address, port) => ['python3', '-c', PYTHON_RELAY, address, String(port)],
  node: (address, port) => ['node', '-e', NODE_RELAY, address, String(port)],
  bash: (address, port) => ['bash', '-c', 'exec 3<>"/dev/tcp/$0/$1" || exit 1; cat >&3 & cat <&3; kill $! 2>/dev/null', address, String(port)],
  nc: (address, port) => ['nc', address, String(port)],
}

const PYTHON_RELAY = `import socket,sys,threading
s=socket.create_connection((sys.argv[1],int(sys.argv[2])))
def up():
  while True:
    d=sys.stdin.buffer.read1(65536)
    if not d: break
    s.sendall(d)
  try: s.shutdown(socket.SHUT_WR)
  except OSError: pass
threading.Thread(target=up,daemon=True).start()
while True:
  d=s.recv(65536)
  if not d: break
  sys.stdout.buffer.write(d); sys.stdout.buffer.flush()`

const NODE_RELAY = `const s=require('net').connect(+process.argv[2],process.argv[1]);process.stdin.pipe(s);s.pipe(process.stdout);s.on('error',()=>process.exit(1))`

/** Le code de sortie de la sonde quand le conteneur n'a aucun outil de relais. */
const NONE_FOUND = 3

const NO_RELAY = { code: 'no_relay', detail: Object.keys(RELAYS).join(', ') } as const

/** Le premier outil de relais présent dans le conteneur, ou null. */
const PROBE = `for t in ${Object.keys(RELAYS).join(' ')}; do command -v "$t" >/dev/null 2>&1 && { echo "$t"; exit 0; }; done; exit ${NONE_FOUND}`

interface Forward {
  containerPort: number
  /** Où joindre le port depuis le conteneur : la boucle locale, ou un service compose. */
  address: string
  source: 'config' | 'detected'
  attributes: PortAttributes
  hostPort: number | null
  error: ForwardedPortDto['error']
  servers: Server[]
}

/**
 * Les ports d'un dev container, servis sur la boucle locale de l'hôte (ADR 0001, #141),
 * à la manière de VS Code : ceux du `devcontainer.json` (`forwardPorts`), et ceux qu'un
 * agent ou un terminal ouvre ensuite, relevés toutes les deux secondes.
 *
 * Chaque connexion passe par un `docker exec` qui la relaie **depuis l'intérieur** du
 * conteneur. L'adresse du conteneur ne suffirait pas : Docker Desktop (WSL, macOS,
 * Windows) ne la rend pas joignable de l'hôte, et un serveur de dev n'écoute souvent que
 * sur sa boucle locale. Le coût est un processus par connexion, que le keep-alive du
 * navigateur amortit.
 *
 * Seulement sur `127.0.0.1` et `::1` de l'hôte : l'accès distant (Tailscale) n'en voit
 * pas plus qu'avant. Un port pris sur l'hôte reçoit le numéro libre suivant, sauf
 * `requireLocalPort`, qui le laisse non redirigé, avec l'erreur.
 */
export class PortForwarder {
  private readonly forwards = new Map<number, Forward>()
  /** L'outil de relais ; null quand le conteneur n'en a aucun, absent tant qu'on ne sait pas. */
  private relay: string | null | undefined
  /** Le conteneur partage le réseau de l'hôte (`--network=host`) : ses ports y sont déjà. */
  private hostNetwork = false
  private timer: NodeJS.Timeout | null = null
  private polling: Promise<void> | null = null
  private closed = false

  constructor(
    readonly containerId: string,
    private readonly docker: string,
    private readonly config: PortsConfig,
    private readonly options: { pollMs?: number; onGone?: () => void } = {},
  ) {}

  /** Ouvre les ports déclarés, puis relève les autres jusqu'à `close`. */
  async start(): Promise<void> {
    this.hostNetwork = await this.inspect('{{.HostConfig.NetworkMode}}') === 'host'
    if (this.hostNetwork) {
      // Rien à relayer, et rien à détecter : `/proc/net/tcp` y montrerait l'hôte entier,
      // Solera compris. Les ports déclarés y sont servis sous leur propre numéro.
      for (const entry of this.config.forward) {
        if (entry.host !== 'localhost') continue
        this.forwards.set(entry.port, {
          containerPort: entry.port,
          address: '127.0.0.1',
          source: 'config',
          attributes: attributesFor(this.config, entry.port),
          hostPort: entry.port,
          error: null,
          servers: [],
        })
      }
      return
    }
    await this.relayCommand()
    for (const entry of this.config.forward) {
      await this.open(entry.port, entry.host, 'config')
    }
    await this.poll()
    this.schedule()
  }

  /** Les ports, déclarés d'abord, puis détectés, chacun par numéro. */
  list(): ForwardedPortDto[] {
    return [...this.forwards.values()]
      .sort((a, b) => (a.source === b.source ? a.containerPort - b.containerPort : a.source === 'config' ? -1 : 1))
      .map((entry) => ({
        containerPort: entry.containerPort,
        host: entry.address === '127.0.0.1' || entry.address === '::1' ? null : entry.address,
        hostPort: entry.hostPort,
        label: entry.attributes.label ?? null,
        protocol: entry.attributes.protocol ?? 'http',
        source: entry.source,
        remapped: entry.hostPort !== null && entry.hostPort !== entry.containerPort,
        error: entry.error ?? (this.relay === null && entry.hostPort !== null ? NO_RELAY : null),
      }))
  }

  /** Relâche les ports de l'hôte ; les connexions ouvertes finissent d'elles-mêmes. */
  async close(): Promise<void> {
    this.release()
    await this.polling
    this.release()
  }

  private release(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    for (const entry of this.forwards.values()) closeServers(entry)
    this.forwards.clear()
  }

  private schedule(): void {
    if (this.closed) return
    this.timer = setTimeout(() => {
      this.polling = this.poll().finally(() => {
        this.polling = null
        this.schedule()
      })
    }, this.options.pollMs ?? POLL_MS)
    this.timer.unref()
  }

  /** Aligne les ports détectés sur ce qui écoute ; un conteneur arrêté relâche tout. */
  async poll(): Promise<void> {
    let listening: Listening[]
    try {
      const { stdout } = await run(
        this.docker,
        ['exec', this.containerId, 'cat', '/proc/net/tcp', '/proc/net/tcp6'],
        { timeout: DOCKER_TIMEOUT_MS, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      )
      listening = parseListening(stdout)
    } catch (err) {
      // `cat` sort en erreur sans `tcp6` (IPv6 coupé), mais sa sortie reste bonne.
      if ((await this.inspect('{{.State.Running}}')) === 'false') {
        this.release()
        this.options.onGone?.()
        return
      }
      const stdout = (err as { stdout?: string }).stdout
      if (!stdout) return
      listening = parseListening(stdout)
    }
    if (this.closed) return
    // Garde-fou : un port que Solera sert lui-même n'est pas un serveur du conteneur.
    const served = new Set([...this.forwards.values()].map((entry) => entry.hostPort))
    for (const { port, address } of listening) {
      const known = this.forwards.get(port)
      if (!known && served.has(port)) continue
      if (known) {
        if (known.source === 'detected') known.address = address
        // Un port déclaré pour la boucle locale suit l'adresse réelle de l'écoute.
        else if (known.address === '127.0.0.1' || known.address === '::1') known.address = address
        continue
      }
      if (attributesFor(this.config, port).onAutoForward === 'ignore') continue
      await this.open(port, address, 'detected')
    }
    for (const entry of [...this.forwards.values()]) {
      if (entry.source === 'detected' && !listening.some((item) => item.port === entry.containerPort)) {
        closeServers(entry)
        this.forwards.delete(entry.containerPort)
      }
    }
  }

  /**
   * Un champ de `docker inspect`, ou null s'il n'a pas pu être lu : sous Docker Desktop,
   * un échec passager ne dit pas que le conteneur s'est arrêté.
   */
  private async inspect(format: string): Promise<string | null> {
    try {
      const { stdout } = await run(this.docker, ['inspect', '--format', format, this.containerId], {
        timeout: DOCKER_TIMEOUT_MS,
        windowsHide: true,
      })
      return stdout.trim()
    } catch {
      return null
    }
  }

  private async open(containerPort: number, host: string, source: Forward['source']): Promise<void> {
    const attributes = attributesFor(this.config, containerPort)
    const entry: Forward = {
      containerPort,
      address: host === 'localhost' ? '127.0.0.1' : host,
      source,
      attributes,
      hostPort: null,
      error: null,
      servers: [],
    }
    this.forwards.set(containerPort, entry)
    const candidates = attributes.requireLocalPort
      ? [containerPort]
      : [...Array.from({ length: NEXT_PORTS + 1 }, (_, at) => containerPort + at).filter(validPort), 0]
    let lastError: Error | null = null
    for (const candidate of candidates) {
      try {
        const servers = await listenLoopback(candidate, (socket) => this.relayConnection(entry, socket))
        if (this.closed || this.forwards.get(containerPort) !== entry) {
          for (const server of servers) server.close()
          return
        }
        entry.servers = servers
        entry.hostPort = (servers[0]!.address() as { port: number }).port
        return
      } catch (err) {
        lastError = err as Error
      }
    }
    entry.error = {
      code: attributes.requireLocalPort ? 'port_taken' : 'listen_failed',
      detail: lastError?.message ?? '',
    }
  }

  private relayConnection(entry: Forward, socket: Socket): void {
    socket.pause()
    void this.relayCommand().then((relay) => {
      if (!relay) socket.destroy()
      else relaySocket(socket, this.docker, this.containerId, relay, entry.address, entry.containerPort)
    })
  }

  /**
   * Cherché une fois : l'image ne change pas tant que le conteneur tourne. Une sonde qui
   * n'a pas pu tourner se refait à la connexion suivante ; un conteneur sans aucun outil
   * le reste, et chaque port le dit.
   */
  private async relayCommand(): Promise<string | null> {
    if (this.relay !== undefined) return this.relay
    const found = await findRelay(this.docker, this.containerId)
    if (found !== undefined) this.relay = found
    return found ?? null
  }
}

/**
 * Le premier outil de relais du conteneur ; null quand il n'en a aucun, ce qui est une
 * réponse ; undefined quand la sonde n'a pas pu tourner, à refaire plus tard.
 */
export async function findRelay(docker: string, containerId: string): Promise<string | null | undefined> {
  try {
    const { stdout } = await run(docker, ['exec', containerId, 'sh', '-c', PROBE], {
      timeout: DOCKER_TIMEOUT_MS,
      windowsHide: true,
    })
    const found = stdout.trim()
    return found in RELAYS ? found : null
  } catch (err) {
    return (err as { code?: unknown }).code === NONE_FOUND ? null : undefined
  }
}

/**
 * Branche une connexion de l'hôte sur `address:port` **dans** le conteneur, par un
 * `docker exec` de l'outil `relay` (`findRelay`). La connexion doit être en pause.
 */
export function relaySocket(socket: Socket, docker: string, containerId: string, relay: string, address: string, port: number): void {
  if (socket.destroyed) return
  const child = spawn(docker, ['exec', '-i', containerId, ...RELAYS[relay]!(address, port)], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  })
  socket.pipe(child.stdin)
  child.stdout.pipe(socket)
  socket.resume()
  child.stdin.on('error', () => undefined)
  socket.on('error', () => child.kill())
  socket.on('close', () => child.kill())
  child.on('error', () => socket.destroy())
  child.on('exit', () => socket.end())
}

function closeServers(entry: Forward): void {
  for (const server of entry.servers) server.close()
  entry.servers = []
}

/**
 * Écoute sur `127.0.0.1` et `::1` au même port : un navigateur qui résout `localhost`
 * en IPv6 tomberait sinon sur un autre serveur de l'hôte. Une machine sans IPv6 se
 * contente d'IPv4. Le port 0 laisse le système choisir.
 */
async function listenLoopback(port: number, onConnection: (socket: Socket) => void): Promise<Server[]> {
  const v4 = await listen(createServer(onConnection), port, '127.0.0.1')
  const chosen = (v4.address() as { port: number }).port
  try {
    const v6 = await listen(createServer(onConnection), chosen, '::1')
    return [v4, v6]
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EADDRNOTAVAIL' || code === 'EAFNOSUPPORT') return [v4]
    v4.close()
    throw err
  }
}

function listen(server: Server, port: number, host: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port, host, exclusive: true }, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
