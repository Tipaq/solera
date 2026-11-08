import { eq } from 'drizzle-orm'
import { conversations, projects, type Db } from '@solera/db'
import {
  DEVCONTAINER_CONFINED_ENVIRONMENT,
  DEVCONTAINER_ENVIRONMENT,
  environmentKey,
  HOST_CONFINED_ENVIRONMENT,
  HOST_ENVIRONMENT,
  sameEnvironment,
  type ConfinedServices,
  type EnvironmentWhere,
  type ExecutionEnvironment,
} from '@solera/protocol'
import type { Unavailable } from './confined/backend.js'
import { ConfinedEnvironment } from './confined/confined.js'
import { hasNativeConfinement, nativeConfinement } from './confined/native.js'
import type { ConfinementScope } from './confined/plan.js'
import { terminalScope } from './confined/scope.js'
import type { ContainerNeed, Devcontainers } from './devcontainer/containers.js'
import { ContainerRefusal } from './devcontainer/refusal.js'
import { hostEnvironment } from './host.js'
import { EnvironmentUnavailableError, type EnvironmentProvider } from './provider.js'

/** Les deux colonnes d'une ligne de `projects` ou de `conversations`. */
export interface EnvironmentColumns {
  environmentWhere: EnvironmentWhere
  environmentConfined: boolean
}

export function environmentOf(row: EnvironmentColumns): ExecutionEnvironment {
  return { where: row.environmentWhere, confined: row.environmentConfined }
}

export function environmentColumns(environment: ExecutionEnvironment): EnvironmentColumns {
  return { environmentWhere: environment.where, environmentConfined: environment.confined }
}

/**
 * Qui lance quoi, et où : l'environnement d'un projet ou d'une session, et le
 * fournisseur qui sait y lancer un processus.
 *
 * L'hôte, et l'hôte confiné là où la plateforme a un confinement natif (#144) ; le dev
 * container du projet (#140), et pour une session confinée un conteneur à elle sur son
 * image (#145).
 */
export class Environments {
  constructor(
    private readonly db: Db,
    /** Absent (tests, serveur sans dossier de données) : pas de dev container. */
    readonly devcontainers: Devcontainers | null = null,
  ) {}

  /**
   * Ce qu'on peut choisir, pour ce projet, sur ce serveur. L'hôte confiné est proposé
   * sur toute plateforme qui en a un, même si l'essai échoue : c'est au choix que le
   * refus dit pourquoi et quoi lancer, plutôt qu'une option qui disparaît sans raison.
   * Le dev container, confiné ou non, l'est pour un projet qui a un `devcontainer.json`,
   * le sien ou celui que Solera garde pour lui, même si Docker manque : son démarrage
   * dira quoi installer.
   */
  choices(projectId: string | null): ExecutionEnvironment[] {
    const host = hasNativeConfinement() ? [HOST_ENVIRONMENT, HOST_CONFINED_ENVIRONMENT] : [HOST_ENVIRONMENT]
    return this.hasDevcontainer(projectId) ? [...host, DEVCONTAINER_ENVIRONMENT, DEVCONTAINER_CONFINED_ENVIRONMENT] : host
  }

  /** Le projet a-t-il un `devcontainer.json` que ce serveur saurait démarrer ? */
  hasDevcontainer(projectId: string | null): boolean {
    const workspacePath = projectId === null ? null : this.workspaceOf(projectId)
    if (projectId === null || workspacePath === null) return false
    return this.devcontainers?.available({ id: projectId, workspacePath }) ?? false
  }

  /**
   * Ce qu'un environnement doit avoir fait avant qu'on y lance quoi que ce soit : le
   * dev container démarre (journal de `up` par `need.onLog`) et reçoit le CLI de
   * l'agent. Confiné, c'est son image qu'on prend : le conteneur de la session démarre
   * ensuite, à l'`open` de son fournisseur. Sans effet pour l'hôte. Lève, avec la
   * raison, quand il ne peut pas servir.
   */
  async prepare(environment: ExecutionEnvironment, projectId: string | null, need: ContainerNeed): Promise<void> {
    if (environment.where !== 'devcontainer') return
    const workspacePath = projectId === null ? null : this.workspaceOf(projectId)
    if (!this.devcontainers || projectId === null || workspacePath === null) {
      throw new EnvironmentUnavailableError(environment, 'Only a project session can run in a dev container.')
    }
    try {
      await this.devcontainers.prepare({ id: projectId, workspacePath }, need, environment.confined)
    } catch (err) {
      throw unavailable(environment, err)
    }
  }

  /**
   * Refuse un environnement que ce serveur ne sait pas lancer, avant qu'on l'enregistre :
   * une session ne retombe jamais en silence sur un autre.
   */
  assertAvailable(projectId: string | null, environment: ExecutionEnvironment): void {
    if (!this.choices(projectId).some((choice) => sameEnvironment(choice, environment))) {
      if (sameEnvironment(environment, HOST_CONFINED_ENVIRONMENT)) refuseConfinement({ code: 'confinement_platform' })
      throw new EnvironmentUnavailableError(
        environment,
        `The ${environmentKey(environment)} environment is not available on this server yet.`,
      )
    }
    if (sameEnvironment(environment, HOST_CONFINED_ENVIRONMENT)) {
      const native = nativeConfinement()
      if ('unavailable' in native) refuseConfinement(native.unavailable)
    }
  }

