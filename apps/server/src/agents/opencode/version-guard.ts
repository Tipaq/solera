import { statSync } from 'node:fs'
import { environmentKey } from '@solera/protocol'
import type { EnvironmentProvider } from '../../environments/provider.js'
import { HttpError } from '../../http/errors.js'

/**
 * Dernière majeure d'opencode dont l'adaptateur parle l'API.
 *
 * L'adaptateur parle la première génération de l'API d'`opencode serve` (`/session/...`,
 * flux `GET /event`). OpenCode 2 (`@opencode/cli` 2.x) l'a retirée au profit de
 * `/api/...` : lancé tel quel, un 2.x démarre bien, mais chaque requête tombe à côté et
 * la conversation reste muette, sans rien qui dise pourquoi. On refuse donc avant de
 * lancer le serveur, avec une raison lisible.
 */
export const SUPPORTED_OPENCODE_MAJOR = 1

const VERSION_TIMEOUT_MS = 5_000

/**
 * Un opencode trop récent pour l'adaptateur. `HttpError` parce que l'erreur remonte telle
 * quelle jusqu'à l'envoi du message : l'interface la traduit par son code.
 */
export class OpencodeUnsupportedVersionError extends HttpError {
  constructor(readonly version: string) {
    // La version écrite en clair plutôt qu'en `{version}` : le message sert aussi tel
    // quel hors de l'interface (journaux, fork, sonde), où personne ne l'interpole.
    super(
      409,
      'opencode_unsupported_version',
      `OpenCode ${version} is not supported: Solera speaks the OpenCode 1.x server API, which OpenCode 2 removed. Install OpenCode 1.x (opencode-ai) and do not run \`opencode upgrade --major\`.`,
      { version },
    )
    this.name = 'OpencodeUnsupportedVersionError'
  }
}

/**
 * Version sondée par binaire. La clé porte la date et la taille du fichier : une mise à
 * jour remplace le binaire en place, et un cache par chemin seul continuerait de laisser
 * passer un 2.x posé après coup. Le binaire n'est relancé que s'il a changé, si bien
 * que le garde-fou ne coûte un `--version` qu'au premier lancement.
 */
const versions = new Map<string, { key: string; version: Promise<string | null> }>()

function fileKey(binary: string): string {
  try {
    const stats = statSync(binary)
    return `${stats.mtimeMs}:${stats.size}`
  } catch {
    // Nom nu ou fichier illisible : `spawn` dira lui-même ce qui ne va pas.
    return 'unknown'
  }
}

async function readVersion(environment: EnvironmentProvider, binary: string): Promise<string | null> {
  try {
    const { stdout, code } = await environment.exec({ command: binary, args: ['--version'], timeoutMs: VERSION_TIMEOUT_MS })
    if (code !== 0) return null
    // La 1.x répond « 1.19.3 », la 2.x « opencode v2.0.32 » : on ne garde que le numéro.
    return /\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?/.exec(stdout)?.[0] ?? null
  } catch {
    return null
  }
}

export function opencodeVersion(environment: EnvironmentProvider, binary: string): Promise<string | null> {
  const key = fileKey(binary)
  // Le même chemin peut désigner deux binaires dans deux environnements.
  const slot = `${environmentKey(environment.environment)}:${binary}`
  const cached = versions.get(slot)
  if (cached && cached.key === key) return cached.version
  const version = readVersion(environment, binary)
  versions.set(slot, { key, version })
  return version
}

/**
 * Refuse un opencode dont la majeure dépasse celle que l'adaptateur connaît.
 *
 * Une version illisible laisse passer : mieux vaut un lancement qui échouera peut-être
 * qu'un refus inventé sur un binaire qui répond mal à `--version`.
 */
export async function assertSupportedOpencode(environment: EnvironmentProvider, binary: string): Promise<void> {
  const version = await opencodeVersion(environment, binary)
  const major = version ? Number(version.split('.')[0]) : NaN
  if (major > SUPPORTED_OPENCODE_MAJOR) throw new OpencodeUnsupportedVersionError(version!)
}
