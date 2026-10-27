import { and, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { projects } from '@solera/db'
import type { PortfolioPullRequestsDto, ProjectPullRequestListDto } from '@solera/protocol'
import { readGitStatus } from '../../git.js'
import { visibilityFilter, visibleProject } from '../../projects/scope.js'
import type { ProjectPullRequests } from '../../reviews/pull-requests.js'
import type { AppContext } from '../context.js'
import { notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * Les PR d'un projet, une par branche, pour les badges de l'onglet Activité (#115).
 * Servies depuis un cache d'une minute : voir `ProjectPullRequests`.
 */
export function registerPullRequestRoutes(app: FastifyInstance, ctx: AppContext, pullRequests: ProjectPullRequests): void {
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
}
