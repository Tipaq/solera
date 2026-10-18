import type { FastifyInstance } from 'fastify'

/**
 * Solera ne s'affiche dans le cadre de personne.
 *
 * Toute réponse porte `frame-ancestors 'none'`, ajouté à la politique qu'une route a
 * déjà posée si elle n'en dit rien. Deux raisons. Un autre site ne peut plus encadrer
 * l'interface pour faire cliquer à son insu (clickjacking). Et le cadre du mode *Direct*
 * de la vue Web, qui garde `allow-same-origin` pour un site tiers, ne peut plus être
 * mené jusqu'à Solera par une redirection : il y aurait l'origine de Solera, scripts
 * compris, avec `parent.document` à portée.
 *
 * Une route dont Solera encadre lui-même le contenu (un PDF du panneau) pose sa propre
 * directive, `frame-ancestors 'self'`, que ce garde laisse en place.
 */
export function registerFrameGuard(app: FastifyInstance): void {
  app.addHook('onSend', async (_request, reply, payload) => {
    const policy = reply.getHeader('content-security-policy')
    if (policy === undefined) {
      reply.header('content-security-policy', "frame-ancestors 'none'")
    } else if (!/(?:^|;)\s*frame-ancestors(?=[\s;]|$)/i.test(String(policy))) {
      reply.header('content-security-policy', `${String(policy)}; frame-ancestors 'none'`)
    }
    return payload
  })
}
