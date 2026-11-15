import type { EditorSeed } from './action-editor'
import { formatDuration, type Translate } from './automations'
import type { BackgroundWork } from './background'
import type { ChatItem, EditTurn } from './chat-fold'
import { familyOf, portIn, seedFromWork } from './session-works'
import type { SubAgent } from './subagents'

/**
 * Ce que l'onglet **Agent** du panneau lit du journal (`actions.md`, PAG-1 à PAG-7) : ce
 * qui tourne sous le fil, et ce que chacun a écrit ou rendu.
 *
 * Tout vient du seul fil (invariant I2) :
 * - les fichiers d'un sous-agent sont ses appels d'écriture (Edit, Write, MultiEdit,
 *   NotebookEdit, ou un outil qui déclare ses chemins) ; le +/− se tire de l'entrée de
 *   l'appel, c'est ce que l'agent a demandé d'écrire, pas un diff du disque ;
 * - son résultat est son dernier message, ce qu'il rend à l'agent principal ;
 * - les fichiers de la session (`EditTurn`) portent les appels qui les ont touchés : chacun
 *   revient au sous-agent dont le fil contient l'appel, sinon à l'agent principal.
 */

const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'edit', 'write', 'apply_patch'])

export interface TouchedFile {
  path: string
  /** Nuls quand une de ses écritures ne dit pas ce qu'elle change. */
  added: number | null
  removed: number | null
  passes: number
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

function writtenPath(item: Extract<ChatItem, { kind: 'tool' }>): string | null {
  const declared = item.presentation?.paths
  const writes = WRITE_TOOLS.has(item.name) || (declared !== undefined && declared.length > 0 && /write|edit|patch/i.test(item.name))
  if (!writes) return null
  const direct = field(item.input, 'file_path') ?? field(item.input, 'notebook_path') ?? field(item.input, 'path')
  if (typeof direct === 'string' && direct) return direct
  return declared?.[0] ?? null
}

/** Les fichiers qu'un sous-agent a écrits lui-même, dans l'ordre de leur première écriture. */
export function filesOf(agent: SubAgent): TouchedFile[] {
  const files = new Map<string, TouchedFile>()
  for (const item of agent.items) {
    if (item.kind !== 'tool' || item.parentToolCallId !== agent.id) continue
    const path = writtenPath(item)
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

/** Ce que le sous-agent a rendu : le texte de son dernier message qui en a. */
export function resultOf(agent: SubAgent): string | null {
  for (let index = agent.items.length - 1; index >= 0; index -= 1) {
    const item = agent.items[index]!
    if (item.kind !== 'message' || item.role !== 'assistant' || item.parentToolCallId !== agent.id) continue
    const text = item.blocks
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n\n')
      .trim()
    if (text) return text
  }
  return null
}

export interface SessionFile {
  path: string
  passes: number
  added: number | null
  removed: number | null
  /** L'agent principal y a écrit. */
  byMain: boolean
  /** Les sous-agents qui y ont écrit, par identifiant, dans l'ordre de leur première écriture. */
  agents: string[]
}

/** Les fichiers écrits pendant la session, chacun rattaché à qui l'a écrit. */
export function sessionFiles(turns: EditTurn[], agents: SubAgent[]): SessionFile[] {
  const owner = new Map<string, string>()
  for (const agent of agents) {
    for (const item of agent.items) if (item.kind === 'tool' && item.parentToolCallId === agent.id) owner.set(item.id, agent.id)
  }
  const files = new Map<string, { path: string; passes: number; byMain: boolean; agents: string[] }>()
  for (const turn of turns) {
    for (const file of turn.files) {
      const entry = files.get(file.path) ?? { path: file.path, passes: 0, byMain: false, agents: [] }
      entry.passes += file.toolCallIds.length
      for (const id of file.toolCallIds) {
        const agentId = owner.get(id)
        if (!agentId) entry.byMain = true
        else if (!entry.agents.includes(agentId)) entry.agents.push(agentId)
      }
      files.set(file.path, entry)
    }
  }

  const perAgent = new Map(agents.map((agent) => [agent.id, new Map(filesOf(agent).map((file) => [file.path, file]))]))
  return [...files.values()].map((entry) => {
    // Le +/− n'est connu que de ce qu'ont écrit les sous-agents : leur fil est là, celui de
    // l'agent principal ne passe pas par ici.
    const known = entry.byMain ? [] : entry.agents.map((id) => perAgent.get(id)?.get(entry.path))
    const sum = (key: 'added' | 'removed') =>
      known.length > 0 && known.every((file) => file !== undefined && file[key] !== null)
        ? known.reduce((total, file) => total + (file![key] ?? 0), 0)
        : null
    return {
      ...entry,
      added: sum('added'),
      removed: sum('removed'),
    }
  })
}

export type AgentEntry =
  | { kind: 'agent'; key: string; node: AgentNode }
  | { kind: 'work'; key: string; work: BackgroundWork }

/** Un sous-agent et ceux qu'il a lancés, comme l'arbre du panneau de Claude Code. */
export interface AgentNode {
  agent: SubAgent
  children: AgentNode[]
  /** Tous ceux qu'il porte, à toute profondeur : le `(+N)` de sa ligne. */
  descendants: number
}

/**
 * Range une liste de sous-agents en arbre, dans l'ordre de la liste : chacun sous son plus
 * proche ancêtre **de la liste**. `all` sert à remonter la chaîne : un agent terminé dont le
 * parent travaille encore n'a pas ce parent dans le même groupe, il remonte donc à la racine
 * plutôt que de disparaître.
 */
export function agentTree(list: SubAgent[], all: SubAgent[]): AgentNode[] {
  const byId = new Map(all.map((agent) => [agent.id, agent]))
  const nodes = new Map(list.map((agent) => [agent.id, { agent, children: [], descendants: 0 } as AgentNode]))
  const roots: AgentNode[] = []
  for (const node of nodes.values()) {
    let parentId = node.agent.parentId
    // Le compte borne la remontée : un journal incohérent ne doit pas faire tourner l'onglet.
    for (let hops = 0; parentId && !nodes.has(parentId) && hops < byId.size; hops += 1) parentId = byId.get(parentId)?.parentId ?? null
    const parent = parentId && parentId !== node.agent.id ? nodes.get(parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const count = (node: AgentNode): number => {
    node.descendants = node.children.reduce((sum, child) => sum + 1 + count(child), 0)
    return node.descendants
  }
  roots.forEach(count)
  return roots
}

/** Les lignes à montrer d'un arbre, avec leur profondeur ; un nœud replié cache sa descendance. */
export function treeRows(nodes: AgentNode[], folded: ReadonlySet<string>, depth = 0): { node: AgentNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...(folded.has(node.agent.id) ? [] : treeRows(node.children, folded, depth + 1)),
  ])
}

/**
 * Les deux groupes de l'onglet (PAG-1, PAG-4). **En cours** : les sous-agents qui
 * travaillent, du plus ancien au plus récent, rangés en arbre, puis les travaux de fond —
 * le journal ne date pas ces derniers. **Terminés** : les autres, en arbre aussi, du plus
 * récent au plus ancien.
 */
export function agentGroups(agents: SubAgent[], background: BackgroundWork[]): { running: AgentEntry[]; done: AgentNode[] } {
  const running = agents.filter((agent) => agent.status === 'running').sort((a, b) => a.startedAt - b.startedAt)
  const done = agents.filter((agent) => agent.status !== 'running').sort((a, b) => b.startedAt - a.startedAt)
  return {
    running: [
      ...agentTree(running, agents).map((node) => ({ kind: 'agent' as const, key: node.agent.id, node })),
      ...background.map((work) => ({ kind: 'work' as const, key: work.id, work })),
    ],
    done: agentTree(done, agents),
  }
}

/** « sonnet · high » : ce que l'appel a demandé, rien quand il n'a rien demandé. */
export function modelLabel(agent: Pick<SubAgent, 'model' | 'effort'>): string | null {
  return [agent.model, agent.effort].filter(Boolean).join(' · ') || null
}

export function toolCount(count: number, t: Translate): string {
  return t(count > 1 ? 'panel.agent.tools.other' : 'panel.agent.tools.one', { count })
}

/** La méta courte d'une ligne de sous-agent : « 2 min · 14 outils », ou « arrêté » s'il n'a pas abouti. */
export function agentMeta(agent: SubAgent, now: number, t: Translate): string {
  if (agent.status === 'interrupted' || agent.status === 'failed') return t('panel.agent.state.stopped')
  const spent = agent.status === 'running' ? Math.max(0, now - agent.startedAt) : agent.durationMs
  return [spent !== null ? formatDuration(spent, t) : null, agent.toolCount > 0 ? toolCount(agent.toolCount, t) : null]
    .filter(Boolean)
    .join(' · ')
}

/** « En faire une action » depuis un travail de fond (PAG-12) : la graine de l'éditeur. */
export function workSeed(work: BackgroundWork, conversationTitle: string, t: Translate): EditorSeed {
  return seedFromWork(
    { conversationTitle, family: familyOf(work.kind), description: work.description || null, command: work.command, port: workPort(work) },
    t,
  )
}

/** Le port qu'un travail de fond annonce, dans sa commande ou sa description. */
export function workPort(work: BackgroundWork): number | null {
  return portIn(work.command ?? work.description)
}
