import type { JournalEntryDto } from '@solera/protocol'
import { isCleanable, type BranchInfo, type TreeRow, type TreeVerdict } from './code-model'
import { cleanOffer, type CleanRequest } from './travail-clean'
import { treeSummary } from './travail-model'

/*
 * Travail du portefeuille (#238, `coque.md` PF-14 à PF-21) : les arbres de tous les
 * projets, jugés comme dans un projet (`codeDataOf`), puis filtrés, repliés et rangés
 * pour les trois vues — Par projet, Tableau, Par moment. Pur : la page lui passe ce que
 * les requêtes du portefeuille rendent.
 */

/** Les états du filtre, du plus pressant au plus calme. */
export const WORK_STATES = ['waiting', 'active', 'review', 'clean'] as const
export type WorkState = (typeof WORK_STATES)[number]

/** Les verdicts que chaque état garde : « À nettoyer » prend aussi le vide et l'introuvable. */
const VERDICTS: Record<WorkState, TreeVerdict[]> = {
  waiting: ['waiting'],
  active: ['active'],
  review: ['review'],
  clean: ['clean', 'empty', 'missing'],
}

export interface WorkFilters {
  projects: string[]
  states: WorkState[]
}

export const NO_WORK_FILTERS: WorkFilters = { projects: [], states: [] }

/** Les filtres retenus par le navigateur ; ce qui n'a plus cours est écarté. */
export function readWorkFilters(raw: string | null): WorkFilters {
  if (!raw) return NO_WORK_FILTERS
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof WorkFilters, unknown>>
    const list = (entry: unknown) => (Array.isArray(entry) ? (entry as unknown[]) : [])
    return {
      projects: list(value.projects).filter((id): id is string => typeof id === 'string'),
      states: list(value.states).filter((state): state is WorkState => (WORK_STATES as readonly unknown[]).includes(state)),
    }
  } catch {
    return NO_WORK_FILTERS
  }
}

type WorkProjectRef = { id: string; name: string }

/** Un projet et ce que ses requêtes rendent : ses arbres jugés, ses branches sans arbre. */
export interface WorkSource<P extends WorkProjectRef> {
  project: P
  /** La branche de base, où le nettoyage vérifie que rien ne se perd. */
  base: string | null
  trees: TreeRow[]
  branches: BranchInfo[]
}

/** Un arbre du portefeuille, qui sait d'où il vient. */
export type WorkTree<P> = TreeRow & { project: P }

/** Un groupe de la vue Par projet (PF-17). */
export interface WorkGroup<P> {
  project: P
  /** Les arbres montrés, la racine comprise. */
  trees: WorkTree<P>[]
  /** Les fusionnés, repliés sous le groupe. */
  folded: WorkTree<P>[]
  /** Les worktrees montrés, sans la racine. */
  count: number
  /** Les branches sans arbre qui ne sont pas fusionnées. */
  branches: number
}

/** Ce que « Nettoyer » propose dans un projet : le nettoyage se fait projet par projet. */
export interface WorkCleanOffer<P> {
  project: P
  base: string | null
  request: CleanRequest
  count: number
}

export interface WorkLayout<P> {
  groups: WorkGroup<P>[]
  /** Les arbres montrés de tous les projets, pour le Tableau. */
  trees: WorkTree<P>[]
  /** Les fusionnés repliés de tous les projets. */
  folded: WorkTree<P>[]
  /** Combien de worktrees chaque projet a, en regard de sa case dans Filtrer ▾. */
  counts: Map<string, number>
  /** La méta : les worktrees des projets filtrés et leur place. */
  summary: { count: number; bytes: number | null }
  offers: WorkCleanOffer<P>[]
  cleanCount: number
}

/**
 * Les trois vues, à partir des mêmes filtres.
 *
 * Le filtre Projet borne tout, « Nettoyer » et la méta compris ; l'état et la recherche
 * ne bornent que les lignes. Un arbre fusionné se replie sous son projet tant qu'on ne
 * demande pas à le voir, par « Montrer » ou par l'état « À nettoyer ». `reasonOf` rend la
 * raison d'un arbre telle qu'elle s'écrit, pour que la recherche la trouve.
 */
