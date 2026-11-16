import { execFileSync } from 'node:child_process'
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
 * les descendants de la suite, laisse deux secondes au `finally` pour finir, puis tue
 * au SIGKILL ce qui reste et sort avec le code du signal. À la sortie, même normale, il
 * termine les descendants encore vivants : une suite qui casse avant son `finally` ne
 * laisse rien non plus. On suit l'arbre des process, pas une liste d'enfants tenue à la
 * main : il emporte l'esbuild de Vite, les sous-process du serveur et ceux de Chromium,
 * sans toucher à la façon dont chaque suite lance les siens.
 *
 * Sous Windows, qui n'a ni `ps` ni ces signaux, seuls les dossiers sont nettoyés.
 */

const scratch = new Set()
let interrupted = null

/** Rend `dir`, effacé à la sortie de la suite, même interrompue. */
export function removeOnExit(dir) {
  scratch.add(dir)
  return dir
}

/** Le signal reçu, ou `null` : un lanceur ne démarre plus rien une fois interrompu. */
export function interruption() {
  return interrupted
}

function descendants() {
  let table
  try {
    table = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' })
  } catch {
    return []
  }
  const children = new Map()
  for (const line of table.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number)
    if (!pid) continue
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
      // Déjà parti, ou le `ps` qui vient de lister.
    }
  }
}

function interrupt(signal) {
  if (interrupted) {
    // Un deuxième Ctrl-C : on n'attend plus.
    killDescendants('SIGKILL')
    process.exit(128 + constants.signals[interrupted])
  }
  interrupted = signal
  console.error(`\n${signal} reçu : arrêt du serveur, de Vite et du navigateur.`)
  killDescendants('SIGTERM')
  setTimeout(() => process.exit(), 2000).unref()
}

if (process.platform !== 'win32') {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, interrupt)
}

process.on('exit', () => {
  killDescendants(interrupted ? 'SIGKILL' : 'SIGTERM')
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
  if (interrupted) process.exitCode = 128 + constants.signals[interrupted]
})
