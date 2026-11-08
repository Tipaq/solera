import { execFile } from 'node:child_process'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  environmentServiceId,
  type ForwardedPortDto,
  type ServiceEnvironmentEngine,
  type ServiceEnvironmentKind,
  type ServiceEnvironmentState,
  type ServiceEnvironmentTerminal,
} from '@solera/protocol'
import { resolveBinary } from '../agents/cli-binary.js'
import { ConfinedEnvironment } from '../environments/confined/confined.js'
import type { Devcontainers } from '../environments/devcontainer/containers.js'
import { DevcontainerEnvironment } from '../environments/devcontainer/environment.js'
import type { EnvironmentProvider } from '../environments/provider.js'
import { listeningSockets } from './processes.js'

const run = promisify(execFile)
const DOCKER_TIMEOUT_MS = 10_000
/** La taille d'un conteneur coûte un parcours de sa couche : relue au plus chaque minute. */
const DISK_EVERY_MS = 60_000
/** Un scan sert les requêtes qui arrivent dans ce délai : deux onglets ne doublent pas `docker stats`. */
const SCAN_EVERY_MS = 4_000
/** Ce que le journal montre de la sortie d'un conteneur. */
const LOG_LINES = 300

/**
 * Un environnement tel que le serveur le voit, avant qu'on décide qui peut le voir : les
 * sessions et les terminaux qui s'en servent, son état, sa consommation.
 */
export interface ScannedEnvironment {
  id: string
  kind: ServiceEnvironmentKind
  engine: ServiceEnvironmentEngine
  name: string | null
  state: ServiceEnvironmentState
  error: string | null
  projectId: string | null
  conversationIds: string[]
  terminals: ServiceEnvironmentTerminal[]
  vscodeAttached: boolean
  cpu: number | null
  memoryBytes: number | null
  diskBytes: number | null
  imageBytes: number | null
  ports: number[]
  forwardedPorts: ForwardedPortDto[]
  startedAt: number | null
  companions: string[]
  /** Le conteneur principal, puis ceux de son docker-compose. */
  containerIds: string[]
  /** Les processus d'un bac à sable sur l'hôte : sa consommation se lit dans le scan des processus. */
  pids: number[]
  /** La session ou le terminal dont un bac à sable est le seul : l'arrêter, c'est l'arrêter. */
  owner: { conversationId: string } | { terminalId: string } | null
}

/** Ce que l'inventaire lit du reste du serveur. */
export interface EnvironmentSources {
  sessions: { liveEnvironments(): { conversationId: string; environment: EnvironmentProvider }[] }
  terminals: { live(): { id: string; projectId: string; title: string; pid: number; environment: EnvironmentProvider }[] }
  devcontainers: Devcontainers | null
  /** Les projets, pour reconnaître un dev container à son dossier. */
  projects(): { id: string; workspacePath: string }[]
  /** Le projet d'une session, pour un bac à sable. */
  projectOf(conversationId: string): string | null
}

/** Un conteneur tel que `docker ps` le décrit, réduit à ce qu'on lit. */
export interface DockerContainer {
  id: string
  name: string
  state: string
  status: string
  writableBytes: number | null
  imageBytes: number | null
  localFolder: string
  composeProject: string
}

const PS_FORMAT = [
  '{{.ID}}',
  '{{.Names}}',
  '{{.State}}',
  '{{.Status}}',
  '{{.Size}}',
  '{{.Label "devcontainer.local_folder"}}',
  '{{.Label "com.docker.compose.project"}}',
].join('\t')

/** `docker ps --format PS_FORMAT`, ligne par ligne. */
export function parseDockerPs(output: string): DockerContainer[] {
  return output.split('\n').flatMap((line) => {
    const [id, name = '', state = '', status = '', size = '', localFolder = '', composeProject = ''] = line.split('\t')
    if (!id?.trim()) return []
    const sizes = parseContainerSize(size)
    return [{ id: id.trim(), name, state, status, ...sizes, localFolder, composeProject }]
  })
}

