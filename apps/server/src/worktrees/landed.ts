import type { ProjectRow } from '@solera/db'

/** Une PR fusionnée sur la forge, réduite à ce qui juge une branche. */
export interface MergedPullRequest {
  number: number
  branch: string
  base: string
  /** Le commit fusionné. */
  head: string
  /** Date de la fusion, en millisecondes ; 0 si la forge ne l'a pas dite. */
  mergedAt: number
}

/** Une PR dont le contenu est arrivé dans la base, et le commit qu'elle y a porté. */
export type LandedPullRequest = Pick<MergedPullRequest, 'number' | 'head'>

/** Les PR fusionnées d'un projet ; null quand la forge n'a pas répondu. */
export type MergedPullRequestSource = (project: ProjectRow) => Promise<MergedPullRequest[] | null>

/**
 * Les PR fusionnées dont le contenu est arrivé dans `base`, par branche : celles qui
 * visaient la base, et celles qui visaient une branche intermédiaire (celle d'un jalon,
 * #68) fusionnée à son tour dans la base, de proche en proche.
 *
 * Par une branche intermédiaire, seule passe une PR fusionnée avant une fusion de cette
 * branche qui a elle-même atterri : une PR fusionnée dans le jalon après sa dernière
 * fusion dans la base y attend encore la suivante.
 *
 * `base` peut être `origin/main` quand la branche locale manque : la forge, elle, dit
 * `main`.
 */
export function landedPullRequests(merged: readonly MergedPullRequest[], base: string): Map<string, LandedPullRequest[]> {
  const target = base.replace(/^origin\//, '')
  const landed = new Set(merged.filter((pr) => pr.base === target))
  for (let grew = true; grew; ) {
    grew = false
    for (const pr of merged) {
      if (landed.has(pr)) continue
      const carried = [...landed].some((next) => next.branch === pr.base && next.mergedAt >= pr.mergedAt)
      if (carried) {
        landed.add(pr)
        grew = true
      }
    }
  }
  const byBranch = new Map<string, LandedPullRequest[]>()
  for (const pr of landed) {
    byBranch.set(pr.branch, [...(byBranch.get(pr.branch) ?? []), { number: pr.number, head: pr.head }])
  }
  return byBranch
}
