import { z } from 'zod'
import { type ConversationStatus } from './api.js'
import { type AgentKind } from './events.js'

/**
 * Colonne du board, c'est-à-dire la position choisie d'une carte dans le workflow.
 *
 * Délibérément pas nommée `status` : ce mot désigne l'état d'exécution d'une
 * conversation, et confondre les deux est le piège central de ce chantier. Une carte
 * porte trois axes orthogonaux — la colonne, qui se décide ; l'activité, qui s'observe
 * sur les conversations rattachées et n'est jamais persistée ici ; l'état de merge, qui
 * se lit dans git. Seul le premier est un champ de la table.
 *
 * La liste est fermée : les colonnes personnalisables rendraient l'état illisible pour
 * les dérivations et pour les outils qui liront le board.
 */
export const cardColumnSchema = z.enum(['todo', 'in_progress', 'review', 'done', 'abandoned'])
export type CardColumn = z.infer<typeof cardColumnSchema>

/** Ordre d'affichage des colonnes, du backlog vers les sorties. */
export const CARD_COLUMNS: readonly CardColumn[] = [
  'todo',
  'in_progress',
  'review',
  'done',
  'abandoned',
]

/**
 * Colonnes de sortie, repliées par défaut sur le board : sans quoi un projet ancien
 * finit dominé par son cimetière.
 */
export const CARD_CLOSED_COLUMNS: readonly CardColumn[] = ['done', 'abandoned']

const TITLE_MAX = 200
const DESCRIPTION_MAX = 20_000

export const createCardBodySchema = z.object({
  title: z.string().min(1).max(TITLE_MAX),
  description: z.string().max(DESCRIPTION_MAX).default(''),
  column: cardColumnSchema.default('todo'),
})

export const updateCardBodySchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX),
    description: z.string().max(DESCRIPTION_MAX),
    column: cardColumnSchema,
    /**
     * Échéance, ou `null` pour l'enlever. Nullable et non optionnelle : « pas de date »
     * est un choix qui s'écrit, alors que l'absence de clé veut dire « n'y touche pas ».
     */
    dueAt: z.number().int().nullable(),
    /** Carte-jalon à laquelle celle-ci se rattache, ou `null` pour l'en détacher. */
    milestoneCardId: z.string().uuid().nullable(),
  })
  .partial()

/**
 * Pose ou retire un lien « bloque » entre deux cartes du même projet.
 *
 * Posé à la main et donc affirmé, à l'inverse des références `#12` que l'enregistrement
 * d'une description réécrit : les deux ne vivent pas dans la même table, et une
 * correction de phrase ne doit pas effacer un blocage que quelqu'un a constaté.
 */
export const cardBlockBodySchema = z.object({
  /** La carte que celle-ci empêche d'avancer. */
  blockedId: z.string().uuid(),
})

/**
 * Coche ou décoche la n-ième sous-tâche de la description.
 *
 * `label` voyage avec l'indice et n'est pas décoratif : la description a pu changer
 * entre l'affichage et le clic, et réécrire la n-ième case sans vérifier ce qu'elle dit
 * cocherait une autre ligne que celle qu'on a vue. Le serveur refuse quand les deux ne
 * concordent plus, plutôt que d'écrire au hasard.
 */
export const toggleSubtaskBodySchema = z.object({
  index: z.number().int().min(0),
  checked: z.boolean(),
  label: z.string().max(DESCRIPTION_MAX),
})

/**
 * Ordre des cartes, colonne par colonne, du haut vers le bas.
 *
 * Un déplacement touche une colonne quand il monte ou descend une carte, deux quand il
 * la change de colonne. Les deux sont donc écrites d'un seul geste : les envoyer
 * séparément laisserait une carte dupliquée ou absente entre les deux requêtes.
 */
export const reorderCardsBodySchema = z.object({
  columns: z
    .array(
      z.object({
        column: cardColumnSchema,
        ids: z.array(z.string().uuid()),
      }),
    )
    .min(1)
    .max(CARD_COLUMNS.length),
})

/** Une carte vue depuis une autre : de quoi rendre une puce `#12` sans second appel. */
export interface CardLinkDto {
  id: string
  number: number
  title: string
  column: CardColumn
}

/**
 * Une conversation rattachée, telle que la carte a besoin de la montrer.
 *
 * `status` est l'état au chargement, comme partout ailleurs : le flux de statuts du
 * WebSocket a le dernier mot côté client.
 */
export interface CardConversationDto {
  id: string
  title: string
  agent: AgentKind
  status: ConversationStatus
  costUsd: number
  worktreeId: string | null
  worktreeName: string | null
  archivedAt: number | null
  createdAt: number
}

const NOTE_MAX = 8_000

export const createCardNoteBodySchema = z.object({
  body: z.string().min(1).max(NOTE_MAX),
})

/**
 * Une note du fil d'une carte : ce qu'une session a fait, trouvé ou décidé.
 *
 * Ajoutée, jamais réécrite, et distincte de la description : celle-ci est l'énoncé du
 * travail, tenu par une personne ; les notes en sont l'historique, écrit surtout par
 * les agents.
 */
export interface CardNoteDto {
  id: string
  body: string
  createdAt: number
  /**
   * Qui l'a écrite. Une note d'agent porte sa conversation, pour qu'on puisse aller
   * lire le travail dont elle rend compte ; `null` quand la conversation a été
   * supprimée depuis, la note lui survivant.
   */
  author:
    | { kind: 'agent'; agent: AgentKind; conversationId: string | null; conversationTitle: string }
    | { kind: 'user'; name: string }
}

