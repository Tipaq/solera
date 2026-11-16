import type { CliLauncher } from '../src/agents/cli-binary.js'
import { hostEnvironment } from '../src/environments/host.js'
import type { EnvironmentProvider, PtyRequest, SpawnRequest } from '../src/environments/provider.js'

/** Un CLI de test, lancé sur l'hôte comme celui d'un adaptateur. */
export function hostCli(binary: string): CliLauncher {
  return { environment: hostEnvironment, executable: async () => binary }
}

/**
 * L'hôte, qui note ce qu'on lui fait lancer : de quoi prouver qu'un processus est passé
 * par le fournisseur, et non par un `spawn` direct.
 */
export function recordingEnvironment(): EnvironmentProvider & { launched: Array<{ via: 'spawn' | 'pty' | 'exec'; command: string; args: string[] }> } {
  const launched: Array<{ via: 'spawn' | 'pty' | 'exec'; command: string; args: string[] }> = []
  const note = (via: 'spawn' | 'pty' | 'exec', request: SpawnRequest) => launched.push({ via, command: request.command, args: request.args })
  return {
    environment: hostEnvironment.environment,
    launched,
    spawn: (request) => (note('spawn', request), hostEnvironment.spawn(request)),
    spawnPty: (request: PtyRequest) => (note('pty', request), hostEnvironment.spawnPty(request)),
    exec: (request) => (note('exec', request), hostEnvironment.exec(request)),
    resolveBinary: (binary, managedDir) => hostEnvironment.resolveBinary(binary, managedDir),
    pathInside: (path) => hostEnvironment.pathInside(path),
    copyIn: (from, to) => hostEnvironment.copyIn(from, to),
    copyOut: (from, to) => hostEnvironment.copyOut(from, to),
    close: () => hostEnvironment.close(),
  }
}
