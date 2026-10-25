/**
 * Arguments d'une recherche web de Codex. Codex ne les révèle parfois qu'à la
 * complétion de l'item : on garde tous les champs de l'action, et un `action.query`
 * vide ou nul n'efface pas la requête que l'item porte, lui.
 */
export function codexWebSearchInput(query: string, action: Record<string, unknown> | null): Record<string, unknown> {
  return {
    ...action,
    query: typeof action?.query === 'string' && action.query.trim() ? action.query : query,
  }
}
