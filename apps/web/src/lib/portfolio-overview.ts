import type { CardDto, JournalEntryDto, MilestoneRunDto, ProjectDto } from '@solera/protocol'
import type { SessionTone, TreeRow } from './code-model'
import { beaconOf, beaconProgress } from './milestone-beacon'
import { horizonOf } from './milestone-model'
import { openLeafCount } from './place'

/*
 * L'Aperçu du portefeuille (#237, `coque.md` PF-8 à PF-13) : « où en sont mes
 * projets ? ». Pur : la page lui passe ce que les requêtes du portefeuille rendent.
 */

/** Arbres montrés dans « Code en cours » : le compte du titre dit le reste. */
export const CODE_SHOWN = 12
/** Lignes de « Derniers événements ». */
export const EVENTS_SHOWN = 8

/** Le jalon en cours d'un projet, tel que sa carte le montre. */
export interface SummaryMilestone {
  number: number
  title: string
  done: number
  total: number
  dueAt: number | null
}

/** La carte d'un projet (PF-10). */
export interface ProjectSummary {
  project: ProjectDto
  /** Ses sessions qui attendent une réponse ou se sont arrêtées en erreur. */
  waiting: number
  /** Ses sessions vivantes : qui travaillent, attendent ou sont en erreur. */
  live: number
  /** Ses cartes ouvertes, feuilles seulement : le compte de l'onglet Tableau. */
  open: number
  milestone: SummaryMilestone | null
  /** Son dernier événement du journal, null s'il n'en a pas dans la fenêtre. */
  lastAt: number | null
}

export interface SummarySources {
  projects: readonly ProjectDto[]
  cards: readonly CardDto[]
  /** Les jalons lancés des projets : un jalon lancé passe devant un jalon prêt, comme au phare. */
  runs: readonly MilestoneRunDto[]
  /** Les sessions des projets, avec leur ton ; null : au repos. */
  sessions: readonly { projectId: string; tone: SessionTone | null }[]
  /** Les entrées du journal, tous projets, la plus récente d'abord ou non. */
  events: readonly Pick<JournalEntryDto, 'projectId' | 'at'>[]
}

/**
 * Le jalon en cours : celui que le phare de l'Aperçu du projet met en grand (#174). Les
 * demandes ouvertes n'y changent rien : elles ne jouent pas sur la maturité.
 */
function currentMilestone(cards: readonly CardDto[], runs: readonly MilestoneRunDto[]): SummaryMilestone | null {
  const { current } = beaconOf(horizonOf({ cards, runs, requests: new Map() }))
  if (!current) return null
  const { done, total } = beaconProgress(current)
  return { number: current.card.number, title: current.card.title, done, total, dueAt: current.card.dueAt }
}

/**
 * Une carte par projet, triées par ce qui réclame Tim : le plus de sessions qui
 * attendent, puis le plus de sessions vivantes, puis l'activité la plus récente, puis
 * le nom.
 */
export function projectSummaries({ projects, cards, runs, sessions, events }: SummarySources): ProjectSummary[] {
  return projects
    .map((project): ProjectSummary => {
      const mine = cards.filter((entry) => entry.projectId === project.id)
      const tones = sessions.filter((entry) => entry.projectId === project.id && entry.tone !== null)
      const lastAt = events.reduce<number | null>(
        (max, entry) => (entry.projectId === project.id && (max === null || entry.at > max) ? entry.at : max),
        null,
      )
      return {
        project,
        waiting: tones.filter((entry) => entry.tone !== 'running').length,
        live: tones.length,
        open: openLeafCount(mine),
        milestone: currentMilestone(mine, runs),
        lastAt,
      }
    })
    .sort(
      (a, b) =>
        b.waiting - a.waiting ||
        b.live - a.live ||
        (b.lastAt ?? 0) - (a.lastAt ?? 0) ||
        a.project.name.localeCompare(b.project.name),
    )
}

/** Un arbre du code en cours, qui sait d'où il vient. */
export type PortfolioTree = TreeRow & { project: ProjectDto }

/**
 * Ce qui vit dans un arbre (PF-11) : pas un arbre fusionné, vide ou introuvable, sauf
 * si une session y tourne encore ; la racine seulement si elle porte du non commité ou
 * une session — une racine propre et calme n'est pas du code en cours.
 */
function isActive(tree: TreeRow): boolean {
  if (tree.sessions.length > 0) return true
  if (tree.root) return tree.uncommitted > 0
  return !['clean', 'empty', 'missing'].includes(tree.verdict)
}

/** Les arbres actifs de tous les projets : ce qui tourne d'abord, puis le plus récent. */
export function activeTrees(groups: readonly { project: ProjectDto; trees: readonly TreeRow[] }[]): PortfolioTree[] {
  return groups
    .flatMap(({ project, trees }) => trees.filter(isActive).map((tree) => ({ ...tree, project })))
    .sort(
      (a, b) =>
        Number(b.sessions.length > 0) - Number(a.sessions.length > 0) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0),
    )
}

/**
 * Les derniers événements (PF-12). Le journal du portefeuille peut citer un projet que
 * la liste ne montre plus (archivé entre deux lectures) : sa ligne est écartée plutôt
 * que montrée sans avatar.
 */
export function recentEvents(
  entries: readonly JournalEntryDto[],
  projects: ReadonlyMap<string, unknown>,
  count: number,
): JournalEntryDto[] {
  return entries.filter((entry) => projects.has(entry.projectId)).slice(0, count)
}
