import type { WorktreeCleanupPlanDto } from '@solera/protocol'
import { isCleanable, type BranchInfo, type TreeRow } from './code-model'

/**
 * Le nettoyage de Travail, en un seul dialogue (`projet.md` T-1.5, T-12) : ce que le
 * bouton « Nettoyer · N » propose, et ce que le dialogue ferait, d'après les plans que
 * le serveur rend pour chaque arbre (`GET …/worktrees/cleanup`).
 */

/** Ce qu'une demande de nettoyage réunit : des arbres, des branches sans arbre. */
export interface CleanRequest {
  trees: TreeRow[]
  branches: string[]
}

/**
 * Ce que « Nettoyer · N » propose : les arbres fusionnés sans rien à perdre que Solera
 * sait retirer, et les branches fusionnées locales (une distante reste à la forge). Le
 * compte est leur total.
 */
export function cleanOffer(trees: TreeRow[], branches: BranchInfo[]): CleanRequest & { count: number } {
  const offered = trees.filter((tree) => isCleanable(tree) && tree.id !== null)
  const names = branches.filter((branch) => branch.kind === 'merged' && !branch.remoteOnly).map((branch) => branch.name)
  return { trees: offered, branches: names, count: offered.length + names.length }
}

/** Le corps d'un `POST …/worktrees/cleanup`. */
export interface CleanJob {
  path: string
  deleteBranch: boolean
  stopServices: boolean
}

export interface CleanSummary {
  /** Tous les plans des arbres cochés sont lus. */
  ready: boolean
  /** Les arbres qui partent. */
  removed: TreeRow[]
  /** Ceux où une session travaille : ils attendent la fin de son tour, et restent. */
  held: { tree: TreeRow; busy: string[] }[]
  jobs: CleanJob[]
  branches: string[]
  /** Arbres, puis branches, qui partent. */
  count: number
  /** La place que les arbres occupent ; null tant qu'une taille n'est pas mesurée. */
  bytes: number | null
  /** Les arbres dont du travail non commité partirait (ou dont git n'a rien pu lire). */
  losing: string[]
  /** Les branches gardées : elles ont des commits que la base n'a pas. */
  keptBranches: string[]
  archived: { id: string; title: string }[]
  restarted: { id: string; title: string; running: boolean }[]
  services: string[]
  terminals: number
  /** Les cartes encore ouvertes des arbres qui partent, une fois chacune. */
  cards: { id: string; number: number; title: string }[]
}

const nameOf = (tree: TreeRow) => tree.branch ?? tree.name

/**
 * Ce que le dialogue ferait, section par section. La perte se lit dans le plan, relu à
 * l'ouverture, pas dans la ligne : ce qui n'est pas commité change d'une minute à
 * l'autre. Une branche dont des commits manquent à la base reste, pour ne rien perdre ;
 * le dialogue le dit.
 */
export function cleanSummary({
  trees,
  branches,
  withTrees,
  withBranches,
  plans,
}: CleanRequest & {
  withTrees: boolean
  withBranches: boolean
  plans: (path: string) => WorktreeCleanupPlanDto | undefined
}): CleanSummary {
  const checked = withTrees ? trees : []
  const read = checked.map((tree) => ({ tree, plan: plans(tree.path) }))
  const ready = read.every((entry) => entry.plan !== undefined)
  const loaded = read.flatMap((entry) => (entry.plan ? [{ tree: entry.tree, plan: entry.plan }] : []))
  const going = loaded.filter((entry) => entry.plan.busy.length === 0)
  const removed = going.map((entry) => entry.tree)
  const shownBranches = withBranches ? branches : []
  const cards = new Map<string, { id: string; number: number; title: string }>()
  for (const { plan } of going) if (plan.card) cards.set(plan.card.id, plan.card)

  return {
    ready,
    removed,
    held: loaded.filter((entry) => entry.plan.busy.length > 0).map((entry) => ({ tree: entry.tree, busy: entry.plan.busy.map((session) => session.title) })),
    jobs: going.map(({ plan }) => ({ path: plan.path, deleteBranch: plan.branchDeletable && !plan.unmergedCommits, stopServices: true })),
    branches: shownBranches,
    count: removed.length + shownBranches.length,
    bytes: removed.some((tree) => tree.sizeBytes === null) ? null : removed.reduce((sum, tree) => sum + (tree.sizeBytes ?? 0), 0),
    losing: going.filter(({ plan }) => plan.modified + plan.untracked > 0 || plan.state === 'unreadable').map(({ tree }) => nameOf(tree)),
    keptBranches: going.filter(({ plan }) => plan.branchDeletable && plan.unmergedCommits).map(({ tree }) => nameOf(tree)),
    archived: going.flatMap(({ plan }) => plan.conversations),
    restarted: going.flatMap(({ plan }) => plan.restarted),
    services: going.flatMap(({ plan }) => plan.services.map((service) => service.label)),
    terminals: going.reduce((sum, { plan }) => sum + plan.terminals, 0),
    cards: [...cards.values()],
  }
}
