import { eq } from 'drizzle-orm'
import { conversations, projects, type Db } from '@solera/db'
import {
  environmentKey,
  HOST_ENVIRONMENT,
  sameEnvironment,
  type EnvironmentWhere,
  type ExecutionEnvironment,
} from '@solera/protocol'
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
 * Seul l'hôte non confiné existe pour l'instant. Le dev container (#140) et le
 * confinement (#144, #145) y ajouteront leur fournisseur ; les appelants, eux, ne
 * changeront pas.
 */
export class Environments {
  constructor(private readonly db: Db) {}

  /** Ce qu'on peut choisir, pour ce projet, sur ce serveur. */
  choices(_projectId: string): ExecutionEnvironment[] {
    return [HOST_ENVIRONMENT]
  }

  /**
   * Refuse un environnement que ce serveur ne sait pas lancer, avant qu'on l'enregistre :
   * une session ne retombe jamais en silence sur un autre.
   */
  assertAvailable(projectId: string, environment: ExecutionEnvironment): void {
    if (this.choices(projectId).some((choice) => sameEnvironment(choice, environment))) return
    throw new EnvironmentUnavailableError(
      environment,
      `The ${environmentKey(environment)} environment is not available on this server yet.`,
    )
  }

  /** Le fournisseur d'un environnement. Lève si ce serveur ne sait pas y lancer. */
  provider(environment: ExecutionEnvironment): EnvironmentProvider {
    if (sameEnvironment(environment, HOST_ENVIRONMENT)) return hostEnvironment
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
   * session dans celui du projet.
   */
  forTerminal(projectId: string, conversationId: string | null): EnvironmentProvider {
    return this.provider(conversationId ? this.ofConversation(conversationId) : this.ofProject(projectId))
  }
}
