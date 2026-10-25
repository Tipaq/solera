import { z } from 'zod'
// `import type` et non `import { type … }` : avec `verbatimModuleSyntax`, la seconde
// forme laisse un import à l'exécution, et `events.ts` importe maintenant d'ici le
// schéma de colonne pour ses événements de rangement de carte. Le cycle qui en
// résulterait mettrait `cardColumnSchema` en zone morte au chargement.
import type { ConversationStatus } from './api.js'
import type { AgentKind } from './events.js'

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
  /** La parente, pour découper une carte : lui ajouter un enfant. */
  parentId: z.string().uuid().optional(),
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
    /** Carte parente à laquelle celle-ci se rattache, ou `null` pour l'en détacher. */
    parentId: z.string().uuid().nullable(),
    /**
     * Pose ou lève l'état « à préciser ». Le poser ramène la carte dans « à faire » :
     * c'est un état de cette colonne, pas une colonne de plus.
     */
    toClarify: z.boolean(),
  })
  .partial()

/**
 * Accepte une carte venue de l'extérieur. Avec `parentId`, c'est le geste
 * « Rattacher à une carte » : elle est acceptée et rangée sous cette parente d'un coup.
 */
export const acceptCardBodySchema = z.object({
  parentId: z.string().uuid().optional(),
})

/**
 * La colonne d'une carte parente, déduite de celles de ses enfants.
 *
 * « En cours » dès qu'un enfant a commencé, terminé compris : le travail est entamé.
 * « À faire » tant qu'aucun n'a bougé. Jamais « terminé » : quand tous les enfants
 * sont fermés, le passage est proposé (`parentCloseProposed`), et c'est une personne
 * qui ferme. Jamais « en relecture » non plus : une parente ne se relit pas, ce sont
 * ses enfants qui ont des PR.
 *
 * Ne s'applique qu'à une parente encore ouverte ; une fois fermée, elle ne se rouvre
 * pas seule parce qu'un enfant a bougé.
 */
export function deriveParentColumn(children: readonly CardColumn[]): CardColumn {
  return children.some((column) => column !== 'todo' && column !== 'abandoned') ? 'in_progress' : 'todo'
}

