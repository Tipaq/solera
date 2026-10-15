import { z } from 'zod'
import type { DiffFileDto } from './api.js'

/**
 * Ce que la vue Git du panneau **écrit** dans le dépôt, et ce qu'elle doit savoir
 * avant d'écrire.
 *
 * Module à part de `git-view.ts`, qui ne lit que : la frontière n'est pas décorative.
 * Une lecture qui se trompe affiche une bêtise, une écriture qui se trompe abîme un
 * dépôt — les deux ne se relisent pas avec la même attention, et les garde-fous de ce
 * module n'ont de sens que pour le second.
 *
 * Décision de dessin : `docs/audits/2026-10-15-git/README.md`, planches T0 (où vit
 * chaque geste), T2 (En cours), T5 (le menu d'un commit), T8 (Remises) et T13
 * (Annuler, et le garde-fou).
 */

/**
 * Un nom de référence, tel que git l'accepte.
 *
 * Les caractères refusés sont ceux de `git check-ref-format`, plus le tiret initial
 * qui ferait passer le nom pour une option sur la ligne de commande. Rien ici ne
 * remplace la vérification de git, qui reste l'autorité : ce filtre existe pour que
 * l'argument n'ait aucune chance d'être interprété comme autre chose qu'un nom.
 */
export const refNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^-][^\s~^:?*[\\]*$/, 'This is not a valid reference name.')
  .refine((name) => !name.includes('..') && !name.endsWith('.lock'))

const hashSchema = z.string().regex(/^[0-9a-f]{7,40}$/)
const pathsSchema = z.array(z.string().min(1).max(400)).min(1).max(500)
const stashIndex = z.number().int().min(0).max(500)

/**
 * Le sha de la remise visée, quand on l'a vue.
 *
 * `null` pour le *Dépiler* de la barre d'outils, qui veut dire « celle du dessus,
 * quelle qu'elle soit » : c'est un geste sans objet désigné, donc sans sha à vérifier.
 * Partout ailleurs — la liste des remises — le sha part avec, et c'est lui qui dit si
 * `stash@{1}` désigne encore ce qu'on regardait.
 */
const stashHash = hashSchema.nullable().default(null)

/**
 * Le geste demandé, tel qu'il part sur le fil.
 *
 * Une union discriminée plutôt qu'une route par geste : les vingt-cinq gestes de la
 * planche T0 partagent le même contrôle d'accès, le même verrou de concurrence et le
 * même journal d'annulation, et vingt-cinq routes auraient été vingt-cinq endroits où
 * en oublier un. Le prix, assumé : l'aiguillage est un `switch`, lisible d'un bloc.
 *
 * Les remises portent **leur index et leur sha**. La pile des remises est partagée par
 * tous les worktrees d'un dépôt, donc une autre session peut l'avoir fait glisser
 * entre l'affichage et le clic : c'est le sha qui dit si `stash@{1}` est toujours la
 * remise qu'on regardait.
 */
export const gitActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('stage'), paths: pathsSchema }),
  z.object({ kind: z.literal('unstage'), paths: pathsSchema }),
  z.object({ kind: z.literal('discard'), paths: pathsSchema }),
  z.object({
    kind: z.literal('commit'),
    summary: z.string().trim().min(1).max(500),
    description: z.string().max(10_000).default(''),
    amend: z.boolean().default(false),
    /** Ligne `Co-Authored-By` complète, que le serveur ajoute telle quelle. */
    coAuthor: z.string().trim().max(300).nullable().default(null),
    push: z.boolean().default(false),
  }),
  z.object({ kind: z.literal('fetch') }),
  z.object({ kind: z.literal('pull') }),
  z.object({
    kind: z.literal('push'),
    force: z.boolean().default(false),
    branch: refNameSchema.nullable().default(null),
  }),
  z.object({
    kind: z.literal('branch-create'),
    name: refNameSchema,
    /** Point de départ : un sha, une branche, ou `null` pour `HEAD`. */
    from: z.string().trim().max(200).nullable().default(null),
    checkout: z.boolean().default(true),
  }),
  z.object({ kind: z.literal('branch-switch'), name: refNameSchema }),
  z.object({ kind: z.literal('branch-merge'), name: refNameSchema }),
  z.object({ kind: z.literal('branch-rebase'), name: refNameSchema }),
  z.object({ kind: z.literal('branch-rename'), name: refNameSchema, to: refNameSchema }),
  z.object({ kind: z.literal('branch-delete'), name: refNameSchema, force: z.boolean().default(false) }),
  z.object({ kind: z.literal('branch-track'), name: refNameSchema, upstream: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal('commit-switch'), hash: hashSchema }),
  z.object({ kind: z.literal('commit-branch'), hash: hashSchema, name: refNameSchema }),
  z.object({ kind: z.literal('commit-merge'), hash: hashSchema }),
  z.object({ kind: z.literal('commit-rebase'), hash: hashSchema }),
  z.object({ kind: z.literal('commit-cherry-pick'), hash: hashSchema }),
  z.object({ kind: z.literal('commit-revert'), hash: hashSchema }),
  z.object({ kind: z.literal('commit-reset'), hash: hashSchema, mode: z.enum(['soft', 'mixed', 'hard']) }),
  z.object({ kind: z.literal('commit-tag'), hash: hashSchema, name: refNameSchema }),
  z.object({ kind: z.literal('stash-push'), message: z.string().trim().max(200).default('') }),
  z.object({ kind: z.literal('stash-pop'), index: stashIndex, hash: stashHash }),
  z.object({ kind: z.literal('stash-apply'), index: stashIndex, hash: stashHash }),
  z.object({ kind: z.literal('stash-branch'), index: stashIndex, hash: stashHash, name: refNameSchema }),
  z.object({ kind: z.literal('stash-drop'), index: stashIndex, hash: stashHash }),
])

