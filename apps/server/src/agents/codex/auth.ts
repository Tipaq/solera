import { CachedProbe } from '../cached-probe.js'
import { AUTH_CACHE_TTL_MS, runAuthCommand, UNKNOWN_AUTH, type AgentAuth } from '../auth.js'

/**
 * Moyens de connexion que `codex login status` annonce (0.153), relevés dans le binaire :
 * « Logged in using ChatGPT », « … an API key - sk-… », « … access token »… L'ordre
 * compte, « personal access token » avant « access token ».
 */
const METHODS: Array<[RegExp, string]> = [
  [/chatgpt/i, 'chatgpt'],
  [/api key/i, 'api_key'],
  [/personal access token/i, 'personal_access_token'],
  [/access token/i, 'access_token'],
  [/bedrock/i, 'bedrock'],
  [/workload identity/i, 'workload_identity'],
]

/**
 * Lit la sortie de `codex login status`, écrite sur stderr. Le CLI n'y donne ni courriel
 * ni formule : seulement l'état et le moyen. Une clé API y est affichée tronquée, et
 * n'est jamais recopiée.
 */
export function parseCodexAuth(output: string): AgentAuth {
  if (/not logged in/i.test(output)) return { ...UNKNOWN_AUTH, status: 'logged_out' }
  const line = /logged in using (.+)/i.exec(output)?.[1]
  if (!line) return UNKNOWN_AUTH
  const method = METHODS.find(([pattern]) => pattern.test(line))?.[1] ?? 'other'
  return { ...UNKNOWN_AUTH, status: 'ready', method }
}

/**
 * La connexion propre du CLI, par `codex login status` : quelques centièmes de seconde,
 * le fichier d'identifiants est lu sans démarrer l'app-server.
 */
export class CodexAuthReader {
  private readonly cached: CachedProbe<AgentAuth>

  constructor(executable: () => Promise<string>) {
    this.cached = new CachedProbe(AUTH_CACHE_TTL_MS, async () => {
      const { stdout, stderr } = await runAuthCommand(await executable(), ['login', 'status'])
      return parseCodexAuth(`${stdout}\n${stderr}`)
    })
  }

  read(force = false): Promise<AgentAuth> {
    return this.cached.read(force)
  }
}
