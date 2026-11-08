import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { basename, posix } from 'node:path'
import type { IPty } from 'node-pty'
import { DEVCONTAINER_CONFINED_ENVIRONMENT, type ConfinedServices, type ExecutionEnvironment, type ForwardedPortDto } from '@solera/protocol'
import { removeEmptyFile } from '../confined/confined.js'
import { isWithin } from '../confined/paths.js'
import { confinementPlan, type ConfinementPlan, type ConfinementScope } from '../confined/plan.js'
import type { EnvironmentProvider, ExecRequest, ExecResult, PtyRequest, SpawnRequest } from '../provider.js'
import { ContainerRefusal } from './refusal.js'
import { DevcontainerEnvironment, type RunningContainer } from './environment.js'
import { containerPathOf, hostPathOf } from './paths.js'

/** Ce qu'il faut pour créer le conteneur d'une session confinée. */
export interface EphemeralSpec {
  projectId: string
  /** Ce que la session ou le terminal voit de l'hôte : ses seuls dossiers. */
  plan: ConfinementPlan
  /** Le dossier de travail, à son chemin de l'hôte : le `workspaceFolder` du conteneur. */
  cwd: string
  services: ConfinedServices
}

/** Un conteneur éphémère démarré, et ce qui en dépend. */
export interface StartedEphemeral {
  /** Le label qui le désigne, lui et ses volumes anonymes. */
  label: string
  container: RunningContainer
  /** Le projet docker-compose de la copie de ses services ; null s'il partage ceux du projet. */
  composeCopy: string | null
  ports: { list(): ForwardedPortDto[]; close(): Promise<void> } | null
}

/** Qui sait démarrer et supprimer un conteneur éphémère : les dev containers du serveur. */
export interface EphemeralLauncher {
  docker(): string
  start(spec: EphemeralSpec, onLog: (line: string) => void): Promise<StartedEphemeral>
  remove(started: StartedEphemeral): Promise<void>
}

/**
 * Le conteneur d'une session confinée dans un dev container (ADR 0001, #145) : à elle
 * seule, éphémère, sur l'image du dev container du projet, sans reconstruction.
 *
 * Son seul worktree y est monté, avec git en liste blanche comme sous bwrap (#144) ;
 * son home et son tmp sont ceux du conteneur, donc privés ; il ne reçoit que les
 * identifiants de la session. `close` le supprime, avec la copie de ses services
 * docker-compose s'il en a une.
 *
 * Une instance par propriétaire, comme le bac à sable natif : le runner d'une session,
 * un terminal. `open` le démarre ; rien ne s'y lance avant.
 */
export class EphemeralContainer implements EnvironmentProvider {
  readonly environment: ExecutionEnvironment = DEVCONTAINER_CONFINED_ENVIRONMENT
  private started: StartedEphemeral | null = null
  private inner: DevcontainerEnvironment | null = null
  private opening: Promise<void> | null = null
  private closed = false

  constructor(
    private readonly launcher: EphemeralLauncher,
    private readonly spec: EphemeralSpec,
  ) {}

  open(onLog: (line: string) => void = () => undefined): Promise<void> {
    this.opening ??= this.launcher.start(this.spec, onLog).then(async (started) => {
      // Fermé pendant son démarrage : il ne doit pas survivre à son propriétaire.
      if (this.closed) {
        await this.launcher.remove(started).catch(() => undefined)
        throw new Error('This confined container was closed while it started.')
      }
      this.started = started
      this.inner = new DevcontainerEnvironment(started.container, this.launcher.docker())
    })
    return this.opening
  }

  spawn(request: SpawnRequest): ChildProcessWithoutNullStreams {
    return this.ready().spawn(request)
  }

  spawnPty(request: PtyRequest): IPty {
    return this.ready().spawnPty(request)
  }

  exec(request: ExecRequest): Promise<ExecResult> {
    return this.ready().exec(request)
  }

  resolveBinary(binary: string): string | null {
    return this.inner?.resolveBinary(binary) ?? null
  }

  /** Ses dossiers sont montés au chemin que `containerPathOf` leur donne (#151). */
  pathInside(hostPath: string): string {
    return containerPathOf(hostPath) ?? hostPath
  }

  pathOutside(insidePath: string): string {
    return hostPathOf(insidePath) ?? insidePath
  }

  urlOfHost(url: string): string {
    return this.ready().urlOfHost(url)
  }

  urlFromHost(url: string): Promise<{ url: string; close(): void }> {
    return this.ready().urlFromHost(url)
  }

  copyIn(hostPath: string, insidePath: string): Promise<void> {
    return this.ready().copyIn(hostPath, insidePath)
  }

  copyOut(insidePath: string, hostPath: string): Promise<void> {
    return this.ready().copyOut(insidePath, hostPath)
  }

