import { z } from 'zod'
import type { DiffFileDto } from './api.js'

/**
 * Ce que la vue Git du panneau lit du dépôt : le graphe, les références, un commit.
 *
 * Dans son propre module plutôt que dans `api.ts` : le volet git y pèse déjà autant
 * que le reste réuni, et la vue en demande trois fois plus — graphe, remises, retard
 * sur l'amont, rattachement au fil. Le diff, lui, reste là-bas : il est partagé avec
 * l'onglet Historique (`DiffFileDto`).
 *
 * Décision de dessin : `docs/audits/2026-10-15-git/README.md`, tours 3 et 4.
 */

/**
 * Les quatre natures de nœud du graphe, telles que GitKraken les distingue.
 *
 * `working` est le nœud « en cours », qui n'est pas un commit : il porte ce que
 * `git status` dit du répertoire de travail, et c'est lui qui est sélectionné à
 * l'ouverture — on arrive sur ce qui n'est pas encore commité, pas sur le passé.
 */
export type GraphNodeKind = 'commit' | 'merge' | 'working' | 'stash'

export type GraphRefKind = 'head' | 'local' | 'remote' | 'tag' | 'worktree'

export interface GraphRefDto {
  name: string
  kind: GraphRefKind
}

/**
 * Le fil qui a produit un commit ou qui occupe un worktree.
 *
 * C'est l'écart assumé avec GitKraken : l'auteur d'un commit est presque toujours un
 * agent, et ce qui renseigne est la conversation. `sure` dit comment le rattachement a
 * été établi — par la branche, ce qui ne se trompe pas, ou par recoupement de dates,
 * qui est une déduction. L'interface n'affiche pas la différence mais l'infobulle si.
 */
export interface ThreadRefDto {
  id: string
  title: string
  sure: boolean
}

/**
 * Un nœud du graphe, couloirs compris.
 *
 * Les couloirs sont calculés côté serveur, en une seule passe sur la fenêtre chargée :
 * le client n'a pas les parents des commits qu'il n'a pas reçus, et refaire le calcul
 * à chaque rendu coûterait plus que de le transporter.
 */
export interface GraphNodeDto {
  kind: GraphNodeKind
  /** Vide pour le nœud « en cours », qui n'a pas d'objet. */
  hash: string
  shortHash: string
  subject: string
  /** Auteur git, tel que `%an` le rend. */
  author: string
  /**
   * Agent nommé par le `Co-Authored-By` du message, s'il y en a un.
   *
   * C'est le seul signe fiable qu'un commit a été écrit par un agent : l'auteur git
   * est l'utilisateur dans les deux cas, puisque le CLI commite sous son identité.
   */
  agent: string | null
  /** Horodatage du commit en millisecondes ; celui du nœud « en cours » est `now`. */
  ts: number
  parents: string[]
  refs: GraphRefDto[]
  thread: ThreadRefDto | null
  /** Couloir du nœud, 0 à gauche. */
  lane: number
  /** Couloirs qui traversent la rangée de haut en bas, sans s'y arrêter. */
  through: number[]
  /** Couloirs qui rejoignent ce nœud par le bas : parents d'une fusion. */
  joins: number[]
  /** Couloirs qui rejoignent ce nœud par le haut : branches qui retombent dessus. */
  collapses: number[]
  /** Rien au-dessus : le couloir part du nœud. */
  tip: boolean
  /** Rien en dessous : le couloir s'arrête au nœud. */
  root: boolean
  /** Renseigné pour le seul nœud « en cours ». */
  working: { files: number; added: number; removed: number } | null
}

export interface GraphDto {
  /** Null si le répertoire de travail n'est pas un dépôt git. */
  nodes: GraphNodeDto[] | null
  /** Nombre de couloirs occupés, d'où se déduit la largeur de la colonne. */
  lanes: number
  hasMore: boolean
  branch: string | null
  /** Vrai quand la fenêtre a été filtrée : la recherche affiche son compte. */
  filtered: boolean
}

/**
 * Filtres de la destination *Recherche*, qui sont aussi ceux du graphe.
 *
 * `thread` et `hand` sont les deux que GitKraken n'a pas : par fil, et « écrit par un
 * agent / écrit à la main ». Le second se lit sur le `Co-Authored-By`, le premier sur
 * le rattachement calculé — donc tous deux après coup, sur la fenêtre chargée, et non
 * par `git log` qui ne les connaît pas.
 */
export const graphQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(60),
  skip: z.coerce.number().int().min(0).default(0),
  /** Texte cherché dans le message. */
  q: z.string().trim().max(200).optional(),
  author: z.string().trim().max(200).optional(),
  file: z.string().trim().max(400).optional(),
  branch: z.string().trim().max(200).optional(),
  since: z.string().trim().max(40).optional(),
  until: z.string().trim().max(40).optional(),
  thread: z.string().trim().max(64).optional(),
  hand: z.enum(['agent', 'human']).optional(),
})

export type GraphQuery = z.infer<typeof graphQuerySchema>

/** Une ligne de la destination *Branches*. */
export interface RefLineDto {
  name: string
  /** Nom complet (`refs/heads/main`), qui sert de clé : deux remotes ont le même court. */
  fullName: string
  hash: string
  /** La branche du répertoire consulté. */
  current: boolean
  upstream: string | null
  /** Retard sur l'amont, null quand la branche n'en suit pas. */
  ahead: number | null
  behind: number | null
  /** Worktree qui a cette branche sortie, s'il y en a un. */
  worktreePath: string | null
  thread: ThreadRefDto | null
  subject: string
  ts: number
}

export type RefSectionKind = 'local' | 'worktrees' | 'remote' | 'tags' | 'submodules'

/**
 * Une section de la destination *Branches*.
 *
 * Une section vide reste dans la liste et dit qu'il n'y a rien : une section qui
 * apparaît un jour sans prévenir est pire qu'une section vide.
 */
export interface RefSectionDto {
  kind: RefSectionKind
  /** Nom du remote, pour les seules sections `remote`. */
  remote: string | null
  lines: RefLineDto[]
}

export interface RefsDto {
  /** Null hors dépôt git. */
  sections: RefSectionDto[] | null
}

/** Ce que la vue montre du commit sélectionné, diff compris. */
export interface CommitDetailDto {
  hash: string
  shortHash: string
  subject: string
  body: string
  author: string
  authorEmail: string
  agent: string | null
  ts: number
  parents: { hash: string; shortHash: string }[]
  refs: GraphRefDto[]
  /** Branches qui contiennent ce commit, locales et distantes. */
  containedIn: string[]
  thread: ThreadRefDto | null
  files: DiffFileDto[]
  patch: string
  truncated: boolean
}
