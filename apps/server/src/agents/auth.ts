import { execFile } from 'node:child_process'
import type { AgentAuthDto } from '@solera/protocol'
import { launchOf } from './launch.js'
import { agentProcessEnv } from './process-env.js'

/**
 * Connexion d'un CLI, telle que l'adaptateur la lit : la ligne de `GET /api/agents/auth`
 * sans le CLI ni le compte, que la route ajoute.
 *
 * La règle commune aux quatre lecteurs : rien qui ouvre une session. La page de brouillon
 * la demande à chaque ouverture ; une commande d'état qui répond en un dixième de seconde
 * se paie, un process d'agent complet non. Un CLI qui n'a rien de tel répond `unknown`.
 */
export type AgentAuth = Omit<AgentAuthDto, 'agent' | 'account'>

export const UNKNOWN_AUTH: AgentAuth = { status: 'unknown', method: null, plan: null, identity: null }

/**
 * Fraîcheur d'une lecture de connexion. Une minute : assez pour qu'ouvrir dix brouillons
 * ne lance pas dix process, assez peu pour qu'une connexion faite à côté se voie vite.
 * `?refresh=1` la court-circuite.
 */
export const AUTH_CACHE_TTL_MS = 60_000

const AUTH_TIMEOUT_MS = 10_000

/**
 * Lance une commande d'état et rend ses deux sorties, même sur un code de sortie non
 * nul : `codex login status` sort en 1 quand personne n'est connecté, et c'est une
 * réponse, pas une panne. Seuls l'absence du binaire et le délai dépassé rejettent.
 */
export function runAuthCommand(
  binary: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const launch = launchOf(binary)
  return new Promise((resolve, reject) => {
    execFile(
      launch.command,
      [...launch.args, ...args],
      { timeout: AUTH_TIMEOUT_MS, windowsHide: true, env: agentProcessEnv(env) },
      (err, stdout, stderr) => {
        const code = err ? (err as { code?: unknown }).code : 0
        // Un code numérique est une sortie normale du CLI ; ENOENT ou un signal (délai
        // dépassé) n'en sont pas.
        if (err && typeof code !== 'number') return reject(err)
        resolve({ stdout: String(stdout), stderr: String(stderr), code: typeof code === 'number' ? code : 0 })
      },
    )
  })
}