  /**
   * Le fournisseur d'un environnement. Lève si ce serveur ne sait pas y lancer.
   *
   * Un environnement confiné demande sa portée (`scope`) : ce que la session ou le
   * terminal doit voir de l'hôte. Son fournisseur est à lui seul, et le propriétaire le
   * ferme à sa fin : c'est ce qui tue ses processus et efface son home privé.
   */
  provider(environment: ExecutionEnvironment, scope?: ConfinementScope, projectId?: string | null): EnvironmentProvider {
    if (sameEnvironment(environment, HOST_ENVIRONMENT)) return hostEnvironment
    // Préparé d'abord par `prepare`, qui l'a démarré : ici, on ne fait que le désigner.
    if (sameEnvironment(environment, DEVCONTAINER_ENVIRONMENT) && this.devcontainers && projectId) {
      return this.devcontainers.provider(projectId)
    }
    if (sameEnvironment(environment, DEVCONTAINER_CONFINED_ENVIRONMENT) && this.devcontainers && projectId && scope) {
      return this.devcontainers.ephemeral(projectId, scope, this.confinedServicesOf(projectId))
    }
    if (sameEnvironment(environment, HOST_CONFINED_ENVIRONMENT) && scope) {
      const native = nativeConfinement()
      if ('unavailable' in native) refuseConfinement(native.unavailable)
      return new ConfinedEnvironment(native.backend, scope)
    }
    throw new EnvironmentUnavailableError(
      environment,
      `This session runs in the ${environmentKey(environment)} environment, which this server cannot start yet.`,
    )
  }

  /** L'environnement par défaut d'un projet ; l'hôte pour un projet disparu. */
  ofProject(projectId: string): ExecutionEnvironment {
    const row = this.db
      .select({ environmentWhere: projects.environmentWhere, environmentConfined: projects.environmentConfined })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()
    return row ? environmentOf(row) : HOST_ENVIRONMENT
  }

  /** L'environnement figé d'une session ; l'hôte pour une session disparue. */
  ofConversation(conversationId: string): ExecutionEnvironment {
    const row = this.db
      .select({
        environmentWhere: conversations.environmentWhere,
        environmentConfined: conversations.environmentConfined,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get()
    return row ? environmentOf(row) : HOST_ENVIRONMENT
  }

  /**
   * Où ouvrir un terminal : dans l'environnement de la session qui l'ouvre, et hors
   * session dans celui du projet. Confiné, il n'écrit que dans son dossier, et le
   * gestionnaire de terminaux ferme son fournisseur quand il se termine. Dans un dev
   * container confiné, il a son propre conteneur, démarré ici.
   */
  async forTerminal(projectId: string, conversationId: string | null, cwd: string): Promise<EnvironmentProvider> {
    const environment = this.terminalEnvironment(projectId, conversationId)
    const provider = this.provider(environment, environment.confined ? terminalScope(cwd) : undefined, projectId)
    try {
      await provider.open?.()
    } catch (err) {
      await provider.close().catch(() => undefined)
      throw unavailable(environment, err)
    }
    return provider
  }

  /**
   * Démarre le fournisseur d'une session, s'il a quelque chose à démarrer : un refus de
   * son conteneur remonte avec son code, comme celui de `prepare`.
   */
  async open(provider: EnvironmentProvider, onLog?: (line: string) => void): Promise<void> {
    try {
      await provider.open?.(onLog)
    } catch (err) {
      throw unavailable(provider.environment, err)
    }
  }

  /** Les services docker-compose que voit le conteneur d'une session confinée du projet. */
  private confinedServicesOf(projectId: string): ConfinedServices {
    return (
      this.db.select({ confinedServices: projects.confinedServices }).from(projects).where(eq(projects.id, projectId)).get()
        ?.confinedServices ?? 'shared'
    )
  }

  /** L'environnement d'un terminal, à préparer avant `forTerminal`. */
  terminalEnvironment(projectId: string, conversationId: string | null): ExecutionEnvironment {
    return conversationId ? this.ofConversation(conversationId) : this.ofProject(projectId)
  }

  private workspaceOf(projectId: string): string | null {
    return (
      this.db.select({ workspacePath: projects.workspacePath }).from(projects).where(eq(projects.id, projectId)).get()
        ?.workspacePath ?? null
    )
  }
}

/** Le refus d'un conteneur, dit avec son code ; une autre erreur passe telle quelle. */
function unavailable(environment: ExecutionEnvironment, err: unknown): unknown {
  if (!(err instanceof ContainerRefusal)) return err
  return new EnvironmentUnavailableError(environment, err.message, { code: err.code, params: { detail: err.message } })
}

/** Le refus d'une session confinée : pourquoi, et la commande qui y remédie. */
function refuseConfinement(unavailable: Unavailable): never {
  throw new EnvironmentUnavailableError(
    HOST_CONFINED_ENVIRONMENT,
    `This server cannot confine a session: ${unavailable.code}${unavailable.detail ? ` (${unavailable.detail})` : ''}.`,
    { code: unavailable.code, params: { fix: unavailable.fix ?? '', detail: unavailable.detail ?? '' } },
  )
}
