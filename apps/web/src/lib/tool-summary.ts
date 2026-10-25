import type { ToolItem } from './chat-fold'
import { locale, translate } from './i18n'
import { isSoleraTool } from './solera-tools'
import { toolEdits, type EditPresentation } from './tool-edits'
import { fields, scalar, text } from './tool-payload'
import { toolWebInput } from './tool-web-input'

/** `mono` distingue un fragment de code d'une phrase : les deux ne se lisent pas pareil. */
export interface ToolSummary {
  text: string
  mono: boolean
}

/** Les identifiants numériques se lisent `#53`, comme une carte ou une tâche. */
const NUMERIC_IDS = ['card_number', 'number', 'issue_number', 'taskId', 'task_id', 'id']

/** Le paramètre qui identifie l'appel, dans l'ordre où on le cherche. */
function identifyingKeys(name: string, input: Record<string, unknown> | null): string[] {
  const web = name === 'WebSearch' || name === 'WebFetch'
  if (web && input?.type === 'findInPage') return ['pattern', 'query', 'url']
  if (web && input?.type === 'openPage') return ['url', 'query']
  if (name === 'Bash') return ['command']
  if (name === 'Skill') return ['skill', 'name']
  if (name.startsWith('Hook/')) return ['source']
  if (['TaskGet', 'TaskUpdate', 'TaskStop', 'TaskOutput'].includes(name)) return ['taskId', 'task_id', 'id']
  if (['ReadMcpResource', 'ReadMcpResourceDir'].includes(name)) return ['uri', 'server']
  // Un motif cherché dit plus que le dossier où on le cherche.
  if (name === 'Grep' || name === 'Glob') return ['pattern', 'query', 'path']
  if (name === 'WebFetch') return ['url', 'query']
  if (name === 'WebSearch') return ['query', 'pattern', 'url']
  return ['file_path', 'path', 'notebook_path', 'file', 'title', 'subject', 'query', 'pattern', 'skill', 'url', 'uri',
    'command', 'prompt', 'card_number', 'number', 'issue_number', 'conversation_id', 'name']
}

/**
 * Ce que fait une commande, quand Codex l'a analysée (`commandActions`) et qu'une seule
 * action la décrit entière. Une commande composée garde sa ligne de shell.
 */
function commandSummary(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 1) return null
  const action = fields(value[0])
  const path = text(action, 'path') ?? text(action, 'name')
  if (action?.type === 'read' && path) return translate('tool.summary.read', { path })
  if (action?.type === 'listFiles' && path) return translate('tool.summary.list', { path })
  const query = text(action, 'query')
  if (action?.type === 'search' && query) {
    return path ? translate('tool.summary.searchIn', { query, path }) : translate('tool.summary.search', { query })
  }
  return null
}

/**
 * Le résumé d'une ligne d'un appel, pour les charges que les quatre adaptateurs
 * normalisent.
 *
 * Ce que l'appel cherche à faire passe avant tout le reste, là où la commande ou le
 * chemin ne disent que comment : la `description` que Claude Code joint à ses `Bash` et
 * à ses sous-agents, sinon l'intitulé que le harnais a écrit (ACP, OpenCode), sinon ce
 * que Codex a compris de la commande. La `description` d'un autre outil n'en est pas
 * une : celle d'une carte ou d'une tâche est son corps. À défaut, le paramètre
 * identifiant reprend la main.
 *
 * La commande ne disparaît pas pour autant : elle reste sous l'entrée de l'appel déplié.
 */
export function toolSummary(tool: ToolItem, edits: EditPresentation | null = toolEdits(tool)): ToolSummary | null {
  const input = fields(toolWebInput(tool))
  const description = ['Bash', 'Agent', 'Task'].includes(tool.name) ? text(input, 'description')?.trim() : null
  const title = description || tool.presentation?.title?.trim()
  if (title) return { text: title, mono: false }
  if (tool.name === 'Bash') {
    const action = commandSummary(input?.commandActions)
    if (action) return { text: action, mono: false }
  }
  // Le titre qu'un agent donne à sa session se lit comme une phrase, pas comme du code.
  if (isSoleraTool(tool.name, 'rename_session')) {
    const sessionTitle = text(input, 'title')
    if (sessionTitle) return { text: sessionTitle, mono: false }
  }
  if (edits?.paths.length) return { text: edits.paths.join(' · '), mono: true }

  const web = tool.name === 'WebSearch' || tool.name === 'WebFetch'
  if (web && Array.isArray(input?.queries)) {
    const queries = input.queries.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    if (queries.length > 0) return { text: queries.join(' · '), mono: true }
  }
  const subject = ['TaskCreate', 'TaskUpdate'].includes(tool.name) ? text(input, 'subject') : null
  if (subject) return { text: subject, mono: false }
  if (tool.name === 'Sleep' && typeof input?.durationMs === 'number' && Number.isFinite(input.durationMs)) {
    const seconds = (input.durationMs / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })
    return { text: translate('tool.summary.sleep', { seconds }), mono: false }
  }

  for (const key of identifyingKeys(tool.name, input)) {
    const numeric = NUMERIC_IDS.includes(key)
    const value = numeric ? scalar(input, key) : text(input, key)
    if (value !== null) return { text: numeric ? `#${value}` : value, mono: true }
  }
  if (tool.presentation?.paths?.length) return { text: tool.presentation.paths.join(' · '), mono: true }
  if (Array.isArray(input?.todos)) {
    const count = input.todos.length
    return { text: translate(count === 1 ? 'tool.todo.count.one' : 'tool.todo.count.many', { count }), mono: false }
  }
  return null
}
