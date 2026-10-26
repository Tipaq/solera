import { z } from 'zod'

/**
 * L'index du vault, niveau 1 : les **faits du texte**.
 *
 * Exacts, déterministes, sans modèle — liens sortants, liens entrants par inversion,
 * liens cassés, notes sans lien entrant, carrefours, ébauches, métadonnées. Tout se
 * reconstruit en une passe sur les fichiers, et rien ici n'a de raison d'attendre.
 *
 * À ne pas confondre avec le niveau 2 (les rapprochements), qui se calcule, peut se
 * tromper, et porte donc toujours un geste de rejet. Un lien entrant n'en a jamais :
 * c'est pour ça que les deux niveaux ne partagent pas de DTO.
 *
 * L'index est **dérivé** : les fichiers sont la vérité, il se jette et se refait.
 * « Tout réindexer » n'est pas une opération dangereuse.
 */

/** Extensions tenues pour des notes. Le reste du vault (images, PDF) n'est pas indexé. */
export const VAULT_NOTE_EXTENSIONS = ['.md', '.markdown'] as const

/**
 * Degré entrant à partir duquel une note est un **carrefour**.
 *
 * Un seuil, pas un calcul — c'est ce que dit `indexation.md`, et c'est pourquoi la
 * valeur est ici et non dans une requête : elle se discute, elle ne se dérive pas.
 */
export const VAULT_CROSSROADS_MIN_INCOMING = 5

/** Ce que l'index reflète, et ce qu'il compte. */
export interface VaultStateDto {
  /** Faux tant qu'aucun chemin de vault n'est réglé : l'interface n'a alors rien à montrer. */
  configured: boolean
  path: string
  /** Faux quand le chemin est réglé mais absent du disque, ou illisible. */
  exists: boolean
  /**
   * Le commit que l'index reflète, `null` hors dépôt git.
   *
   * C'est lui qui rend le rattrapage borné et exact : au démarrage, un `git diff`
   * entre ce SHA et `HEAD` dit exactement ce qui a bougé hors de Solera.
   */
  indexedCommit: string | null
  /** `HEAD` maintenant. Différent du précédent, l'index est en retard. */
  headCommit: string | null
  indexedAt: number | null
  counts: VaultCountsDto
}

/** Les quatre entrées de l'état du vault, toutes du niveau 1. */
export interface VaultCountsDto {
  notes: number
  /** Notes sans dossier. Aucun agent ne les voit, faute de droit à hériter. */
  drafts: number
  /** Liens dont la cible n'existe pas. */
  brokenLinks: number
  /** Degré entrant nul. */
  orphans: number
  crossroads: number
}

export interface VaultNoteDto {
  /** Chemin relatif à la racine du vault, séparateur `/`. C'est l'identité d'une note. */
  path: string
  /** Dossier parent, `''` pour une ébauche. */
  folder: string
  title: string
  words: number
  bytes: number
  tags: string[]
  modifiedAt: number
  incoming: number
  outgoing: number
  broken: number
}

/** Un lien, vu depuis l'une ou l'autre de ses deux extrémités. */
export interface VaultLinkDto {
  /** La note à l'autre bout, `null` quand le lien est cassé. */
  path: string | null
  /** Le titre de cette note, ou la cible telle qu'écrite quand le lien est cassé. */
  title: string
  /** La cible telle qu'elle est écrite entre les crochets, sans alias ni ancre. */
  target: string
  anchor: string | null
  line: number
}

/** Tout ce que le niveau 1 sait d'une note. */
export interface VaultNoteFactsDto {
  note: VaultNoteDto
  /** Qui cite cette note — l'inversion des liens sortants, et c'est tout ce qu'est un backlink. */
  incoming: (VaultLinkDto & { path: string })[]
  outgoing: VaultLinkDto[]
}

export interface VaultFolderDto {
  /** Chemin relatif, séparateur `/`. */
  path: string
  notes: number
}

/** Les cinq listes que la page du vault et le panneau tirent de l'index. */
export const vaultNoteFilterSchema = z.enum([
  'all',
  /** Sans dossier. */
  'drafts',
  /** Sans lien entrant. */
  'orphans',
  /** Degré entrant élevé. */
  'crossroads',
  /** Les notes qui portent au moins un lien cassé. */
  'broken',
])
export type VaultNoteFilter = z.infer<typeof vaultNoteFilterSchema>

