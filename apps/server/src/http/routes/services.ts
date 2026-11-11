import { conversations, projects } from '@solera/db'
import type {
  ServiceAppAction,
  ServiceAppDto,
  ServiceDto,
  ServiceEnvironmentAction,
  ServiceEnvironmentDto,
  ServiceEnvironmentLogDto,
  ServicesDto,
} from '@solera/protocol'
import { eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import type { SessionManager } from '../../sessions/session-manager.js'
import type { TerminalManager } from '../../terminals/terminal-manager.js'
import { controlServiceApp, scanServiceApps, type ServiceApp } from '../../services/apps.js'
import { EnvironmentInventory, sandboxUsage, type ScannedEnvironment } from '../../services/environments.js'
import { readProcessHost } from '../../services/ownership.js'
import { processOrigins } from '../../services/origins.js'
import { serviceProcessScanner, stopServiceProcess, type ServiceProcess } from '../../services/processes.js'
import { readSystemLoad } from '../../services/system.js'
import type { AppContext } from '../context.js'
import { HttpError } from '../errors.js'
import { requireUser } from '../require-user.js'

export function registerServiceRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  sessions: SessionManager,
  terminals: TerminalManager,
): void {
  const origins = processOrigins(ctx.config.paths.data)
  const devcontainers = sessions.environments.devcontainers
  const inventory = new EnvironmentInventory({
    sessions,
    terminals,
    devcontainers,
    projects: () => ctx.db.select({ id: projects.id, workspacePath: projects.workspacePath }).from(projects).all(),
    projectOf: (conversationId) =>
      ctx.db.select({ projectId: conversations.projectId }).from(conversations).where(eq(conversations.id, conversationId)).get()
        ?.projectId ?? null,
  })
  const scanner = serviceProcessScanner(origins)
  /**
   * Le temps CPU de chaque entrée au scan précédent : la charge d'un service est l'écart
   * entre deux scans, rapporté au temps écoulé. Une entrée disparue sort au scan suivant.
   */
  let cpuBefore = new Map<string, { seconds: number; at: number }>()
  let cpuNow = new Map<string, number | null>()
  let measured = 0
  const measure = (entries: { id: string; cpuSeconds: number | null }[], at: number) => {
    const next = new Map<string, { seconds: number; at: number }>()
    cpuNow = new Map()
    for (const entry of entries) {
      if (entry.cpuSeconds === null) continue
      const before = cpuBefore.get(entry.id)
      const elapsed = before ? (at - before.at) / 1000 : 0
      cpuNow.set(entry.id, before && elapsed > 0 ? Math.max(0, (entry.cpuSeconds - before.seconds) / elapsed) : null)
      next.set(entry.id, { seconds: entry.cpuSeconds, at })
    }
    cpuBefore = next
  }
  const scan = (fresh = false): Promise<ServiceProcess[]> => scanner.scan(fresh)

  /**
   * Le projet et la conversation d'une origine, ou null si l'utilisateur ne doit pas
   * voir l'entrée : un projet privé d'un autre, ou une origine inconnue hors admin.
   */
  const attribution = (userId: string, isAdmin: boolean) => {
    const allProjects = ctx.db.select().from(projects).all()
    const allConversations = new Map(ctx.db.select({
      id: conversations.id, projectId: conversations.projectId, title: conversations.title, userId: conversations.userId,
    }).from(conversations).all().map((row) => [row.id, row]))
    return (origin: ServiceProcess['origin']) => {
      const conversation = origin?.conversationId ? allConversations.get(origin.conversationId) : undefined
      const project = allProjects.find((candidate) => candidate.id === origin?.projectId)
      // Une conversation sans projet appartient à qui l'a ouverte : ce qu'elle lance est
      // à lui, et n'est pas une origine inconnue réservée à l'admin.
      const free = !project && conversation?.projectId === null && conversation.userId === userId
      if (!free && (project ? project.ownerId !== userId && project.visibility !== 'shared' : !isAdmin)) return null
      const linked = conversation && conversation.projectId === (project?.id ?? null) ? conversation : null
      return { project: project ?? null, conversation: linked ?? null }
    }
  }

  const visible = (processes: ServiceProcess[], userId: string, isAdmin: boolean): ServiceDto[] => {
    const attribute = attribution(userId, isAdmin)
    return processes.flatMap((entry): ServiceDto[] => {
      const seen = attribute(entry.origin)
      if (!seen) return []
      const { project, conversation: linked } = seen
      return [{
        id: entry.id, kind: entry.kind, pid: entry.pid, name: entry.name, command: entry.command,
        parentPid: entry.parentPid, parentName: entry.parentName, launcherPid: entry.launcherPid,
        stopsWithSolera: entry.stopsWithSolera, cwd: entry.cwd, ports: entry.ports,
        startedAt: entry.startedAt, memoryBytes: entry.memoryBytes, cpu: cpuNow.get(entry.id) ?? null,
        processCount: entry.processCount, processes: entry.processes,
        projectId: project?.id ?? null, projectName: project?.name ?? null,
        conversationId: linked?.id ?? null, conversationTitle: linked?.title ?? null,
        origin: entry.origin ? entry.origin.conversationId ? 'agent' : 'terminal' : 'unknown',
        // Un lanceur se pilote depuis sa conversation ou son terminal ; un outil d'agent
        // (serveur MCP) arrêté ici casserait la conversation sans rien libérer d'utile.
        canStop: !!entry.origin && (!!project || linked?.userId === userId) && (entry.kind === 'command' || entry.kind === 'detached'),
      }]
    })
  }

  /**
   * Les apps suivent la visibilité des processus. Une seule différence : sans origine
   * connue, l'admin peut aussi les piloter. Le préfixe `solera-app-` est en soi une
   * déclaration (« Solera peut l'arrêter »), et l'admin a de toute façon la main sur
   * les unités de la machine ; un agent qui a oublié de transmettre son jeton ne doit
   * pas laisser une app impossible à arrêter depuis l'interface.
   */
  const visibleApps = (apps: ServiceApp[], userId: string, isAdmin: boolean): ServiceAppDto[] => {
    const attribute = attribution(userId, isAdmin)
    return apps.flatMap((entry): ServiceAppDto[] => {
      const seen = attribute(entry.origin)
      if (!seen) return []
      const { project, conversation } = seen
      const manageable = !!project || conversation?.userId === userId || isAdmin
      const running = ['active', 'activating', 'reloading'].includes(entry.state)
      return [{
        id: entry.id, unit: entry.unit, description: entry.description, executable: entry.executable, command: entry.command,
        state: entry.state, subState: entry.subState, result: entry.result, mainPid: entry.mainPid,
        ports: entry.ports, cwd: entry.cwd, startedAt: entry.startedAt, memoryBytes: entry.memoryBytes,
        cpu: cpuNow.get(entry.id) ?? null,
        enabled: entry.enabled, transient: entry.transient,
        projectId: project?.id ?? null, projectName: project?.name ?? null,
        conversationId: conversation?.id ?? null, conversationTitle: conversation?.title ?? null,
        origin: entry.origin ? entry.origin.conversationId ? 'agent' : 'terminal' : 'unknown',
        canStop: manageable && running,
        // Une unité transitoire arrêtée est déchargée par systemd : elle ne revient
        // jamais dans la liste inactive, seule une unité en échec reste relançable.
        canRestart: manageable && entry.state !== 'deactivating',
        canReset: manageable && entry.state === 'failed',
      }]
    })
  }

  /**
   * Les environnements suivent la visibilité de leur projet, ou, sans projet, de la
   * session qu'ils font tourner. Un bac à sable se mesure dans le scan des processus :
   * ses processus sont des enfants de Solera.
   */
  const visibleEnvironments = (
    entries: ScannedEnvironment[],
    processes: ServiceProcess[],
    userId: string,
    isAdmin: boolean,
  ): ServiceEnvironmentDto[] => {
    const attribute = attribution(userId, isAdmin)
    const ids = [...new Set(entries.flatMap((entry) => entry.conversationIds))]
    const titles = new Map(
      ids.length
        ? ctx.db.select({ id: conversations.id, title: conversations.title }).from(conversations)
          .where(inArray(conversations.id, ids)).all().map((row) => [row.id, row.title])
        : [],
    )
    return entries.flatMap((entry): ServiceEnvironmentDto[] => {
      const owner = entry.owner && 'conversationId' in entry.owner ? entry.owner.conversationId : null
      const seen = attribute({ projectId: entry.projectId, conversationId: owner })
      if (!seen) return []
      const manageable = !!seen.project || seen.conversation?.userId === userId
      // Un conteneur de session confinée se mesure par Docker, pas par ses processus.
      const usage = entry.kind === 'sandbox' && entry.engine !== 'docker' ? sandboxUsage(entry.pids, processes, (id) => cpuNow.get(id) ?? null) : null
      const devcontainer = entry.kind === 'devcontainer'
      return [{
        id: entry.id, kind: entry.kind, engine: entry.engine, name: entry.name, state: entry.state, error: entry.error,
        projectId: seen.project?.id ?? null, projectName: seen.project?.name ?? null,
        sessions: entry.conversationIds.map((conversationId) => ({ conversationId, title: titles.get(conversationId) ?? null })),
        terminals: entry.terminals, vscodeAttached: entry.vscodeAttached,
        cpu: usage?.cpu ?? entry.cpu, memoryBytes: usage?.memoryBytes ?? entry.memoryBytes,
        diskBytes: entry.diskBytes, imageBytes: entry.imageBytes,
        ports: usage?.ports ?? entry.ports, forwardedPorts: entry.forwardedPorts, startedAt: usage?.startedAt ?? entry.startedAt,
        companions: entry.companions,
        canStop: manageable && (entry.state === 'running' || (entry.state === 'starting' && entry.containerIds.length > 0)),
        canRestart: manageable && devcontainer && entry.containerIds.length > 0 && entry.state !== 'starting',
        canRebuild: manageable && devcontainer && entry.state !== 'starting' && !!entry.projectId
          && sessions.environments.hasDevcontainer(entry.projectId),
        hasLog: devcontainer,
      }]
    })
  }

  app.get('/api/services', async (request): Promise<ServicesDto> => {
    const user = requireUser(request)
    if (process.platform !== 'linux') {
      return { supported: false, scannedAt: Date.now(), services: [], apps: [], environments: [], system: null }
    }
    const [processes, apps, system, environments] = await Promise.all([
      scan(), scanServiceApps(origins), readSystemLoad().catch(() => null), inventory.scan(),
    ])
    // Une mesure par scan et non par requête : deux onglets ouverts ne doivent pas
    // ramener l'intervalle à quelques millisecondes.
    const scannedAt = scanner.scannedAt ?? Date.now()
    if (measured !== scannedAt) {
      measure([...processes, ...apps], scannedAt)
      measured = scannedAt
    }
    return {
      supported: true, scannedAt, system,
      services: visible(processes, user.id, user.isAdmin),
      apps: visibleApps(apps, user.id, user.isAdmin),
      environments: visibleEnvironments(environments, processes, user.id, user.isAdmin),
    }
  })

  /**
   * `fresh` pour une action, qui doit viser l'état du moment. Le journal, relu toutes les
   * deux secondes pendant un démarrage, se contente du dernier scan.
   */
  const findEnvironment = async (request: Parameters<typeof requireUser>[0], id: string, fresh: boolean) => {
    const user = requireUser(request)
    if (process.platform !== 'linux') throw new HttpError(409, 'services_unsupported', 'Service discovery requires Linux.')
    const [entries, processes] = await Promise.all([inventory.scan(fresh), scan()])
    const visible = visibleEnvironments(entries, processes, user.id, user.isAdmin).find((entry) => entry.id === id)
    const scanned = entries.find((entry) => entry.id === id)
    if (!visible || !scanned) throw new HttpError(404, 'service_gone', 'This environment is no longer running. Refresh the list.')
    return { visible, scanned }
  }

  /**
   * Arrête ce qui tourne dans l'environnement avant d'y toucher : une session dont le
   * conteneur disparaît sous elle finirait en erreur, alors qu'arrêtée elle repart à son
   * prochain message. L'onglet d'un terminal reste, avec son dernier écran.
   */
  const stopUsers = async (entry: ScannedEnvironment) => {
    await Promise.all(entry.conversationIds.map((conversationId) => sessions.terminate(conversationId)))
    for (const terminal of entry.terminals) terminals.kill(terminal.id)
  }

  app.post('/api/services/environments/:id/:action', async (request, reply) => {
    const { id, action } = request.params as { id: string; action: string }
    if (!['stop', 'restart', 'rebuild'].includes(action)) throw new HttpError(404, 'not_found', 'Unknown action.')
    const { visible, scanned } = await findEnvironment(request, id, true)
    const allowed = action === 'stop' ? visible.canStop : action === 'restart' ? visible.canRestart : visible.canRebuild
    if (!allowed) throw new HttpError(409, 'service_environment_refused', 'This action is not available for this environment.')
    // Ce qui ferait échouer l'action se vérifie avant d'arrêter les sessions : elles ne
    // doivent pas tomber pour un environnement qu'on ne peut finalement pas toucher.
    if (scanned.kind === 'devcontainer') {
      const refusal = action === 'rebuild'
        ? devcontainers?.status(scanned.projectId!).starting ? 'This dev container is already starting.' : null
        : inventory.dockerAvailable() ? null : 'Docker is not on the PATH of the Solera server.'
      if (refusal) throw new HttpError(409, 'service_environment_failed', refusal, { message: refusal })
    }
    await stopUsers(scanned)
    try {
      await controlEnvironment(scanned, action as ServiceEnvironmentAction)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new HttpError(409, 'service_environment_failed', message, { message })
    }
    inventory.invalidate()
    scanner.invalidate()
    return reply.status(202).send({ accepted: true })
  })

  const controlEnvironment = async (entry: ScannedEnvironment, action: ServiceEnvironmentAction) => {
    // Un bac à sable est celui de sa session ou de son terminal : les arrêter l'a arrêté.
    if (entry.kind === 'sandbox') return
    const projectId = entry.projectId!
    if (action === 'rebuild') {
      const workspacePath = ctx.db.select({ workspacePath: projects.workspacePath }).from(projects)
        .where(eq(projects.id, projectId)).get()?.workspacePath
      if (!devcontainers || !workspacePath) throw new Error('This project has no dev container to rebuild.')
      // Long : la reconstruction se suit dans la liste (« démarrage ») et dans son journal.
      void devcontainers.rebuild({ id: projectId, workspacePath }).catch(() => undefined)
      return
    }
    await inventory.control(entry.containerIds, action)
    // La prochaine session repasse par `devcontainer up`, qui le relance et relit son environnement.
    devcontainers?.forget(projectId)
  }

  app.get('/api/services/environments/:id/log', async (request): Promise<ServiceEnvironmentLogDto> => {
    const { id } = request.params as { id: string }
    const { visible, scanned } = await findEnvironment(request, id, false)
    if (!visible.hasLog || !scanned.projectId) throw new HttpError(404, 'not_found', 'This environment has no log.')
    return {
      startup: devcontainers?.startupLog(scanned.projectId) ?? [],
      output: scanned.containerIds[0] ? await inventory.output(scanned.containerIds[0]) : '',
    }
  })

  app.post('/api/services/:id/stop', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    if (process.platform !== 'linux') throw new HttpError(409, 'services_unsupported', 'Service discovery requires Linux.')
    const processes = await scan(true)
    const service = visible(processes, user.id, user.isAdmin).find((entry) => entry.id === id)
    if (!service) throw new HttpError(404, 'service_gone', 'This service is no longer available.')
    if (!service.canStop) throw new HttpError(409, 'service_untracked', 'The origin of this service is unknown.')
    if (!stopServiceProcess(processes.find((entry) => entry.id === id)!, origins, await readProcessHost())) {
      throw new HttpError(409, 'service_changed', 'The service has changed or could not be stopped. Refresh the list.')
    }
    scanner.invalidate()
    return reply.status(202).send({ stopping: true })
  })

  app.post('/api/services/apps/:id/:action', async (request, reply) => {
    const user = requireUser(request)
    const { id, action } = request.params as { id: string; action: string }
    if (!['stop', 'restart', 'reset'].includes(action)) throw new HttpError(404, 'not_found', 'Unknown action.')
    if (process.platform !== 'linux') throw new HttpError(409, 'services_unsupported', 'Service discovery requires Linux.')
    const app = visibleApps(await scanServiceApps(origins), user.id, user.isAdmin).find((entry) => entry.id === id)
    if (!app) throw new HttpError(404, 'service_gone', 'This app is no longer available. Refresh the list.')
    const allowed = action === 'stop' ? app.canStop : action === 'restart' ? app.canRestart : app.canReset
    if (!allowed) throw new HttpError(409, 'service_app_refused', 'This action is not available for this app.')
    try {
      await controlServiceApp(app.unit, action as ServiceAppAction)
    } catch (err) {
      throw new HttpError(409, 'service_app_failed', `systemd refused: ${err instanceof Error ? err.message : String(err)}`)
    }
    return reply.status(202).send({ accepted: true })
  })
}
