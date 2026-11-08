import { createServer, type AddressInfo, type Server as NetServer } from 'node:net'
import type { Server as HttpServer } from 'node:http'

/**
 * Le serveur de Solera, rendu joignable depuis les conteneurs sous Linux natif (#149).
 *
 * Sans Docker Desktop, un conteneur voit l'hôte à la passerelle de son réseau Docker
 * (172.17.0.1, ou celle du réseau d'un compose), où un serveur qui n'écoute que sur
 * la boucle locale ne répond pas. On écoute donc en plus sur cette adresse-là, et
 * seulement elle : elle n'existe que sur le pont Docker, pas sur le réseau de la
 * machine. Chaque réseau a sa passerelle : une écoute par adresse, ouverte au premier
 * conteneur qui en a besoin et gardée jusqu'à l'arrêt du serveur.
 *
 * Les connexions sont confiées telles quelles au serveur HTTP principal : mêmes
 * routes, même authentification, et `request.ip` dit la vraie adresse du conteneur.
 */
export class BridgeListeners {
  private server: HttpServer | null = null
  private readonly listening = new Map<string, Promise<void>>()

  /** Le serveur HTTP à prolonger, une fois qu'il écoute. */
  serve(server: HttpServer): void {
    this.server = server
  }

  /** Écoute sur `address`, au port du serveur principal ; sans effet si c'est déjà fait. */
  ensure(address: string): Promise<void> {
    let pending = this.listening.get(address)
    if (!pending) {
      pending = this.open(address)
      this.listening.set(address, pending)
      // Un échec se retente au conteneur suivant : l'adresse a pu apparaître entre-temps.
      pending.catch(() => this.listening.delete(address))
    }
    return pending
  }

  private open(address: string): Promise<void> {
    const main = this.server
    const port = (main?.address() as AddressInfo | null)?.port
    if (!main || !port) return Promise.reject(new Error('the Solera server is not listening yet'))
    const bridge: NetServer = createServer((socket) => main.emit('connection', socket))
    return new Promise<void>((resolve, reject) => {
      bridge.once('error', reject)
      bridge.listen({ host: address, port }, () => {
        bridge.off('error', reject)
        // Une connexion refusée plus tard (trop de fichiers ouverts) ne doit pas tuer le serveur.
        bridge.on('error', () => undefined)
        // Rien à fermer à l'arrêt : ces écoutes ne retiennent pas le process.
        bridge.unref()
        resolve()
      })
    })
  }
}
