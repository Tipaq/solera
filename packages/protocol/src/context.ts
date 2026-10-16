import { z } from 'zod'

/**
 * Détail de l'occupation de la fenêtre de contexte.
 *
 * Les trois CLI ne mesurent pas la même chose, et on assume la différence plutôt que
 * de les rabattre sur le plus petit dénominateur commun : Claude découpe la fenêtre
 * **par catégorie de contenu** (c'est la table de `/context`), Codex n'en dit rien et
 * ne sait parler que de la **nature des jetons** (part mise en cache, coût du
 * raisonnement), opencode ne donne qu'un total. D'où une union et non un objet unique :
 * un axe absent reste absent, et `null` veut dire « ce CLI ne le dit pas », jamais
 * « zéro ».
 *
 * Journalisé avec le relevé d'usage dont il est le détail (invariant I2 : le journal
 * est la source d'affichage). Une sonde à l'ouverture de la modale aurait été plus
 * fraîche, mais elle exige un process CLI vivant : une conversation refroidie
 * n'afficherait plus rien alors que le dernier état connu est précisément ce qu'on
 * veut lire avant de la relancer.
 */

/**
 * Plafond des listes nominatives. Le relevé part dans le journal à chaque tour, et une
 * session chargée en outils MCP y pèserait quelques kilo-octets par tour sans ce
 * garde-fou. Les listes sont triées par poids décroissant avant d'être coupées : ce
 * qu'on perd est ce qui n'aurait rien expliqué.
 */
export const CONTEXT_DETAIL_MAX_ROWS = 40

/**
 * Nature d'une ligne de catégorie, telle que le CLI la classe.
 *
 * On classe sur ce champ et jamais sur le libellé, qui est rendu en anglais par le CLI
 * et peut changer sans préavis. `deferred` désigne les schémas d'outils laissés hors
 * fenêtre : ils sont listés pour information et exclus du calcul d'occupation.
 */
export const contextRowKindSchema = z.enum(['used', 'free', 'buffer', 'deferred'])
export type ContextRowKind = z.infer<typeof contextRowKindSchema>

export const contextCategorySchema = z.object({
  /** Libellé rendu par le CLI, affiché tel quel faute de traduction fiable. */
  label: z.string(),
  tokens: z.number(),
  kind: contextRowKindSchema,
})

/** Une ligne nominative : un fichier de mémoire, un outil MCP, un sous-agent, un skill. */
export const contextEntrySchema = z.object({
  /** Nom ou chemin, selon la liste. */
  name: z.string(),
  /**
   * Provenance telle que le CLI la nomme — « Project », « User », `plugin`,
   * `syncedSkills`, le nom du serveur MCP. Brute : c'est un identifiant du CLI, pas
   * une clé de traduction.
   */
  source: z.string().nullable().default(null),
  tokens: z.number(),
})
export type ContextEntry = z.infer<typeof contextEntrySchema>

/** Les six compteurs de `TokenUsageBreakdown`, tels que Codex les livre. */
export const contextTokenNatureSchema = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  cacheWriteInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
})
export type ContextTokenNature = z.infer<typeof contextTokenNatureSchema>

export const contextBreakdownSchema = z.discriminatedUnion('axis', [
  /**
   * Claude : la fenêtre découpée par catégorie de contenu, plus le nominatif de ce qui
   * se corrige en changeant la configuration — un serveur MCP qu'on coupe, un fichier
   * de mémoire qu'on allège.
   */
  z.object({
    axis: z.literal('categories'),
    categories: z.array(contextCategorySchema).default([]),
    memoryFiles: z.array(contextEntrySchema).default([]),
    mcpTools: z.array(contextEntrySchema).default([]),
    agents: z.array(contextEntrySchema).default([]),
    skills: z.array(contextEntrySchema).default([]),
  }),
  /**
   * Codex : la nature des jetons. `last` décrit la dernière requête, donc l'occupation
   * courante ; `total` est le cumul du fil, qui n'est pas une occupation et dépasserait
   * la fenêtre (voir `docs/SPEC.md`, §compaction).
   */
  z.object({
    axis: z.literal('tokens'),
    last: contextTokenNatureSchema,
    total: contextTokenNatureSchema,
  }),
])
export type ContextBreakdown = z.infer<typeof contextBreakdownSchema>
