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

/**
 * Un conteneur à la session, éphémère, sur l'image du dev container du projet, son seul
 * worktree monté : #145. Le seul confinement de Windows natif.
 */
export const DEVCONTAINER_CONFINED_ENVIRONMENT: ExecutionEnvironment = Object.freeze({ where: 'devcontainer', confined: true })

/**
 * Les services docker-compose du dev container (une base de données…), pour le
 * conteneur d'une session confinée : ceux du projet, partagés, ou une copie à elle,
 * supprimée avec elle (#145). Un réglage du projet.
 */
export const confinedServicesSchema = z.enum(['shared', 'copy'])
export type ConfinedServices = z.infer<typeof confinedServicesSchema>

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
  /** Le dev container passe par docker-compose : le réglage des services a un objet. */
  compose: boolean
  /** Les services docker-compose que voit le conteneur d'une session confinée (#145). */
  confinedServices: ConfinedServices
}

/** Écrire le `devcontainer.json` que Solera garde : du JSON avec commentaires (JSONC). */
export const putProjectDevcontainerBodySchema = z.object({
  content: z.string().min(2).max(256 * 1024),
})

/**
 * Un port du dev container, servi sur la boucle locale de l'hôte (#141) : déclaré dans
 * `forwardPorts`, ou détecté parce qu'un processus du conteneur s'est mis à l'écouter.
 */
export interface ForwardedPortDto {
  /** Le port tel que le conteneur l'écoute, et tel que l'agent le cite. */
  containerPort: number
  /** Le service qui l'écoute quand ce n'est pas le conteneur lui-même (`db` de `db:5432`). */
  host: string | null
  /** Où l'hôte le sert, sur `localhost` ; null quand il n'a pas pu l'être (voir `error`). */
  hostPort: number | null
  /** Le `label` de `portsAttributes`. */
  label: string | null
  protocol: 'http' | 'https'
  source: 'config' | 'detected'
  /** Le port était pris sur l'hôte : il y est servi sous un autre numéro. */
  remapped: boolean
  /**
   * Pourquoi il n'est pas joignable : pris sur l'hôte alors que `requireLocalPort` le
   * veut à son numéro, aucune écoute possible, ou aucun outil de relais dans le
   * conteneur. `detail` est le message système, ou la liste des outils cherchés.
   */
  error: { code: 'port_taken' | 'listen_failed' | 'no_relay'; detail: string } | null
}
