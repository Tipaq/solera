import { z } from 'zod'

/**
 * Ce que Solera signale hors de la conversation regardée : une notification système
 * sur les appareils abonnés, un toast dans l'application ouverte. Jamais les deux sur
 * le même appareil : celui où l'application est visible reçoit le toast.
 */

/**
 * Les sortes de notifications, que chaque compte peut couper séparément.
 *
 * Une sorte nouvelle s'ajoute ici, à `notificationPrefsSchema` et à son défaut :
 * l'aiguillage du serveur et l'écran des réglages la prennent alors sans autre
 * changement. `decision` est une décision qu'une session demande (`request_decision`).
 */
export const notificationKindSchema = z.enum(['decision', 'cliRequest', 'turnCompleted'])
export type NotificationKind = z.infer<typeof notificationKindSchema>

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  decision: true,
  cliRequest: true,
  turnCompleted: true,
}

/**
 * Une clé par sorte, chacune tolérante : un réglage écrit avant l'arrivée d'une sorte
 * n'a pas sa clé, et doit la recevoir allumée plutôt que de perdre les autres.
 */
export const notificationPrefsSchema = z.object({
  decision: z.boolean().default(true).catch(true),
  cliRequest: z.boolean().default(true).catch(true),
  turnCompleted: z.boolean().default(true).catch(true),
})
export type NotificationPrefs = z.infer<typeof notificationPrefsSchema>

/** Ce qu'un CLI attend, pour le libellé d'un toast et le titre d'une notification. */
export type CliRequestKind = 'permission' | 'question' | 'elicitation' | 'plan'

/**
 * Un toast. Le texte se compose côté client, dans sa langue : le serveur n'envoie que
 * des faits. Discriminé par `kind` comme les sortes de notifications.
 */
export type InAppNotification =
  | {
      kind: 'decision'
      /** L'id de la ligne `agent_requests` : ce que le dialogue de réponse ouvre. */
      decisionId: string
      question: string
      /** La conversation qui demande, et son titre : d'où vient la question. */
      conversationId: string
      conversationTitle: string
      projectName: string
      /**
       * Pour une proposition de nettoyage, la branche visée : le client recompose la
       * question dans sa langue. Facultatif pour un serveur plus ancien que le client.
       */
      worktreeBranch?: string | null
    }
  | {
      kind: 'cliRequest'
      request: CliRequestKind
      conversationId: string
      /** `null` pour un fil libre, qui vit à la racine et non sous un projet. */
      projectId: string | null
      conversationTitle: string
      /** Ce qui est demandé, en une ligne : l'outil et sa commande, la question posée. */
      detail: string | null
    }

/** Service de push d'un abonnement, lu dans son adresse : il dit quel appareil c'est. */
export type PushServiceKind = 'apple' | 'google' | 'mozilla' | 'microsoft' | 'other'

export interface PushDeviceDto {
  endpoint: string
  service: PushServiceKind
  userAgent: string | null
  createdAt: number
}

/** Un délai pour avoir le temps de fermer l'application avant que la notification parte. */
export const MAX_PUSH_TEST_DELAY_SECONDS = 60
export const pushTestBodySchema = z.object({
  delaySeconds: z.number().int().min(0).max(MAX_PUSH_TEST_DELAY_SECONDS),
})

export interface PushDeliveryDto {
  endpoint: string
  service: PushServiceKind
  /** `sent` : accepté par le service de push ; ce qui suit ne dépend plus de Solera. */
  outcome: 'sent' | 'failed' | 'removed'
  /** Code HTTP et motif du refus, tels que le service les a donnés. */
  status: number | null
  reason: string | null
}

export interface PushTestDto {
  id: string
  sendAt: number
  /** Null tant que l'envoi n'a pas eu lieu. */
  deliveries: PushDeliveryDto[] | null
}
