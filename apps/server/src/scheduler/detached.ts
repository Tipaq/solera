import { spawn } from 'node:child_process'
import { MAX_ACTION_RUN_EXCERPT_CHARS } from '@solera/protocol'
import { agentProcessEnv } from '../agents/process-env.js'
import { killTree } from '../platform/process-tree.js'
import { serviceAppsAvailable } from '../services/apps.js'

/**
 * L'exécution d'une commande planifiée (`actions/scheduled.ts`) : un processus détaché,
 * joué par le daemon pour le projet comme le script de vérification d'une tâche
 * (`check.ts`), et non une session. Il tourne donc sur l'hôte, hors de tout fournisseur
 * d'environnement : le planificateur ne l'appelle que pour un projet qui ne demande ni
 * confinement ni dev container.
 */

/** Ce que la sortie garde en mémoire : l'extrait n'en prend que la fin. */
const MAX_OUTPUT_CHARS = 16 * MAX_ACTION_RUN_EXCERPT_CHARS

/** Après le délai, le temps laissé à la commande pour se terminer proprement. */
const KILL_GRACE_MS = 3000

/** Après la sortie, le temps laissé aux tuyaux pour livrer ce qu'elle a écrit (voir `check.ts`). */
const EXIT_DRAIN_MS = 200

export interface DetachedCommand {
  command: string
  cwd: string
  /** Ajouté à l'environnement du daemon. */
  env: Record<string, string>
  timeoutMs: number
  /** Ce qui nomme le scope systemd. */
  label: string
}

export interface DetachedResult {
  /** Null quand elle a été coupée, ou n'a pas pu partir. */
  exitCode: number | null
  timedOut: boolean
  /** Sorties standard et d'erreur mêlées, dans l'ordre d'arrivée, tronquées par le début. */
  output: string
}

export type CommandExecutor = (command: DetachedCommand) => Promise<DetachedResult>

/**
 * Joue une commande par le shell de l'utilisateur, comme un terminal d'action, et rend sa
 * fin. Ne lève jamais : un shell introuvable devient un échec lisible dans la sortie.
 */
export async function runDetached(command: DetachedCommand): Promise<DetachedResult> {
  const shell = process.env.SHELL || '/bin/sh'
  const argv = [shell, '-lc', command.command]
  // Hors du cgroup du daemon : une commande qui s'emballe ne doit pas geler Solera.
  const scoped = (await serviceAppsAvailable())
    ? ['systemd-run', '--user', '--scope', '--quiet', '--collect', `--description=Solera: ${command.label}`, '--', ...argv]
    : argv

  return new Promise((resolve) => {
    let output = ''
    let timedOut = false
    let settled = false
    let killer: NodeJS.Timeout | undefined
    let drain: NodeJS.Timeout | undefined

    // Un groupe de processus à elle : le délai doit emporter ce qu'elle a lancé.
    const child = spawn(scoped[0]!, scoped.slice(1), {
      cwd: command.cwd,
      env: agentProcessEnv(command.env),
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const finish = (exitCode: number | null, extra = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(killer)
      clearTimeout(drain)
      child.stdout?.destroy()
      child.stderr?.destroy()
      resolve({ exitCode: timedOut ? null : exitCode, timedOut, output: (output + extra).slice(-MAX_OUTPUT_CHARS) })
    }
    const kill = (signal: NodeJS.Signals) => {
      if (child.pid) killTree(child.pid, signal)
    }
    const timer = setTimeout(() => {
      timedOut = true
      kill('SIGTERM')
      killer = setTimeout(() => {
        kill('SIGKILL')
        finish(null)
      }, KILL_GRACE_MS)
    }, command.timeoutMs)

    const collect = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.length > 2 * MAX_OUTPUT_CHARS) output = output.slice(-MAX_OUTPUT_CHARS)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (err) => finish(null, `\n${err.message}\n`))
    child.on('exit', (code) => {
      if (!timedOut) clearTimeout(timer)
      drain = setTimeout(() => finish(code), EXIT_DRAIN_MS)
    })
    child.on('close', (code) => finish(code))
  })
}
