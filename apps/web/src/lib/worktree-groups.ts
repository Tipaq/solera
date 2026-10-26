import type { WorktreeState, WorktreeStatusDto } from '@solera/protocol'
import { ACTIVITY_GROUPS, type ActivityGroup, type SessionPlace } from './activity-groups'

/**
 * Le regroupement de l'onglet Activité par worktree : qui travaille où (planche B3 de
 * `docs/audits/2026-10-21-page-projet/final/`).
 *
 * La racine du projet en tête, puis les arbres habités, puis ceux qu'aucune session
 * n'occupe. Une session dont l'arbre n'est plus dans la liste — retiré du disque, ou
 * liste pas encore lue — forme son propre groupe, plutôt que de passer pour la racine.
 */
export interface WorktreeGrouping<R> {
  root: R[]
  inhabited: { tree: WorktreeStatusDto; rows: R[] }[]
  /** Sessions d'un arbre que la liste ne connaît pas. */
  unplaced: R[]
  idle: WorktreeStatusDto[]
}

/** Ce que le regroupement lit d'une ligne de l'Activité. */
export interface GroupableRow {
  group: ActivityGroup
  place: SessionPlace
  updatedAt: number
}

/**
 * L'ordre des arbres sans session : d'abord ce qui se nettoie, puis ce qui porte encore
 * du travail, puis ce qui n'est plus sur le disque (planche B3).
 */
const IDLE_ORDER: Record<WorktreeState, number> = {
  merged: 0,
  dirty: 1,
  unmerged: 1,
  empty: 1,
  unreadable: 2,
  missing: 2,
}

export function groupByWorktree<R extends GroupableRow>(
  rows: R[],
  trees: WorktreeStatusDto[],
): WorktreeGrouping<R> {
  const root: R[] = []
  const unplaced: R[] = []
  const byPath = new Map<string, R[]>()
  for (const row of rows) {
    if (row.place.root) root.push(row)
    else if (row.place.path === null) unplaced.push(row)
    else byPath.set(row.place.path, [...(byPath.get(row.place.path) ?? []), row])
  }

  const inhabited = trees
    .filter((tree) => byPath.has(tree.path))
    .map((tree) => ({ tree, rows: byPath.get(tree.path)! }))
    // L'arbre qui réclame le plus urgent passe devant, comme les groupes par état ;
    // à égalité, le plus récemment actif.
    .sort((a, b) => urgency(a.rows) - urgency(b.rows) || latest(b.rows) - latest(a.rows))

  const idle = trees
    .filter((tree) => !byPath.has(tree.path))
    .sort((a, b) => IDLE_ORDER[a.state] - IDLE_ORDER[b.state] || lastActivity(b) - lastActivity(a))

  return { root, inhabited, unplaced, idle }
}

function urgency(rows: GroupableRow[]): number {
  return Math.min(...rows.map((row) => ACTIVITY_GROUPS.indexOf(row.group)))
}

function latest(rows: GroupableRow[]): number {
  return Math.max(...rows.map((row) => row.updatedAt))
}

/** Le dernier signe de vie d'un arbre que git connaît : un fichier touché, ou un commit. */
export function lastActivity(tree: Pick<WorktreeStatusDto, 'lastEditAt' | 'lastCommitAt'>): number {
  return Math.max(tree.lastEditAt ?? 0, tree.lastCommitAt ?? 0)
}

/**
 * Le geste d'un arbre sans session : le nettoyer s'il est fusionné, l'oublier s'il a
 * quitté le disque, le reprendre s'il porte encore du travail.
 *
 * Un arbre créé au shell ne se reprend pas : une session ne s'ouvre que dans un arbre
 * que Solera connaît. Il ne reste alors que le nettoyage, dont la confirmation dit ce
 * qui serait perdu. Un arbre illisible se nettoie aussi, sa confirmation prévient.
 */
export type IdleGesture = 'clean' | 'resume' | 'forget'

export function idleGestureOf(tree: Pick<WorktreeStatusDto, 'state' | 'id'>): IdleGesture {
  if (tree.state === 'missing') return 'forget'
  if (tree.state === 'merged' || tree.state === 'unreadable') return 'clean'
  return tree.id ? 'resume' : 'clean'
}
