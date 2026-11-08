import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { EnvironmentProvider } from '../../environments/provider.js'

/**
 * Le `spawnClaudeCodeProcess` du SDK, branché sur un fournisseur d'environnement : le
 * SDK compose la commande et ses arguments, le fournisseur décide où elle tourne.
 *
 * Le SDK ne lit plus la sortie d'erreur d'un processus qu'il n'a pas lancé lui-même :
 * on la relaie ici, sans quoi l'option `stderr` resterait muette et une session morte au
 * démarrage n'aurait plus d'explication.
 */
export function claudeSpawner(
  environment: EnvironmentProvider,
  onStderr: (data: string) => void,
): NonNullable<Options['spawnClaudeCodeProcess']> {
  return ({ command, args, cwd, env, signal }) => {
    const child = environment.spawn({ command, args, cwd, env, signal })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (data: string) => onStderr(data))
    return child
  }
}