/** `73.7kB (virtual 1.77GB)` : la couche du conteneur, puis son image. Unités décimales. */
export function parseContainerSize(size: string): { writableBytes: number | null; imageBytes: number | null } {
  const match = /^\s*([\d.]+\s*[kMGTP]?B)\s*(?:\(virtual\s+([\d.]+\s*[kMGTP]?B)\))?/i.exec(size)
  if (!match) return { writableBytes: null, imageBytes: null }
  const writable = parseBytes(match[1]!)
  const virtual = match[2] ? parseBytes(match[2]) : null
  return { writableBytes: writable, imageBytes: virtual === null || writable === null ? virtual : Math.max(0, virtual - writable) }
}

const UNITS: Record<string, number> = {
  b: 1,
  kb: 1e3,
  mb: 1e6,
  gb: 1e9,
  tb: 1e12,
  pb: 1e15,
  kib: 1024,
  mib: 1024 ** 2,
  gib: 1024 ** 3,
  tib: 1024 ** 4,
}

/** `1.188MiB`, `73.7kB` : Docker écrit la mémoire en binaire, le disque en décimal. */
export function parseBytes(text: string): number | null {
  const match = /^\s*([\d.]+)\s*([a-z]*)\s*$/i.exec(text)
  if (!match) return null
  const factor = UNITS[(match[2] || 'b').toLowerCase()]
  return factor === undefined ? null : Math.round(Number(match[1]) * factor)
}

/** `docker stats --no-stream --format '{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}'`, par id court. */
export function parseDockerStats(output: string): Map<string, { cpu: number | null; memoryBytes: number | null }> {
  const stats = new Map<string, { cpu: number | null; memoryBytes: number | null }>()
  for (const line of output.split('\n')) {
    const [id, cpu = '', memory = ''] = line.split('\t')
    if (!id?.trim()) continue
    const percent = Number.parseFloat(cpu)
    stats.set(id.trim().slice(0, 12), {
      // Docker donne un pourcentage d'un cœur, qui dépasse 100 sur plusieurs.
      cpu: Number.isFinite(percent) ? percent / 100 : null,
      memoryBytes: parseBytes(memory.split('/')[0] ?? ''),
    })
  }
  return stats
}

/**
 * L'état d'un dev container, d'après Docker et ce que Solera sait de son démarrage. Un
 * conteneur sorti sur un signal d'arrêt (`docker stop`, 137 ou 143) est arrêté, pas en
 * échec.
 */
export function containerState(
  container: Pick<DockerContainer, 'state' | 'status'> | null,
  solera: { starting: boolean; failure: string | null },
): { state: ServiceEnvironmentState; error: string | null } {
  if (solera.starting) return { state: 'starting', error: null }
  if (!container) return solera.failure ? { state: 'failed', error: solera.failure } : { state: 'stopped', error: null }
  switch (container.state) {
    case 'running':
      return { state: 'running', error: null }
    case 'created':
    case 'restarting':
      return { state: 'starting', error: null }
    case 'dead':
      return { state: 'failed', error: container.status }
    case 'exited': {
      const code = Number(/Exited \((\d+)\)/.exec(container.status)?.[1] ?? 0)
      if ([0, 137, 143].includes(code)) return { state: solera.failure ? 'failed' : 'stopped', error: solera.failure }
      return { state: 'failed', error: solera.failure ?? container.status }
    }
    default:
      return { state: 'stopped', error: null }
  }
}

/** Les ports en écoute d'un espace réseau, d'après ses tables `/proc/net/tcp*` mises bout à bout. */
export function listeningPorts(tables: string): number[] {
  return [...new Set(listeningSockets(tables).values())].sort((a, b) => a - b)
}

/**
 * Un serveur de VS Code tourne-t-il parmi ces lignes de commande ? Dans le home
 * (`~/.vscode-server`) ou dans le volume de l'extension Dev Containers
 * (`/vscode/vscode-server`), sans point.
 */
export function vscodeIn(commandLines: string): boolean {
  return /vscode-server|\.vscode-remote|cursor-server/.test(commandLines)
}

/**
 * La consommation d'un bac à sable : ses processus sur l'hôte, et tout ce qui en descend,
 * tels que le scan des processus les a repliés.
 */