  /**
   * Les pièces jointes d'un message, copiées dans le tmp du conteneur : leur dossier
   * mêle tous les projets, il n'est pas monté (comme sous bwrap, #144).
   */
  async shareAttachments<T extends { id: string; filename: string; path: string; inlineImage: boolean }>(
    attachments: T[],
  ): Promise<T[]> {
    const inner = this.ready()
    return Promise.all(
      attachments.map(async (attachment) => {
        if (attachment.inlineImage) return attachment
        const dir = posix.join('/tmp/solera-attachments', attachment.id)
        await inner.exec({ command: 'mkdir', args: ['-p', dir], timeoutMs: 15_000 })
        const inside = posix.join(dir, basename(attachment.filename) || 'file')
        await inner.copyIn(attachment.path, inside)
        return { ...attachment, path: inside }
      }),
    )
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const started = this.started
    this.started = null
    this.inner = null
    if (started) await this.launcher.remove(started)
    for (const placeholder of this.spec.plan.placeholders) await removeEmptyFile(placeholder)
  }

  /** Le conteneur, puis ceux de la copie de ses services : Services y somme la consommation. */
  get containerId(): string | null {
    return this.started?.container.id ?? null
  }

  get composeCopy(): string | null {
    return this.started?.composeCopy ?? null
  }

  get projectId(): string {
    return this.spec.projectId
  }

  /** Ses ports, servis sur la boucle locale de l'hôte pour l'aperçu de sa session (#141). */
  forwardedPorts(): ForwardedPortDto[] {
    return this.started?.ports?.list() ?? []
  }

  private ready(): DevcontainerEnvironment {
    if (this.closed) throw new Error('This confined container is closed.')
    if (!this.inner) throw new Error('This confined container has not been started.')
    return this.inner
  }
}

/** Ce que le conteneur voit de l'hôte : la portée, dite en chemins réels, sans chaîne d'outils. */
export function ephemeralPlan(scope: ConfinementScope): ConfinementPlan {
  return confinementPlan({ scope, path: '', home: '/', coveredRoots: [], deniedRoots: [] })
}

/** Un montage tel que `docker run --mount` le lit. */
export function bindMount(source: string, target: string, readonly = false): string {
  return `type=bind,source=${source},target=${target}${readonly ? ',readonly' : ''}`
}

/**
 * Les montages du conteneur, chacun au chemin que `containerPathOf` lui donne : le même
 * que sur l'hôte, `/mnt/c/…` sous Windows natif (#151). Le dossier de travail devient le
 * `workspaceMount` : la racine inscriptible qui le contient.
 */
export function ephemeralMounts(
  plan: ConfinementPlan,
  cwd: string,
  agents: { source: string; target: string },
  platform: NodeJS.Platform = process.platform,
): { workspaceMount: string; mounts: string[]; sources: string[] } {
  const workspace = plan.writable.find((root) => isWithin(cwd, root)) ?? cwd
  const at = (path: string) => {
    const target = containerPathOf(path, platform)
    if (target === null) {
      throw new ContainerRefusal('devcontainer_paths', `${path} is on a network share, which Solera cannot mount in a Linux container: move it to a local drive.`)
    }
    return target
  }
  const mounts = [
    ...plan.writable.filter((root) => root !== workspace).map((root) => bindMount(root, at(root))),
    ...plan.readable.map((path) => bindMount(path, at(path), true)),
    // Docker monte les plus profonds après leurs parents : ceux-ci passent en lecture
    // seule dans un dossier inscriptible.
    ...plan.protected.map((path) => bindMount(path, at(path), true)),
    bindMount(agents.source, agents.target, true),
  ]
  return {
    workspaceMount: bindMount(workspace, at(workspace)),
    mounts,
    sources: [workspace, ...plan.writable, ...plan.readable, ...plan.protected, agents.source],
  }
}

/**
 * Ce que le `devcontainer.json` du projet ne transmet pas au conteneur d'une session
 * confinée : ce qui construit (l'image l'est déjà, features comprises), ce qui monte ou
 * ouvre l'hôte (montages, `runArgs`, privilèges, ports publiés), ce qui s'exécute sur
 * l'hôte (`initializeCommand`), et ce que Solera pose lui-même.
 */
const DROPPED_KEYS = [
  'image',
  'build',
  'dockerFile',
  'context',
  'dockerComposeFile',
  'service',
  'runServices',
  'features',
  'overrideFeatureInstallOrder',
  'mounts',
  'workspaceMount',
  'workspaceFolder',
  'runArgs',
  'appPort',
  'initializeCommand',
  'privileged',
  'capAdd',
  'securityOpt',
  'shutdownAction',
  'overrideCommand',
  'updateRemoteUserUID',
  'configFilePath',
]

export interface EphemeralConfigInput {
  /** La configuration du projet, telle que `devcontainer read-configuration` la rend. */
  configuration: unknown
  /** L'image du conteneur du projet, celle qu'on réutilise sans la reconstruire. */
  image: string
  cwd: string
  workspaceMount: string
  mounts: string[]
  runArgs: string[]
  /** L'environnement du conteneur du projet : celui que docker-compose lui donne y est. */
  containerEnv: Record<string, string>
}

