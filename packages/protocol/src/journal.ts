import { z } from 'zod'

/**
 * Le Journal : ce qui s'est passé, dans l'ordre, à partir de matière qui existe déjà.
 *
 * Rien ici n'est écrit à l'événement. Les sept sources sont **dérivées à la lecture**,
 * et c'est tenable depuis que `card_moves` existe : le seul fait que personne ne
 * pouvait redériver — *quand* une carte a changé de colonne — a sa table, le reste est
 * déjà daté là où il est stocké. Une table `project_events` aurait demandé qu'on pense
 * à l'alimenter depuis chaque site d'écriture, serait née vide sur les projets
 * existants, et n'aurait de toute façon rien su des fusions ni des audits, qui se
 * produisent hors de l'application.
 *
 * Référence d'interface : `docs/audits/2026-10-14-gestion-de-projet/final/pages/`,
 * écrans F5 (un projet) et F11 (le portefeuille).
 */

/**
 * Ce qu'une ligne raconte. Le libellé en petites capitales en est la traduction, et
 * l'icône la reprend.
 *
 * Pas de `decision`, et ce n'est pas un oubli : la maquette F5 en montrait une, mais
 * `card_notes.body` est un champ libre et la carte #32 a **refusé** de lui donner un
 * type (2026-10-15). Un `kind` rempli au jugé par les agents, qui étiquetteraient tout
 * « décision », ferait un tri auquel on ne peut pas se fier — pire qu'un tri absent.
 * Le journal écrit donc `NOTE` et dit la vérité.
 */
export const JOURNAL_KINDS = [
  'note',
  'cardOpened',
  'cardClosed',
  'session',
  'run',
  'branch',
  'audit',
] as const

export type JournalKind = (typeof JOURNAL_KINDS)[number]

/**
 * Les familles que les pilules basses filtrent.
 *
 * Quatre et non trois : *Notes*, *Cartes* et *Sessions* laissaient les fusions et les
 * audits — les deux seules sources qui ne sont pas en base — joignables par *Tout* et
 * par rien d'autre. *Dépôt* les rassemble, et c'est aussi ce qu'elles ont en commun :
 * elles se lisent dans le dossier du projet, pas dans sa base.
 */
export const JOURNAL_FAMILIES = ['notes', 'cards', 'sessions', 'repo'] as const

export type JournalFamily = (typeof JOURNAL_FAMILIES)[number]

export const JOURNAL_FAMILY_OF: Record<JournalKind, JournalFamily> = {
  note: 'notes',
  cardOpened: 'cards',
  cardClosed: 'cards',
  session: 'sessions',
  run: 'sessions',
  branch: 'repo',
  audit: 'repo',
}

/**
 * Une ligne du journal.
 *
 * La provenance est **structurée et non rédigée** : le serveur rend le numéro de carte,
 * le texte libre déjà écrit quelque part (titre de session, nom de tâche) et un compte,
 * à charge de la page de les composer. Rédiger « carte #17 · 1 session » côté serveur
 * aurait figé la langue dans la réponse, alors que l'interface est bilingue de
 * structure et que le français ne s'accorde pas comme l'anglais.
 */
export interface JournalEntryDto {
  /** Stable d'une lecture à l'autre : c'est la clé de liste, pas un rang. */
  id: string
  kind: JournalKind
  at: number
  /** Le grand texte de la ligne. */
  title: string
  /** Le projet d'où elle sort : la pastille du portefeuille, et le lien. */
  projectId: string
  /** Carte dont la ligne parle, quand il y en a une. */
  cardNumber: number | null
  /**
   * Second membre de la provenance, **déjà écrit ailleurs** : le titre de la session
   * qui a posé la note, le CLI qui a ouvert le fil. Jamais une phrase fabriquée ici.
   */
  source: string | null
  /**
   * Ce que la provenance compte, quand elle compte quelque chose. Le `kind` dit de quoi
   * il s'agit : des sessions pour une carte fermée, des commits pour une branche.
   */
  count: number | null
  /** Verdict d'un tir planifié, et rien d'autre : une valeur fermée, donc traduisible. */
  status: JournalRunStatus | null
  /** Conversation à ouvrir, quand la ligne en désigne une. */
  conversationId: string | null
}

/** Les états d'un tir, tels que `scheduled_runs.status` les écrit. */
export type JournalRunStatus = 'running' | 'succeeded' | 'failed' | 'timed_out' | 'skipped'

export interface JournalDto {
  entries: JournalEntryDto[]
  /** La fenêtre effectivement lue, en jours : la page l'annonce plutôt que de la deviner. */
  days: number
  /**
   * Vrai quand au moins un projet de la fenêtre n'a pas pu être lu dans son dossier —
   * dépôt absent, droits, `git` qui déborde son délai. Les lignes de base sont là, les
   * fusions et les audits de ce projet manquent, et le dire vaut mieux que de rendre un
   * journal troué sans prévenir.
   */
  repoIncomplete: boolean
}

/** Fenêtre par défaut, et celle que la maquette annonce. */
export const JOURNAL_DEFAULT_DAYS = 14

/**
 * Borne haute : au-delà, la lecture des fusions coûte un `git log` sur des mois
 * d'histoire pour chaque projet, et personne ne déroule trois mois de journal à la
 * souris. La pagination viendra quand on en aura la demande, pas avant.
 */
export const JOURNAL_MAX_DAYS = 90

export const journalQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(JOURNAL_MAX_DAYS).default(JOURNAL_DEFAULT_DAYS),
})

export type JournalQuery = z.infer<typeof journalQuerySchema>
