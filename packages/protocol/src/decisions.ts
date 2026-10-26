import { z } from 'zod'

/**
 * Les décisions : ce qu'une session demande à une personne de trancher, sans se bloquer
 * en attendant (`request_decision`).
 *
 * Ce n'est pas une table à part : une décision est une ligne `agent_requests` de genre
 * `request_decision`, sur le modèle des deux rangements. L'agent a sa réponse « déposée »
 * tout de suite ; une personne tranche plus tard, et la réponse revient à la session par
 * `session_messages`, ce qui la relance et survit aux redémarrages.
 *
 * Distinctes des demandes natives des CLI (permissions, questions, plans), qui suspendent
 * un tour et meurent avec le process.
 */

export const MAX_DECISION_QUESTION_CHARS = 300
export const MAX_DECISION_CONTEXT_CHARS = 8000
export const MAX_DECISION_OPTIONS = 6
export const MAX_DECISION_OPTION_CHARS = 120
export const MAX_DECISION_ANSWER_CHARS = 4000

/** Le délai le plus court qu'un agent peut demander : un quart d'heure. */
export const MIN_DECISION_HOURS = 0.25

/** La charge d'une décision, telle que le daemon la réécrit une fois validée. */
export interface DecisionPayload {
  question: string
  /** Ce qu'il faut savoir pour trancher, en markdown. Vide si l'agent n'a rien ajouté. */
  context: string
  options: string[]
  /** Le choix appliqué à l'échéance ; null : l'agent apprendra que personne n'a répondu. */
  defaultOption: string | null
}

/**
 * Les choix d'une proposition de nettoyage d'arbre. Des clés et non des phrases : c'est
 * Solera qui pose la question, sans connaître la langue du lecteur, et l'interface les
 * traduit.
 */
export const WORKTREE_DECISION_OPTIONS = ['clean', 'keep'] as const

/**
 * Une décision que Solera pose lui-même : nettoyer un arbre fusionné et propre. La
 * réponse ne part à aucune session, elle nettoie (`agent_requests.worktree_path`).
 */
export interface DecisionWorktreeDto {
  path: string
  branch: string
  /** La branche contre laquelle l'arbre a été jugé fusionné. */
  base: string
  /** Sessions non archivées que le nettoyage rangerait. */
  sessions: number
}

/**
 * Ce qu'il est advenu d'une décision (`agent_requests.answer`).
 *
 * `user` : une personne a tranché. `default` : l'échéance a appliqué le choix prévu.
 * `expired` : l'échéance est passée sans réponse ni défaut. `withdrawn` : la conversation
 * a été archivée ou supprimée avant.
 */
export const decisionAnswerSchema = z.object({
  option: z.string().optional(),
  text: z.string().optional(),
  by: z.enum(['user', 'default', 'expired', 'withdrawn']),
  userId: z.string().optional(),
})
export type DecisionAnswer = z.infer<typeof decisionAnswerSchema>

/** L'état d'une décision, déduit de `answer` : `pending` tant qu'elle est nulle. */
export type DecisionStatus = 'pending' | DecisionAnswer['by']

export interface DecisionDto {
  id: string
  projectId: string
  projectName: string
  conversationId: string
  conversationTitle: string
  /** La carte de la session qui demande, si elle en traite une. */
  card: { number: number; title: string } | null
  /** Non nul pour une proposition de nettoyage : la question vient alors de Solera. */
  worktree: DecisionWorktreeDto | null
  question: string
  context: string
  options: string[]
  defaultOption: string | null
  expiresAt: number
  status: DecisionStatus
  answer: {
    option: string | null
    text: string | null
    /** Le nom de qui a répondu ; null pour une échéance ou un retrait. */
    byName: string | null
    /** L'heure de la clôture. */
    at: number
  } | null
  createdAt: number
}

export const answerDecisionBodySchema = z
  .object({
    option: z.string().max(MAX_DECISION_OPTION_CHARS).nullable().default(null),
    text: z.string().trim().max(MAX_DECISION_ANSWER_CHARS).default(''),
  })
  .refine((body) => body.option !== null || body.text !== '', {
    message: 'Choose an option or write an answer.',
  })
export type AnswerDecisionBody = z.infer<typeof answerDecisionBodySchema>

/**
 * Une demande d'agent qui attend une personne, pour la section « À décider » de la
 * colonne : les décisions, et les deux rangements qu'un clic accorde.
 *
 * Seules les décisions se tranchent depuis la colonne ; les deux autres mènent à la
 * conversation où se trouve leur bouton d'accord.
 */
export type AwaitingRequestDto =
  | {
      kind: 'decision'
      id: string
      conversationId: string
      projectId: string
      question: string
      /** Pour une proposition de nettoyage : la branche, de quoi recomposer la question. */
      worktreeBranch: string | null
      expiresAt: number
      createdAt: number
    }
  | {
      /** Un changement de cartes à accorder, ou un brouillon de cartes à valider (#70). */
      kind: 'request_card_change' | 'propose_cards'
      id: string
      /** La conversation qui demande : c'est dans son fil qu'est le bouton. */
      conversationId: string
      projectId: string
      conversationTitle: string
      count: number
      createdAt: number
    }
  | {
      kind: 'move_conversation'
      id: string
      /** La conversation à ranger : c'est dans son fil qu'est le bouton. */
      conversationId: string
      projectId: string | null
      conversationTitle: string
      createdAt: number
    }

/**
 * Ce qu'un fil a de demandes en attente d'un clic, par genre (#119) : ce que la fenêtre
 * d'avant l'archivage récapitule, puisqu'archiver les retire.
 */
export interface PendingRequestCounts {
  decision: number
  cardChange: number
  cardDraft: number
  move: number
}

/** `GET /api/conversations/pending-requests?ids=…` : les seuls fils qui en ont. */
export interface PendingRequestsDto {
  conversations: ({ id: string } & PendingRequestCounts)[]
}
