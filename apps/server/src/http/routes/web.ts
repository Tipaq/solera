import type { FastifyInstance } from 'fastify'
import type { WebPageDto } from '@solera/protocol'
import { readWebPage, WebReadError } from '../../web-reader.js'
import { badRequest } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * La vue *Web* du panneau : une page lue par le serveur, rendue en mode *Lecture*.
 *
 * Réservée aux utilisateurs connectés : le serveur va chercher l'adresse qu'on lui
 * donne, et ne doit pas servir de relais à qui ne l'est pas.
 */
export function registerWebRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { url?: string } }>('/api/web/read', async (request): Promise<WebPageDto> => {
    requireUser(request)
    const url = request.query.url?.trim()
    if (!url) throw badRequest('web_unreadable', 'An address is required.')
    try {
      return await readWebPage(url)
    } catch (err) {
      if (err instanceof WebReadError) throw badRequest('web_unreadable', err.message, { reason: err.message })
      throw err
    }
  })
}