export function sandboxUsage(
  pids: readonly number[],
  processes: readonly { id: string; pid: number; launcherPid: number | null; memoryBytes: number; ports: number[]; startedAt: number }[],
  cpuOf: (id: string) => number | null,
): { cpu: number | null; memoryBytes: number | null; ports: number[]; startedAt: number | null } {
  const roots = new Set(pids)
  const members = processes.filter((entry) => roots.has(entry.pid) || (entry.launcherPid !== null && roots.has(entry.launcherPid)))
  if (members.length === 0) return { cpu: null, memoryBytes: null, ports: [], startedAt: null }
  const loads = members.map((entry) => cpuOf(entry.id))
  const starts = members.filter((entry) => roots.has(entry.pid)).map((entry) => entry.startedAt)
  return {
    cpu: loads.every((load) => load === null) ? null : loads.reduce<number>((sum, load) => sum + (load ?? 0), 0),
    memoryBytes: members.reduce((sum, entry) => sum + entry.memoryBytes, 0),
    ports: [...new Set(members.flatMap((entry) => entry.ports))].sort((a, b) => a - b),
    startedAt: starts.length ? Math.min(...starts) : null,
  }
}

/**
 * Les environnements d'exécution que Solera fait tourner : les dev containers des
 * projets, que Docker tient hors de l'arbre de processus de Solera, et les bacs à sable
 * des sessions et des terminaux confinés, qui y sont.
 */
export class EnvironmentInventory {
  private cached: { at: number; entries: ScannedEnvironment[] } | null = null
  private pending: Promise<ScannedEnvironment[]> | null = null
  private sizes: { at: number; byId: Map<string, Pick<DockerContainer, 'writableBytes' | 'imageBytes'>> } | null = null
  private readonly dirSizes = new Map<string, { at: number; bytes: number }>()

  constructor(private readonly sources: EnvironmentSources) {}

  scan(fresh = false): Promise<ScannedEnvironment[]> {
    if (!fresh && this.cached && Date.now() - this.cached.at < SCAN_EVERY_MS) return Promise.resolve(this.cached.entries)
    this.pending ??= this.scanNow()
      .then((entries) => {
        this.cached = { at: Date.now(), entries }
        return entries
      })
      .finally(() => {
        this.pending = null
      })
    return this.pending
  }

  invalidate(): void {
    this.cached = null
  }

  /** Docker est-il là pour agir ? Vérifié avant d'arrêter les sessions qui s'en servent. */
  dockerAvailable(): boolean {
    return resolveBinary('docker') !== null
  }

  /** Arrête ou redémarre les conteneurs d'un dev container, docker-compose compris. */
  async control(containerIds: string[], action: 'stop' | 'restart'): Promise<void> {
    const docker = resolveBinary('docker')
    if (!docker) throw new Error('Docker is not on the PATH of the Solera server.')
    try {
      await run(docker, [action, ...containerIds], { timeout: 120_000, windowsHide: true })
    } catch (err) {
      throw new Error((err as { stderr?: string }).stderr?.trim() || (err as Error).message)
    }
    this.invalidate()
  }

