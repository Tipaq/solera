import type { FastifyInstance } from 'fastify'
import { HttpError } from './errors.js'

/**
 * Réserve une instance de bureau à la fenêtre de l'application.
 *
 * Le serveur écoute sur 127.0.0.1, que toute page ouverte dans un navigateur du poste
 * peut joindre. Le port ne compte pas dans le « site » d'un cookie : une page servie sur
 * un autre port local est same-site et emporterait la session, et ce serveur ouvre des
 * terminaux. Deux contrôles, donc, sur chaque requête, poignée de main WebSocket
 * comprise :
 * - `Host` doit être l'adresse locale, ce qui écarte le DNS rebinding (un domaine
 *   quelconque qui se résoudrait vers 127.0.0.1). Un dev container joint aussi le
 *   serveur, pour son MCP : par la passerelle Docker où il écoute alors en plus
 *   (Linux natif), dont l'adresse IP est celle où la connexion est arrivée, ou par
 *   `host.docker.internal`, que Docker Desktop relaie sur la boucle locale. Ni l'une
 *   ni l'autre n'est un nom qu'une page hostile ferait résoudre vers ce serveur ;
 * - `Origin`, quand le navigateur l'envoie (toujours pour une WebSocket ou un POST), doit
 *   être cette même adresse. Un client hors navigateur (curl, un client MCP par jeton)
 *   n'en envoie pas, et passe.
 *
 * Le relais des Storybook (`/ds/<jeton>/`) échappe au second contrôle : ses pages sont
 * opaques par construction (CSP `sandbox`), donc d'origine `null`, et c'est le jeton du
 * chemin qui les garde, pas le cookie.
 */
export function registerLocalOriginGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (request) => {
    const host = request.headers.host ?? ''
    if (!localHosts(request.socket.localAddress, request.socket.localPort).includes(host)) {
      throw new HttpError(403, 'forbidden_host', 'This instance only answers on its local address.')
    }
    const origin = request.headers.origin
    if (origin === undefined || request.url.startsWith('/ds/')) return
    if (origin !== `http://${host}`) {
      throw new HttpError(403, 'forbidden_origin', 'This instance only answers the Solera window.')
    }
  })
}

/** Les `Host` qu'accepte une connexion arrivée sur `address`, au port `port`. */
function localHosts(address: string | undefined, port: number | undefined): string[] {
  const local = (address ?? '').replace(/^::ffff:/, '')
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (local === '127.0.0.1') hosts.push(`host.docker.internal:${port}`)
  else if (local && local !== '::1') hosts.push(local.includes(':') ? `[${local}]:${port}` : `${local}:${port}`)
  return hosts
}
