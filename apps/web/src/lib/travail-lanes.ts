import {
  VERDICT_ORDER,
  entryInTree,
  isCleanable,
  rowInTree,
  treeOf,
  type BranchInfo,
  type BranchKind,
  type TreeRow,
  type TreeScope,
  type TreeVerdict,
} from './code-model'
import { treeSummary, type TravailDisplay } from './travail-model'

/**
 * La vue « Par arbre » de Travail (`projet.md` T-4) : un couloir par arbre, qui porte
 * son fil (ses sessions vivantes, ses derniers événements), un couloir par branche sans
 * arbre, le couloir « Projet » de ce qui ne vit dans aucun arbre, et, repliés en bas,
 * les arbres à nettoyer et les branches fusionnées.
 *
 * Pur : la page lui passe ce que `useTravail` a lu et ce que les filtres ont gardé.
 */

/** Événements montrés par couloir avant « Plus » ; et au plus, une fois déplié. */
export const LANE_ENTRIES = 3
export const LANE_ENTRIES_MAX = 20
/** Le couloir « Projet » montre une ligne de plus : il n'a pas de sessions au-dessus. */
export const PROJECT_ENTRIES = LANE_ENTRIES + 1

/** Ce que les couloirs lisent d'une session vivante. */
interface LiveFacts {
  entry: { conversation: { id: string } }
  place: { root: boolean; branch: string | null; path: string | null }
}

/** Ce que les couloirs lisent d'une ligne d'historique. */
interface EntryFacts {
  id: string
  at: number
  conversationId: string | null
  cardNumber: number | null
  title: string
}

/** Un couloir : un arbre, ses sessions vivantes, ses événements (le plus récent d'abord). */
export interface LaneData<Row = LiveFacts, Entry = EntryFacts> {
  tree: TreeRow
  live: Row[]
  entries: Entry[]
}

export interface Lanes<Row, Entry> {
  /** Les arbres où il reste à faire : ce qui t'attend d'abord, puis le plus récent. */
  active: LaneData<Row, Entry>[]
  /** Ceux qu'on peut nettoyer sans rien perdre, et les introuvables. */
  cleanup: LaneData<Row, Entry>[]
  /** Ce qui ne vit dans aucun arbre : le couloir « Projet ». */
  loose: Entry[]
}

const finished = (tree: TreeRow) => isCleanable(tree) || tree.verdict === 'missing'

/** Un arbre vit maintenant tant qu'une session y travaille ; sinon, son dernier signe. */
function recencyOf(lane: LaneData<unknown, { at: number }>, now: number): number {
  if (lane.live.length > 0 || lane.tree.sessions.length > 0) return now
  return Math.max(lane.tree.lastUsedAt ?? 0, lane.entries[0]?.at ?? 0)
}

/**
 * Les couloirs d'un projet. Chaque ligne du fil va à **un seul** arbre : un worktree
 * d'abord, la racine seulement à défaut (`treeOf`), pour qu'une carte qui a travaillé
 * aux deux endroits ne se raconte pas deux fois.
 */
export function lanesOf<Row extends LiveFacts, Entry extends EntryFacts>({
  trees,
  live,
  entries,
  scopes,
  now,
}: {
  trees: TreeRow[]
  live: Row[]
  entries: Entry[]
  scopes: Map<string, TreeScope>
  now: number
}): Lanes<Row, Entry> {
  const scopeOf = (tree: TreeRow) => scopes.get(tree.key) ?? { sessionIds: new Set<string>(), cardNumbers: new Set<number>() }
  const byTree = new Map<string, LaneData<Row, Entry>>(trees.map((tree) => [tree.key, { tree, live: [], entries: [] }]))
  const loose: Entry[] = []
  for (const entry of entries) {
    const owner = treeOf(trees, (tree) => entryInTree(entry, tree, scopeOf(tree)))
    if (owner) byTree.get(owner.key)!.entries.push(entry)
    else loose.push(entry)
  }
  for (const row of live) {
    const owner = treeOf(trees, (tree) => rowInTree(row, tree, scopeOf(tree)))
    if (owner) byTree.get(owner.key)!.live.push(row)
  }
  const all = [...byTree.values()]
  const waiting = (lane: LaneData<Row, Entry>) => Number(lane.tree.verdict === 'waiting')
  const active = all
    .filter((lane) => !finished(lane.tree))
    .sort((a, b) => waiting(b) - waiting(a) || recencyOf(b, now) - recencyOf(a, now))
  return { active, cleanup: all.filter((lane) => finished(lane.tree)), loose }
}

