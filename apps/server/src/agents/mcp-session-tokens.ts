import { randomBytes, randomUUID } from 'node:crypto'
import type { McpSessionScope } from './mcp-builtin.js'

/**
 * Les jetons qui ouvrent le serveur MCP de Solera à une session, et à elle seule.
 *
 * Le CLI d'une session ne lance plus le serveur MCP : il le joint par HTTP, sous
 * `/api/v1/mcp`, avec ce jeton en Bearer. C'est le serveur de Solera qui lance le
 * process, sur l'hôte, avec la portée que le jeton désigne. L'agent ne voit donc ni la
 * base ni le chemin qui y mène, qu'il tourne sur l'hôte, confiné ou dans un conteneur
 * (ADR 0001).
 *
 * En mémoire seulement : un jeton ne vaut que pour le runner qui l'a reçu, et un
 * redémarrage du serveur emporte de toute façon les runners. Rien à purger, rien à
 * chiffrer sur le disque.
 */

/** Distinct de `solera_pat_` : les deux familles ne se confondent ni à l'œil ni au code. */
export const MCP_SESSION_TOKEN_PREFIX = 'solera_mcp_'

export interface McpSessionGrant {
  /** Identifiant non secret, qui sert de propriétaire aux sessions HTTP du pont. */
  id: string
  conversationId: string
  scope: McpSessionScope
}

type RevokeListener = (grantIds: string[]) => void

export class McpSessionTokens {
  private readonly bySecret = new Map<string, McpSessionGrant>()
  /** Par conversation, le secret de chaque portée émise : la clé est la portée sérialisée. */
  private readonly byConversation = new Map<string, Map<string, string>>()
  private readonly listeners: RevokeListener[] = []

  /**
   * Le jeton d'une portée, le même tant qu'elle ne change pas.
   *
   * Les runners comparent les serveurs résolus pour décider d'une relance ou d'un
   * `setMcpServers` : un jeton neuf à chaque résolution les ferait repartir sans raison.
   * Une portée qui change en reçoit un autre, et le précédent reste valable jusqu'à la
   * révocation, le temps que le CLI qui le tient soit relancé.
   */
  issue(conversationId: string, scope: McpSessionScope): string {
    const key = JSON.stringify(scope)
    let issued = this.byConversation.get(conversationId)
    const known = issued?.get(key)
    if (known) return known

    const secret = `${MCP_SESSION_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    this.bySecret.set(secret, { id: randomUUID(), conversationId, scope })
    if (!issued) {
      issued = new Map()
      this.byConversation.set(conversationId, issued)
    }
    issued.set(key, secret)
    return secret
  }

  resolve(secret: string): McpSessionGrant | null {
    if (!secret.startsWith(MCP_SESSION_TOKEN_PREFIX)) return null
    return this.bySecret.get(secret) ?? null
  }

  /** Révoque tout de suite les jetons de la conversation. */
  revoke(conversationId: string): void {
    this.detach(conversationId)()
  }

  /**
   * Détache les jetons de la conversation et rend de quoi les révoquer plus tard.
   *
   * En deux temps pour l'arrêt d'un runner : ses jetons doivent rester valables tant
   * que son CLI finit de s'arrêter, mais un runner relancé entre-temps pour la même
   * conversation ne doit pas les reprendre, sans quoi leur révocation le couperait.
   * Détachés, ils ne sont plus rendus par `issue`, qui en frappe de neufs.
   */
  detach(conversationId: string): () => void {
    const issued = this.byConversation.get(conversationId)
    this.byConversation.delete(conversationId)
    const secrets = [...(issued?.values() ?? [])]
    return () => {
      const grantIds: string[] = []
      for (const secret of secrets) {
        const grant = this.bySecret.get(secret)
        if (!grant) continue
        grantIds.push(grant.id)
        this.bySecret.delete(secret)
      }
      if (grantIds.length === 0) return
      for (const listener of this.listeners) listener(grantIds)
    }
  }

  onRevoke(listener: RevokeListener): void {
    this.listeners.push(listener)
  }
}
