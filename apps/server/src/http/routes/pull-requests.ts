import { and, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { projects } from '@solera/db'
import type { PortfolioPullRequestsDto, ProjectPullRequestListDto, PullRequestMergeResultDto } from '@solera/protocol'
import { readGitStatus } from '../../git.js'
import { visibilityFilter, visibleProject } from '../../projects/scope.js'
import { ForgeError, type Forge } from '../../reviews/forge.js'
import { PullRequestNotReady, mergeReadyPullRequest } from '../../reviews/merge.js'
import type { ProjectPullRequests } from '../../reviews/pull-requests.js'
import type { WorktreeStatusService } from '../../worktrees/status-service.js'
import type { AppContext } from '../context.js'
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/** Ce que la fusion d'une PR demande en plus de la liste : la forge, et ce qu'elle périme. */
export interface PullRequestMerging {
  forge: Forge
  worktreeStatus: WorktreeStatusService
  /** Le jeton GitHub enregistré de l'utilisateur, qui passe devant celui de `gh`. */
  token: (userId: string) => string | undefined
}

/**
 * Les PR d'un projet, une par branche, pour les badges de l'onglet Activité (#115).
 * Servies depuis un cache d'une minute : voir `ProjectPullRequests`.
 */
export function registerPullRequestRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  pullRequests: ProjectPullRequests,
  merging: PullRequestMerging,
): void {
  app.get('/api/projects/:id/pull-requests', async (request): Promise<ProjectPullRequestListDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const project = visibleProject(ctx, id, user.id)
    if (!project) throw notFound('project_not_found', 'Project not found.')
    if (!(await readGitStatus(project.workspacePath))) {
      return { available: false, fetchedAt: Date.now(), pullRequests: [] }
    }
    return pullRequests.get(project, user.id)
  })

  /**
   * Les mêmes pour tous les projets visibles et non archivés, d'une requête : l'Activité
   * du portefeuille (#117). Chaque projet garde son cache d'une minute.
   */
  app.get('/api/pull-requests', async (request): Promise<PortfolioPullRequestsDto> => {
    const user = requireUser(request)
    const rows = ctx.db
      .select()
      .from(projects)
      .where(and(visibilityFilter(user.id), isNull(projects.archivedAt)))
      .all()
    const lists = await Promise.all(
      rows.map(async (project) => {
        if (!(await readGitStatus(project.workspacePath))) return null
        // Un projet en échec sort de la liste au lieu de faire tomber les autres.
        try {
          return [project.id, await pullRequests.get(project, user.id)] as const
        } catch {
          return null
        }
      }),
    )
    return { projects: Object.fromEntries(lists.filter((entry) => entry !== null)) }
  })

  /**
   * Fusionne une PR prête du projet (S7) : le « Fusionner la PR » d'un arbre. Le
   * propriétaire seul, comme pour nettoyer un arbre. 409 si la forge la dit pas prête,
   * 502 si elle refuse ; la confirmation est celle de l'interface.
   */
  app.post('/api/projects/:id/pull-requests/:number/merge', async (request): Promise<PullRequestMergeResultDto> => {
    const user = requireUser(request)
    const { id, number } = request.params as { id: string; number: string }
    const project = visibleProject(ctx, id, user.id)
    if (!project) throw notFound('project_not_found', 'Project not found.')
    if (project.ownerId !== user.id) {
      throw forbidden('pull_request_merge_forbidden', 'Only the project owner can merge a pull request.')
    }
    if (!/^[1-9]\d{0,9}$/.test(number)) throw badRequest('bad_pull_request_number', 'Not a pull request number.')

    let pr
    try {
      pr = await mergeReadyPullRequest(merging.forge, project.workspacePath, number, merging.token(user.id))
    } catch (err) {
      if (err instanceof PullRequestNotReady || err instanceof ForgeError) throw mergeFailure(err)
      throw err
    }
    pullRequests.invalidate(project.id)
    merging.worktreeStatus.invalidate(project.id)
    return { number: pr.number, url: pr.url, branch: pr.head, base: pr.base }
  })
}

const NOT_READY: Record<PullRequestNotReady['reason'], string> = {
  merged: 'Pull request #{number} is already merged.',
  closed: 'Pull request #{number} was closed without being merged.',
  draft: 'Pull request #{number} is still a draft.',
  conflicting: 'Pull request #{number} conflicts with its base: rebase it first.',
  checks_failing: 'Some checks of pull request #{number} failed.',
  checks_pending: 'Some checks of pull request #{number} are still running.',
}

/** Le message de la forge part tel quel : c'est lui qui dit quoi faire (rebaser, attendre). */
function mergeFailure(err: PullRequestNotReady | ForgeError): HttpError {
  if (err instanceof PullRequestNotReady) {
    return conflict(`pull_request_${err.reason}`, NOT_READY[err.reason], { number: err.pullRequest.number })
  }
  return new HttpError(502, 'forge_failed', 'The forge refused: {error}', { error: err.message })
}