/** Les événements qu'un couloir montre : trois, ou vingt une fois déplié. */
export function shownEntries<Entry>(entries: Entry[], more: boolean, base = LANE_ENTRIES): Entry[] {
  return entries.slice(0, more ? LANE_ENTRIES_MAX : base)
}

/* ------------------------------------------------------------------ T-4.1 la disposition */

export type LaneItem<Row, Entry> = { kind: 'tree'; lane: LaneData<Row, Entry> } | { kind: 'branch'; branch: BranchInfo }

/** Le titre d'une section : la page le traduit. */
export type LaneGroupLabel =
  | { kind: 'milestone'; number: number; title: string }
  | { kind: 'noMilestone' }
  | { kind: 'verdict'; verdict: TreeVerdict }
  | { kind: 'branch'; branchKind: BranchKind }

export interface LaneGroup<Row, Entry> {
  key: string
  label: LaneGroupLabel
  items: LaneItem<Row, Entry>[]
}

export interface LaneLayout<Row, Entry> {
  /** Null sans regroupement : les arbres, puis les branches sans worktree. */
  groups: LaneGroup<Row, Entry>[] | null
  trees: LaneData<Row, Entry>[]
  branches: BranchInfo[]
  /** « À nettoyer » ; null quand il n'y a rien, ou que l'affichage le cache. */
  cleanup: { lanes: LaneData<Row, Entry>[]; open: boolean; summary: { count: number; bytes: number | null } } | null
  merged: { branches: BranchInfo[]; open: boolean } | null
  project: Entry[] | null
  /** L'index, dans l'ordre de la vue. */
  index: { trees: TreeRow[]; branches: BranchInfo[]; project: boolean }
}

const BRANCH_KINDS: BranchKind[] = ['pr', 'unmerged', 'remote', 'merged']

function groupOf<Row, Entry>(item: LaneItem<Row, Entry>, grouping: 'milestone' | 'state'): LaneGroupLabel {
  if (grouping === 'milestone') {
    const milestone = (item.kind === 'tree' ? item.lane.tree.card : item.branch.card)?.milestone
    return milestone ? { kind: 'milestone', number: milestone.number, title: milestone.title } : { kind: 'noMilestone' }
  }
  return item.kind === 'tree' ? { kind: 'verdict', verdict: item.lane.tree.verdict } : { kind: 'branch', branchKind: item.branch.kind }
}

const groupKey = (label: LaneGroupLabel) =>
  label.kind === 'milestone' ? `m${label.number}` : label.kind === 'verdict' ? `v-${label.verdict}` : label.kind === 'branch' ? `b-${label.branchKind}` : 'none'

/** Le rang d'une section : par jalon, dans l'ordre d'arrivée et « Sans jalon » en dernier ; par état, l'ordre des verdicts puis des genres. */
function groupRank(label: LaneGroupLabel): number {
  if (label.kind === 'noMilestone') return 1
  if (label.kind === 'verdict') return VERDICT_ORDER.indexOf(label.verdict)
  if (label.kind === 'branch') return VERDICT_ORDER.length + BRANCH_KINDS.indexOf(label.branchKind)
  return 0
}

/**
 * Ce que la vue « Par arbre » montre, et dans quel ordre (T-4.1, T-4.2, T-4.7, T-4.8,
 * T-1.6). `forced` : un filtre d'état réclame ce qui est à nettoyer ou fusionné ; ses
 * sections se montrent alors dépliées, quoi que dise l'affichage.
 */
