import type { CommitTurnDto, ConversationStatus, GraphNodeDto, GraphRefDto, ThreadRefDto } from '@solera/protocol'
import { statesOfTree, type BranchInfo, type CodeCard, type CodePr, type TreeRow } from './code-model'

/**
 * La vue **Graphe** de Travail (`projet.md` T-7) : le graphe du panneau git sur tout le
 * dépôt du projet, doublé de ce que Solera sait de ses branches, et le tiroir d'un
 * commit avec les sessions qui s'y rattachent.
 *
 * Pur, comme `travail-model.ts` : les tests le lisent seul. Les couloirs, eux, viennent
 * déjà calculés du serveur (`git-graph.ts`).
 */

/* ------------------------------------------------------------------ les branches connues */

/** Ce qu'une branche du graphe est pour Solera : un arbre, ou une branche sans arbre. */
export type GraphKnown = { kind: 'tree'; tree: TreeRow } | { kind: 'branch'; branch: BranchInfo }

/** Les branches que Solera connaît, par nom de branche. Un arbre l'emporte sur la branche qu'il porte. */
export function knownBranches(trees: TreeRow[], branches: BranchInfo[]): Map<string, GraphKnown> {
  const map = new Map<string, GraphKnown>()
  for (const branch of branches) map.set(branch.name, { kind: 'branch', branch })
  for (const tree of trees) if (tree.branch) map.set(tree.branch, { kind: 'tree', tree })
  return map
}

export const knownKey = (entry: GraphKnown): string => (entry.kind === 'tree' ? entry.tree.key : entry.branch.key)
export const knownName = (entry: GraphKnown): string => (entry.kind === 'tree' ? (entry.tree.branch ?? entry.tree.name) : entry.branch.name)
export const knownCard = (entry: GraphKnown): CodeCard | null => (entry.kind === 'tree' ? entry.tree.card : entry.branch.card)
export const knownPr = (entry: GraphKnown): CodePr | null => (entry.kind === 'tree' ? entry.tree.pr : entry.branch.pr)

/** Le nom sans son premier segment, celui d'un remote possible ; null s'il n'y en a pas. */
function withoutRemote(name: string): string | null {
  const slash = name.indexOf('/')
  return slash > 0 ? name.slice(slash + 1) : null
}

/**
 * `name` désigne-t-il la branche `branch` ? Elle-même, ou sa distante : un seul segment
 * devant (`origin/feat/x`). `%D` ne dit pas quelles refs sont distantes, et le serveur
 * range toute ref à `/` parmi elles ; le remote ne se reconnaît donc qu'à sa place.
 */
export function namesBranch(name: string, branch: string): boolean {
  return name === branch || withoutRemote(name) === branch
}

/** La branche connue que nomme une ref : elle-même d'abord, sinon sans son remote. */
function knownOfName(name: string, known: Map<string, GraphKnown>): GraphKnown | undefined {
  const stripped = withoutRemote(name)
  return known.get(name) ?? (stripped === null ? undefined : known.get(stripped))
}

const BRANCH_REFS: ReadonlySet<GraphRefDto['kind']> = new Set(['local', 'remote', 'worktree'])

/** Les branches connues dont la tête est sur cette rangée, sans doublon, dans l'ordre des refs. */
export function knownOfNode(node: Pick<GraphNodeDto, 'refs'>, known: Map<string, GraphKnown>): GraphKnown[] {
  const out: GraphKnown[] = []
  for (const ref of node.refs) {
    if (!BRANCH_REFS.has(ref.kind)) continue
    const entry = knownOfName(ref.name, known)
    if (entry && !out.includes(entry)) out.push(entry)
  }
  return out
}

/** Une branche fusionnée : un arbre que l'état « Fusionné » garde, une branche fusionnée. */
export function isMergedKnown(entry: GraphKnown): boolean {
  return entry.kind === 'tree' ? statesOfTree(entry.tree).has('merged') : entry.branch.merged
}

/**
 * T-7.4 : les fusionnées perdent leurs étiquettes, leurs commits restent — ils sont dans
 * l'histoire de la base, les retirer mentirait sur le graphe. Une rangée sans rien à
 * retirer est rendue telle quelle.
 */
