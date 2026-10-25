import type { ToolPresentation } from '@solera/protocol'
import type { ToolItem } from './chat-fold'
import { translate, type MessageKey } from './i18n'
import { outputText } from './tool-payload'

/**
 * D'où vient un outil : du CLI lui-même, du serveur MCP de Solera, ou d'un autre
 * serveur MCP. Le fil les distingue sans ajouter de ligne : le symbole de Solera, ou
 * une marque MCP avec le nom du serveur.
 */
export type ToolOrigin = { kind: 'native' | 'solera' | 'mcp'; server: string; name: string }

/**
 * Le même outil MCP s'écrit `mcp__serveur__outil` chez Claude, `serveur/outil` chez
 * Codex et dans les adaptateurs qui le normalisent, `solera_outil` dans un ancien
 * journal d'OpenCode. Les espaces `Collaboration/…`, `Codex/…` et `Hook/…` sont ceux de
 * l'adaptateur Codex, pas des serveurs MCP.
 */
export function toolOrigin(name: string, presentation?: ToolPresentation): ToolOrigin {
  if (presentation?.origin === 'native') return { kind: 'native', server: '', name }
  if (presentation?.origin !== 'mcp' && /^(Collaboration|Codex|Hook)\//.test(name)) return { kind: 'native', server: '', name }
  const claude = /^mcp__(.+?)__(.+)$/.exec(name)
  const slash = /^([^/]+)\/(.+)$/.exec(name)
  const legacy = name.startsWith('solera_') ? ['', 'solera', name.slice('solera_'.length)] : null
  const match = claude ?? slash ?? legacy
  if (!match) return { kind: 'native', server: '', name }
  return { kind: match[1] === 'solera' ? 'solera' : 'mcp', server: match[1]!, name: match[2]! }
}

/** Les outils du serveur `solera`, sous un nom qui se lit (voir `solera-mcp.mjs`). */
const SOLERA_LABELS: Record<string, MessageKey> = {
  search_history: 'soleraTool.search_history',
  read_conversation: 'soleraTool.read_conversation',
  list_sessions: 'soleraTool.list_sessions',
  find_file_edits: 'soleraTool.find_file_edits',
  list_cards: 'soleraTool.list_cards',
  read_card: 'soleraTool.read_card',
  add_card_note: 'soleraTool.add_card_note',
  move_card: 'soleraTool.move_card',
  create_card: 'soleraTool.create_card',
  append_card_description: 'soleraTool.append_card_description',
  edit_subtasks: 'soleraTool.edit_subtasks',
  link_card: 'soleraTool.link_card',
  list_actions: 'soleraTool.list_actions',
  register_action: 'soleraTool.register_action',
  remove_action: 'soleraTool.remove_action',
  run_action: 'soleraTool.run_action',
  start_session: 'soleraTool.start_session',
  create_worktree: 'soleraTool.create_worktree',
  list_worktrees: 'soleraTool.list_worktrees',
  schedule_task: 'soleraTool.schedule_task',
  list_models: 'soleraTool.list_models',
  rename_session: 'soleraTool.rename_session',
  set_project_image: 'soleraTool.set_project_image',
  send_session_message: 'soleraTool.send_session_message',
  broadcast_session_message: 'soleraTool.broadcast_session_message',
  notify_when_done: 'soleraTool.notify_when_done',
  read_session_messages: 'soleraTool.read_session_messages',
  read_instructions: 'soleraTool.read_instructions',
  edit_instructions: 'soleraTool.edit_instructions',
  write_instructions: 'soleraTool.write_instructions',
  read_memory: 'soleraTool.read_memory',
  write_memory: 'soleraTool.write_memory',
  delete_memory: 'soleraTool.delete_memory',
  create_project: 'soleraTool.create_project',
  move_conversation: 'soleraTool.move_conversation',
  request_card_change: 'soleraTool.request_card_change',
  request_decision: 'soleraTool.request_decision',
  count_active_sessions: 'soleraTool.count_active_sessions',
  list_components: 'soleraTool.list_components',
  read_component: 'soleraTool.read_component',
  read_ds_page: 'soleraTool.read_ds_page',
  show_prototype: 'soleraTool.show_prototype',
  list_projects: 'soleraTool.list_projects',
  interrupt_session: 'soleraTool.interrupt_session',
  reply_session: 'soleraTool.reply_session',
}

/**
 * Le nom d'un outil dans le fil. Un outil de Solera a le sien ; l'étiquette qu'un
 * connecteur donne à son opération passe ensuite ; un serveur inconnu ne reçoit aucun
 * sens inventé, seulement son nom sans préfixe ni séparateurs. Le nom brut reste lisible
 * dans le détail de l'appel.
 */
export function toolLabel(name: string, presentation?: ToolPresentation): string {
  const origin = toolOrigin(name, presentation)
  const key = origin.kind === 'solera' ? SOLERA_LABELS[origin.name] : undefined
  if (key) return translate(key)
  const label = presentation?.label?.trim()
  if (label) return label
  return origin.kind === 'native' ? name : origin.name.replace(/[_-]+/g, ' ')
}

/**
 * Ce que fait un appel, en cinq familles, pour la présentation `intent`. Une
 * classification locale : on ne prétend pas connaître l'intention du modèle.
 */
export type ToolIntent = 'context' | 'inspect' | 'change' | 'verify' | 'other'

export const INTENT_LABELS: Record<ToolIntent, MessageKey> = {
  context: 'toolStyle.intent.context',
  inspect: 'toolStyle.intent.inspect',
  change: 'toolStyle.intent.change',
  verify: 'toolStyle.intent.verify',
  other: 'toolStyle.intent.other',
}

export function toolIntent(tool: ToolItem): ToolIntent {
  const origin = toolOrigin(tool.name, tool.presentation)
  if (origin.kind === 'solera') return /^(read|list|search|find|count)_/.test(origin.name) ? 'context' : 'change'
  if (['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'ViewImage'].includes(tool.name)) return 'inspect'
  if (['Edit', 'Write', 'ApplyPatch', 'NotebookEdit'].includes(tool.name)) return 'change'
  // Une commande quelconque n'est pas une vérification : seuls les mots qui la disent.
  const command = (tool.input as { command?: unknown } | null)?.command
  if (tool.name === 'Bash' && /(?:^|[\s:])(?:test|typecheck|lint|check)(?:$|[\s:])/.test(String(command ?? ''))) return 'verify'
  return 'other'
}

/** Au-delà, un aperçu d'une ligne n'a plus rien à montrer. */
const PREVIEW_CHARS = 500

/** La première ligne d'une sortie, pour la présentation `cards`, sans charger un corps laissé au serveur. */
export function toolPreview(tool: ToolItem): string {
  if (tool.status === 'running') return translate('toolStyle.outputPending')
  const text = outputText(tool.output)?.slice(0, PREVIEW_CHARS).replace(/\s+/g, ' ').trim()
  return text || translate('toolStyle.outputEmpty')
}
