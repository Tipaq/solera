import { isSpawnTool } from '@solera/protocol'
import { activityOf, type ChatItem, type ChatState, type TaskState, type ToolItem } from './chat-fold'

/**
 * Les sous-agents d'une conversation, dérivés du seul journal (invariant I2).
 *
 * Un sous-agent n'a pas d'existence propre côté serveur : c'est un appel d'outil,
 * et tout ce qu'il produit porte l'identifiant de cet appel. Cet identifiant lui
 * sert donc d'identité ici, sans état parallèle à tenir ni requête à faire.
 */

export interface SubAgent {
  /** L'appel qui l'a lancé. Sert d'identité et de clé de rattachement. */
  id: string
  /** Type déclaré à l'appel (`Explore`, `general-purpose`...), ou l'outil à défaut. */
  type: string
  /** Ce que l'appel dit chercher. Vide si le CLI n'en donne pas. */
  description: string
  status: ToolItem['status']
  startedAt: number
  /** Connue seulement une fois l'appel terminé : le CLI ne la donne pas avant. */
  durationMs: number | null
  /** Ce qu'il fait en ce moment, ou null s'il ne tourne plus. */
  activity: string | null
  /** Le fil du sous-agent, dans l'ordre du journal. */
  items: ChatItem[]
  /** Ses propres appels d'outils. Ceux d'un sous-agent imbriqué comptent pour lui. */
  toolCount: number
  /**
   * Ce qu'il a consommé, tel que le CLI le compte. Zéro tant qu'il n'a pas rendu
   * compte : le fil ne peut pas le déduire, les tokens d'un sous-agent n'apparaissent
   * nulle part ailleurs.
   */
  totalTokens: number
  /** L'appel de spawn du sous-agent parent, pour les imbrications. */
  parentId: string | null
  /**
   * Le modèle et l'effort que l'appel a demandés, nuls quand il n'en dit rien : le
   * sous-agent tient alors ceux de sa définition, ou ceux de la session, et le flux du
   * CLI ne les répète pas.
   */
  model: string | null
  effort: string | null
  /**
   * Ce que l'agent principal donne à `SendMessage` pour lui écrire : l'`agentId` que Claude
   * Code annonce dans le résultat de l'appel, sinon le nom que l'appel lui a donné — un nom
   * ne joint l'agent que tant qu'il tourne, l'identifiant le reprend aussi une fois fini.
   * Nul tant que ni l'un ni l'autre n'est connu.
   */
  address: string | null
}

function field(input: unknown, key: string): string {
  if (typeof input !== 'object' || input === null) return ''
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/** Le texte d'une sortie d'outil, qu'elle arrive en chaîne ou en blocs de contenu. */
function outputText(output: unknown): string {
  if (typeof output === 'string') return output
  if (!Array.isArray(output)) return ''
  return output.map((block) => field(block, 'text')).join('\n')
}

/** L'`agentId` que Claude Code écrit dans le résultat d'un appel `Agent`, pour le reprendre. */
export function agentIdIn(output: unknown): string | null {
  return /\bagentId:\s*([\w-]+)/.exec(outputText(output))?.[1] ?? null
}

/**
 * Un sous-agent par appel de spawn, dans l'ordre où ils ont été lancés.
 *
 * Un appel dont le journal ne porte encore aucune retombée reste dans la liste : entre
 * le lancement et le premier événement du sous-agent, il s'écoule plusieurs secondes,
 * et l'omettre ferait apparaître puis clignoter le bandeau.
 */
export function buildSubAgents(items: ChatItem[], tasks: ChatState['tasks']): SubAgent[] {
  const byId = new Map<string, SubAgent>()
  // Le CLI décrit ses travaux par leur propre identifiant ; le fil, lui, ne connaît
  // que l'appel d'outil. C'est ce dernier qui fait le lien entre les deux vues.
  const byToolCall = new Map<string, TaskState>()
  for (const task of tasks.values()) {
    if (task.toolCallId) byToolCall.set(task.toolCallId, task)
  }

  for (const item of items) {
    if (item.kind !== 'tool' || !isSpawnTool(item.name)) continue
    const task = byToolCall.get(item.id)
    /*
     * Un agent passé en arrière-plan rend son appel d'outil aussitôt, avec un résultat
     * qui dit seulement qu'il continue ailleurs. Sans ce redressement, la ligne
     * l'annonçait terminé en quarante millisecondes alors qu'il travaillait encore
     * vingt secondes, et le bandeau cessait de le compter parmi les agents actifs.
     */
    const backgrounded = task !== undefined && !task.done && item.status === 'done'
    /*
     * Et l'inverse : un agent arrêté avec sa session a lui aussi rendu son appel, mais
     * son travail n'a pas abouti. Sans ce redressement, la ligne annonçait « terminé »
     * un agent dont plus personne n'a jamais eu de nouvelles.
     */
    const cutShort = task?.outcome === 'stopped' && item.status === 'done'
    byId.set(item.id, {
      id: item.id,
      type: field(item.input, 'subagent_type') || item.name,
      description: field(item.input, 'description'),
      status: backgrounded ? 'running' : cutShort ? 'interrupted' : item.status,
      startedAt: item.ts,
      // La durée de l'appel n'est celle du travail que tant qu'il l'attend.
      durationMs: task && task.durationMs > 0 ? task.durationMs : item.durationMs,
      activity: null,
      items: [],
      toolCount: 0,
      totalTokens: task?.totalTokens ?? 0,
      parentId: item.parentToolCallId,
      // `effort` pour Claude Code, `reasoning_effort` pour les CLI qui suivent l'API d'OpenAI.
      model: field(item.input, 'model') || null,
      effort: field(item.input, 'effort') || field(item.input, 'reasoning_effort') || null,
      address: agentIdIn(item.output) ?? (field(item.input, 'name') || null),
    })
  }

  if (byId.size === 0) return []

  for (const item of items) {
    if (item.kind !== 'message' && item.kind !== 'tool') continue
    const parent = item.parentToolCallId ? byId.get(item.parentToolCallId) : undefined
    if (!parent) continue

    parent.items.push(item)
    if (item.kind === 'tool') parent.toolCount += 1
  }

  const agents = [...byId.values()]
  for (const agent of agents) {
    if (agent.status !== 'running') continue
    // Le CLI décrit lui-même ce que fait son agent, y compris pendant qu'il réfléchit
    // sans rien appeler. Le repli sur le journal couvre les secondes qui précèdent son
    // premier compte rendu, et les CLI qui n'en donnent aucun.
    agent.activity = byToolCall.get(agent.id)?.activity ?? activityOf(agent.items, agent.id)
  }
  return agents
}

/** Comment nommer un sous-agent dans une liste, au plus court qui reste parlant. */
export function subAgentLabel(agent: SubAgent): string {
  return agent.description || agent.type
}
