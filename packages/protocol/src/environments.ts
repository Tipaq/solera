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

/** L'hôte, confiné par bwrap (Linux, WSL) ou seatbelt (macOS) : #144. */
export const HOST_CONFINED_ENVIRONMENT: ExecutionEnvironment = Object.freeze({ where: 'host', confined: true })

/** Le dev container du projet, partagé par ses sessions non confinées : #140. */
export const DEVCONTAINER_ENVIRONMENT: ExecutionEnvironment = Object.freeze({ where: 'devcontainer', confined: false })

export function sameEnvironment(a: ExecutionEnvironment, b: ExecutionEnvironment): boolean {
  return a.where === b.where && a.confined === b.confined
}

/**
 * Une clé stable pour un sélecteur ou une clé de traduction : `host`,
 * `devcontainer.confined`…
 */
export function environmentKey(environment: ExecutionEnvironment): `${EnvironmentWhere}${'' | '.confined'}` {
  return environment.confined ? `${environment.where}.confined` : environment.where
}

/**
 * Les environnements qu'on peut choisir pour un projet, ou pour une session à sa
 * création : ceux que ce serveur sait lancer, sur cette plateforme. L'hôte, et l'hôte
 * confiné sous Linux, WSL et macOS (#144), et le dev container d'un projet qui a un
 * `devcontainer.json` (#140).
 */
export interface ProjectEnvironmentsDto {
  /** L'environnement par défaut du projet ; l'hôte s'il n'a rien réglé. */
  default: ExecutionEnvironment
  choices: ExecutionEnvironment[]
  /**
   * Ce que Solera propose à la place du défaut, à confirmer : le dev container d'un
   * projet qui a un `devcontainer.json` et tourne encore sur l'hôte. Null sinon.
   */
  suggested: ExecutionEnvironment | null
}

/**
 * Le `devcontainer.json` d'un projet, tel que ses réglages le montrent (#143) : celui du
 * dépôt, qui prévaut et qu'on ne fait que lire, ou celui que Solera garde hors du dépôt
 * pour un projet qui n'en a pas.
 */
export interface ProjectDevcontainerDto {
  /** Le chemin du `devcontainer.json` du dépôt, relatif au projet ; null s'il n'en a pas. */
  repository: string | null
  /** Le texte de celui que Solera garde ; null s'il n'en garde pas. */
  managed: string | null
  /** Le modèle de départ : l'image de base avec git, et les features de la stack détectée. */
  template: string
}

/** Écrire le `devcontainer.json` que Solera garde : du JSON avec commentaires (JSONC). */
export const putProjectDevcontainerBodySchema = z.object({
  content: z.string().min(2).max(256 * 1024),
})