export function laneLayout<Row, Entry extends { at: number }>({
  lanes,
  branches,
  display,
  forced,
  targeted,
  now,
}: {
  lanes: Lanes<Row, Entry>
  branches: BranchInfo[]
  display: TravailDisplay
  forced: boolean
  /** Un arbre ou une branche choisis : le couloir « Projet » n'a plus lieu d'être. */
  targeted: boolean
  now: number
}): LaneLayout<Row, Entry> {
  const sortLanes = (list: LaneData<Row, Entry>[]) => {
    if (display.sort === 'recent') return [...list].sort((a, b) => recencyOf(b, now) - recencyOf(a, now))
    if (display.sort === 'size') return [...list].sort((a, b) => (b.tree.sizeBytes ?? -1) - (a.tree.sizeBytes ?? -1))
    return list
  }
  const open = branches.filter((branch) => branch.kind !== 'merged')
  const mergedBranches = branches.filter((branch) => branch.kind === 'merged')
  const trees = sortLanes(lanes.active)
  const shownBranches = display.sort === 'waiting' ? open : [...open].sort((a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0))
  const cleanupLanes = sortLanes(lanes.cleanup)

  let groups: LaneGroup<Row, Entry>[] | null = null
  if (display.group !== 'none') {
    const grouping = display.group
    const byKey = new Map<string, LaneGroup<Row, Entry>>()
    const items: LaneItem<Row, Entry>[] = [
      ...trees.map((lane) => ({ kind: 'tree' as const, lane })),
      ...shownBranches.map((branch) => ({ kind: 'branch' as const, branch })),
    ]
    for (const item of items) {
      const label = groupOf(item, grouping)
      const key = groupKey(label)
      const group = byKey.get(key) ?? { key, label, items: [] }
      group.items.push(item)
      byKey.set(key, group)
    }
    // `sort` est stable : à rang égal (deux jalons), l'ordre d'arrivée reste.
    groups = [...byKey.values()].sort((a, b) => groupRank(a.label) - groupRank(b.label))
  }

  const ordered = groups ? groups.flatMap((group) => group.items) : null
  const indexTrees = ordered ? ordered.flatMap((item) => (item.kind === 'tree' ? [item.lane.tree] : [])) : trees.map((lane) => lane.tree)
  const indexBranches = ordered ? ordered.flatMap((item) => (item.kind === 'branch' ? [item.branch] : [])) : shownBranches

  const cleanup =
    cleanupLanes.length > 0 && (display.showCleanup || forced)
      ? { lanes: cleanupLanes, open: forced, summary: treeSummary(cleanupLanes.map((lane) => lane.tree)) }
      : null
  const merged = mergedBranches.length > 0 && (display.showMerged || forced) ? { branches: mergedBranches, open: forced } : null
  const project = display.showProject && !targeted && lanes.loose.length > 0 ? lanes.loose : null

  return {
    groups,
    trees,
    branches: shownBranches,
    cleanup,
    merged,
    project,
    index: {
      trees: forced && cleanup ? [...indexTrees, ...cleanup.lanes.map((lane) => lane.tree)] : indexTrees,
      branches: indexBranches,
      project: project !== null,
    },
  }
}

/* ------------------------------------------------------------------ T-3.5 l'index qui fait défiler */

/** L'ancre d'un couloir : un `id` HTML sûr, tiré de la clé de l'arbre ou de la branche. */
export function laneAnchor(key: string): string {
  return `travail-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

/**
 * Le couloir qu'on lit : le dernier dont le haut a passé la ligne de lecture (`line`,
 * en pixels depuis le haut de la zone qui défile) ; tout en haut, le premier.
 */
export function spiedKey(tops: { key: string; top: number }[], line: number): string | null {
  let current: string | null = tops[0]?.key ?? null
  for (const entry of tops) {
    if (entry.top <= line) current = entry.key
    else break
  }
  return current
}