export const vaultNotesQuerySchema = z.object({
  filter: vaultNoteFilterSchema.default('all'),
  /** Restreint à un dossier et ses enfants. Vide signifie « tout le vault ». */
  folder: z.string().default(''),
  /** Les plus récemment modifiées d'abord, comme la page les montre. */
  limit: z.coerce.number().int().min(1).max(500).default(100),
})

export interface VaultReindexDto {
  state: VaultStateDto
  /** Notes réécrites par cette passe. */
  indexed: number
  removed: number
}

/**
 * L'arbre du vault, à plat : les dossiers d'un côté, les notes de l'autre.
 *
 * À plat et non imbriqué : la vue *Notes* du panneau replie les dossiers un par un, et
 * un arbre imbriqué obligerait à le parcourir en entier pour retrouver une note dont on
 * connaît le chemin. L'imbrication se refait côté interface, où elle sert à l'affichage.
 */
export interface VaultTreeDto {
  folders: VaultFolderDto[]
  /**
   * Le degré entrant accompagne chaque note, et ce n'est pas un ornement : c'est par
   * lui que le sélecteur de `[[` classe ses propositions — les carrefours d'abord,
   * parce que c'est là qu'on veut accrocher.
   */
  notes: { path: string; folder: string; title: string; incoming: number }[]
}

/** Le texte d'une note, pour l'éditeur. */
export interface VaultNoteContentDto {
  path: string
  title: string
  content: string
  /**
   * Empreinte du fichier au moment de la lecture, rendue à l'enregistrement.
   *
   * Le vault s'édite ailleurs — un autre éditeur, le téléphone, et demain un agent :
   * sans cette comparaison, enregistrer écrase en silence ce qui a été écrit entre
   * temps, et la perte ne se remarque pas.
   */
  fingerprint: string
}

export const vaultNotePathQuerySchema = z.object({
  /** Chemin relatif à la racine du vault, séparateur `/`. */
  path: z.string().min(1).max(1024),
})

export const vaultWriteNoteBodySchema = z.object({
  path: z.string().min(1).max(1024),
  content: z.string().max(2 * 1024 * 1024),
  /**
   * Empreinte reçue à la lecture. `null` force l'écriture : le choix explicite
   * d'écraser, pris après qu'un conflit a été montré.
   */
  fingerprint: z.string().nullable(),
})

export interface VaultWriteNoteDto {
  fingerprint: string
  /** La note telle que l'index la relit juste après l'écriture. */
  note: VaultNoteDto
}

/**
 * Créer une note : un dossier et un titre, et c'est tout.
 *
 * Les deux chemins de création passent par là, parce que ce sont les deux moments d'un
 * même geste : le `+` d'un dossier donne un dossier, l'**ébauche** n'en donne pas. Une
 * ébauche n'a donc pas de droit à hériter, et aucun agent ne la voit — c'est à soi.
 */
/**
 * *Garder en note* : un fil libre devient une ébauche du vault (carte #118).
 *
 * Les intitulés des deux voix viennent de l'interface, dans sa langue : c'est le seul
 * texte que Solera ajoute à ce que le fil a dit.
 */
export const vaultNoteFromConversationBodySchema = z.object({
  conversationId: z.string().min(1),
  roles: z.object({
    user: z.string().trim().min(1).max(80),
    assistant: z.string().trim().min(1).max(80),
  }),
})

export const vaultCreateNoteBodySchema = z.object({
  /** Vide pour une ébauche. */
  folder: z.string().max(512).default(''),
  title: z.string().trim().min(1).max(200),
})

/** Un commit qui a touché une note. */
export interface VaultNoteRevisionDto {
  hash: string
  subject: string
  author: string
  at: number
}

export interface VaultNoteHistoryDto {
  /**
   * `false` quand le vault n'est pas un dépôt git : il n'y a alors pas d'historique par
   * note, et le dire vaut mieux qu'une liste vide qu'on prendrait pour une note neuve.
   */
  versioned: boolean
  /** Vrai quand le fichier porte des modifications que l'historique ne connaît pas encore. */
  uncommitted: boolean
  revisions: VaultNoteRevisionDto[]
}
