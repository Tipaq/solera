import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { cardReviews, type Db, type ProjectRow } from '@solera/db'
import type {
  ProjectPullRequestDto,
  ProjectPullRequestListDto,
  PullRequestBadgeState,
  PullRequestReviewState,
} from '@solera/protocol'

const run = promisify(execFile)

const GH_TIMEOUT_MS = 20_000

/**
 * Au-delà, la liste est relue sur la forge ; en deçà, resservie. Une minute : un badge
 * n'a pas besoin d'être à la seconde, et chaque relecture est un appel à l'API GitHub.
 */
const TTL_MS = 60_000

/** Assez pour couvrir les PR ouvertes et les fusions récentes d'un projet actif. */
const LIST_LIMIT = 60

const FIELDS = 'number,title,url,headRefName,baseRefName,state,isDraft,mergedAt,updatedAt,statusCheckRollup'

/** Une PR telle que `gh pr list --json` la rend, réduite à ce que le badge lit. */
export interface RawPullRequest {
  number: number
  title: string
  url: string
  headRefName: string
  baseRefName: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  mergedAt: string | null
  updatedAt: string
  /** Des `CheckRun` (status, conclusion) et des `StatusContext` (state), mêlés. */
  statusCheckRollup: { status?: string; conclusion?: string; state?: string; name?: string; context?: string }[] | null
}

/** Lit les PR d'un dépôt ; une interface pour que les tests n'aient pas besoin de GitHub. */
export type PullRequestLister = (cwd: string, token?: string) => Promise<RawPullRequest[]>

export const ghListPullRequests: PullRequestLister = async (cwd, token) => {
  const { stdout } = await run('gh', ['pr', 'list', '--state', 'all', '--limit', String(LIST_LIMIT), '--json', FIELDS], {
    cwd,
    timeout: GH_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', ...(token ? { GH_TOKEN: token } : {}) },
  })
  return JSON.parse(stdout) as RawPullRequest[]
}

const FAILED_CONCLUSIONS = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE'])

/**
 * Les checks d'une PR, comptés. Un check sauté ne compte ni pour ni contre.
 *
 * Rien n'est interprété : la CI de ce dépôt tombe faute de facturation en deux secondes,
 * et le badge le dit en « échec », avec le nom des checks au survol. Distinguer une
 * panne de la CI d'un vrai échec demanderait de lire leurs journaux.
 */
export function countChecks(rollup: RawPullRequest['statusCheckRollup']): ProjectPullRequestDto['checks'] {
  const checks = { passed: 0, pending: 0, failed: [] as string[] }
  for (const check of rollup ?? []) {
    const name = check.name ?? check.context ?? '?'
    if (check.state !== undefined && check.status === undefined) {
      // StatusContext : SUCCESS, PENDING, EXPECTED, FAILURE, ERROR.
      if (check.state === 'SUCCESS') checks.passed++
      else if (check.state === 'FAILURE' || check.state === 'ERROR') checks.failed.push(name)
      else checks.pending++
      continue
    }
    if (check.status !== 'COMPLETED') checks.pending++
    else if (FAILED_CONCLUSIONS.has(check.conclusion ?? '')) checks.failed.push(name)
    else if (check.conclusion === 'SUCCESS' || check.conclusion === 'NEUTRAL') checks.passed++
  }
  return checks
}

/**
 * L'état du badge. Fusionnée passe avant tout, puis brouillon : une PR en brouillon
 * n'est pas proposée, quoi que disent ses checks. Ensuite l'échec avant l'attente, parce
 * qu'un check tombé ne se relèvera pas en attendant les autres. Sans check, une PR
 * ouverte est prête : rien ne dit le contraire.
 */
export function badgeStateOf(pr: Pick<RawPullRequest, 'state' | 'isDraft'>, checks: ProjectPullRequestDto['checks']): PullRequestBadgeState | null {
  if (pr.state === 'MERGED') return 'merged'
  if (pr.state !== 'OPEN') return null
  if (pr.isDraft) return 'draft'
  if (checks.failed.length > 0) return 'failing'
  if (checks.pending > 0) return 'checks'
  return 'ready'
}

/**
 * Une PR par branche : l'ouverte, sinon la dernière fusionnée. Une branche rouverte
 * après une fusion porte de nouveau une PR ouverte, et c'est elle qui compte.
 */
export function pullRequestsByBranch(
  raw: RawPullRequest[],
  reviews: ReadonlyMap<number, PullRequestReviewState>,
): ProjectPullRequestDto[] {
  const kept = new Map<string, ProjectPullRequestDto>()
  for (const pr of raw) {
    const checks = countChecks(pr.statusCheckRollup)
    const state = badgeStateOf(pr, checks)
    if (!state || !pr.headRefName) continue
    const dto: ProjectPullRequestDto = {
      number: pr.number,
      url: pr.url,
      title: pr.title,
      branch: pr.headRefName,
      base: pr.baseRefName,
      state,
      checks,
      review: reviews.get(pr.number) ?? null,
      updatedAt: Date.parse(pr.mergedAt ?? pr.updatedAt) || 0,
    }
    const current = kept.get(dto.branch)
    if (!current || rank(dto) > rank(current) || (rank(dto) === rank(current) && dto.updatedAt > current.updatedAt)) {
      kept.set(dto.branch, dto)
    }
  }
  return [...kept.values()].sort((a, b) => b.number - a.number)
}

const rank = (pr: ProjectPullRequestDto) => (pr.state === 'merged' ? 0 : 1)

interface CacheEntry {
  value: ProjectPullRequestListDto | null
  pending: Promise<ProjectPullRequestListDto> | null
}

/**
 * Les PR d'un projet, pour les badges de l'onglet Activité (#115) : **un seul**
 * `gh pr list` par projet et par minute, quel que soit le nombre de sessions affichées.
 *
 * Comme la liste des worktrees, une liste périmée est resservie tout de suite pendant
 * que la suivante se lit : l'interface n'attend la forge qu'au tout premier appel.
 *
 * La revue de Solera (#68, `card_reviews`) y est jointe par numéro de PR.
 */
export class ProjectPullRequests {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly db: Db,
    private readonly list: PullRequestLister = ghListPullRequests,
    private readonly token?: (userId: string) => string | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  async get(project: ProjectRow, userId: string): Promise<ProjectPullRequestListDto> {
    const entry = this.cache.get(project.id) ?? { value: null, pending: null }
    this.cache.set(project.id, entry)
    const fresh = entry.value && this.now() - entry.value.fetchedAt < TTL_MS
    if (fresh) return entry.value!
    entry.pending ??= this.fetch(project, userId).finally(() => {
      entry.pending = null
    })
    const next = entry.pending.then((value) => (entry.value = value))
    return entry.value ?? next
  }

  private async fetch(project: ProjectRow, userId: string): Promise<ProjectPullRequestListDto> {
    let raw: RawPullRequest[]
    try {
      raw = await this.list(project.workspacePath, this.token?.(userId))
    } catch {
      // `gh` absent, non connecté, ou un dépôt sans remote GitHub : pas de badge, et on
      // ne réessaie qu'à la minute suivante.
      return { available: false, fetchedAt: this.now(), pullRequests: [] }
    }
    const reviews = new Map(
      this.db
        .select({ prNumber: cardReviews.prNumber, state: cardReviews.state })
        .from(cardReviews)
        .where(eq(cardReviews.projectId, project.id))
        .all()
        .map((row) => [row.prNumber, row.state] as const),
    )
    return { available: true, fetchedAt: this.now(), pullRequests: pullRequestsByBranch(raw, reviews) }
  }
}
