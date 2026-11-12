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

/** Le retrait d'un arbre : l'arbre, et le corps de son `POST …/worktrees/cleanup`. */
export interface CleanJob {
  tree: TreeRow
  body: { path: string; deleteBranch: boolean; stopServices: boolean }
}

/** La place que des arbres occupent ; null tant qu'une taille n'est pas mesurée : une somme partielle mentirait. */
export function sizeOf(trees: TreeRow[]): number | null {
  return trees.some((tree) => tree.sizeBytes === null) ? null : trees.reduce((sum, tree) => sum + (tree.sizeBytes ?? 0), 0)
}

export interface CleanSummary {
  /** Tous les plans des arbres cochés sont lus, ou ont échoué. */
  ready: boolean
  /** Les arbres dont le plan n'a pas pu être lu : ils restent. */
  unread: string[]
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
  /** Le plan d'un chemin ; `undefined` tant qu'il se lit, `null` s'il n'a pas pu l'être. */
  plans: (path: string) => WorktreeCleanupPlanDto | null | undefined
}): CleanSummary {
  const checked = withTrees ? trees : []
  const read = checked.map((tree) => ({ tree, plan: plans(tree.path) }))
  const ready = read.every((entry) => entry.plan !== undefined)
  const loaded = read.flatMap((entry) => (entry.plan ? [{ tree: entry.tree, plan: entry.plan }] : []))
  const unread = read.filter((entry) => entry.plan === null).map((entry) => nameOf(entry.tree))
  const going = loaded.filter((entry) => entry.plan.busy.length === 0)
  const removed = going.map((entry) => entry.tree)
  const shownBranches = withBranches ? branches : []
  const cards = new Map<string, { id: string; number: number; title: string }>()
  for (const { plan } of going) if (plan.card) cards.set(plan.card.id, plan.card)

  return {
    ready,
    unread,
    removed,
    held: loaded.filter((entry) => entry.plan.busy.length > 0).map((entry) => ({ tree: entry.tree, busy: entry.plan.busy.map((session) => session.title) })),
    jobs: going.map(({ tree, plan }) => ({ tree, body: { path: plan.path, deleteBranch: plan.branchDeletable && !plan.unmergedCommits, stopServices: true } })),
    branches: shownBranches,
    count: removed.length + shownBranches.length,
    bytes: sizeOf(removed),
    losing: going.filter(({ plan }) => plan.modified + plan.untracked > 0 || plan.state === 'unreadable').map(({ tree }) => nameOf(tree)),
    keptBranches: going.filter(({ plan }) => plan.branchDeletable && plan.unmergedCommits).map(({ tree }) => nameOf(tree)),
    archived: going.flatMap(({ plan }) => plan.conversations),
    restarted: going.flatMap(({ plan }) => plan.restarted),
    services: going.flatMap(({ plan }) => plan.services.map((service) => service.label)),
    terminals: going.reduce((sum, { plan }) => sum + plan.terminals, 0),
    cards: [...cards.values()],
  }
}
