/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Ce qu'un sous-agent a écrit, et ce qu'il a rendu, déduits de son seul fil (I2) :
 * - ses appels d'écriture (Edit, Write, MultiEdit, NotebookEdit, ou un outil qui
 *   déclare ses chemins), d'où le fichier et un compte +/− approximatif tiré de
 *   l'entrée de l'appel — c'est ce que l'agent a demandé d'écrire, pas un diff du disque ;
 * - son dernier message, qui est ce qu'il rend à l'agent principal.
 * Les fichiers de la session (`EditTurn`) portent les appels qui les ont touchés : on
 * rattache chacun au sous-agent dont le fil contient l'appel, sinon à l'agent principal.
 */
import type { ChatItem, EditTurn } from '../../../lib/chat-fold'
import { subAgentLabel, type SubAgent } from '../../../lib/subagents'

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit', 'write', 'apply_patch'])

export interface TouchedFile {
  path: string
  added: number | null
  removed: number | null
  passes: number
  /** Les appels qui l'ont touché, pour défiler jusqu'au premier dans le fil. */
  toolCallIds: string[]
}

function lines(value: unknown): number {
  return typeof value === 'string' && value.length > 0 ? value.split('\n').length : 0
}

function field(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
}

/** Le +/− qu'un appel d'écriture demande, quand son entrée le dit. */
function delta(name: string, input: unknown): { added: number; removed: number } | null {
  if (name === 'Write' || name === 'write') return { added: lines(field(input, 'content')), removed: 0 }
  if (name === 'Edit' || name === 'edit') return { added: lines(field(input, 'new_string')), removed: lines(field(input, 'old_string')) }
  if (name === 'MultiEdit') {
    const edits = field(input, 'edits')
    if (!Array.isArray(edits)) return null
    return edits.reduce<{ added: number; removed: number }>(
      (sum, edit) => ({ added: sum.added + lines(field(edit, 'new_string')), removed: sum.removed + lines(field(edit, 'old_string')) }),
      { added: 0, removed: 0 },
    )
  }
  if (name === 'NotebookEdit') return { added: lines(field(input, 'new_source')), removed: 0 }
  return null
}

function pathOf(name: string, input: unknown, declared: string[] | undefined): string | null {
  const direct = field(input, 'file_path') ?? field(input, 'notebook_path') ?? field(input, 'path')
  if (typeof direct === 'string' && direct) return direct
  return WRITE_TOOLS.has(name) && declared && declared.length > 0 ? declared[0]! : null
}

/** Les fichiers qu'un sous-agent a écrits, dans l'ordre de leur première écriture. */
export function filesOf(agent: SubAgent): TouchedFile[] {
  const files = new Map<string, TouchedFile>()
  for (const item of agent.items) {
    if (item.kind !== 'tool' || item.parentToolCallId !== agent.id) continue
    if (!WRITE_TOOLS.has(item.name) && !(item.presentation?.paths?.length && /write|edit|patch/i.test(item.name))) continue
    const path = pathOf(item.name, item.input, item.presentation?.paths)
    if (!path) continue
    const entry = files.get(path) ?? { path, added: 0, removed: 0, passes: 0, toolCallIds: [] }
    const change = delta(item.name, item.input)
    entry.added = change && entry.added !== null ? entry.added + change.added : null
    entry.removed = change && entry.removed !== null ? entry.removed + change.removed : null
    entry.passes += 1
    entry.toolCallIds.push(item.id)
    files.set(path, entry)
  }
  return [...files.values()]
}

/** Ce que le sous-agent a rendu : le texte de son dernier message. */
export function resultOf(agent: SubAgent): string | null {
  for (let index = agent.items.length - 1; index >= 0; index -= 1) {
    const item: ChatItem = agent.items[index]!
    if (item.kind !== 'message' || item.role !== 'assistant' || item.parentToolCallId !== agent.id) continue
    const text = item.blocks.filter((block) => block.type === 'text').map((block) => (block as { text: string }).text).join('\n\n').trim()
    if (text) return text
  }
  return null
}

export interface SessionFile {
  path: string
  passes: number
  added: number | null
  removed: number | null
  /** « agent principal », ou les sous-agents qui l'ont touché. */
  by: string[]
  /** Le sous-agent à ouvrir depuis la ligne, s'il n'y en a qu'un. */
  agentId: string | null
}

/** Les fichiers de la session, chacun rattaché à qui l'a écrit. */
export function sessionFiles(turns: EditTurn[], agents: SubAgent[]): SessionFile[] {
  const owner = new Map<string, SubAgent>()
  for (const agent of agents) {
    for (const item of agent.items) if (item.kind === 'tool') owner.set(item.id, agent)
  }
  const perAgent = new Map(agents.map((agent) => [agent.id, new Map(filesOf(agent).map((file) => [file.path, file]))]))
  const files = new Map<string, SessionFile & { owners: Set<string> }>()
  for (const turn of turns) {
    for (const file of turn.files) {
      const entry = files.get(file.path) ?? { path: file.path, passes: 0, added: null, removed: null, by: [], agentId: null, owners: new Set<string>() }
      entry.passes += file.toolCallIds.length
      for (const id of file.toolCallIds) {
        const agent = owner.get(id)
        entry.owners.add(agent ? agent.id : 'main')
      }
      files.set(file.path, entry)
    }
  }
  return [...files.values()].map(({ owners, ...entry }) => {
    const ids = [...owners]
    const subs = ids.filter((id) => id !== 'main')
    // Le +/− n'est connu que pour ce qu'ont écrit les sous-agents : leur fil est là.
    const known = subs.length > 0 && !owners.has('main')
      ? subs.map((id) => perAgent.get(id)?.get(entry.path)).filter((file): file is TouchedFile => file !== undefined)
      : []
    const sum = (key: 'added' | 'removed') => (known.length > 0 && known.every((file) => file[key] !== null) ? known.reduce((total, file) => total + (file[key] ?? 0), 0) : null)
    return {
      ...entry,
      added: sum('added'),
      removed: sum('removed'),
      by: ids.map((id) => (id === 'main' ? 'agent principal' : subAgentLabel(agents.find((agent) => agent.id === id)!))),
      agentId: subs.length === 1 && !owners.has('main') ? subs[0]! : null,
    }
  })
}

/** Fait défiler le fil principal jusqu'à un appel d'outil, s'il est rendu. */
export function revealToolCall(id: string): boolean {
  const node = document.querySelector<HTMLElement>(`[data-tool-id="${CSS.escape(id)}"]`)
  if (!node) return false
  node.scrollIntoView({ behavior: 'smooth', block: 'center' })
  node.animate?.([{ boxShadow: '0 0 0 2px var(--color-accent)' }, { boxShadow: '0 0 0 0 transparent' }], { duration: 1600 })
  return true
}