/**
 * Le `devcontainer.json` du conteneur d'une session confinée, passé à
 * `devcontainer up --override-config` : celui du projet (utilisateur, variables,
 * commandes de cycle de vie, ports), sur l'image déjà construite, avec les seuls
 * montages de la session.
 *
 * `updateRemoteUserUID` à faux : l'image du projet a déjà l'UID de l'hôte, et le CLI
 * laisserait sinon une image par worktree. `overrideCommand` à vrai : l'image d'un
 * service docker-compose peut avoir une commande qui sort aussitôt.
 */
export function ephemeralConfig(input: EphemeralConfigInput): Record<string, unknown> {
  const source = (input.configuration && typeof input.configuration === 'object' ? input.configuration : {}) as Record<
    string,
    unknown
  >
  const kept = Object.fromEntries(Object.entries(source).filter(([key]) => !DROPPED_KEYS.includes(key)))
  const ownEnv =
    source.containerEnv && typeof source.containerEnv === 'object' ? (source.containerEnv as Record<string, string>) : {}
  return {
    ...kept,
    image: input.image,
    workspaceFolder: input.cwd,
    workspaceMount: input.workspaceMount,
    mounts: input.mounts,
    runArgs: input.runArgs,
    containerEnv: { ...input.containerEnv, ...ownEnv },
    overrideCommand: true,
    updateRemoteUserUID: false,
  }
}

/** Un montage du conteneur, tel que `docker inspect` le décrit. */
export interface InspectedMount {
  Type?: string
  Source?: string
  Destination?: string
}

/**
 * Ce qui, dans le conteneur démarré, ouvrirait l'hôte : un dossier de l'hôte que la
 * session n'a pas à voir (un montage qu'une feature déclare dans les métadonnées de
 * l'image, le socket de Docker), ou le mode privilégié. Vide s'il est sain. Les volumes
 * nommés restent : ils ne montrent rien de l'hôte.
 */
export function unconfinedParts(inspected: { mounts: InspectedMount[]; privileged: boolean }, allowed: string[]): string[] {
  const issues = inspected.privileged ? ['privileged mode'] : []
  for (const mount of inspected.mounts) {
    if (mount.Type !== 'bind' || !mount.Source) continue
    if (allowed.includes(mount.Source)) continue
    issues.push(`${mount.Source} mounted at ${mount.Destination ?? '?'}`)
  }
  return issues
}

/**
 * Le réseau d'un conteneur docker-compose dans sa copie : `projet_default` devient
 * `copie_default`. Un réseau externe, qui ne porte pas le nom du projet, reste le même.
 */
export function copiedNetwork(network: string, project: string, copy: string): string {
  return network.startsWith(`${project}_`) ? `${copy}_${network.slice(project.length + 1)}` : network
}

/**
 * La configuration docker-compose d'une copie des services, depuis celle que
 * `docker compose config --format json` a résolue sous le nom de la copie (ses volumes
 * nommés y portent donc déjà ce nom) :
 *
 * - seulement les services copiés : ni celui du dev container, ni ceux que `runServices`
 *   écarte, et leurs `depends_on` vers ceux-là tombent ;
 * - ni `ports` ni `container_name` : le service du projet tient déjà les mêmes ;
 * - un dossier de l'hôte monté (`./data:/var/lib/postgresql/data`) devient un volume
 *   anonyme, vide : deux bases sur le même dossier se corrompraient ;
 * - ni `network_mode` (l'hôte, ou le conteneur d'un service absent), ni privilèges.
 */
export function copiedCompose(
  resolved: unknown,
  options: { exclude: string | null; only: string[] | null },
): { config: Record<string, unknown>; services: string[] } {
  const source = (resolved && typeof resolved === 'object' ? resolved : {}) as Record<string, unknown>
  const all = (source.services && typeof source.services === 'object' ? source.services : {}) as Record<
    string,
    Record<string, unknown>
  >
  const names = Object.keys(all).filter(
    (name) => name !== options.exclude && (options.only === null || options.only.includes(name)),
  )
  const services: Record<string, unknown> = {}
  for (const name of names) {
    const { ports: _ports, container_name: _name, network_mode: _mode, privileged: _privileged, ...service } = all[name]!
    if (Array.isArray(service.volumes)) {
      service.volumes = service.volumes.map((volume: unknown) => {
        const entry = volume as { type?: string; target?: string }
        return entry.type === 'bind' ? { type: 'volume', target: entry.target } : volume
      })
    }
    if (service.depends_on && typeof service.depends_on === 'object' && !Array.isArray(service.depends_on)) {
      service.depends_on = Object.fromEntries(
        Object.entries(service.depends_on as Record<string, unknown>).filter(([dependency]) => names.includes(dependency)),
      )
    }
    services[name] = service
  }
  const { services: _all, name: _project, ...rest } = source
  return { config: { ...rest, services }, services: names }
}
