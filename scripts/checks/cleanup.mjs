import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { constants } from 'node:os'

/**
 * Ce qu'une suite d'interface laisse derrière elle quand on la tue (carte #266).
 *
 * Les suites arrêtent leur serveur, leur Vite et leur Chromium dans un `finally`, qui ne
 * s'exécute pas quand le process reçoit SIGTERM ou SIGINT : `timeout`, Ctrl-C, une
 * session arrêtée. Le serveur et Vite restaient alors orphelins, des heures durant.
 *
 * Importer ce module suffit : sur SIGINT, SIGTERM ou SIGHUP, il envoie SIGTERM à tous
 * les descendants de la suite, attend qu'ils soient partis (trois secondes au plus, le
 * temps aussi pour le `finally`), puis tue au SIGKILL ce qui reste et sort avec le code
 * du signal. À la sortie, même normale, il termine les descendants encore vivants : une
 * suite qui casse avant son `finally` ne laisse rien non plus. On suit l'arbre des
 * process, pas une liste d'enfants tenue à la main : il emporte l'esbuild de Vite, les
 * sous-process du serveur et ceux de Chromium, sans toucher à la façon dont chaque
 * suite lance les siens.
 *
 * Sous Windows, qui n'a ni `ps` ni ces signaux, seuls les dossiers sont nettoyés.
 */

const scratch = new Set()
let interrupted = null
let interruptedAt = 0

/** Rend `dir`, effacé à la sortie de la suite, même interrompue. */
export function removeOnExit(dir) {
  scratch.add(dir)
  return dir
}

/** Le signal reçu, ou `null` : un lanceur ne démarre plus rien une fois interrompu. */
export function receivedSignal() {
  return interrupted
}

function descendants() {
  const table = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
  if (table.status !== 0) return []
  const children = new Map()
  for (const line of table.stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    // Le `ps` qui vient de lister est lui aussi un enfant de la suite.
    if (!pid || pid === table.pid) continue
    if (!children.has(ppid)) children.set(ppid, [])
    children.get(ppid).push(pid)
  }
  const found = []
  const queue = [process.pid]
  while (queue.length) {
    for (const pid of children.get(queue.shift()) ?? []) {
      found.push(pid)
      queue.push(pid)
    }
  }
  return found
}

function killDescendants(signal) {
  if (process.platform === 'win32') return
  for (const pid of descendants()) {
    try {
      process.kill(pid, signal)
    } catch {
      // Déjà parti.
    }
  }
}

function interrupt(signal) {
  if (interrupted) {
    // Un Ctrl-C ou un `timeout` signale tout le groupe, et le lanceur relaie aussitôt à
    // sa suite : ce doublon arrive dans la foulée. Un vrai deuxième Ctrl-C, plus tard,
    // n'attend plus.
    if (Date.now() - interruptedAt < 500) return
    killDescendants('SIGKILL')
    process.exit()
  }
  interrupted = signal
  interruptedAt = Date.now()
  console.error(`\n${signal} reçu : arrêt du serveur, de Vite et du navigateur.`)
  killDescendants('SIGTERM')
  const poll = setInterval(() => {
    if (Date.now() - interruptedAt > 3000 || !descendants().length) process.exit()
  }, 100)
  poll.unref()
}

if (process.platform !== 'win32') {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, interrupt)
}

process.on('exit', () => {
  if (interrupted) process.exitCode = 128 + constants.signals[interrupted]
  killDescendants(interrupted ? 'SIGKILL' : 'SIGTERM')
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      console.error(`Dossier temporaire laissé : ${dir} (${error.code ?? error.message})`)
    }
  }
})
