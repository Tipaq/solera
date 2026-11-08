import type { Config } from '../config.js'

/**
 * L'adresse de Solera que le CLI d'une session joint, pour son serveur MCP.
 *
 * Elle dépend de l'environnement où le CLI tourne (ADR 0001) : sur l'hôte et en bac à
 * sable natif, il partage le réseau du serveur et la boucle locale suffit ; depuis un
 * conteneur, il faudra l'adresse de l'hôte vue du conteneur. Seul l'hôte existe pour
 * l'instant : le dev container ajoutera sa branche ici, et nulle part ailleurs.
 *
 * Distincte de `publicUrl`, qui sert les liens montrés à une personne, peut-être sur un
 * autre appareil : le CLI, lui, est sur la machine, et passer par le nom public le
 * ferait dépendre du réseau pour parler à son voisin.
 */
export function soleraUrlForAgents(server: Pick<Config['server'], 'host' | 'port' | 'agentUrl'>): string {
  if (server.agentUrl) return server.agentUrl.replace(/\/+$/, '')
  return `http://${reachableHost(server.host)}:${server.port}`
}

/**
 * Une adresse d'écoute « partout » ne se joint pas telle quelle : on la remplace par la
 * boucle locale, que le serveur écoute alors aussi. Une adresse précise (celle de
 * Tailscale seule, par exemple) est la seule où il réponde : on la garde.
 */
function reachableHost(host: string): string {
  if (host === '' || host === '0.0.0.0' || host === '::' || host === '[::]') return '127.0.0.1'
  if (host.includes(':') && !host.startsWith('[')) return `[${host}]`
  return host
}
