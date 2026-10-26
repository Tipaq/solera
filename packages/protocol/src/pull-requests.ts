/**
 * Les cinq états d'un badge de PR (planche B4 de `docs/audits/2026-10-21-page-projet/final/`) :
 * brouillon, checks en cours, échec, prête, fusionnée.
 *
 * Une PR fermée sans fusion n'a pas de badge : elle ne dit plus rien de la branche.
 */
export type PullRequestBadgeState = 'draft' | 'checks' | 'failing' | 'ready' | 'merged'

/** Où en est la revue de Solera (#68) sur cette PR, quand elle a été demandée. */
export type PullRequestReviewState =
  | 'reviewing'
  | 'changes'
  | 'approved'
  | 'escalated'
  | 'closed'
  | 'to_merge'
  | 'merging'
  | 'merged'
  | 'merge_failed'

export interface ProjectPullRequestDto {
  number: number
  url: string
  title: string
  /** La branche proposée : c'est par elle qu'une PR retrouve son worktree et ses sessions. */
  branch: string
  base: string
  state: PullRequestBadgeState
  /** Les checks tels que la forge les rend, pour dire au survol ce que l'état résume. */
  checks: { passed: number; pending: number; failed: string[] }
  /** Null quand aucune revue n'a été demandée à Solera pour cette PR. */
  review: PullRequestReviewState | null
  /** Date de fusion, ou de dernière mise à jour pour une PR ouverte. */
  updatedAt: number
}

export interface ProjectPullRequestListDto {
  /**
   * Faux quand la forge n'a pas répondu : `gh` absent ou non connecté, dépôt sans remote
   * GitHub. L'interface ne montre alors aucun badge plutôt que des badges faux.
   */
  available: boolean
  fetchedAt: number
  /** Une PR par branche au plus : l'ouverte, sinon la dernière fusionnée. */
  pullRequests: ProjectPullRequestDto[]
}