export type GitAction = z.infer<typeof gitActionSchema>
export type GitActionKind = GitAction['kind']

/**
 * Une perte, nommée par ce qu'elle est et chiffrée.
 *
 * C'est la moitié du garde-fou de T13 : « ceci ne s'annule pas » ne suffit pas, il
 * faut dire quoi. `byAgent` existe parce que perdre quatre commits dont deux écrits
 * par un agent dans ce fil ne se décide pas comme perdre quatre commits à soi.
 */
export interface GitLossDto {
  kind: 'working' | 'staged' | 'commits' | 'stash' | 'remote'
  count: number
  added?: number
  removed?: number
  byAgent?: number
}

/**
 * Ce que coûterait le geste, demandé **avant** de le faire.
 *
 * La règle de T13 : tout ce qui n'est pas annulable passe par un garde-fou qui nomme
 * exactement ce qui sera perdu. L'interface n'appelle donc `act` qu'après avoir lu
 * ceci pour les gestes qui mordent, et le serveur calcule les deux depuis les mêmes
 * lectures — un garde-fou qui ne dirait pas la vérité serait pire que pas de garde-fou.
 */
export interface GitImpactDto {
  undoable: boolean
  losses: GitLossDto[]
  /** Proposer « remiser d'abord » : il y a du travail en cours à sauver. */
  offerStash: boolean
}

/** Les gestes qu'`Annuler` sait défaire, chacun avec sa phrase. */
export type GitUndoKind =
  | 'commit'
  | 'amend'
  | 'merge'
  | 'rebase'
  | 'cherry-pick'
  | 'revert'
  | 'reset'
  | 'switch'
  | 'branch-create'
  | 'branch-delete'
  | 'branch-rename'
  | 'tag'
  | 'track'
  | 'stash-push'

/**
 * Ce qu'`Annuler` annulerait, tel que le bandeau de T13 l'écrit.
 *
 * Il ne dit pas « annuler » mais *quoi* il annule et *où* ça ramène, et il n'est rendu
 * que tant que c'est encore vrai : le serveur revérifie l'état du dépôt à chaque
 * lecture et ne rend rien si le dépôt a bougé depuis. Ne jamais promettre un
 * « Annuler » qu'on ne peut pas tenir.
 */
export interface GitUndoDto {
  kind: GitUndoKind
  /** Ce sur quoi portait le geste : une branche, un message, un nom de remise. */
  subject: string
  /** Où l'annulation ramène, en sha court, quand ça a un sens. */
  target: string | null
  /** Vrai si ce qu'on annulerait est déjà sur un distant : le dire change la décision. */
  pushed: boolean
}

/**
 * Le fil qui tient le répertoire pendant qu'un tour tourne.
 *
 * Décision de la carte #10, question 2 : un seul écrivain à la fois. Les écritures de
 * l'interface sont fermées tant qu'un agent travaille dans ce même répertoire — pas
 * d'index concurrent, pas de fichier qui bouge sous un patch. La lecture, elle,
 * continue. Planche `tour-1/clair/04`.
 */
export interface GitLockDto {
  threadId: string
  title: string
}

/** Une remise, avec l'aperçu sans lequel on n'ose plus dépiler (planche T8). */
export interface StashDto {
  index: number
  hash: string
  /** `stash@{0}`, tel que git le nomme. */
  ref: string
  message: string
  branch: string | null
  ts: number
  files: DiffFileDto[]
  /** Vrai si l'aperçu a été coupé : une remise peut porter des centaines de fichiers. */
  truncated: boolean
}

export interface StashesDto {
  stashes: StashDto[]
}

/**
 * L'état d'écriture du dépôt : ce qui est indexé, ce qui ne l'est pas, et ce qui
 * empêche ou défait.
 *
 * Une seule lecture pour toute la destination *En cours* et toute la barre d'outils :
 * elles ne se regardent jamais séparément, et trois requêtes auraient triplé le délai
 * d'ouverture pour trois process git de plus.
 */
export interface GitStateDto {
  /** Null hors dépôt git, comme les autres lectures de la vue. */
  branch: string | null
  upstream: string | null
  ahead: number | null
  behind: number | null
  detached: boolean
  staged: DiffFileDto[]
  unstaged: DiffFileDto[]
  stagedPatch: string
  unstagedPatch: string
  truncated: boolean
  head: { hash: string; shortHash: string; subject: string } | null
  lock: GitLockDto | null
  undo: GitUndoDto | null
  redo: GitUndoDto | null
  /**
   * La ligne `Co-Authored-By` de l'agent de ce fil, prête à être ajoutée au message.
   *
   * Null en portée projet, où aucun agent n'est désigné. C'est ce qui fait que la
   * colonne *Auteur* du graphe saura dire « Claude » : le CLI commite sous l'identité
   * git de l'utilisateur, et le co-auteur est le seul endroit où l'agent s'écrit.
   */
  coAuthor: string | null
  /** Un conflit est en cours : la destination *Conflits* du rail, qui est le lot 3. */
  conflicted: string[]
}
