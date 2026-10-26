import type { FastifyInstance } from 'fastify'
import type { ProjectPullRequestListDto } from '@solera/protocol'
import { readGitStatus } from '../../git.js'
import { visibleProject } from '../../projects/scope.js'
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
}
