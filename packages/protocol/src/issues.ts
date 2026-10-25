import { z } from 'zod'

/**
 * Les issues d'un outil externe absorbées dans le board (#84).
 *
 * Solera fait foi : les issues entrent en cartes non acceptées, et seul l'état des
 * cartes repart vers l'outil (fermée, rouverte). Aucune carte ne sort en issue, et le
 * contenu n'est pas synchronisé. La richesse (commenter, étiqueter) passe par les agents
 * et le serveur MCP de l'outil.
 */

/** Un seul outil pour l'instant ; la colonne existe pour ne pas fermer la porte. */
export const ISSUE_PROVIDERS = ['github'] as const
export const issueProviderSchema = z.enum(ISSUE_PROVIDERS)
export type IssueProvider = z.infer<typeof issueProviderSchema>

export type IssueState = 'open' | 'closed'

/**
 * Ce qu'il reste à écrire dans l'outil pour une carte absorbée : la fermer comme
 * terminée, comme non prévue, comme refusée (avec un mot), ou la rouvrir.
 */
export type IssuePush = 'completed' | 'not_planned' | 'refused' | 'reopen'

/** Un dépôt GitHub, en `propriétaire/nom`, tel que l'API l'adresse. */
export const GITHUB_REPOSITORY = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/

export const issueSourceBodySchema = z.object({
  provider: issueProviderSchema.default('github'),
  repository: z.string().trim().regex(GITHUB_REPOSITORY),
})
export type IssueSourceBody = z.infer<typeof issueSourceBodySchema>

/** La source d'un projet, telle que sa page la montre. */
export interface IssueSourceDto {
  provider: IssueProvider
  repository: string
  /** Dernière lecture réussie ou non ; `null` avant la première. */
  polledAt: number | null
  /** La dernière erreur de lecture, `null` quand la dernière a réussi. */
  error: string | null
  /** Le nombre de cartes venues de cette source. */
  cardCount: number
}

/** Le lien d'une carte vers l'issue dont elle vient. */
export interface CardIssueDto {
  provider: IssueProvider
  /** Le numéro de l'issue, tel qu'il s'écrit après le `#` dans l'outil. */
  number: string
  url: string
  state: IssueState
  /** Une écriture de l'état encore en attente, ou refusée par l'outil. */
  pending: IssuePush | null
  pushError: string | null
}

/** Un commentaire de l'issue, lu en direct à l'ouverture de la carte et jamais stocké. */
export interface IssueCommentDto {
  id: string
  author: string
  body: string
  url: string
  createdAt: number
}

export interface CardIssueCommentsDto {
  comments: IssueCommentDto[]
  /** L'outil n'a pas répondu : la carte s'affiche sans ses commentaires. */
  error: string | null
}

/**
 * Récrit les `#12` d'un texte venu d'un dépôt en `propriétaire/nom#12`.
 *
 * Dans une issue, `#12` désigne l'issue 12 du dépôt ; dans une carte, la carte 12 du
 * projet. Laissé tel quel, le corps importé tisserait des backlinks vers des cartes sans
 * rapport. La forme longue reste un lien pour GitHub et n'en est plus un pour le board,
 * dont l'analyseur ne lit un `#` qu'en début de mot.
 */
export function qualifyIssueReferences(text: string, repository: string): string {
  return text.replace(/(^|[^\w#/])#(\d+)\b/g, (_, before: string, number: string) => `${before}${repository}#${number}`)
}