export interface CardDto {
  id: string
  projectId: string
  /** Numéro court, unique dans le projet, tel qu'il s'écrit après le `#`. */
  number: number
  title: string
  description: string
  column: CardColumn
  position: number
  /** Échéance choisie, `null` tant que personne n'en a posé — et c'est la norme. */
  dueAt: number | null
  /**
   * La carte-jalon à laquelle celle-ci se rattache. Un jalon est une carte ordinaire :
   * sa date est son échéance, son état est sa colonne, et rien ne la distingue sinon
   * d'être désignée ici.
   */
  milestone: CardLinkDto | null
  createdBy: string
  createdByName: string
  createdAt: number
  updatedAt: number
  conversations: CardConversationDto[]
  /** Les notes ne voyagent pas avec la liste : le board n'en affiche que le compte. */
  attachmentCount: number
  noteCount: number
  /** Cartes que la description de celle-ci mentionne. */
  references: CardLinkDto[]
  /** Cartes dont la description mentionne celle-ci. */
  referencedBy: CardLinkDto[]
  /** Cartes que celle-ci empêche d'avancer, par un lien posé à la main. */
  blocks: CardLinkDto[]
  /** Cartes qui empêchent celle-ci d'avancer. */
  blockedBy: CardLinkDto[]
}

/**
 * Le `#` doit ouvrir un mot, comme le `@` des fichiers : sans cette contrainte, une
 * couleur hexadécimale ou une ancre d'URL passerait pour une référence.
 */
const CARD_REFERENCE = /(?:^|[^\w#])#(\d+)\b/g

/**
 * Numéros de cartes cités dans un texte, dédupliqués et dans l'ordre d'apparition.
 *
 * Partagé par le serveur, qui en tire les backlinks à l'enregistrement, et par le web,
 * qui en tire les puces cliquables. Deux analyseurs finiraient par diverger, et une
 * référence rendue d'un côté sans exister de l'autre est pire que pas de référence.
 */
export function parseCardReferences(text: string): number[] {
  const found: number[] = []
  for (const match of text.matchAll(CARD_REFERENCE)) {
    const number = Number(match[1])
    if (Number.isSafeInteger(number) && number > 0 && !found.includes(number)) {
      found.push(number)
    }
  }
  return found
}

/**
 * Une case à cocher écrite dans la description, telle que la barre d'avancement et le
 * panneau la voient.
 *
 * Il n'y a pas de table : une sous-tâche est une ligne `- [ ]` du markdown, et cocher
 * réécrit cette ligne. On évite ainsi un troisième endroit où un travail se décrit, à
 * côté de la description et des notes — au prix d'un ordre qui suit le texte et d'une
 * écriture sur la description à chaque clic.
 */
export interface CardSubtask {
  /** Rang dans le document, à partir de 0 : c'est l'adresse d'une sous-tâche. */
  index: number
  checked: boolean
  /** Le texte après la case, tel qu'il est écrit — markdown non rendu. */
  label: string
}

/** Une puce de liste portant une case, à la façon de GitHub. */
const SUBTASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/

/** Ouverture ou fermeture d'un bloc de code clôturé. */
const CODE_FENCE = /^\s*(?:```|~~~)/

/**
 * Les sous-tâches d'un texte, dans l'ordre où elles s'y lisent.
 *
 * Les blocs de code sont sautés : un `- [ ]` dans un exemple de markdown n'est pas une
 * tâche, et le rendu ne lui met pas de case non plus. Les deux doivent compter pareil,
 * sans quoi le n-ième clic ne tomberait pas sur la n-ième ligne.
 */
export function parseSubtasks(text: string): CardSubtask[] {
  const found: CardSubtask[] = []
  let inCode = false
  for (const line of text.split('\n')) {
    if (CODE_FENCE.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const match = SUBTASK_LINE.exec(line)
    if (!match) continue
    found.push({ index: found.length, checked: match[2] !== ' ', label: match[4]?.trim() ?? '' })
  }
  return found
}

/**
 * Réécrit une description avec la n-ième sous-tâche cochée ou décochée.
 *
 * Rend `null` quand l'indice n'existe plus : la description a changé depuis
 * l'affichage, et il vaut mieux refuser que cocher une ligne que personne n'a visée.
 * Seul le caractère entre crochets bouge — le reste de la ligne, indentation et
 * markdown compris, est rendu tel quel.
 */
export function toggleSubtask(text: string, index: number, checked: boolean): string | null {
  const lines = text.split('\n')
  let seen = 0
  let inCode = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (CODE_FENCE.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const match = SUBTASK_LINE.exec(line)
    if (!match) continue
    if (seen === index) {
      lines[i] = `${match[1]}${checked ? 'x' : ' '}${match[3]}${match[4]}`
      return lines.join('\n')
    }
    seen += 1
  }
  return null
}

/**
 * Nom de branche proposé pour la première session d'une carte.
 *
 * Le numéro passe devant pour que la branche se relie à sa carte au premier coup d'œil
 * dans `git branch`, où le titre seul ne dit pas d'où il vient.
 */
export function cardBranchName(number: number, title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug.length > 0 ? `feat/${number}-${slug}` : `feat/${number}`
}

/**
 * Une carte telle que la palette l'affiche, tous projets confondus.
 *
 * Distincte de `CardDto` : la palette n'a besoin que de quoi écrire une ligne et y
 * mener. Les sessions, les notes et les backlinks d'une carte pèsent quatre requêtes
 * chacun, et personne ne les lit dans une liste de résultats.
 */
export interface CardSearchEntryDto {
  id: string
  projectId: string
  number: number
  title: string
  column: CardColumn
  updatedAt: number
}

export interface CardSearchDto {
  cards: CardSearchEntryDto[]
}