export function workLayout<P extends WorkProjectRef>({
  projects,
  filters,
  query,
  showMerged,
  reasonOf,
}: {
  projects: WorkSource<P>[]
  filters: WorkFilters
  query: string
  showMerged: boolean
  reasonOf: (tree: TreeRow) => string
}): WorkLayout<P> {
  const needle = query.trim().toLocaleLowerCase()
  const chosen = new Set(filters.projects)
  const inScope = projects.filter((source) => chosen.size === 0 || chosen.has(source.project.id))
  const hideMerged = !showMerged && !filters.states.includes('clean')

  const passes = (tree: TreeRow, project: P) =>
    (filters.states.length === 0 || filters.states.some((state) => VERDICTS[state].includes(tree.verdict))) &&
    (!needle ||
      [tree.branch ?? tree.name, reasonOf(tree), tree.card?.title ?? '', tree.card ? `#${tree.card.number}` : '', project.name]
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle))

  const groups = inScope.flatMap(({ project, trees, branches }): WorkGroup<P>[] => {
    const kept = trees.filter((tree) => passes(tree, project)).map((tree) => ({ ...tree, project }))
    const shown = hideMerged ? kept.filter((tree) => !isCleanable(tree)) : kept
    const folded = hideMerged ? kept.filter(isCleanable) : []
    if (shown.length === 0 && folded.length === 0) return []
    return [
      {
        project,
        trees: shown,
        folded,
        count: shown.filter((tree) => !tree.root).length,
        branches: branches.filter((entry) => entry.kind !== 'merged').length,
      },
    ]
  })

  const offers = inScope.flatMap(({ project, base, trees, branches }): WorkCleanOffer<P>[] => {
    const { count, ...request } = cleanOffer(trees, branches)
    return count > 0 ? [{ project, base, request, count }] : []
  })

  return {
    groups,
    trees: groups.flatMap((group) => group.trees),
    folded: groups.flatMap((group) => group.folded),
    counts: new Map(projects.map(({ project, trees }) => [project.id, trees.filter((tree) => !tree.root).length])),
    summary: treeSummary(inScope.flatMap((source) => source.trees)),
    offers,
    cleanCount: offers.reduce((sum, offer) => sum + offer.count, 0),
  }
}

/**
 * Ce que « Nettoyer » d'un repli propose : ses arbres seulement, projet par projet, ceux
 * que Solera sait retirer (créés par lui), avec la base de leur projet.
 */
export function foldedOffers<P extends WorkProjectRef>(folded: WorkTree<P>[], offers: WorkCleanOffer<P>[]): WorkCleanOffer<P>[] {
  return offers.flatMap((offer) => {
    const trees = folded.filter((tree) => tree.project.id === offer.project.id && tree.id !== null)
    return trees.length > 0 ? [{ ...offer, request: { trees, branches: [] }, count: trees.length }] : []
  })
}

/**
 * Par moment (PF-19) : les événements du journal des projets cochés, que la recherche
 * garde par leur titre ou le nom de leur projet. Un événement d'un projet que la liste
 * ne montre plus (archivé entre deux lectures) est écarté plutôt que montré sans avatar.
 */
export function workEvents(
  entries: readonly JournalEntryDto[],
  { projects, selected, query }: { projects: ReadonlyMap<string, WorkProjectRef>; selected: readonly string[]; query: string },
): JournalEntryDto[] {
  const needle = query.trim().toLocaleLowerCase()
  return entries.filter((entry) => {
    const project = projects.get(entry.projectId)
    if (!project) return false
    if (selected.length > 0 && !selected.includes(project.id)) return false
    return !needle || `${entry.title} ${project.name}`.toLocaleLowerCase().includes(needle)
  })
}

/** « Ce qui t'attend » (PF-16) des projets cochés ; une ligne sans projet reste. */
export function inboxInProjects<T extends object>(items: readonly T[], selected: readonly string[]): T[] {
  if (selected.length === 0) return [...items]
  return items.filter((item) => {
    const projectId = 'projectId' in item ? item.projectId : null
    return typeof projectId !== 'string' || selected.includes(projectId)
  })
}
