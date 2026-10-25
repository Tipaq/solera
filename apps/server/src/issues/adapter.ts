import type { IssueProvider, IssueState } from '@solera/protocol'

/** Une issue telle que l'outil la rend : de quoi créer la carte et suivre son état. */
export interface ExternalIssue {
  /** L'identifiant dans l'outil, celui que `card_issues.external_id` garde. */
  id: string
  url: string
  title: string
  body: string
  state: IssueState
  author: string
  /** Date de dernière mise à jour, au format de l'outil : c'est elle qui fait le curseur. */
  updatedAt: string
  /** Vrai si l'issue a des sous-issues, qu'il faut alors lire à part. */
  hasChildren: boolean
}

export interface ExternalComment {
  id: string
  /** L'issue commentée. */
  issueId: string
  author: string
  body: string
  url: string
  /** Au format de l'outil : c'est elle qui fait le curseur des commentaires. */
  createdAt: string
}

/**
 * Le contrat d'un outil de tickets, vu du board (#84).
 *
 * Une poignée de fonctions, et pas de moteur de synchronisation : les issues entrent,
 * l'état repart, le reste passe par les agents et le serveur MCP de l'outil. Un second
 * outil (YouTrack) s'ajoute en écrivant ce contrat une seconde fois.
 *
 * `token` : le jeton de la personne qui possède le projet, quand Solera en a un ;
 * l'adaptateur se rabat sinon sur l'authentification de la machine.
 */
export interface IssueAdapter {
  readonly provider: IssueProvider
  /** Qui lit : ses propres commentaires ne sont pas renvoyés aux sessions. */
  viewer(token?: string): Promise<string>
  /**
   * Les issues mises à jour depuis le curseur, de la plus ancienne à la plus récente.
   * Sans curseur, les seules issues ouvertes : l'historique fermé n'a rien à faire au board.
   */
  changedSince(repository: string, cursor: string | null, token?: string): Promise<ExternalIssue[]>
  /** Les commentaires créés depuis le curseur, du plus ancien au plus récent. */
  commentsSince(repository: string, cursor: string, token?: string): Promise<ExternalComment[]>
  /** Les commentaires d'une issue, lus à l'ouverture de sa carte. */
  comments(repository: string, id: string, token?: string): Promise<ExternalComment[]>
  /** Les identifiants des sous-issues d'une issue. */
  children(repository: string, id: string, token?: string): Promise<string[]>
  /** Ferme l'issue, avec un commentaire avant quand il y a un mot à dire. */
  close(repository: string, id: string, reason: 'completed' | 'not_planned', token?: string, comment?: string): Promise<void>
  reopen(repository: string, id: string, token?: string): Promise<void>
}

/** Refus de l'outil, lisible tel quel sur la page du projet. */
export class IssueAdapterError extends Error {}
