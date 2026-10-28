import { CachedProbe } from '../cached-probe.js'
import { AUTH_CACHE_TTL_MS, runAuthCommand, UNKNOWN_AUTH, type AgentAuth } from '../auth.js'

/**
 * Lit la sortie de `claude auth status --json` : `loggedIn`, `authMethod`
 * (`claude.ai`, clé API...), `apiProvider` (`firstParty`, Bedrock, Vertex), `email`,
 * `orgName`, `subscriptionType`. Tout est facultatif : un champ absent vaut null, une
 * sortie illisible vaut `unknown`.
 */
export function parseClaudeAuth(stdout: string): AgentAuth {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return UNKNOWN_AUTH
  }
  if (typeof parsed !== 'object' || parsed === null) return UNKNOWN_AUTH
  const fields = parsed as Record<string, unknown>
  const text = (key: string) => (typeof fields[key] === 'string' && fields[key] !== '' ? (fields[key] as string) : null)
  if (typeof fields.loggedIn !== 'boolean') return UNKNOWN_AUTH
  if (!fields.loggedIn) return { ...UNKNOWN_AUTH, status: 'logged_out' }

  // Hors facturation Anthropic, c'est le fournisseur qui dit comment on paie.
  const provider = text('apiProvider')
  return {
    status: 'ready',
    method: text('authMethod') ?? (provider !== 'firstParty' ? provider : null),
    plan: text('subscriptionType'),
    identity: text('email') ?? text('orgName'),
  }
}

/**
 * La connexion propre du CLI, par `claude auth status` : 0,13 s mesurées, sans session
 * ni appel au modèle.
 */
export class ClaudeAuthReader {
  private readonly cached: CachedProbe<AgentAuth>

  constructor(executable: () => Promise<string>) {
    this.cached = new CachedProbe(AUTH_CACHE_TTL_MS, async () => {
      const { stdout } = await runAuthCommand(await executable(), ['auth', 'status', '--json'])
      return parseClaudeAuth(stdout)
    })
  }

  read(force = false): Promise<AgentAuth> {
    return this.cached.read(force)
  }
}
