import { mkdir } from 'node:fs/promises'
import type { Server as HttpServer } from 'node:http'
import { join } from 'node:path'
import type { AgentKind } from '@solera/protocol'
import type { Config, Paths } from '../../config.js'
import { prototypesRoot } from '../../design-system/storybooks.js'
import { soleraUrlForAgents } from '../../instance/agent-url.js'
import { AGENTS_MOUNT, ContainerAgents, type LinuxTarget } from './agents.js'
import { BridgeListeners } from './bridge.js'
import { binaryName, DevcontainerEnvironment, LOOPBACK_HOSTS, type RunningContainer } from './environment.js'
import { devcontainerConfigOf, DevcontainerTools, type Mount } from './tools.js'

/** Ce qu'un lancement attend du conteneur. */
export interface ContainerNeed {
  /** L'agent d'une session : son CLI Linux, à la version de l'hôte. Absent pour un terminal. */
  agent?: { kind: AgentKind; binary: string; version: string }
  /** Le dossier où le lancement travaille, sur l'hôte. */
  cwd: string
  /** Chaque ligne du journal de `devcontainer up`, pendant qu'il démarre. */
  onLog?: (line: string) => void
}

/** Pourquoi un conteneur ne peut pas servir : l'interface le traduit par son code. */
export class ContainerRefusal extends Error {
  constructor(
    readonly code:
      | 'devcontainer_missing'
      | 'devcontainer_docker_missing'
      | 'devcontainer_cli_missing'
      | 'devcontainer_failed'
      | 'devcontainer_foreign'
      | 'devcontainer_host_unreachable'
      | 'devcontainer_arch',
    message: string,
  ) {
    super(message)
    this.name = 'ContainerRefusal'
  }
}

interface Project {
  id: string
  workspacePath: string
}

/**
 * Les dev containers des projets : un par projet, partagé par ses sessions non
 * confinées et ses terminaux (ADR 0001, #140).
 *
 * Solera démarre le conteneur à la première session ou au premier terminal qui en a
 * besoin, et ne l'arrête jamais de lui-même. Un conteneur qui tourne déjà pour le
 * dossier, y compris celui de VS Code, est réutilisé tel quel.
 *
 * Les dossiers que l'agent doit voir sont montés **au même chemin** que sur l'hôte : un
 * worktree garde ses liens git (`.git`, `gitdir` dans le dépôt principal), et rien
 * n'est à traduire dans ce que Solera passe au CLI (homes de compte, mémoire, pièces
 * jointes). Ce n'est pas tenable sous Windows natif, où les chemins diffèrent.
 */
export class Devcontainers {
  private readonly running = new Map<string, RunningContainer>()
  private readonly starting = new Map<string, Promise<RunningContainer>>()
  private lazy: { tools: DevcontainerTools; agents: ContainerAgents } | null = null

  constructor(
    private readonly paths: Paths,
    /**
     * Où le serveur écoute : un conteneur ne joint la boucle locale de l'hôte que par
     * Docker Desktop, qui la relaie derrière `host.docker.internal`.
     */
    private readonly server: Pick<Config['server'], 'host' | 'port' | 'agentUrl'> = { host: '127.0.0.1', port: 0, agentUrl: '' },
  ) {}

  /** Sous Linux natif, les écoutes du serveur sur les passerelles Docker. */
  private readonly bridges = new BridgeListeners()

  /** Le serveur HTTP que les conteneurs joignent, une fois qu'il écoute. */
  serve(server: HttpServer): void {
    this.bridges.serve(server)
  }

  /** Construits au premier usage : un serveur sans dev container n'en touche aucun chemin. */
  private get tools(): DevcontainerTools {
    return this.parts().tools
  }

  private get agents(): ContainerAgents {
    return this.parts().agents
  }

  private parts() {
    this.lazy ??= {
      tools: new DevcontainerTools(this.paths.agents),
      agents: new ContainerAgents(join(this.paths.data, 'container-agents')),
    }
    return this.lazy
  }

  /** Le projet a-t-il un `devcontainer.json` ? Seul cas où on le propose. */
  available(workspacePath: string): boolean {
    return devcontainerConfigOf(workspacePath) !== null
  }

  /**
   * Démarre le conteneur du projet s'il ne tourne pas, et y apporte le CLI de l'agent.
   * Rend le fournisseur où lancer. Un conteneur arrêté entre-temps est redémarré.
   */
  async prepare(project: Project, need: ContainerNeed): Promise<DevcontainerEnvironment> {
    if (!this.available(project.workspacePath)) {
      throw new ContainerRefusal(
        'devcontainer_missing',
        `${project.workspacePath} has no .devcontainer/devcontainer.json: this project cannot run in a dev container.`,
      )
    }
    const container = await this.ensureRunning(project, need.onLog ?? (() => undefined))
    if (need.agent || need.cwd !== project.workspacePath) {
      if (!container.solerasMounts) {
        throw new ContainerRefusal(
          'devcontainer_foreign',
          `The dev container ${container.id.slice(0, 12)} was started outside Solera (by VS Code, for instance), without the mounts Solera needs for agent sessions and worktrees. Remove it (\`docker rm -f ${container.id.slice(0, 12)}\`) and Solera will recreate it with them; VS Code will attach to that one.`,
        )
      }
    }
    if (need.agent) {
      const target = await this.target(container)
      try {
        const inside = await this.agents.ensure(need.agent.kind, need.agent.version, target)
        container.agents.set(binaryName(need.agent.binary), inside)
      } catch (err) {
        throw new ContainerRefusal(
          'devcontainer_failed',
          `The Linux ${need.agent.kind} CLI ${need.agent.version} could not be fetched for the dev container: ${(err as Error).message}`,
        )
      }
    }
    return this.provider(project.id)
  }

