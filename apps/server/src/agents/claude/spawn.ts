import type { Options } from '@anthropic-ai/claude-agent-sdk'
import type { EnvironmentProvider } from '../../environments/provider.js'

/** Ce que la queue du stderr garde, comme le SDK pour un processus qu'il lance lui-même. */
const STDERR_TAIL_CHARS = 2_000

export interface ClaudeSpawner {
  /** À passer au SDK en `spawnClaudeCodeProcess`. */
  spawn: NonNullable<Options['spawnClaudeCodeProcess']>
  /**
   * L'erreur du SDK, complétée de la fin du stderr : « exited with code 1 » seul ne dit
   * pas pourquoi le CLI est mort.
   */
  explain(err: unknown): Error
}

/**
 * Le `spawnClaudeCodeProcess` du SDK, branché sur un fournisseur d'environnement : le
 * SDK compose la commande et ses arguments, le fournisseur décide où elle tourne.
 *
 * Le SDK ne lit plus la sortie d'erreur d'un processus qu'il n'a pas lancé lui-même :
 * ni l'option `stderr`, ni la queue qu'il joint à ses erreurs de sortie. On relaie la
 * première ici, et on garde la seconde pour `explain`, sans quoi une session morte au
 * démarrage n'aurait plus d'explication dans le fil.
 */
export function claudeSpawner(
  environment: EnvironmentProvider,
  onStderr: (data: string) => void,
): ClaudeSpawner {
  let tail = ''
  return {
    spawn: ({ command, args, cwd, env, signal }) => {
      tail = ''
      const child = environment.spawn({ command, args, cwd, env, signal })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (data: string) => {
        tail = (tail + data).slice(-STDERR_TAIL_CHARS)
        onStderr(data)
      })
      return child
    },
    explain: (err) => {
      const error = err instanceof Error ? err : new Error(String(err))
      const stderr = tail.trim()
      if (!stderr || error.message.includes(stderr)) return error
      // La forme du SDK quand il lance le CLI lui-même.
      const explained = new Error(`${error.message}. stderr: ${stderr}`, { cause: error })
      explained.name = error.name
      return explained
    },
  }
}
