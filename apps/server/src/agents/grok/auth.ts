import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { userGrokHome } from '../../grok-accounts/homes.js'
import { UNKNOWN_AUTH, type AgentAuth } from '../auth.js'

/**
 * La connexion propre de Grok, sans le lancer : Grok n'a pas de commande d'état, et le
 * seul moyen de le faire parler est une poignée de main ACP sur un process complet.
 * Ce qu'il range en se connectant suffit : `auth.json` dans son home (`GROK_HOME`, à
 * défaut `~/.grok`), ou `XAI_API_KEY` dans l'environnement que les sessions héritent.
 * Le contenu du fichier n'est pas lu : sa forme n'est pas documentée, sa présence l'est.
 */
export async function readGrokAuth(
  home: string = userGrokHome(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentAuth> {
  if (env.XAI_API_KEY) return { ...UNKNOWN_AUTH, status: 'ready', method: 'api_key' }
  try {
    await access(join(home, 'auth.json'))
    return { ...UNKNOWN_AUTH, status: 'ready' }
  } catch {
    return { ...UNKNOWN_AUTH, status: 'logged_out' }
  }
}
