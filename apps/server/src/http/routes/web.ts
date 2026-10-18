import type { FastifyInstance } from 'fastify'
import type { WebPageDto } from '@solera/protocol'
import { readWebPage, WebReadError } from '../../web-reader.js'
import { badRequest, forbidden } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * La vue *Web* du panneau : une page lue par le serveur, rendue en mode *Lecture*.
 *
 * Réservée aux utilisateurs connectés : le serveur va chercher l'adresse qu'on lui
 * donne, et ne doit pas servir de relais à qui ne l'est pas. Ni à un autre site : la
 * route est un GET et le cookie de session, `SameSite=Lax`, suit une navigation venue
 * d'ailleurs. `Sec-Fetch-Site` dit d'où vient la requête ; seule Solera elle-même, ou
 * l'adresse tapée à la main (`none`), peut s'en servir.
 *
 * `frame=1` ne lit que les en-têtes : le mode *Direct* veut savoir si le cadre
 * s'affichera, pas l'article.
 */
export function registerWebRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { url?: string; frame?: string } }>('/api/web/read', async (request): Promise<WebPageDto> => {
    requireUser(request)
    const site = request.headers['sec-fetch-site']
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      throw forbidden('web_cross_site', 'Pages can only be read from Solera itself.')
    }
    const url = request.query.url?.trim()
    if (!url) throw badRequest('web_unreadable', 'An address is required.')
    try {
      return await readWebPage(url, { frameOnly: request.query.frame === '1' })
    } catch (err) {
      if (err instanceof WebReadError) throw badRequest('web_unreadable', err.message, { reason: err.message })
      throw err
    }
  })
}
