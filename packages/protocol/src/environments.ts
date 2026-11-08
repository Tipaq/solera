import { z } from 'zod'

/**
 * L'environnement d'exécution d'une session : où tournent son CLI et ses terminaux, et
 * s'ils y sont confinés (ADR 0001, `docs/adr/0001-environnements-d-execution.md`).
 *
 * Deux axes indépendants plutôt qu'une liste de modes : un dev container confiné se
 * compose des deux, il ne se construit pas une seconde fois.
 *
 * Le projet en a un par défaut ; une session en choisit un à sa création et le garde.
 */

/** Où tourne la chaîne d'outils : l'hôte de Solera, ou le dev container du projet. */
export const environmentWhereSchema = z.enum(['host', 'devcontainer'])
export type EnvironmentWhere = z.infer<typeof environmentWhereSchema>

export const executionEnvironmentSchema = z.object({
  where: environmentWhereSchema,
  confined: z.boolean(),
})
export type ExecutionEnvironment = z.infer<typeof executionEnvironmentSchema>

/** L'hôte, non confiné : ce qu'un projet qui n'a rien réglé garde, comme avant. */
export const HOST_ENVIRONMENT: ExecutionEnvironment = Object.freeze({ where: 'host', confined: false })

export function sameEnvironment(a: ExecutionEnvironment, b: ExecutionEnvironment): boolean {
  return a.where === b.where && a.confined === b.confined
}

/**
 * Une clé stable pour un sélecteur ou une clé de traduction : `host`,
 * `devcontainer.confined`…
 */
export function environmentKey(environment: ExecutionEnvironment): string {
  return environment.confined ? `${environment.where}.confined` : environment.where
}

/**
 * Les environnements qu'on peut choisir pour un projet, ou pour une session à sa
 * création : ceux que ce serveur sait lancer, sur cette plateforme. L'hôte seul tant que
 * les fournisseurs du dev container et du confinement n'existent pas (#140, #144).
 */
export interface ProjectEnvironmentsDto {
  /** L'environnement par défaut du projet ; l'hôte s'il n'a rien réglé. */
  default: ExecutionEnvironment
  choices: ExecutionEnvironment[]
}
