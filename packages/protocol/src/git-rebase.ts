import { z } from 'zod'
import type { ThreadRefDto } from './git-view.js'

/**
 * Les deux écritures qui **s'interrompent** : le rebase interactif, et le conflit
 * qu'il laisse derrière lui — ou qu'une fusion laisse.
 *
 * Module à part de `git-write.ts`, qui porte les gestes qui finissent dans la même
 * requête que celle qui les lance. Ceux-ci ne finissent pas : ils laissent le dépôt
 * dans un état intermédiaire que personne n'a demandé et dont il faut sortir. C'est ce
 * qui justifie les deux écarts assumés avec GitKraken qu'ils portent (carte #10) :
 *
 * - **les tours sont suspendus pendant un rebase** (planche T9). Un rebase à moitié
 *   fait n'est pas un dépôt qu'un agent sait lire : ni l'arbre, ni `HEAD`, ni la
 *   branche ne veulent dire ce qu'ils veulent dire d'habitude. Le verrou du lot 2 va
 *   dans l'autre sens (l'interface n'écrit pas pendant qu'un agent travaille) ; celui-
 *   ci est son symétrique ;
 * - **« laisser l'agent le résoudre »** (planche T10). L'éditeur de conflits est là,
 *   en entier, mais passer la main doit coûter un clic — un agent résout un conflit
 *   mieux et plus vite dès qu'il dépasse un `else` déplacé.
 *
 * Décision de dessin : `docs/audits/2026-10-15-git/README.md`, planches T9 et T10.
 */

/**
 * Les quatre verbes du rebase interactif, tels que la planche T9 les nomme.
 *
 * Quatre et pas douze : `edit`, `break`, `exec` et les autres verbes de git demandent
 * de reprendre la main dans un terminal, ce que cette vue ne sait pas offrir. Ceux-là
 * se décident entièrement d'avance, ce qui est la condition pour qu'un bouton
 * *Lancer* tienne sa promesse.
 */
export const rebaseVerbSchema = z.enum(['pick', 'squash', 'reword', 'drop'])
export type RebaseVerb = z.infer<typeof rebaseVerbSchema>

/**
 * Une ligne du plan : un commit et ce qu'on en fait.
 *
 * `message` n'est lu que par `reword`, et c'est **le serveur qui l'écrit dans un
 * fichier** plutôt que de le passer à git sur une ligne de commande : le todo d'un
 * rebase est relu par un shell, et un message de commit contient des apostrophes, des
 * retours à la ligne et parfois un `$`.
 */
export const rebaseStepSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{7,40}$/),
  verb: rebaseVerbSchema,
  message: z.string().max(10_000).default(''),
})

export type RebaseStep = z.infer<typeof rebaseStepSchema>

/** Un commit du plan, tel que l'écran le montre avant de lancer quoi que ce soit. */
export interface RebaseCommitDto {
  hash: string
  shortHash: string
  subject: string
  body: string
  author: string
  agent: string | null
  ts: number
  thread: ThreadRefDto | null
}

/**
 * Ce qu'il y aurait à rebaser, et sur quoi : la liste que l'écran propose.
 *
 * Rendue par une lecture à part et non par l'état général : on ne la demande qu'en
 * ouvrant le rebase interactif, et elle coûte un `log` de plus.
 */
export interface RebasePlanDto {
  /** Null hors dépôt git, ou quand il n'y a pas d'amont à viser. */
  onto: { ref: string; shortHash: string; subject: string } | null
  /** Du plus ancien au plus récent, l'ordre dans lequel git les rejouera. */
  commits: RebaseCommitDto[]
  /** La branche qui sera déplacée. */
  branch: string | null
  /** Vrai si l'amont a été déduit (`@{upstream}`) plutôt que désigné. */
  guessed: boolean
}

/**
 * Un rebase en cours, c'est-à-dire un dépôt dont il faut sortir.
 *
 * Présent dans `GitStateDto` et non dans une lecture à part : c'est lui qui suspend
 * les tours et qui change ce que la vue entière a le droit de faire, donc il doit
 * arriver avec le reste de l'état, pas une requête plus tard.
 */
export interface GitRebaseDto {
  /** Sur quoi on rebase, tel que git l'a retenu. */
  onto: string | null
  /** Le commit sur lequel git s'est arrêté, s'il y en a un. */
  stopped: { shortHash: string; subject: string } | null
  done: number
  total: number
  /** Les fichiers en conflit, qui sont la raison de l'arrêt quand il y en a. */
  conflicted: string[]
}

/** D'où vient le conflit : la phrase de l'en-tête n'est pas la même. */
export type ConflictOrigin = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

/**
 * Un morceau de fichier en conflit.
 *
 * Le fichier arrive découpé plutôt qu'en vrac avec ses marqueurs : l'écran de T10
 * empile les trois versions **par bloc**, chacune avec son « prendre », et laisser le
 * client recouper `<<<<<<<` à chaque rendu reviendrait à écrire deux fois le même
 * analyseur — une fois ici, une fois pour reconstruire le résultat.
 */
export type ConflictSegmentDto =
  | { kind: 'context'; lines: string[] }
  | { kind: 'conflict'; ours: string[]; theirs: string[] }

export interface ConflictFileDto {
  path: string
  /** Un conflit binaire ne s'édite pas : seuls *prendre les miens / les leurs* restent. */
  binary: boolean
  segments: ConflictSegmentDto[]
  /** Vrai si le fichier a été coupé : un conflit peut porter sur dix mille lignes. */
  truncated: boolean
}

/**
 * Tous les conflits du dépôt, avec de quoi nommer les deux côtés.
 *
 * « Les miens » et « les leurs » ne suffisent pas : pendant un rebase, les deux
 * s'inversent par rapport à ce qu'on croit — `ours` est le commit sur lequel on
 * rejoue, `theirs` est son propre travail. Les étiquettes partent donc du serveur,
 * qui sait laquelle est laquelle.
 */
export interface ConflictsDto {
  origin: ConflictOrigin | null
  oursLabel: string
  theirsLabel: string
  files: ConflictFileDto[]
}
