import type { Forge, PullRequest } from './forge.js'
import { badgeStateOf } from './pull-requests.js'

/** Pourquoi une PR ne se fusionne pas maintenant. */
export type MergeRefusal = 'merged' | 'closed' | 'draft' | 'conflicting' | 'checks_failing' | 'checks_pending'

/**
 * La PR est-elle prête ? La même règle que le badge « prête » de l'Activité, qui seul
 * montre le geste, plus le conflit que la forge connaît et que la liste ne lit pas.
 */
export function mergeRefusalOf(pr: PullRequest): MergeRefusal | null {
  if (pr.state === 'MERGED') return 'merged'
  if (pr.state === 'CLOSED') return 'closed'
  const badge = badgeStateOf(pr, pr.checks)
  if (badge === 'draft') return 'draft'
  if (pr.mergeable === 'CONFLICTING') return 'conflicting'
  if (badge === 'failing') return 'checks_failing'
  if (badge === 'checks') return 'checks_pending'
  return null
}

/** La PR n'est pas prête : rien n'a été fusionné. */
export class PullRequestNotReady extends Error {
  constructor(
    readonly reason: MergeRefusal,
    readonly pullRequest: PullRequest,
  ) {
    super(`PR #${pullRequest.number} : ${reason}`)
  }
}

/**
 * Fusionne une PR prête, telle que la forge la voit à l'instant : relue, jugée, puis
 * fusionnée en squash au commit lu, pour qu'un push arrivé entre-temps fasse échouer la
 * fusion au lieu de partir sans avoir été vu. La branche n'est jamais supprimée.
 *
 * Partagée par le « Fusionner la PR » d'un arbre et par la PR finale d'un jalon.
 * `PullRequestNotReady` si elle ne l'est pas, `ForgeError` si la forge refuse.
 */
export async function mergeReadyPullRequest(forge: Forge, cwd: string, ref: string, token?: string): Promise<PullRequest> {
  const pr = await forge.readPullRequest(cwd, ref, token)
  const refusal = mergeRefusalOf(pr)
  if (refusal) throw new PullRequestNotReady(refusal, pr)
  await forge.mergePullRequest(cwd, pr.number, pr.headSha, token)
  return pr
}
