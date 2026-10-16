import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk'
import { CONTEXT_DETAIL_MAX_ROWS, type ContextBreakdown, type ContextEntry } from '@solera/protocol'

/**
 * Traduction de la réponse `get_context_usage` du CLI vers le relevé de Solera.
 *
 * Comme pour `usage.ts`, la lecture ne présume rien : elle parcourt ce qui est là,
 * ignore ce qu'elle ne reconnaît pas, et n'échoue jamais sur un champ manquant. La
 * réponse est l'un des payloads les plus riches du SDK (elle porte en plus la grille
 * de carrés du TUI, le découpage des messages, l'usage API du dernier appel) et elle
 * évolue par ajouts : ce qui n'est pas lu ici est volontairement laissé de côté.
 *
 * Écart avec ce que la carte #45 annonçait : la méthode rend
 * `SDKControlGetContextUsageResponse`, en camelCase, et non le `SDKContextUsage` en
 * snake_case qui voyage sur le résultat de `/context`. Les deux décrivent la même
 * mesure mais ne se ressemblent pas : pas d'`over_limit` ici, un `maxTokens` **et** un
 * `rawMaxTokens`, et `skills` est un objet de totaux dont le nominatif vit dans
 * `skillFrontmatter`.
 */

/**
 * La fenêtre contre laquelle on rapporte l'occupation.
 *
 * `rawMaxTokens` est la fenêtre d'auto-compaction résolue — la limite crue du modèle,
 * ou une fenêtre de politique plus petite. C'est elle que le CLI emploie pour son
 * `percentage`, donc la seule qui réconcilie la pastille et la modale. `maxTokens`
 * coïncide avec elle sur un modèle sans politique particulière (mesuré : 1 000 000
 * pour les deux sur `claude-opus-5[1m]`), et c'est faute de mieux qu'on y retombe.
 */
export function contextWindow(usage: SDKControlGetContextUsageResponse): number | null {
  for (const value of [usage.rawMaxTokens, usage.maxTokens]) {
    if (typeof value === 'number' && value > 0) return value
  }
  return null
}

/** Trie par poids décroissant et coupe : voir `CONTEXT_DETAIL_MAX_ROWS`. */
function heaviest(entries: ContextEntry[]): ContextEntry[] {
  return entries
    .filter((entry) => entry.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, CONTEXT_DETAIL_MAX_ROWS)
}

export function contextBreakdown(usage: SDKControlGetContextUsageResponse): ContextBreakdown {
  return {
    axis: 'categories',
    // Les lignes à zéro ne disent rien et prendraient la place de celles qui parlent ;
    // les lignes `deferred`, elles, sont gardées même si elles ne comptent pas dans
    // l'occupation : savoir qu'un serveur MCP pèse 8 000 jetons hors fenêtre est
    // précisément ce qui fait décider de le couper.
    categories: (usage.categories ?? [])
      .filter((row) => row.tokens > 0)
      .map((row) => ({ label: row.name, tokens: row.tokens, kind: row.kind })),
    memoryFiles: heaviest(
      (usage.memoryFiles ?? []).map((file) => ({
        name: file.path,
        source: file.type ?? null,
        tokens: file.tokens,
      })),
    ),
    mcpTools: heaviest(
      (usage.mcpTools ?? []).map((tool) => ({
        name: tool.name,
        source: tool.serverName ?? null,
        tokens: tool.tokens,
      })),
    ),
    agents: heaviest(
      (usage.agents ?? []).map((agent) => ({
        name: agent.agentType,
        source: agent.source ?? null,
        tokens: agent.tokens,
      })),
    ),
    // Les skills arrivent emboîtés : un bloc de totaux, et le nominatif dedans. Seul
    // le nominatif intéresse la modale, le total se relit sur la ligne « Skills » des
    // catégories.
    skills: heaviest(
      (usage.skills?.skillFrontmatter ?? []).map((skill) => ({
        name: skill.name,
        source: skill.source ?? null,
        tokens: skill.tokens,
      })),
    ),
  }
}
