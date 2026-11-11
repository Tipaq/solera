import { rm } from 'node:fs/promises'
import { and, asc, desc, eq, isNotNull, isNull, or } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { projects, scheduledRuns, scheduledTasks, type ProjectRow, type ScheduledTaskRow, type UserRow } from '@solera/db'
import {
  approveScheduleCheckBodySchema,
  createScheduledTaskBodySchema,
  createScopedScheduledTaskBodySchema,
  runScheduleBodySchema,
  testScheduleCheckBodySchema,
  testScopedScheduleCheckBodySchema,
  updateScheduledTaskBodySchema,
  type CreateScheduledTaskBody,
  type ScheduleCheckResultDto,
  type ScheduleScope,
  type ScheduledTaskDto,
} from '@solera/protocol'
import type { AgentRegistry } from '../../agents/registry.js'
import { checkStateDir, runCheck } from '../../scheduler/check.js'
import type { TaskScheduler } from '../../scheduler/task-scheduler.js'
import {
  approveScheduleCheck,
  createScheduledTask,
  deleteScheduledTask,
  runToDto,
  tasksToDto,
  updateScheduledTask,
} from '../../scheduler/tasks.js'
import type { SessionManager } from '../../sessions/session-manager.js'
import { placeDirectory } from '../../workspace.js'
import type { AppContext } from '../context.js'
import { forbidden, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * Tâches planifiées, d'un projet ou hors projet (Savoir, Instance, sans projet).
 *
 * Lisibles par qui voit le projet, comme ses conversations. Modifiables par qui a créé
 * la tâche ou possède le projet : un tir s'ouvre au nom de son créateur, avec les
 * permissions qu'il a choisies, et un autre compte n'a pas à les élargir à sa place.
 * Hors projet, lisibles et modifiables par leur seul créateur.
 */
export function registerScheduleRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  sessions: SessionManager,
  registry: AgentRegistry,
  tasks: TaskScheduler,
): void {
  const loadProject = (projectId: string, userId: string) => {
    const project = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get()
    if (!project || (project.ownerId !== userId && project.visibility !== 'shared')) {
      throw notFound('project_not_found', 'Project not found.')
    }
    return project
  }

  const loadWritable = (taskId: string, userId: string): ScheduledTaskRow => {
    const task = ctx.db.select().from(scheduledTasks).where(eq(scheduledTasks.id, taskId)).get()
    if (!task) throw notFound('schedule_not_found', 'Scheduled task not found.')
    // Sans projet, il n'y a pas de propriétaire de projet pour partager l'écriture :
    // reste le créateur de la tâche, et lui seul.
    const owner = task.projectId === null ? null : loadProject(task.projectId, userId).ownerId
    if (task.userId !== userId && owner !== userId) {
      throw forbidden('schedule_write_forbidden', 'Only the task creator or the project owner can change it.')
    }
    return task
  }

  /** Une tâche confinée que ce serveur ne saurait pas lancer est refusée dès sa création (#146). */
  const assertConfinable = (projectId: string, confined: boolean | null) => {
    sessions.environments.assertAvailable(projectId, sessions.environments.forAutonomous(projectId, confined))
  }

  const one = (row: ScheduledTaskRow): ScheduledTaskDto => tasksToDto(ctx.db, [row])[0]!

  /** Le dernier tir qui a ouvert une session : ce que l'essai d'un script reçoit comme précédent. */
  const previousRun = (taskId: string) =>
    ctx.db
      .select({ startedAt: scheduledRuns.startedAt, status: scheduledRuns.status })
      .from(scheduledRuns)
      .where(and(eq(scheduledRuns.taskId, taskId), isNotNull(scheduledRuns.conversationId)))
      .orderBy(desc(scheduledRuns.startedAt))
      .get() ?? null

  /**
   * Le projet visé, ou le dossier où tourne une portée hors projet, une fois les droits
   * vérifiés. Le vault doit être configuré ; l'instance est réservée aux
   * administrateurs : son dossier de données tient la base et les secrets de tous les
   * comptes. `none` n'a pas de dossier à lui.
   */
  const resolveTarget = (
    user: UserRow,
    target: { scope: ScheduleScope; projectId?: string },
  ): { project: ProjectRow | null; directory: string | null } => {
    if (target.scope === 'project') return { project: loadProject(target.projectId!, user.id), directory: null }
    if (target.scope === 'instance' && !user.isAdmin) throw forbidden('admin_only', 'Administrators only.')
    if (target.scope === 'none') return { project: null, directory: null }
    return { project: null, directory: placeDirectory(ctx.db, ctx.config, target.scope) }
  }

  const create = async (
    user: UserRow,
    project: ProjectRow | null,
    scope: ScheduleScope,
    body: CreateScheduledTaskBody,
  ): Promise<ScheduledTaskDto> => {
    // Comme à la création d'une conversation : la tâche garde une configuration
    // explicite, pas un « défaut du CLI » qui changerait de sens d'un tir à l'autre.
    if (project) assertConfinable(project.id, body.confined)
    const config = await registry.adapter(body.agent).resolveDefaults(body.config)
    const owner = { projectId: project?.id ?? null, scope: scope === 'project' ? undefined : scope, userId: user.id }
    return one(createScheduledTask(ctx.db, owner, { ...body, config }))
  }

  /** Toutes les tâches visibles, tous projets confondus : la sidebar les range par projet. */
  app.get('/api/schedules', async (request): Promise<ScheduledTaskDto[]> => {
    const user = requireUser(request)
    const rows = ctx.db
      .select({ task: scheduledTasks })
      .from(scheduledTasks)
      // Externe : une tâche sans projet n'appartient qu'à son créateur, et une jointure
      // interne la ferait disparaître de la liste au lieu de la ranger à part.
      .leftJoin(projects, eq(projects.id, scheduledTasks.projectId))
      .where(
        or(
          eq(projects.ownerId, user.id),
          eq(projects.visibility, 'shared'),
          and(isNull(scheduledTasks.projectId), eq(scheduledTasks.userId, user.id)),
        ),
      )
      .orderBy(asc(scheduledTasks.createdAt))
      .all()
    return tasksToDto(
      ctx.db,
      rows.map((row) => row.task),
    )
  })

  app.post('/api/projects/:id/schedules', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = createScheduledTaskBodySchema.parse(request.body)
    return reply.status(201).send(await create(user, loadProject(id, user.id), 'project', body))
  })

  /** Création depuis la page Planifiées : dans un projet, le vault, l'instance ou nulle part. */
  app.post('/api/schedules', async (request, reply) => {
    const user = requireUser(request)
    const { scope, projectId, ...body } = createScopedScheduledTaskBodySchema.parse(request.body)
    const { project } = resolveTarget(user, { scope, projectId })
    return reply.status(201).send(await create(user, project, scope, body))
  })

  app.patch('/api/schedules/:id', async (request): Promise<ScheduledTaskDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = updateScheduledTaskBodySchema.parse(request.body)
    const task = loadWritable(id, user.id)
    if (body.confined !== undefined && task.projectId !== null) assertConfinable(task.projectId, body.confined)

    const config = body.config
      ? await registry.adapter(body.agent ?? task.agent).resolveDefaults(body.config)
      : undefined
    return one(updateScheduledTask(ctx.db, task, { ...body, config }))
  })

  app.delete('/api/schedules/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadWritable(id, user.id)

    const running = deleteScheduledTask(ctx.db, id)
    // Un tir en vol n'a plus de tâche pour le borner : il s'arrête avec elle.
    await Promise.all(running.map((conversationId) => sessions.terminate(conversationId)))
    // Ce que sa vérification gardait d'un tir à l'autre ne sert plus à personne.
    await rm(checkStateDir(ctx.config.paths.data, id), { recursive: true, force: true })
    return reply.status(204).send()
  })

  /** « Lancer maintenant » : un tir hors cadence, qui ne décale pas le suivant. */
  app.post('/api/schedules/:id/run', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadWritable(id, user.id)
    const body = runScheduleBodySchema.parse(request.body ?? {})
    return reply.status(201).send(runToDto(await tasks.runNow(id, { skipCheck: body.skipCheck })))
  })

  /**
   * Joue un script de vérification sans rien lancer, celui du formulaire, enregistré ou
   * non. C'est exécuter du code sur le serveur : réservé à qui peut modifier la tâche,
   * ou en créer une dans ce projet. L'état gardé entre deux tirs n'est pas touché.
   */
  app.post('/api/projects/:id/schedules/check-test', async (request): Promise<ScheduleCheckResultDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = testScheduleCheckBodySchema.parse(request.body)
    const project = loadProject(id, user.id)
    const task = body.taskId ? loadWritable(body.taskId, user.id) : null
    if (task && task.projectId !== project.id) throw notFound('schedule_not_found', 'Scheduled task not found.')
    return runCheck(body.script, {
      taskId: task?.id ?? '',
      taskName: task?.name ?? '',
      projectId: project.id,
      cwd: project.workspacePath,
      // Sans tâche, un dossier vide : l'essai le copie sans jamais y écrire.
      stateDir: checkStateDir(ctx.config.paths.data, task?.id ?? '_draft'),
      firedAt: Date.now(),
      trigger: 'test',
      previous: task ? previousRun(task.id) : null,
      timeoutMs: body.timeoutSeconds * 1000,
    })
  })

  /**
   * L'essai depuis la page Planifiées : joué où la portée tourne, avec les droits de sa
   * création. Une tâche existante doit avoir cette portée, et ce projet.
   */
  app.post('/api/schedules/check-test', async (request): Promise<ScheduleCheckResultDto> => {
    const user = requireUser(request)
    const body = testScopedScheduleCheckBodySchema.parse(request.body)
    const { project, directory } = resolveTarget(user, body)
    const task = body.taskId ? loadWritable(body.taskId, user.id) : null
    if (task && (task.scope !== body.scope || task.projectId !== (project?.id ?? null))) {
      throw notFound('schedule_not_found', 'Scheduled task not found.')
    }
    const stateDir = checkStateDir(ctx.config.paths.data, task?.id ?? '_draft')
    return runCheck(body.script, {
      taskId: task?.id ?? '',
      taskName: task?.name ?? '',
      projectId: project?.id ?? '',
      cwd: project?.workspacePath ?? directory ?? stateDir,
      stateDir,
      firedAt: Date.now(),
      trigger: 'test',
      previous: task ? previousRun(task.id) : null,
      timeoutMs: body.timeoutSeconds * 1000,
    })
  })

  /** Valide le script qu'un agent a proposé, tel qu'il a été relu. */
  app.post('/api/schedules/:id/check/approve', async (request): Promise<ScheduledTaskDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = approveScheduleCheckBodySchema.parse(request.body)
    return one(approveScheduleCheck(ctx.db, loadWritable(id, user.id), body.script))
  })
}