  /** La fin de la sortie du conteneur principal, flux d'erreur compris. */
  async output(containerId: string): Promise<string> {
    const docker = resolveBinary('docker')
    if (!docker) return ''
    try {
      const { stdout, stderr } = await run(docker, ['logs', '--tail', String(LOG_LINES), containerId], {
        timeout: DOCKER_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
      return [stdout, stderr].filter((part) => part.trim()).join('\n')
    } catch (err) {
      return (err as { stderr?: string }).stderr?.trim() || (err as Error).message
    }
  }

  private async scanNow(): Promise<ScannedEnvironment[]> {
    const [containers, sandboxes] = await Promise.all([this.devcontainers(), this.sandboxes()])
    return [...containers, ...sandboxes]
  }

  private async devcontainers(): Promise<ScannedEnvironment[]> {
    const devcontainers = this.sources.devcontainers
    if (!devcontainers) return []
    const projects = this.sources.projects()
    const docker = resolveBinary('docker')
    const listed = docker ? await this.dockerContainers(docker).catch(() => []) : []
    const sessions = this.sources.sessions.liveEnvironments()
    const terminals = this.sources.terminals.live()
    const entries: ScannedEnvironment[] = []
    const running: { entry: ScannedEnvironment; id: string }[] = []

    for (const project of projects) {
      const solera = devcontainers.status(project.id)
      const own = listed.filter((container) => container.localFolder === project.workspacePath)
      // Celui que Solera a démarré, sinon celui qui tourne, sinon le plus récent.
      const main =
        own.find((container) => solera.containerId?.startsWith(container.id)) ??
        own.find((container) => container.state === 'running') ??
        own[0] ??
        null
      if (!main && !solera.starting && !solera.failure) continue
      const companions = main?.composeProject
        ? listed.filter((other) => other.composeProject === main.composeProject && other.id !== main.id)
        : []
      const matches = (environment: EnvironmentProvider) =>
        environment instanceof DevcontainerEnvironment &&
        (main ? environment.containerId.startsWith(main.id) : environment.containerId === solera.containerId)
      const { state, error } = containerState(main, solera)
      const entry: ScannedEnvironment = {
        id: environmentServiceId({ kind: 'devcontainer', projectId: project.id }),
        kind: 'devcontainer',
        engine: 'docker',
        name: main?.name ?? null,
        state,
        error,
        projectId: project.id,
        conversationIds: sessions.filter((session) => matches(session.environment)).map((session) => session.conversationId),
        terminals: terminals
          .filter((terminal) => terminal.projectId === project.id && matches(terminal.environment))
          .map((terminal) => ({ id: terminal.id, title: terminal.title, pid: terminal.pid })),
        vscodeAttached: false,
        cpu: null,
        memoryBytes: null,
        diskBytes: main ? sum([main, ...companions].map((container) => container.writableBytes)) : null,
        imageBytes: main?.imageBytes ?? null,
        ports: [],
        forwardedPorts: devcontainers.forwardedPorts(project.id),
        startedAt: null,
        companions: companions.map((container) => container.name),
        containerIds: main ? [main.id, ...companions.map((container) => container.id)] : [],
        pids: [],
        owner: null,
      }
      entries.push(entry)
      if (main?.state === 'running' && docker) running.push({ entry, id: main.id })
    }
    if (docker && running.length > 0) await this.measure(docker, running, listed)
    return entries
  }

  /** CPU et mémoire de tout le docker-compose, ports, VS Code, heure de démarrage. */
  private async measure(docker: string, running: { entry: ScannedEnvironment; id: string }[], listed: DockerContainer[]): Promise<void> {
    const ids = running.flatMap(({ entry }) =>
      entry.containerIds.filter((id) => listed.find((container) => container.id === id)?.state === 'running'),
    )
    const [stats, started] = await Promise.all([
      run(docker, ['stats', '--no-stream', '--format', '{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}', ...ids], {
        timeout: DOCKER_TIMEOUT_MS,
        windowsHide: true,
      })
        .then(({ stdout }) => parseDockerStats(stdout))
        .catch(() => new Map<string, { cpu: number | null; memoryBytes: number | null }>()),
      run(docker, ['inspect', '--format', '{{.Id}}\t{{.State.StartedAt}}', ...running.map(({ id }) => id)], {
        timeout: DOCKER_TIMEOUT_MS,
        windowsHide: true,
      })
        .then(({ stdout }) => stdout)
        .catch(() => ''),
    ])
    await Promise.all(
      running.map(async ({ entry, id }) => {
        const measured = entry.containerIds.map((member) => stats.get(member.slice(0, 12))).filter((value) => value !== undefined)
        entry.cpu = measured.length ? sum(measured.map((value) => value.cpu)) : null
        entry.memoryBytes = measured.length ? sum(measured.map((value) => value.memoryBytes)) : null
        const at = started.split('\n').find((line) => line.startsWith(id))?.split('\t')[1]
        entry.startedAt = at ? Date.parse(at) || null : null
        const [tables, top] = await Promise.all([
          run(docker, ['exec', '-u', 'root', id, 'cat', '/proc/net/tcp', '/proc/net/tcp6'], {
            timeout: DOCKER_TIMEOUT_MS,
            windowsHide: true,
          })
            .then(({ stdout }) => stdout)
            .catch((err: { stdout?: string }) => err.stdout ?? ''),
          run(docker, ['top', id, '-eo', 'args'], { timeout: DOCKER_TIMEOUT_MS, windowsHide: true })
            .then(({ stdout }) => stdout)
            .catch(() => ''),
        ])
        entry.ports = listeningPorts(tables)
        entry.vscodeAttached = vscodeIn(top)
      }),
    )
  }

  /** Tous les conteneurs : ceux d'un dev container, et leurs voisins de docker-compose. */
  private async dockerContainers(docker: string): Promise<DockerContainer[]> {
    const withSizes = !this.sizes || Date.now() - this.sizes.at > DISK_EVERY_MS
    const { stdout } = await run(docker, ['ps', '-a', ...(withSizes ? ['-s'] : []), '--format', PS_FORMAT], {
      timeout: DOCKER_TIMEOUT_MS * 3,
      windowsHide: true,
    })
    const containers = parseDockerPs(stdout)
    if (withSizes) {
      this.sizes = { at: Date.now(), byId: new Map(containers.map((container) => [container.id, container])) }
      return containers
    }
    return containers.map((container) => ({
      ...container,
      writableBytes: this.sizes?.byId.get(container.id)?.writableBytes ?? null,
      imageBytes: this.sizes?.byId.get(container.id)?.imageBytes ?? null,
    }))
  }

  /** Un bac à sable par session et par terminal confinés : chacun a le sien. */
  private async sandboxes(): Promise<ScannedEnvironment[]> {
    const owners = [
      ...this.sources.sessions.liveEnvironments().map((session) => ({
        id: environmentServiceId({ kind: 'sandbox', conversationId: session.conversationId }),
        environment: session.environment,
        projectId: this.sources.projectOf(session.conversationId),
        conversationIds: [session.conversationId],
        terminals: [] as ServiceEnvironmentTerminal[],
        owner: { conversationId: session.conversationId },
      })),
      ...this.sources.terminals.live().map((terminal) => ({
        id: environmentServiceId({ kind: 'sandbox', terminalId: terminal.id }),
        environment: terminal.environment,
        projectId: terminal.projectId,
        conversationIds: [] as string[],
        terminals: [{ id: terminal.id, title: terminal.title, pid: terminal.pid }],
        owner: { terminalId: terminal.id },
      })),
    ]
    return Promise.all(
      owners.flatMap(({ environment, ...owner }) =>
        environment instanceof ConfinedEnvironment
          ? [
              (async (): Promise<ScannedEnvironment> => ({
                ...owner,
                kind: 'sandbox',
                engine: environment.engine,
                name: null,
                state: 'running',
                error: null,
                vscodeAttached: false,
                cpu: null,
                memoryBytes: null,
                diskBytes: environment.privateRoot ? await this.directorySize(environment.privateRoot) : null,
                imageBytes: null,
                ports: [],
                forwardedPorts: [],
                startedAt: null,
                companions: [],
                containerIds: [],
                pids: environment.pids(),
              }))(),
            ]
          : [],
      ),
    )
  }

  /** Ce que pèse un dossier, relu au plus chaque minute. */
  private async directorySize(root: string): Promise<number | null> {
    const known = this.dirSizes.get(root)
    if (known && Date.now() - known.at < DISK_EVERY_MS) return known.bytes
    const bytes = await directoryBytes(root).catch(() => null)
    if (bytes === null) return known?.bytes ?? null
    this.dirSizes.set(root, { at: Date.now(), bytes })
    for (const [path, size] of this.dirSizes) if (Date.now() - size.at > DISK_EVERY_MS * 10) this.dirSizes.delete(path)
    return bytes
  }
}

/** La taille d'un arbre de fichiers, sans suivre les liens. */
export async function directoryBytes(root: string): Promise<number> {
  let total = 0
  const pending = [root]
  while (pending.length > 0) {
    const dir = pending.pop()!
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.isFile()) total += (await lstat(path).catch(() => null))?.size ?? 0
    }
  }
  return total
}

/** La somme de ce qui est connu ; null si rien ne l'est. */
function sum(values: (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === 'number')
  return known.length ? known.reduce((total, value) => total + value, 0) : null
}
