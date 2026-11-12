import { canDiffTree, canRebaseTree, treeSessionId, type TreeFields, type TreeRow } from './code-model'

/**
 * Les gestes d'un arbre dans Travail, sans React (`projet.md` T-13.1, T-6.2) : lesquels
 * se montrent, dans quel ordre, et celui que la ligne met en avant. Les prédicats
 * (`canDiffTree`, `treeSessionId`…) sont ceux du modèle, partagés avec l'Aperçu
 * (`lineGestures`) ; les gestes eux-mêmes vivent dans `components/travail/useTreeActions`
 * et `lib/tree-gestures`.
 */

export type TreeGestureKey = 'session' | 'diff' | 'pr' | 'rebase' | 'merge' | 'clean'

export interface TreeGesture {
  key: TreeGestureKey
  /** Pour `session` : aucune session à rouvrir, on en lance une. */
  launch?: boolean
  /** Montré, mais éteint : le nettoyage d'un arbre que Solera ne connaît pas. */
  disabled?: boolean
}

/**
 * Les gestes d'un arbre, dans leur ordre : la session (ou en lancer une), le diff, la
 * PR, le rebase, la fusion d'une PR prête, le nettoyage. La racine n'a que sa session et
 * son diff. Un arbre créé au shell (sans id) ne se nettoie pas depuis Solera : le geste
 * reste, éteint, pour dire qu'il existe.
 */
export function treeGestures(tree: TreeRow): TreeGesture[] {
  const gestures: TreeGesture[] = [{ key: 'session', launch: treeSessionId(tree) === null }]
  if (canDiffTree(tree)) gestures.push({ key: 'diff' })
  if (tree.root) return gestures
  if (tree.pr?.url) gestures.push({ key: 'pr' })
  if (canRebaseTree(tree)) gestures.push({ key: 'rebase' })
  if (tree.pr?.state === 'ready') gestures.push({ key: 'merge' })
  gestures.push({ key: 'clean', disabled: tree.id === null })
  return gestures
}

/** Le geste que le verdict appelle, montré en clair sur la ligne au téléphone (T-6.2). */
export type PrimaryGesture = 'reply' | 'clean' | 'review'

export function primaryGesture(tree: TreeRow): PrimaryGesture | null {
  if (tree.verdict === 'waiting') return 'reply'
  if (tree.verdict === 'clean' && tree.id !== null) return 'clean'
  if (tree.verdict === 'review' && tree.pr?.url) return 'review'
  return null
}

/** Au-delà, la taille d'un arbre s'écrit à l'encre forte (T-6.2). */
export const HEAVY_BYTES = 400 * 1024 * 1024

export function isHeavy(tree: Pick<TreeFields, 'sizeBytes'>): boolean {
  return tree.sizeBytes !== null && tree.sizeBytes >= HEAVY_BYTES
}
