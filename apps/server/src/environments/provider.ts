import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { IPty } from 'node-pty'
import { environmentKey, type ExecutionEnvironment } from '@solera/protocol'
import { HttpError } from '../http/errors.js'

/**
 * Le fournisseur d'un environnement d'exécution : la seule porte par laquelle Solera
 * lance le CLI d'un agent ou un terminal (ADR 0001).
 *
 * Le contrat reprend celui des providers de Sandcastle : lancer (`spawn`, `spawnPty`,
 * `exec`), le chemin d'un dossier vu de l'intérieur, la copie de fichiers, la fermeture.
 * Le serveur et l'interface restent sur l'hôte ; seul ce qui passe par ici change de
 * monde quand l'environnement change.
 *
 * Un appelant ne transforme jamais lui-même une commande pour la lancer (lanceur `.cmd`
 * de Windows, `docker exec`, bwrap) : c'est le travail du fournisseur, et c'est ce qui
 * permet à un même runner de tourner sur l'hôte comme dans un conteneur.
 */
export interface EnvironmentProvider {
  readonly environment: ExecutionEnvironment
  /** Un processus aux trois flux branchés : le CLI d'un agent, une commande de connexion. */
  spawn(request: SpawnRequest): ChildProcessWithoutNullStreams
  /** Un processus dans un pseudo-terminal : un shell, une action de projet, une connexion interactive. */
  spawnPty(request: PtyRequest): IPty
  /**
   * Joue une commande jusqu'au bout et rend ses sorties, même sur un code non nul : une
   * sonde de version ou d'état. Ne rejette que si la commande n'a pas pu tourner
   * (introuvable, délai dépassé).
   */
  exec(request: ExecRequest): Promise<ExecResult>
  /**
   * Le chemin du CLI nommé `binary`, cherché **dans** l'environnement, ou null. Un CLI
   * présent sur l'hôte peut manquer au conteneur : le chercher ailleurs annoncerait un
   * agent que la session ne saurait pas lancer.
   */
  resolveBinary(binary: string, managedDir: string): string | null
  /** Un dossier de l'hôte (le workspace, un worktree) tel que l'environnement le voit. */
  pathInside(hostPath: string): string
  /**
   * L'inverse : un chemin que le CLI rend (un fichier édité, son dossier de travail),
   * tel que l'hôte le lit. Rendu tel quel quand il n'a pas d'équivalent sur l'hôte.
   */
  pathOutside(insidePath: string): string
  /**
   * Une adresse du serveur de Solera, telle que l'environnement la joint : le MCP de
   * Solera, vu d'un conteneur, est sur l'hôte et non sur sa propre boucle locale.
   */
  urlOfHost(url: string): string
  /** Copie un fichier ou un dossier de l'hôte dans l'environnement. */
  copyIn(hostPath: string, insidePath: string): Promise<void>
  /** Copie un fichier ou un dossier de l'environnement vers l'hôte. */
  copyOut(insidePath: string, hostPath: string): Promise<void>
  /** Libère ce que l'environnement tient pour Solera. Sans effet sur l'hôte. */
  close(): Promise<void>
}

export interface SpawnRequest {
  /** Un CLI résolu, ou une commande que l'environnement trouvera dans son PATH. */
  command: string
  args: string[]
  /** Chemin de l'hôte : le fournisseur le traduit s'il le faut. */
  cwd?: string
  /** Absent : l'environnement du serveur, tel quel. */
  env?: NodeJS.ProcessEnv
  /** Tue le processus quand il s'abaisse. */
  signal?: AbortSignal
}

export interface PtyRequest extends SpawnRequest {
  name: string
  cols: number
  rows: number
}

export interface ExecRequest extends SpawnRequest {
  timeoutMs: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
}

/**
 * Une session demande un environnement que ce serveur ne sait pas fournir : elle refuse
 * de démarrer en disant pourquoi, et ne retombe jamais en silence sur un autre.
 * `HttpError` parce que le refus remonte tel quel jusqu'à l'envoi du message, où
 * l'interface le traduit par son code.
 */
export class EnvironmentUnavailableError extends HttpError {
  constructor(
    readonly environment: ExecutionEnvironment,
    message: string,
    /** Un refus plus précis que « pas encore lancé » : la raison, et quoi lancer (#144). */
    refusal?: { code: string; params?: Record<string, string> },
  ) {
    super(409, refusal?.code ?? 'environment_unavailable', message, {
      environment: environmentKey(environment),
      ...refusal?.params,
    })
    this.name = 'EnvironmentUnavailableError'
  }
}