export function withoutMergedRefs(nodes: GraphNodeDto[], known: Map<string, GraphKnown>): GraphNodeDto[] {
  return nodes.map((node) => {
    const refs = node.refs.filter((ref) => {
      if (!BRANCH_REFS.has(ref.kind)) return true
      const entry = knownOfName(ref.name, known)
      return !(entry && isMergedKnown(entry))
    })
    return refs.length === node.refs.length ? node : { ...node, refs }
  })
}

/* ------------------------------------------------------------------ T-7.3 la mise en retrait */

/**
 * Une rangée hors de la branche choisie s'estompe : ni sur sa course, ni portant sa tête.
 * `runs` nomme les courses comme le serveur, distantes comprises.
 */
export function isDimmed(node: Pick<GraphNodeDto, 'run' | 'refs'>, runs: (string | null)[], target: string | null): boolean {
  if (target === null) return false
  const run = runs[node.run] ?? null
  if (run !== null && namesBranch(run, target)) return false
  return !node.refs.some((ref) => BRANCH_REFS.has(ref.kind) && namesBranch(ref.name, target))
}

/* ------------------------------------------------------------------ le tiroir d'un commit */

/**
 * L'arbre ou la branche d'un commit, parmi les branches qui le portent : la course du
 * commit d'abord, puis celles qui le contiennent. Un arbre l'emporte sur une branche
 * sans arbre : c'est lui qui a des sessions.
 */
export function commitHome(names: (string | null)[], known: Map<string, GraphKnown>): GraphKnown | null {
  const found = names.flatMap((name) => {
    const entry = name ? knownOfName(name, known) : undefined
    return entry ? [entry] : []
  })
  return found.find((entry) => entry.kind === 'tree') ?? found[0] ?? null
}

/**
 * D'où vient le rattachement d'une session à un commit (T-7.7) : le tour qui l'a écrit,
 * le fil qui l'a écrit d'après sa branche ou déduit des dates, une session de l'arbre,
 * une session de la carte.
 */
export type Provenance = 'turn' | 'sure' | 'dates' | 'branch' | 'card'

export interface LinkedSession {
  id: string
  provenance: Provenance
  /** Le titre que le serveur a donné, au cas où la session ne serait plus dans la liste. */
  title: string | null
  turn: { number: number | null; message: string | null } | null
}

export interface LinkedInput {
  turn: CommitTurnDto | null
  thread: ThreadRefDto | null
  /** Les fils qui se recoupaient à l'heure du commit, quand `thread` se tait. */
  candidates: ThreadRefDto[]
  /** Les sessions de l'arbre qui porte le commit, et celles de sa carte, avec leur date. */
  tree: { id: string; at: number }[]
  card: { id: string; at: number }[]
}

/**
 * Les sessions d'un commit, dédoublonnées, dans l'ordre de T-7.7 : celle qui l'a écrit
 * (au tour près si on le sait, sinon le fil, sinon chaque candidat), puis celles de
 * l'arbre, puis celles de la carte, les plus récentes d'abord. Le tour tranche : le fil
 * et les candidats ne sont qu'un repli, et deux sessions ne disent pas « a écrit ce commit ».
 */
export function linkedSessions({ turn, thread, candidates, tree, card }: LinkedInput): LinkedSession[] {
  const out: LinkedSession[] = []
  const seen = new Set<string>()
  const push = (id: string, provenance: Provenance, title: string | null = null, at: LinkedSession['turn'] = null) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push({ id, provenance, title, turn: at })
  }
  if (turn) push(turn.conversationId, 'turn', turn.title, { number: turn.turn, message: turn.message })
  else if (thread) push(thread.id, thread.sure ? 'sure' : 'dates', thread.title)
  else for (const candidate of candidates) push(candidate.id, 'dates', candidate.title)
  const recent = (list: { id: string; at: number }[]) => [...list].sort((a, b) => b.at - a.at)
  for (const entry of recent(tree)) push(entry.id, 'branch')
  for (const entry of recent(card)) push(entry.id, 'card')
  return out
}

export type SessionState = 'waiting' | 'error' | 'working' | 'done' | 'unknown'

/** L'état d'une session, tel que le tiroir l'écrit : une interrompue attend qu'on la relance. */
export function sessionStateOf(status: ConversationStatus | null): SessionState {
  if (status === null) return 'unknown'
  if (status === 'awaiting_input') return 'waiting'
  if (status === 'error' || status === 'interrupted') return 'error'
  if (status === 'running') return 'working'
  return 'done'
}
