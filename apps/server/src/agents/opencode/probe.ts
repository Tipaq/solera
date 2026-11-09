import type { CliLauncher } from '../cli-binary.js'
import { OpencodeServer } from './server.js'

/**
 * Lance un `opencode serve` le temps d'une lecture : catalogue, commandes d'un dossier,
 * fork. Sans flux d'événements, et sans rien injecter : la sonde voit la configuration
 * du poste telle qu'elle est.
 */
export async function withProbeServer<T>(
  cli: CliLauncher,
  cwd: string,
  read: (server: OpencodeServer) => Promise<T>,
): Promise<T> {
  // La mise à jour automatique reste coupée : une sonde ne doit pas changer le binaire.
  const server = await OpencodeServer.start({
    binary: await cli.executable(),
    environment: cli.environment,
    cwd,
    config: { autoupdate: false },
  })
  try {
    return await read(server)
  } finally {
    server.close()
  }
}
