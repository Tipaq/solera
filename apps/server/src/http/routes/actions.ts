import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { conversations, projects, worktrees } from '@solera/db'
import {
  actionPlaceBodySchema,
  createProjectActionBodySchema,
  runProjectActionBodySchema,
  serviceActionControlSchema,
  tryProjectActionBodySchema,
  updateProjectActionBodySchema,
  type ActionRunDetailDto,
  type ActionSuggestion,
  type ProjectActionDto,
} from '@solera/protocol'
import {
  approveAction,
  createAction,
  deleteAction,
  listActionRows,
  loadAction,
  rejectAction,
  unitsOrphanedBy,
  updateAction,
  type ActionRunner,
} from '../../actions/actions.js'
import { runDetails } from '../../actions/runs.js'
import { readSuggestions, withoutExisting } from '../../actions/suggestions.js'
import type { SessionManager } from '../../sessions/session-manager.js'
import type { AppContext } from '../context.js'
import { conflict, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'
import { visibilityFilter, visibleProject } from '../../projects/scope.js'

/**
 * Actions de projet.
 *
 * Mêmes droits que les terminaux : qui voit le projet peut lancer et modifier ses
 * actions. Une action n'exécute rien qu'un terminal du même projet ne permette déjà ;
 * ce qui la distingue, c'est qu'un agent peut l'écrire, d'où le passage obligé par la
 * relecture avant qu'un clic la lance.
 */
export function registerActionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  sessions: SessionManager,
  runner: ActionRunner,
): void {
  const guardProject = (projectId: string, userId: string) => {
    const project = visibleProject(ctx, projectId, userId)
    if (!project) throw notFound('project_not_found', 'Project not found.')
    return project
  }

  const guardAction = (actionId: string, userId: string) => {
    const action = loadAction(ctx.db, actionId)
    const project = guardProject(action.projectId, userId)
    return { action, project }
  }

  /**
   * Le worktree de la conversation si elle est donnée, sinon le worktree choisi, sinon
   * la racine. L'un ou l'autre doit appartenir au projet.
   */
  const baseDir = (
    projectId: string,
    workspacePath: string,
    { conversationId, worktreeId }: { conversationId?: string; worktreeId?: string },
  ) => {
    if (worktreeId) {
      const worktree = ctx.db
        .select({ path: worktrees.path })
        .from(worktrees)
        .where(and(eq(worktrees.id, worktreeId), eq(worktrees.projectId, projectId), isNull(worktrees.removedAt)))
        .get()
      if (!worktree) throw notFound('worktree_not_found', 'Worktree not found.')
      return worktree.path
    }
    if (!conversationId) return workspacePath
    const row = ctx.db
      .select({ projectId: conversations.projectId })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .get()
    if (!row || row.projectId !== projectId) {
      throw notFound('conversation_not_found', 'Conversation not found.')
    }
    return sessions.workingDirectory(conversationId)
  }

  /** Toutes les actions visibles : la palette les propose tous projets confondus. */
  app.get('/api/actions', async (request): Promise<ProjectActionDto[]> => {
    const user = requireUser(request)
    const visible = ctx.db.select({ id: projects.id }).from(projects).where(visibilityFilter(user.id)).all()
    return runner.toDtos(listActionRows(ctx.db, visible.map((project) => project.id)))
  })

  app.post('/api/projects/:id/actions', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    guardProject(id, user.id)
    const body = createProjectActionBodySchema.parse(request.body)
    const row = createAction(ctx.db, id, body, null)
    return reply.status(201).send(await runner.toDto(row))
  })

  /** « Trouvé dans le dépôt » : ce que la racine du projet sait lancer, moins ses boutons. */
  app.get('/api/projects/:id/actions/suggestions', async (request): Promise<ActionSuggestion[]> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const project = guardProject(id, user.id)
    return withoutExisting(await readSuggestions(project.workspacePath), listActionRows(ctx.db, [id]))
  })

  /** « Essayer » depuis l'éditeur : un terminal d'essai, rien d'enregistré, les droits d'un terminal. */
  app.post('/api/projects/:id/actions/try', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const project = guardProject(id, user.id)
    const { conversationId, ...attempt } = tryProjectActionBodySchema.parse(request.body ?? {})
    const base = baseDir(id, project.workspacePath, { conversationId })
    return reply.status(201).send(await runner.tryCommand(id, attempt, base, conversationId ?? null, user.id))
  })

  app.patch('/api/actions/:id', async (request): Promise<ProjectActionDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { action } = guardAction(id, user.id)
    const patch = updateProjectActionBodySchema.parse(request.body)
    const next = updateAction(ctx.db, action, patch, null)
    // Un service qui devient une tâche, ou change de nombre d'instances, laisserait ses
    // unités tourner sans bouton.
    if (unitsOrphanedBy(action, next)) await runner.forget(action)
    return runner.toDto(next)
  })

  app.post('/api/actions/:id/approve', async (request): Promise<ProjectActionDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { action } = guardAction(id, user.id)
    return runner.toDto(approveAction(ctx.db, action))
  })

  /**
   * Refuser ce qu'un agent propose : la commande relue en dernier revient, validée. Une
   * action jamais relue n'a rien où revenir : elle est supprimée (204).
   */
  app.post('/api/actions/:id/reject', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { action } = guardAction(id, user.id)
    const restored = rejectAction(ctx.db, action)
    if (restored) return reply.send(await runner.toDto(restored))
    await runner.forget(action)
    deleteAction(ctx.db, id)
    return reply.status(204).send()
  })

  /** Les derniers passages, avec l'extrait de leur sortie : le détail d'une action. */
  app.get('/api/actions/:id/runs', async (request): Promise<ActionRunDetailDto[]> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    guardAction(id, user.id)
    return runDetails(ctx.db, id)
  })

  app.delete('/api/actions/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { action } = guardAction(id, user.id)
    await runner.forget(action)
    deleteAction(ctx.db, id)
    return reply.status(204).send()
  })

  app.post('/api/actions/:id/run', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { action, project } = guardAction(id, user.id)
    const body = runProjectActionBodySchema.parse(request.body ?? {})
    if (!action.approvedAt) {
      throw conflict('action_not_approved', 'Review this action before running it.')
    }
    const result = await runner.run(action, baseDir(action.projectId, project.workspacePath, body), body.conversationId ?? null, {
      args: body.args,
      switch: body.switch,
    })
    return reply.status(result.alreadyRunning ? 200 : 201).send(result)
  })

  app.post('/api/actions/:id/service/:op', async (request) => {
    const user = requireUser(request)
    const { id, op } = request.params as { id: string; op: string }
    const { action, project } = guardAction(id, user.id)
    const body = actionPlaceBodySchema.parse(request.body ?? {})
    const base = baseDir(action.projectId, project.workspacePath, body)
    if (op === 'logs') return runner.logs(action, base)
    // Relancer un service arrêté revient à le lancer : même relecture préalable.
    if (op === 'restart' && !action.approvedAt) {
      throw conflict('action_not_approved', 'Review this action before running it.')
    }
    return runner.control(action, serviceActionControlSchema.parse(op), base)
  })
}