/** Tous les enfants sont fermés, au moins un livré, et la parente pas encore close. */
export function parentCloseProposed(card: { column: CardColumn; children: readonly { column: CardColumn }[] }): boolean {
  return (
    !CARD_CLOSED_COLUMNS.includes(card.column) &&
    card.children.length > 0 &&
    card.children.every((child) => CARD_CLOSED_COLUMNS.includes(child.column)) &&
    card.children.some((child) => child.column === 'done')
  )
}

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
 * Les liens informatifs entre cartes (#109) : ils ne changent ni l'ordre du travail ni
 * la colonne. `related` se lit des deux bouts ; `duplicate_of` va de la copie vers
 * l'originale.
 */
export const CARD_RELATION_KINDS = ['related', 'duplicate_of'] as const
export const cardRelationKindSchema = z.enum(CARD_RELATION_KINDS)
export type CardRelationKind = z.infer<typeof cardRelationKindSchema>

/**
 * Pose un lien informatif depuis la carte de l'URL. Pour `duplicate_of`, remplace
 * l'originale déjà posée : une copie n'en a qu'une, et le sélecteur de la fiche la
 * change d'un geste, comme la parente.
 */
export const cardRelationBodySchema = z.object({
  kind: cardRelationKindSchema,
  targetId: z.string().uuid(),
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
   * La carte parente. Un jalon n'est pas un type : c'est une carte de haut niveau, qui
   * a une échéance et des enfants.
   */
  parent: CardLinkDto | null
  /**
   * Les enfants directs, par numéro. Une carte qui en a sert de regroupement : le
   * kanban ne la montre pas, et sa colonne se déduit d'eux (`deriveParentColumn`).
   */
  children: CardLinkDto[]
  /** `null` : venue de l'extérieur et pas encore acceptée. Elle ne lance pas de session. */
  acceptedAt: number | null
  /** « À préciser » depuis cette date, ou `null`. Ne se pose qu'en « à faire ». */
  toClarifySince: number | null
  createdBy: string
  createdByName: string
  createdAt: number
  updatedAt: number
  /**
   * Depuis quand la carte est dans sa colonne, d'après `card_moves` ; sa création
   * quand elle n'a jamais bougé. C'est ce qui dit « terminée cette semaine » —
   * `updatedAt`, qu'une retouche de titre réécrit, ne le dit pas.
   *
   * Une carte fermée avant `card_moves` (migration 0037, 2026-10-15) n'a pas de
   * mouvement et date donc de sa création. C'est une borne basse, qui ne se trompe que
   * par omission : on ne ferme pas une carte avant qu'elle existe, donc aucune ne passe
   * pour récente à tort. On n'invente pas pour autant de mouvements à rebours — la
   * table ne garde que des faits datés.
   */
  columnSince: number
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
  /** Cartes liées à celle-ci, dans un sens ou dans l'autre : un lien informatif. */
  related: CardLinkDto[]
  /** L'originale dont celle-ci est un doublon. */
  duplicateOf: CardLinkDto | null
  /** Les cartes qui se déclarent doublons de celle-ci. */
  duplicates: CardLinkDto[]
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
  for (const number of cardMentions(text)) {
    if (!found.includes(number)) found.push(number)
  }
  return found
}

/**
 * Chaque citation `#12` d'un texte, dans l'ordre et **sans** dédoublonner.
 *
 * Pour qui compte combien de fois une carte revient — la vue *Projet* en tire la carte
 * qu'une session semble traiter. Le même analyseur que `parseCardReferences`, pour la
 * même raison : deux analyseurs finiraient par diverger.
 */
export function cardMentions(text: string): number[] {
  return cardReferenceRanges(text).map((range) => range.number)
}

/**
 * Chaque `#n` d'un texte, avec sa place : début du `#` et fin du numéro. Sert au rendu,
 * qui remplace la référence par un lien sans toucher au caractère qui la précède. Les
 * deux fonctions au-dessus en dérivent : un seul analyseur.
 */
export function cardReferenceRanges(text: string): { start: number; end: number; number: number }[] {
  const ranges: { start: number; end: number; number: number }[] = []
  for (const match of text.matchAll(CARD_REFERENCE)) {
    const number = Number(match[1])
    if (!Number.isSafeInteger(number) || number <= 0) continue
    const end = match.index + match[0].length
    ranges.push({ start: end - (match[1] ?? '').length - 1, end, number })
  }
  return ranges
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
 * La section où un agent complète la description de sa carte (#66).
 *
 * Un agent ajoute et ne réécrit pas : ce qui précède est la consigne d'une personne, et
 * un compte rendu de session l'effacerait. Une section à part, en fin de texte, garde
 * les deux lisibles d'un coup d'œil ; chaque ajout y est daté et signé, et doublé d'une
 * note sur la carte, qui en est l'historique.
 */
export const CARD_PRECISIONS_HEADING = '## Précisions'

/** La section où vont les sous-tâches ajoutées à une description qui n'en avait pas. */
export const CARD_SUBTASKS_HEADING = '## Sous-tâches'

/** Un titre de premier ou de second niveau, qui ferme la section en cours. */
const SECTION_BREAK = /^#{1,2}\s/

/**
 * Ajoute un bloc en fin de section, en la créant à la fin du texte si elle n'existe pas.
 *
 * La section court jusqu'au titre suivant de même niveau ou plus haut : si une personne
 * a écrit sous elle, l'ajout reste dans la section et ne se mêle pas à son texte.
 */
export function appendToSection(text: string, heading: string, block: string): string {
  const lines = text.split('\n')
  let start = -1
  let end = lines.length
  let inCode = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (CODE_FENCE.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    if (start === -1) {
      if (line.trim() === heading) start = i
    } else if (SECTION_BREAK.test(line)) {
      end = i
      break
    }
  }

  if (start === -1) {
    const head = text.trimEnd()
    return `${head}${head ? '\n\n' : ''}${heading}\n\n${block}`
  }
  const before = lines.slice(0, start).join('\n')
  const section = lines.slice(start, end).join('\n').trimEnd()
  const after = lines.slice(end).join('\n')
  return `${start > 0 ? `${before}\n` : ''}${section}\n\n${block}${after ? `\n\n${after}` : ''}`
}

/**
 * Ajoute une précision datée et signée à la section `CARD_PRECISIONS_HEADING`.
 *
 * `day` est écrit tel quel (`2026-10-24`) : la description se lit hors de l'interface,
 * dans un dépôt ou par un agent, et une date relative y vieillirait mal.
 */
export function appendCardPrecision(text: string, entry: { day: string; author: string; body: string }): string {
  return appendToSection(text, CARD_PRECISIONS_HEADING, `**${entry.day} · ${entry.author}**\n\n${entry.body.trim()}`)
}

/**
 * Ajoute des sous-tâches non cochées : sous la dernière qui existe, avec sa puce et son
 * retrait, ou dans une section `CARD_SUBTASKS_HEADING` s'il n'y en a aucune.
 *
 * Un libellé tient sur une ligne : un saut de ligne y ferait une seconde ligne qui ne
 * serait plus une case.
 */
export function appendSubtasks(text: string, labels: readonly string[]): string {
  const clean = labels.map((label) => label.replace(/\s+/g, ' ').trim()).filter((label) => label !== '')
  if (clean.length === 0) return text

  const lines = text.split('\n')
  let last = -1
  let prefix = '- ['
  let inCode = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (CODE_FENCE.test(line)) {
      inCode = !inCode
      continue
    }
    if (inCode) continue
    const match = SUBTASK_LINE.exec(line)
    if (match) {
      last = i
      prefix = match[1] ?? prefix
    }
  }

  if (last === -1) return appendToSection(text, CARD_SUBTASKS_HEADING, clean.map((label) => `- [ ] ${label}`).join('\n'))
  lines.splice(last + 1, 0, ...clean.map((label) => `${prefix} ] ${label}`))
  return lines.join('\n')
}

/**
 * Nom de branche proposé pour la première session d'une carte.
 *
 * Le numéro passe devant pour que la branche se relie à sa carte au premier coup d'œil
 * dans `git branch`, où le titre seul ne dit pas d'où il vient.
 */
export function cardBranchName(number: number, title: string): string {
  return branchName('feat', number, title)
}

/**
 * Nom de la branche d'une carte parente (#68) : celle où ses enfants se fusionnent, et
 * qui part vers la branche par défaut quand elles sont toutes terminées. Un préfixe à
 * part, pour qu'elle ne se confonde pas dans `git branch` avec la branche d'une session.
 */
export function parentBranchName(number: number, title: string): string {
  return branchName('jalon', number, title)
}

function branchName(prefix: string, number: number, title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return slug.length > 0 ? `${prefix}/${number}-${slug}` : `${prefix}/${number}`
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
