import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/**
 * Le temps laissé au serveur du lancement précédent pour finir de s'arrêter : un peu plus
 * que le délai d'arrêt du lanceur (`STOP_TIMEOUT_MS`, server.ts), au bout duquel il est tué.
 */
const PREVIOUS_SERVER_GRACE_MS = 20_000

/**
 * Le port du serveur local, choisi une fois et gardé dans les réglages de l'app.
 *
 * L'origine de la page (`http://127.0.0.1:<port>`) porte le stockage local du navigateur :
 * brouillons, préférences d'affichage, panneaux ouverts. Un port tiré à chaque lancement
 * les ferait repartir de zéro. Il n'est remplacé que s'il est pris par un autre
 * programme, ou par une installation serveur de Solera sur le même poste.
 *
 * S'il est pris par le serveur de bureau du lancement précédent, qui finit de ranger ses
 * sessions, on l'attend : changer de port perdrait le stockage de la page, et deux
 * serveurs ouvriraient la même base. S'il ne part pas, le lancement échoue plutôt.
 */
export async function stablePort(file: string): Promise<number> {
  const saved = readSavedPort(file)
  if (saved !== null) {
    if (await isFree(saved)) return saved
    if (await isDesktopServer(saved)) {
      const deadline = Date.now() + PREVIOUS_SERVER_GRACE_MS
      while (Date.now() < deadline) {
        await delay(250)
        if (await isFree(saved)) return saved
      }
      throw new Error(`un serveur Solera du lancement précédent occupe encore le port ${saved}`)
    }
  }
  const port = await anyFreePort()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ port }, null, 2)}\n`)
  return port
}

function readSavedPort(file: string): number | null {
  try {
    const { port } = JSON.parse(readFileSync(file, 'utf8')) as { port?: unknown }
    return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536 ? port : null
  } catch {
    return null
  }
}

/**
 * Un serveur de bureau de Solera répond sur ce port. La garde d'origine de ce profil
 * n'accepte que `127.0.0.1:<port>` en `Host`, ce que `http.get` envoie.
 */
function isDesktopServer(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get({ host: '127.0.0.1', port, path: '/api/system/instance', timeout: 2000 }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        body += chunk
      })
      response.on('end', () => {
        try {
          resolve((JSON.parse(body) as { profile?: unknown }).profile === 'desktop')
        } catch {
          resolve(false)
        }
      })
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(false))
  })
}

function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

function anyFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => (port > 0 ? resolve(port) : reject(new Error('aucun port libre'))))
    })
  })
}
