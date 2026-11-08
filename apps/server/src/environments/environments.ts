import { eq } from 'drizzle-orm'
import { conversations, projects, type Db } from '@solera/db'
import {
  environmentKey,
  HOST_CONFINED_ENVIRONMENT,
  HOST_ENVIRONMENT,
  sameEnvironment,
  type EnvironmentWhere,
  type ExecutionEnvironment,
} from '@solera/protocol'
import type { Unavailable } from './confined/backend.js'
import { ConfinedEnvironment } from './confined/confined.js'
import { hasNativeConfinement, nativeConfinement } from './confined/native.js'
import type { ConfinementScope } from './confined/plan.js'
import { terminalScope } from './confined/scope.js'
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
 * L'hôte, et l'hôte confiné là où la plateforme a un confinement natif (#144). Le dev
 * container (#140) et le conteneur confiné (#145) y ajouteront leur fournisseur ; les
 * appelants, eux, ne changeront pas.
 */
export class Environments {
  constructor(private readonly db: Db) {}

  /**
   * Ce qu'on peut choisir, pour ce projet, sur ce serveur. L'hôte confiné est proposé
   * sur toute plateforme qui en a un, même si l'essai échoue : c'est au choix que le
   * refus dit pourquoi et quoi lancer, plutôt qu'une option qui disparaît sans raison.
   */
  choices(_projectId: string | null): ExecutionEnvironment[] {
    return hasNativeConfinement() ? [HOST_ENVIRONMENT, HOST_CONFINED_ENVIRONMENT] : [HOST_ENVIRONMENT]
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
    if (environment.confined) {
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
  provider(environment: ExecutionEnvironment, scope?: ConfinementScope): EnvironmentProvider {
    if (sameEnvironment(environment, HOST_ENVIRONMENT)) return hostEnvironment
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
   * gestionnaire de terminaux ferme son fournisseur quand il se termine.
   */
  forTerminal(projectId: string, conversationId: string | null, cwd: string): EnvironmentProvider {
    const environment = conversationId ? this.ofConversation(conversationId) : this.ofProject(projectId)
    return this.provider(environment, environment.confined ? terminalScope(cwd) : undefined)
  }
}

/** Le refus d'une session confinée : pourquoi, et la commande qui y remédie. */
function refuseConfinement(unavailable: Unavailable): never {
  throw new EnvironmentUnavailableError(
    HOST_CONFINED_ENVIRONMENT,
    `This server cannot confine a session: ${unavailable.code}${unavailable.detail ? ` (${unavailable.detail})` : ''}.`,
    { code: unavailable.code, params: { fix: unavailable.fix ?? '', detail: unavailable.detail ?? '' } },
  )
}
