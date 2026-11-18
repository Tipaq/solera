import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Lancer le serveur, Vite et les scripts d'une suite d'interface, et attendre qu'ils
 * répondent, sans en recopier une version de plus dans chaque suite.
 */

/** Un port TCP libre sur 127.0.0.1, au moment de l'appel. */
export async function freePort() {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise((resolve) => socket.close(resolve))
  return port
}

/**
 * Lance `node <args>` dans `cwd`. Le process s'ajoute à `processes`, que la suite arrête
 * dans son `finally`, et garde dans `diagnostics` les 6000 derniers caractères de sa sortie.
 */
export function run(args, cwd, env, processes) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: 'pipe' })
  processes.push(child)
  child.diagnostics = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { child.diagnostics = (child.diagnostics + chunk).slice(-6000) })
  }
  return child
}

/** Attend jusqu'à 15 s que `url` réponde 2xx ; échoue tout de suite si `child` meurt. */
export async function ready(url, child) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error(child.diagnostics)
    if (await fetch(url).then((response) => response.ok).catch(() => false)) return
    await delay(100)
  }
  throw new Error(`Server did not start: ${child.diagnostics}`)
}
