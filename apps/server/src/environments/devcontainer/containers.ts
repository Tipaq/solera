import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import type { Server as HttpServer } from 'node:http'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import type { AgentKind, ConfinedServices, ForwardedPortDto } from '@solera/protocol'
import type { Config, Paths } from '../../config.js'
import { prototypesRoot } from '../../design-system/storybooks.js'
import { soleraUrlForAgents } from '../../instance/agent-url.js'
import { AGENTS_MOUNT, ContainerAgents, type LinuxTarget } from './agents.js'
import type { ConfinementScope } from '../confined/plan.js'
import { BridgeListeners } from './bridge.js'
import {
  copiedNetwork,
  ephemeralConfig,
  EphemeralContainer,
  ephemeralMounts,
  ephemeralPlan,
  unconfinedParts,
  type EphemeralLauncher,
  type EphemeralSpec,
  type StartedEphemeral,
} from './ephemeral.js'
import { binaryName, DevcontainerEnvironment, LOOPBACK_HOSTS, type RunningContainer } from './environment.js'
import { PortForwarder, portsConfigOf, type PortsConfig } from './ports.js'
import { ManagedDevcontainers } from './managed.js'
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
      | 'devcontainer_arch'
      | 'devcontainer_unconfined',
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
  /** Le journal du dernier `devcontainer up` de chaque projet, pour Services. */
  private readonly journals = new Map<string, string[]>()
  /** Pourquoi le dernier démarrage d'un projet a échoué ; effacé au suivant qui réussit. */
  private readonly failures = new Map<string, string>()
  private readonly ports = new Map<string, PortForwarder>()
  /** La configuration lue au dernier démarrage de chaque projet : le conteneur d'une session confinée la reprend. */
  private readonly configurations = new Map<string, { configuration: unknown; path: string | null }>()
  private swept: Promise<void> | null = null
  private lazy: { tools: DevcontainerTools; agents: ContainerAgents } | null = null
  private managedStore: ManagedDevcontainers | null = null

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

  /** Les `devcontainer.json` que Solera garde pour les projets qui n'en ont pas (#143). */
  get managed(): ManagedDevcontainers {
    this.managedStore ??= managedDevcontainers(this.paths)
    return this.managedStore
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

  /** Le projet a-t-il un `devcontainer.json`, le sien ou celui de Solera ? Seul cas où on le propose. */
  available(project: Project): boolean {
    return this.configOf(project) !== null
  }

  /**
   * Le `devcontainer.json` d'un projet : celui du dépôt d'abord, qui reste la source de
   * vérité, puis celui que Solera garde pour lui (`managed`), passé au CLI par `--config`.
   */
  configOf(project: Project): { path: string; managed: boolean } | null {
    const own = devcontainerConfigOf(project.workspacePath)
    if (own) return { path: own, managed: false }
    const managed = this.managed.configOf(project.id)
    return managed ? { path: managed, managed: true } : null
  }

  /**
   * Démarre le conteneur du projet s'il ne tourne pas, et y apporte le CLI de l'agent.
   * Rend le fournisseur où lancer. Un conteneur arrêté entre-temps est redémarré.
   */
  async prepare(project: Project, need: ContainerNeed, confined = false): Promise<void> {
    if (!this.available(project)) {
      throw new ContainerRefusal(
        'devcontainer_missing',
        `${project.workspacePath} has no .devcontainer/devcontainer.json, and Solera keeps none for it: create one from the project settings to run it in a dev container.`,
      )
    }
    const container = await this.ensureRunning(project, need.onLog ?? (() => undefined))
    // Une session confinée ne prend que l'image du conteneur du projet : peu importe qui l'a démarré.
    if (!confined && (need.agent || need.cwd !== project.workspacePath)) {
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
  }

  /**
   * Où en est le conteneur d'un projet, vu de Solera : en démarrage, l'id de celui qu'il
   * a démarré, l'échec de son dernier démarrage. Docker dit le reste.
   */
  status(projectId: string): { starting: boolean; containerId: string | null; failure: string | null } {
    return {
      starting: this.starting.has(projectId),
      containerId: this.running.get(projectId)?.id ?? null,
      failure: this.failures.get(projectId) ?? null,
    }
  }

  /** Le journal du dernier `devcontainer up` du projet, vide si Solera n'en a pas lancé. */
  startupLog(projectId: string): string[] {
    return this.journals.get(projectId) ?? []
  }

  /**
   * Reconstruit le conteneur du projet : `devcontainer up --remove-existing-container`,
   * qui supprime l'ancien (celui de VS Code compris) et en crée un neuf, avec les
   * montages de Solera. Ce qui tournait dedans meurt avec lui : l'appelant arrête
   * d'abord les sessions et les terminaux qui s'en servent.
   */
  rebuild(project: Project): Promise<RunningContainer> {
    if (this.starting.has(project.id)) {
      throw new ContainerRefusal('devcontainer_failed', 'This dev container is already starting.')
    }
    const pending = this.start(project, () => undefined, true).finally(() => this.starting.delete(project.id))
    this.starting.set(project.id, pending)
    return pending
  }

  /**
   * Oublie le conteneur démarré d'un projet, arrêté ou redémarré depuis Services : la
   * prochaine session repasse par `up`, qui le relance et relit son environnement.
   */
  forget(projectId: string): void {
    this.running.delete(projectId)
    // Arrêté ou relancé à la main : l'échec d'un démarrage d'avant ne le décrit plus.
    this.failures.delete(projectId)
  }

  /**
   * Le conteneur d'une session ou d'un terminal confiné (#145), à démarrer par son
   * `open` : sur l'image du conteneur du projet, que `prepare(…, true)` a démarré.
   */
  ephemeral(projectId: string, scope: ConfinementScope, services: ConfinedServices): EphemeralContainer {
    return new EphemeralContainer(this.ephemeralLauncher, {
      projectId,
      plan: ephemeralPlan(scope),
      cwd: scope.workspaces[0]!,
      services,
    })
  }

  private readonly ephemeralLauncher: EphemeralLauncher = {
    docker: () => this.tools.docker(),
    start: (spec, onLog) => this.startEphemeral(spec, onLog),
    remove: (started) => this.removeEphemeral(started),
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

  private async start(project: Project, onLog: (line: string) => void, rebuild = false): Promise<RunningContainer> {
    this.running.delete(project.id)
    const journal: string[] = []
    this.journals.set(project.id, journal)
    const log = (line: string) => {
      journal.push(line)
      if (journal.length > JOURNAL_LINES) journal.shift()
      onLog(line)
    }
    try {
      const container = await this.startContainer(project, log, rebuild)
      this.failures.delete(project.id)
      return container
    } catch (err) {
      this.failures.set(project.id, (err as Error).message)
      throw err
    }
  }

  private async startContainer(project: Project, onLog: (line: string) => void, rebuild: boolean): Promise<RunningContainer> {
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
      const config = this.configOf(project)
      // Seul celui de Solera passe par `--config` : celui du dépôt garde l'identité que
      // VS Code lui donne, et son conteneur reste partagé.
      const configPath = config?.managed ? config.path : undefined
      const { workspaceFolder, configuration } = await this.tools.readConfiguration(project.workspacePath, configPath)
      this.configurations.set(project.id, { configuration, path: config?.path ?? null })
      const mounts = await this.mounts(project, workspaceFolder)
      const up = await this.tools.up(project.workspacePath, mounts, onLog, rebuild, configPath)
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
      await this.forward(project.id, container.id, portsConfigOf(configuration))
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
   * Sert les ports du conteneur sur l'hôte, pour l'aperçu web (#141). Un conteneur
   * recréé remplace les redirections du précédent ; un conteneur arrêté les relâche.
   */
  private async forward(projectId: string, containerId: string, config: PortsConfig): Promise<void> {
    const previous = this.ports.get(projectId)
    if (previous?.containerId === containerId) return
    await previous?.close()
    const forwarder = new PortForwarder(containerId, this.tools.docker(), config, {
      onGone: () => {
        if (this.ports.get(projectId) === forwarder) this.ports.delete(projectId)
      },
    })
    this.ports.set(projectId, forwarder)
    await forwarder.start()
  }

  /** Les ports du dev container d'un projet et leur adresse sur l'hôte ; vide s'il ne tourne pas. */
  forwardedPorts(projectId: string): ForwardedPortDto[] {
    return this.ports.get(projectId)?.list() ?? []
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

  /** Ce qui distingue cette instance de Solera d'une autre sur le même Docker. */
  private get instance(): string {
    return createHash('sha256').update(this.paths.data).digest('hex').slice(0, 8)
  }

  /**
   * Démarre le conteneur d'une session confinée : l'image du conteneur du projet, sa
   * configuration sans ce qui construit ni ce qui ouvre l'hôte, les seuls montages de la
   * session, le réseau des services docker-compose (partagés ou copiés). Refusé s'il
   * montre quand même un dossier de l'hôte (une feature qui monte le socket de Docker)
   * ou tourne en mode privilégié.
   */
  private async startEphemeral(spec: EphemeralSpec, onLog: (line: string) => void): Promise<StartedEphemeral> {
    const base = this.running.get(spec.projectId)
    const config = this.configurations.get(spec.projectId)
    if (!base || !config) {
      throw new ContainerRefusal('devcontainer_failed', `The dev container of project ${spec.projectId} has not been started.`)
    }
    await (this.swept ??= this.sweepEphemeral())
    const project = await this.tools.describe(base.id)
    if (!project) throw new ContainerRefusal('devcontainer_failed', 'The dev container of the project is gone.')
    const id = randomUUID()
    const copyName = `solera-${this.instance}-${process.pid}-${id.slice(0, 8)}`
    const composeProject = project.labels['com.docker.compose.project'] ?? null
    let composeCopy: string | null = null
    let ports: PortForwarder | null = null
    const dir = join(this.paths.data, 'ephemeral', id)
    try {
      const runArgs = ['--label', `${INSTANCE_LABEL}=${this.instance}`, '--label', `${PID_LABEL}=${process.pid}`]
      const network = project.networks[0]
      if (project.networkMode === 'host') {
        runArgs.push('--network=host')
      } else if (composeProject && network && spec.services === 'copy' && config.path) {
        composeCopy = await this.copyServices(config.configuration, config.path, copyName, onLog)
        runArgs.push(`--network=${composeCopy ? copiedNetwork(network, composeProject, copyName) : network}`)
      } else if (network && network !== 'bridge') {
        runArgs.push(`--network=${network}`)
      }
      const mounts = ephemeralMounts(spec.plan, spec.cwd, { source: this.agents.root, target: AGENTS_MOUNT })
      const override = ephemeralConfig({
        configuration: config.configuration,
        image: project.image,
        cwd: spec.cwd,
        workspaceMount: mounts.workspaceMount,
        mounts: mounts.mounts,
        runArgs,
        containerEnv: project.env,
      })
      await mkdir(dir, { recursive: true })
      const overridePath = join(dir, 'devcontainer.json')
      await writeFile(overridePath, JSON.stringify(override, null, 2))
      const up = await this.tools.upEphemeral(spec.cwd, overridePath, `${EPHEMERAL_LABEL}=${id}`, onLog)
      const started = await this.tools.describe(up.containerId)
      const issues = started ? unconfinedParts(started, mounts.sources) : ['the container is gone']
      if (issues.length > 0) {
        throw new ContainerRefusal(
          'devcontainer_unconfined',
          `The image of this dev container opens the host to a confined session (${issues.join('; ')}): a feature of its devcontainer.json asks for it, docker-in-docker or docker-outside-of-docker for instance. Run this session unconfined, or confined on the host.`,
        )
      }
      const container: RunningContainer = {
        id: up.containerId,
        user: up.remoteUser,
        workspace: spec.cwd,
        remoteWorkspaceFolder: spec.cwd,
        solerasMounts: true,
        loginShell: '/bin/sh',
        env: {},
        agents: new Map(base.agents),
        hostAddress: await this.hostAddress(up.containerId),
      }
      await this.reachServer(container.hostAddress)
      await this.assertMcpReachable(container)
      await this.probe(container)
      container.env = { ...container.env, ...spec.plan.env }
      await this.linkHome(container, spec.plan.homeLinks)
      ports = new PortForwarder(container.id, this.tools.docker(), portsConfigOf(config.configuration))
      await ports.start()
      return { label: id, container, composeCopy, ports }
    } catch (err) {
      await this.removeEphemeral({ label: id, ports, composeCopy: composeCopy ?? (spec.services === 'copy' ? copyName : null) })
      if (err instanceof ContainerRefusal) throw err
      throw new ContainerRefusal('devcontainer_failed', (err as Error).message)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /**
   * Une copie des services docker-compose du projet, sauf celui du dev container, sous
   * un projet docker-compose à la session : ses conteneurs, son réseau et ses volumes
   * lui appartiennent. Null quand il n'y a rien d'autre à copier.
   */
  private async copyServices(
    configuration: unknown,
    configPath: string,
    copyName: string,
    onLog: (line: string) => void,
  ): Promise<string | null> {
    const files = composeFilesOf(configuration, configPath)
    if (files.length === 0) return null
    const base = ['-p', copyName, '--project-directory', dirname(files[0]!), ...files.flatMap((file) => ['-f', file])]
    const all = (await this.tools.compose([...base, 'config', '--services'], 60_000)).split('\n').map((line) => line.trim()).filter(Boolean)
    const { service, runServices } = (configuration ?? {}) as { service?: unknown; runServices?: unknown }
    const wanted = (Array.isArray(runServices) ? all.filter((name) => runServices.includes(name)) : all).filter(
      (name) => name !== service,
    )
    if (wanted.length === 0) return null
    onLog(`Starting a copy of the docker-compose services for this session: ${wanted.join(', ')}`)
    await this.tools.compose([...base, 'up', '-d', '--no-deps', ...wanted])
    return copyName
  }

  /** Les liens du home de la session vers ce qui est monté de l'hôte : les transcripts de Claude, ses consignes. */
  private async linkHome(container: RunningContainer, links: ConfinementScope['homeLinks']): Promise<void> {
    if (links.length === 0) return
    await this.tools.execIn(
      container.id,
      [
        '/bin/sh',
        '-c',
        'while [ $# -gt 1 ]; do mkdir -p "$HOME/$(dirname "$1")" && ln -sfn "$2" "$HOME/$1"; shift 2; done',
        'link',
        ...links.flatMap((link) => [link.path, link.target]),
      ],
      container.user,
    )
  }

  /** Supprime un conteneur éphémère, ses ports et la copie de ses services. */
  private async removeEphemeral(started: Pick<StartedEphemeral, 'label' | 'composeCopy'> & Partial<StartedEphemeral>): Promise<void> {
    await started.ports?.close()
    await this.tools.removeLabelled(`${EPHEMERAL_LABEL}=${started.label}`)
    if (started.composeCopy) await this.tools.removeLabelled(`com.docker.compose.project=${started.composeCopy}`)
  }

  /**
   * Les conteneurs éphémères et les copies de services qu'un serveur mort a laissés : le
   * pid dans leurs labels les attribue, ceux d'un serveur vivant ne sont pas touchés.
   */
  private async sweepEphemeral(): Promise<void> {
    const instance = this.instance
    const dead = (pid: number) => pid > 0 && pid !== process.pid && !alive(pid)
    const pids = new Set((await this.tools.labelled(`${INSTANCE_LABEL}=${instance}`, PID_LABEL)).map((entry) => Number(entry.value)))
    for (const pid of pids) {
      if (dead(pid)) await this.tools.removeLabelled(`${INSTANCE_LABEL}=${instance}`, `${PID_LABEL}=${pid}`)
    }
    const copies = new Set(
      (await this.tools.labelled('com.docker.compose.project', 'com.docker.compose.project')).map((entry) => entry.value),
    )
    for (const name of copies) {
      if (dead(Number(new RegExp(`^solera-${instance}-(\\d+)-`).exec(name)?.[1]))) {
        await this.tools.removeLabelled(`com.docker.compose.project=${name}`)
      }
    }
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

/** Les labels des conteneurs éphémères : le leur, l'instance de Solera, et le serveur qui les a créés. */
const EPHEMERAL_LABEL = 'solera.ephemeral'
const INSTANCE_LABEL = 'solera.instance'
const PID_LABEL = 'solera.pid'

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Les fichiers docker-compose d'une configuration, en chemins absolus. */
export function composeFilesOf(configuration: unknown, configPath: string): string[] {
  const value = (configuration as { dockerComposeFile?: unknown } | null)?.dockerComposeFile
  const files = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((file) => typeof file === 'string') : []
  return files.map((file) => (isAbsolute(file) ? file : resolve(dirname(configPath), file)))
}

/** Ce qu'on garde du journal d'un démarrage : la construction d'une image en écrit beaucoup. */
const JOURNAL_LINES = 400
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

/** Les `devcontainer.json` gardés par Solera, un dossier par projet. */
export function managedDevcontainers(paths: Pick<Paths, 'data'>): ManagedDevcontainers {
  return new ManagedDevcontainers(join(paths.data, 'devcontainers'))
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
