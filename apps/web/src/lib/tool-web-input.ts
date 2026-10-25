import { codexWebSearchInput } from '@solera/protocol'
import type { ToolItem } from './chat-fold'
import { fields } from './tool-payload'

/**
 * Les arguments définitifs d'une recherche web de Codex, dans un journal antérieur au
 * rafraîchissement de l'entrée à la complétion : ils n'y vivent que dans la sortie, que
 * l'aperçu du serveur garde exprès pour qu'un appel replié se résume sans charger le corps.
 */
export function toolWebInput(tool: Pick<ToolItem, 'name' | 'input' | 'output' | 'status'>): unknown {
  if ((tool.name !== 'WebSearch' && tool.name !== 'WebFetch') || tool.status === 'running') return tool.input
  const output = fields(tool.output)
  if (!output || typeof output.query !== 'string' || !('action' in output) || !('results' in output)) return tool.input
  const action = fields(output.action)
  if (!action && !output.query.trim()) return tool.input
  if (output.action !== null && (!action || !['search', 'openPage', 'findInPage', 'other'].includes(String(action.type)))) return tool.input
  return { ...fields(tool.input), ...codexWebSearchInput(output.query, action) }
}
