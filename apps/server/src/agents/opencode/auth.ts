import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { UNKNOWN_AUTH, type AgentAuth } from '../auth.js'

/** Là où `opencode auth login` range ses identifiants (`opencode auth list` l'affiche). */
export function opencodeAuthFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_DATA_HOME || join(homedir(), '.local/share'), 'opencode/auth.json')
}

/**
 * opencode n'a pas une connexion mais des fournisseurs, et peut tourner sans aucun :
 * des modèles gratuits, ou des clés prises dans l'environnement. Un fichier vide ne dit
 * donc pas « déconnecté », seulement qu'on ne sait pas — `unknown`. Des identifiants
 * enregistrés disent `ready`, et `method` nomme les fournisseurs. `opencode auth list`
 * dirait la même chose en près d'une seconde de démarrage.
 */
export async function readOpencodeAuth(file: string = opencodeAuthFile()): Promise<AgentAuth> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return UNKNOWN_AUTH
  }
  if (typeof parsed !== 'object' || parsed === null) return UNKNOWN_AUTH
  const providers = Object.keys(parsed).sort()
  if (providers.length === 0) return UNKNOWN_AUTH
  return { ...UNKNOWN_AUTH, status: 'ready', method: providers.join(', ') }
}
