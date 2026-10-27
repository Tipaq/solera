import { z } from 'zod'
import { agentKindSchema, type AgentKind } from './events.js'

/**
 * Consommation du compte, telle que le CLI la déclare.
 *
 * Volontairement une **liste** de fenêtres et non un jeu de champs nommés : les CLI en
 * ajoutent régulièrement côté serveur, sans mise à jour du client. La sortie de Fable a
 * fait apparaître une fenêtre dédiée du jour au lendemain, et la sonde du CLI installé
 * montre aujourd'hui une douzaine de clés dont la plupart sont encore nulles et portent
 * des noms de code. Figer une liste ici reviendrait à devoir rebuilder à chaque
 * nouveauté, et à masquer en silence tout ce qui n'aurait pas été prévu.
 */

export const usageWindowSchema = z.object({
  /** Clé d'origine côté CLI, stable, utilisée comme identité de rendu. */
  id: z.string(),
  label: z.string(),
  /** Part consommée, de 0 à 1. Null quand le CLI ne la fournit pas. */
  utilization: z.number().nullable(),
  /** Fin de la fenêtre, en millisecondes. Null si inconnue. */
  resetsAt: z.number().nullable(),
})
export type UsageWindow = z.infer<typeof usageWindowSchema>

/**
 * Crédits facturés au-delà du forfait. Les deux CLI n'en donnent pas la même chose :
 * Claude un pourcentage et des montants, Codex un solde. `detail` est donc un texte
 * déjà mis en forme, plutôt qu'un modèle monétaire commun qui n'existe pas.
 */
export const usageCreditsSchema = z.object({
  label: z.string(),
  utilization: z.number().nullable(),
  detail: z.string().nullable(),
  enabled: z.boolean(),
})

export const agentUsageSchema = z.object({
  agent: agentKindSchema,
  /** Formule déclarée par le CLI (`max`, `plus`...). Null en facturation à l'usage. */
  plan: z.string().nullable(),
  /**
   * Faux quand les limites de forfait ne s'appliquent pas : clé API, Bedrock, Vertex.
   * Les fenêtres sont alors vides, et ce n'est pas une panne.
   */
  limitsAvailable: z.boolean(),
  windows: z.array(usageWindowSchema),
  credits: usageCreditsSchema.nullable(),
  fetchedAt: z.number(),
})
export type AgentUsage = z.infer<typeof agentUsageSchema>

/**
 * Connexion d'un CLI, lue sans ouvrir de session : `claude auth status`, `codex login
 * status`, ou la présence d'un fichier d'identifiants. `unknown` quand le CLI ne dit
 * rien de bon marché, ou que la lecture a échoué — jamais une erreur pour toute la liste.
 */
export interface AgentAuthDto {
  agent: AgentKind
  /** Null : la connexion propre du CLI, partagée par tous les utilisateurs. */
  account: string | null
  status: 'ready' | 'logged_out' | 'unknown'
  /** Moyen de connexion tel que le CLI le nomme (`claude.ai`, `chatgpt`, `api_key`...). */
  method: string | null
  /** Formule déclarée (`max`...), quand le CLI la donne. */
  plan: string | null
  /** Courriel ou libellé du compte, quand le CLI le donne. */
  identity: string | null
}

/** Dernier signal de limite vu pendant un vrai tour, par type de fenêtre. */
export interface UsageLiveWindowDto {
  type: string
  status: 'allowed' | 'allowed_warning' | 'rejected'
  /** Souvent null chez Claude, dont le `rate_limit_event` ne donne que le statut. */
  utilization: number | null
  resetsAt: number | null
  /** Moment où le signal a été reçu, en millisecondes. */
  at: number
}

/**
 * Aperçu gratuit de la consommation : rien n'est sondé pour le construire. `probed` est
 * la dernière lecture complète gardée en mémoire depuis le démarrage, quel que soit son
 * âge (`fetchedAt` le dit), `live` ce que les tours ont rapporté en passant.
 */
export interface UsagePeekDto {
  agent: AgentKind
  account: string | null
  probed: AgentUsage | null
  live: UsageLiveWindowDto[]
}
