/**
 * Les outils du serveur MCP de Solera, sous le nom que chaque CLI leur donne.
 *
 * Le même appel s'appelle `mcp__solera__schedule_task` chez Claude, `solera/schedule_task`
 * chez Codex (`serveur/outil`, voir `codex/item-events.ts`) et `solera_schedule_task`
 * chez OpenCode. Reconnaître l'outil, c'est reconnaître les trois.
 */
export function isSoleraTool(name: string, tool: string): boolean {
  return name === `mcp__solera__${tool}` || name === `solera/${tool}` || name === `solera_${tool}`
}

/** L'identifiant de tâche que `schedule_task` rend dans sa réponse : « … créée, id <uuid>. » */
export function scheduledTaskIdOf(output: string | null): string | null {
  return output?.match(/créée, id ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/)?.[1] ?? null
}
