import type { FastifyInstance } from 'fastify'
import { MCP_ENDPOINT_PATH } from '../agents/mcp-builtin.js'
import type { McpSessionTokens } from '../agents/mcp-session-tokens.js'
import { bearerSecret, resolveApiToken } from '../auth/api-tokens.js'
import { resolveSession } from '../auth/sessions.js'
import type { AppContext } from './context.js'
import { HttpError, unauthorized } from './errors.js'

/**
 * Routes accessibles sans session. Tout le reste exige un utilisateur.
 *
 * Le profil de l'instance en fait partie : l'interface l'attend avant de dessiner quoi que
 * ce soit, page de connexion comprise. La création du premier compte aussi : elle se
 * ferme d'elle-même dès qu'un compte existe.
 */
const PUBLIC_ROUTES = new Set(['/api/auth/login', '/api/auth/setup', '/api/health', '/api/system/instance'])

/**
 * L'API publique, réservée aux jetons.
 *
 * La frontière est nette dans les deux sens : un cookie n'y entre pas, un jeton ne sort
 * pas de ce préfixe. C'est ce qui permet aux DTO de l'interface de bouger sans devenir
 * un contrat public, et ce qui interdit à un jeton volé d'atteindre l'administration
 * des comptes.
 */
const API_V1_PREFIX = '/api/v1/'

/**
 * Qui appelle, et où il a le droit d'aller : un jeton de session, un jeton d'API ou le
 * cookie de l'interface. À part de `buildApp` pour que les tests du pont MCP passent
 * par le même garde que le serveur.
 */
export function registerAuthHooks(app: FastifyInstance, ctx: AppContext, mcpTokens: McpSessionTokens): void {
  // Résolution de l'identité sur toute requête. Les routes décident ensuite si elles
  // exigent un utilisateur, via requireUser().
  app.addHook('onRequest', async (request) => {
    const secret = bearerSecret(request.headers.authorization)
    const grant = secret ? mcpTokens.resolve(secret) : null
    if (grant) {
      request.mcpGrant = grant
      return
    }
    const identity = secret ? resolveApiToken(ctx.db, secret) : null
    if (identity) {
      request.apiToken = identity.token
      request.user = identity.user
      return
    }

    // Repli sur le cookie même en présence d'un en-tête `Authorization` : un proxy ou
    // une extension qui en ajoute un ne doit pas rendre l'interface inutilisable.
    const token = request.cookies[ctx.config.sessionCookie]
    if (!token) return
    const user = await resolveSession(ctx.db, token)
    if (user) request.user = user
  })

  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return
    const path = request.url.split('?')[0] ?? request.url
    if (PUBLIC_ROUTES.has(path) || path === '/api/auth/logout') return

    // Le jeton d'une session n'ouvre que son serveur MCP.
    if (request.mcpGrant) {
      if (path === MCP_ENDPOINT_PATH) return
      throw new HttpError(403, 'session_token_outside_mcp', 'A session token only grants access to /api/v1/mcp.')
    }

    if (path.startsWith(API_V1_PREFIX)) {
      if (!request.apiToken) {
        throw new HttpError(401, 'api_token_required', 'This API requires a bearer token.')
      }
      return
    }

    if (request.apiToken) {
      throw new HttpError(
        403,
        'token_outside_api',
        'A bearer token only grants access to /api/v1.',
      )
    }
    if (!request.user) throw unauthorized()
  })
}