  /** Le fournisseur d'un projet dont le conteneur a été préparé. */
  provider(projectId: string): DevcontainerEnvironment {
    const container = this.running.get(projectId)
    if (!container) throw new Error(`The dev container of project ${projectId} has not been started.`)
    return new DevcontainerEnvironment(container, this.tools.docker())
  }

  private async ensureRunning(project: Project, onLog: (line: string) => void): Promise<RunningContainer> {
    const known = this.running.get(project.id)
    if (known && (await this.tools.inspect(known.id))?.running) return known
    let pending = this.starting.get(project.id)
    if (!pending) {
      pending = this.start(project, onLog).finally(() => this.starting.delete(project.id))
      this.starting.set(project.id, pending)
    }
    return pending
  }

  private async start(project: Project, onLog: (line: string) => void): Promise<RunningContainer> {
    this.running.delete(project.id)
    try {
      this.tools.docker()
      await this.tools.assertDockerRunning()
      await this.tools.devcontainer()
    } catch (err) {
      const tool = (err as { tool?: string }).tool
      throw new ContainerRefusal(
        tool === 'devcontainer' ? 'devcontainer_cli_missing' : 'devcontainer_docker_missing',
        (err as Error).message,
      )
    }
    try {
      const workspaceFolder = await this.tools.workspaceFolder(project.workspacePath)
      const mounts = await this.mounts(project, workspaceFolder)
      const up = await this.tools.up(project.workspacePath, mounts, onLog)
      const info = await this.tools.inspect(up.containerId)
      const container: RunningContainer = {
        id: up.containerId,
        user: up.remoteUser,
        workspace: project.workspacePath,
        remoteWorkspaceFolder: up.remoteWorkspaceFolder,
        solerasMounts: info?.mountTargets.includes(AGENTS_MOUNT) ?? false,
        loginShell: '/bin/sh',
        env: {},
        agents: new Map(),
        hostAddress: await this.hostAddress(up.containerId),
      }
      await this.reachServer(container.hostAddress)
      await this.assertMcpReachable(container)
      await this.probe(container)
      this.running.set(project.id, container)
      return container
    } catch (err) {
      if (err instanceof ContainerRefusal) throw err
      throw new ContainerRefusal('devcontainer_failed', (err as Error).message)
    }
  }

  /** L'hôte vu du conteneur ; un conteneur qui ne le voit pas du tout est refusé. */
  private async hostAddress(containerId: string): Promise<string> {
    const address = await this.tools.hostAddress(containerId)
    if (address) return address
    throw new ContainerRefusal(
      'devcontainer_host_unreachable',
      'The container has no network to reach this machine (network mode "none", or the network of another container), so the agents would run without the Solera MCP server. Give it a bridge network, or the network of this machine: `"runArgs": ["--network=host"]` in its devcontainer.json, or `network_mode: host` in its docker-compose file.',
    )
  }

  /**
   * Le MCP de Solera doit se joindre depuis le conteneur, sans quoi une session y
   * partirait sans lui. Sous Linux natif, l'hôte vu du conteneur est la passerelle du
   * réseau Docker, où un serveur qui n'écoute que sur sa boucle locale ne répond pas :
   * il y écoute alors en plus, à son port (#149). Sur le réseau de l'hôte, la boucle
   * locale suffit.
   */
  private async reachServer(hostAddress: string): Promise<void> {
    if (hostAddress === 'host.docker.internal' || LOOPBACK_HOSTS.includes(hostAddress) || this.server.agentUrl) return
    if (!LOOPBACK_HOSTS.includes(this.server.host)) return
    try {
      await this.bridges.ensure(hostAddress)
    } catch (err) {
      throw new ContainerRefusal(
        'devcontainer_host_unreachable',
        `The Solera server listens on ${this.server.host} only, and could not also listen on ${hostAddress}, where the container sees this machine: ${(err as Error).message}. Set server.agentUrl to an address of this machine reachable from Docker, and make the server listen on it.`,
      )
    }
  }

  /**
   * Écouter ne suffit pas : un pare-feu de l'hôte (ufw, firewalld) peut filtrer ce qui
   * entre par le pont Docker. On le vérifie depuis le conteneur, à l'adresse même que
   * ses sessions recevront. Sans outil pour sonder, on laisse passer.
   */
  private async assertMcpReachable(container: RunningContainer): Promise<void> {
    const url = new DevcontainerEnvironment(container, this.tools.docker()).urlOfHost(soleraUrlForAgents(this.server))
    if ((await this.tools.reaches(container.id, url)) !== false) return
    throw new ContainerRefusal(
      'devcontainer_host_unreachable',
      `The container cannot connect to ${url}, where the agents would find the Solera MCP server. ${unreachableAdvice(url, container.hostAddress)}`,
    )
  }

