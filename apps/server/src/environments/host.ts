import { execFile, spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { cp } from 'node:fs/promises'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { HOST_ENVIRONMENT, type ExecutionEnvironment } from '@solera/protocol'
import { resolveBinary } from '../agents/cli-binary.js'
import { launchOf } from '../agents/launch.js'
import type { EnvironmentProvider, ExecRequest, ExecResult, PtyRequest, SpawnRequest } from './provider.js'

/**
 * L'hôte, non confiné : ce que Solera a toujours fait, rangé derrière le contrat.
 *
 * Les chemins sont ceux de l'hôte, la copie est une copie locale, et rien n'est à
 * fermer. Le seul travail propre à l'hôte est celui des lanceurs `.cmd` de Windows, que
 * `launchOf` déplie : c'est ici, et nulle part ailleurs, qu'un CLI de l'hôte se lance.
 */
export class HostEnvironment implements EnvironmentProvider {
  readonly environment: ExecutionEnvironment = HOST_ENVIRONMENT

  spawn(request: SpawnRequest): ChildProcessWithoutNullStreams {
    const launch = launchOf(request.command)
    return spawnProcess(launch.command, [...launch.args, ...request.args], {
      cwd: request.cwd,
      env: request.env,
      signal: request.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
  }

  spawnPty(request: PtyRequest): IPty {
    const launch = launchOf(request.command)
    const pty = spawnPty(launch.command, [...launch.args, ...request.args], {
      name: request.name,
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: request.env as Record<string, string> | undefined,
    })
    request.signal?.addEventListener('abort', () => pty.kill(), { once: true })
    return pty
  }

  exec(request: ExecRequest): Promise<ExecResult> {
    const launch = launchOf(request.command)
    return new Promise((resolve, reject) => {
      execFile(
        launch.command,
        [...launch.args, ...request.args],
        {
          cwd: request.cwd,
          env: request.env,
          signal: request.signal,
          timeout: request.timeoutMs,
          windowsHide: true,
        },
        (err, stdout, stderr) => {
          const code = err ? (err as { code?: unknown }).code : 0
          // Un code numérique est une sortie normale de la commande ; ENOENT ou un
          // signal (délai dépassé) n'en sont pas.
          if (err && typeof code !== 'number') return reject(err)
          resolve({ stdout: String(stdout), stderr: String(stderr), code: typeof code === 'number' ? code : 0 })
        },
      )
    })
  }

  resolveBinary(binary: string, managedDir: string): string | null {
    return resolveBinary(binary, managedDir)
  }

  pathInside(hostPath: string): string {
    return hostPath
  }

  async copyIn(hostPath: string, insidePath: string): Promise<void> {
    if (hostPath !== insidePath) await cp(hostPath, insidePath, { recursive: true })
  }

  async copyOut(insidePath: string, hostPath: string): Promise<void> {
    if (hostPath !== insidePath) await cp(insidePath, hostPath, { recursive: true })
  }

  async close(): Promise<void> {}
}

/** L'hôte n'a pas d'état : une seule instance pour tout le serveur. */
export const hostEnvironment = new HostEnvironment()
