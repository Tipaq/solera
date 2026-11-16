import type { ApiTokenRow, Db, UserRow } from '@solera/db'
import type { McpSessionGrant } from '../agents/mcp-session-tokens.js'
import type { Config } from '../config.js'

export interface AppContext {
  db: Db
  config: Config
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Renseigné par le hook d'authentification, absent sur les routes publiques. */
    user?: UserRow
    /**
     * Jeton d'API présenté en Bearer, quand l'appelant est une machine. `user` porte
     * alors son propriétaire : un jeton emprunte une identité, il n'en crée pas.
     */
    apiToken?: ApiTokenRow
    /**
     * Jeton de session présenté en Bearer par le CLI d'une conversation : il n'ouvre
     * que le serveur MCP, avec la portée de cette session, et aucun compte.
     */
    mcpGrant?: McpSessionGrant
  }
}