  /**
   * Ce que Solera monte dans un conteneur qu'il crée, chacun au même chemin que sur
   * l'hôte. Non confiné : l'agent n'y voit rien qu'une session sur l'hôte ne lise déjà.
   */
  private async mounts(project: Project, workspaceFolder: string | null): Promise<Mount[]> {
    const same = [
      project.workspacePath,
      join(this.paths.worktrees, project.id),
      this.paths.attachments,
      this.paths.memory,
      this.paths.skillLibrary,
      prototypesRoot(this.paths.data),
      this.paths.codexAccounts,
      this.paths.grokAccounts,
      containerHomes(this.paths),
    ]
    for (const dir of [...same, this.agents.root]) await mkdir(dir, { recursive: true })
    return [
      { source: this.agents.root, target: AGENTS_MOUNT },
      ...same.filter((dir) => dir !== workspaceFolder).map((dir) => ({ source: dir, target: dir })),
    ]
  }

  /** Le shell de l'utilisateur et l'environnement que `devcontainer exec` lui donnerait. */
  private async probe(container: RunningContainer): Promise<void> {
    const shell = await this.tools
      .execIn(container.id, ['/bin/sh', '-c', '(getent passwd "$0" || grep "^$0:" /etc/passwd) | cut -d: -f7', container.user], 'root')
      .catch(() => '')
    container.loginShell = shell.trim().split('\n')[0] || '/bin/sh'
    const env = await this.tools.execIn(container.id, [container.loginShell, '-lc', 'env'], container.user).catch(() => '')
    container.env = parseEnv(env)
  }

  private async target(container: RunningContainer): Promise<LinuxTarget> {
    let out: string
    try {
      out = await this.tools.execIn(
        container.id,
        ['/bin/sh', '-c', 'uname -m; ls /lib/ld-musl-* 2>/dev/null | head -n 1'],
        'root',
      )
    } catch (err) {
      throw new ContainerRefusal('devcontainer_failed', `The dev container does not answer: ${(err as Error).message}`)
    }
    const [machine = '', musl = ''] = out.split('\n').map((line) => line.trim())
    const arch = targetArch(machine)
    if (!arch) {
      throw new ContainerRefusal(
        'devcontainer_arch',
        `The dev container runs on ${machine || 'an unknown architecture'}: the agent CLIs only exist for x86_64 and aarch64.`,
      )
    }
    return { arch, musl: musl.length > 0 }
  }
}

/**
 * Quoi faire quand le conteneur ne joint pas `url`. Un pare-feu n'est en cause que si
 * l'URL vise la passerelle Docker : ailleurs (`server.agentUrl`, Docker Desktop, réseau
 * de l'hôte), c'est l'adresse elle-même qu'il faut revoir.
 */
export function unreachableAdvice(url: string, hostAddress: string): string {
  const { hostname, port, protocol } = new URL(url)
  const throughGateway = hostAddress !== 'host.docker.internal' && !LOOPBACK_HOSTS.includes(hostAddress)
  if (!throughGateway || hostname.replace(/^\[|\]$/g, '') !== hostAddress) {
    return 'Check that the Solera server answers there, or set server.agentUrl to an address of this machine the container can reach.'
  }
  const target = port || (protocol === 'https:' ? '443' : '80')
  const family = hostAddress.includes(':') ? 'ipv6' : 'ipv4'
  return `A firewall on this machine (ufw, firewalld) probably drops what comes in from the Docker networks: allow TCP to ${hostAddress} on port ${target}, for instance \`sudo ufw allow in to ${hostAddress} port ${target} proto tcp\`, or \`sudo firewall-cmd --permanent --add-rich-rule='rule family="${family}" destination address="${hostAddress}" port port="${target}" protocol="tcp" accept' && sudo firewall-cmd --reload\`.`
}

/** L'architecture d'un CLI pour ce que `uname -m` dit du conteneur ; null sans CLI pour elle. */
export function targetArch(machine: string): LinuxTarget['arch'] | null {
  if (machine === 'x86_64' || machine === 'amd64') return 'x64'
  if (machine === 'aarch64' || machine === 'arm64') return 'arm64'
  return null
}

/** Les configurations des CLI lancés dans un conteneur (`CLAUDE_CONFIG_DIR`), par utilisateur. */
export function containerHomes(paths: Paths): string {
  return join(paths.data, 'container-homes')
}

/** Ce qui ne décrit que le shell de la sonde, pas l'utilisateur. */
const PROBE_ONLY = new Set(['PWD', 'OLDPWD', 'SHLVL', '_', 'HOSTNAME', 'TERM'])

/** La sortie de `env`, sans les valeurs sur plusieurs lignes qu'on ne saurait découper. */
export function parseEnv(output: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (match && !PROBE_ONLY.has(match[1]!)) env[match[1]!] = match[2]!
  }
  return env
}
