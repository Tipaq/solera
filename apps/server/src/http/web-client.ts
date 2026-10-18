import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/**
 * L'interface ne se laisse encadrer par personne, pas même par elle-même. Un autre site
 * n'a pas à la superposer à la sienne (clickjacking). Et le mode *Direct* de la vue
 * *Web* encadre des pages tierces avec leurs scripts et leur origine : l'une d'elles qui
 * redirigerait le cadre vers Solera y chargerait la session, bac à sable levé. Les
 * fichiers bruts de `/api`, que l'éditeur encadre, ne sont pas concernés : inertes.
 */
const NO_FRAMING = "frame-ancestors 'none'"

/**
 * Le frontend buildé est servi en statique par le même process (pas de serveur Node
 * front). En développement, Vite sert l'UI et proxifie /api, donc dist/ est absent
 * et on se contente de répondre en JSON.
 */
export async function registerWebClient(app: FastifyInstance, webRoot: string): Promise<void> {
  const indexPath = join(webRoot, 'index.html')
  const hasBuild = existsSync(indexPath)

  if (hasBuild) {
    await app.register(fastifyStatic, {
      root: webRoot,
      index: false,
      // Le cache-control intégré du plugin écraserait celui posé par setHeaders.
      cacheControl: false,
      /**
       * Seuls les fichiers de `assets/` portent un hash dans leur nom : eux seuls
       * peuvent être figés. Tout le reste (index.html, sw.js, manifest, icônes) garde
       * un nom stable, et un cache immutable y empêcherait toute mise à jour, service
       * worker compris.
       */
      setHeaders: (res, path) => {
        const hashed = path.includes(`${sep}assets${sep}`)
        res.setHeader(
          'cache-control',
          hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
        )
        // Vaut aussi pour `sendFile`, donc pour la racine et le repli SPA.
        if (path.endsWith('.html')) res.setHeader('content-security-policy', NO_FRAMING)
      },
    })

    // Sans index, le plugin statique répond 403 sur la racine au lieu de la déléguer.
    app.get('/', (_request, reply) => reply.sendFile('index.html'))
  }

  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? request.url
    // Un asset manquant doit répondre 404, pas du HTML : sinon le navigateur remonte
    // une erreur de type MIME au lieu du vrai problème.
    const looksLikeAsset = /\.[a-z0-9]+$/i.test(path)

    if (path.startsWith('/api/') || looksLikeAsset || !hasBuild) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Route inconnue.' } })
    }
    // Repli SPA : react-router gère les routes côté client.
    return reply.sendFile('index.html')
  })
}
