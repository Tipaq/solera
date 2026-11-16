import { conversations, projects } from '@solera/db'
import type { ProjectBackgroundDto, ProjectBackgroundTaskDto, ServiceKind } from '@solera/protocol'
import { and, asc, eq, gt } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { bashCommand } from '../../events/bash-command.js'
import type { EventLog } from '../../events/event-log.js'
import { summarizeCommandText } from '../../services/command-line.js'
import { processOrigins } from '../../services/origins.js'
import { serviceProcessScanner } from '../../services/processes.js'
import type { AppContext } from '../context.js'
import { notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/** Ce qu'il faut d'une entrée de `GET /api/services` pour la reconnaître. */
export interface BackgroundProcess {
  id: string
  kind: ServiceKind
  conversationId: string | null
  command: string | null
  startedAt: number
}

/** Null quand la machine ne se scanne pas : les travaux restent, sans rapprochement. */
export type ScanBackgroundProcesses = () => Promise<BackgroundProcess[] | null>

/**
 * Les travaux de fond d'un projet (#206) : pour chaque session qui en a laissé tourner,
 * ce que le journal en sait — départ, appel d'outil, commande exacte d'un `Bash` lancé
 * en fond —, et le processus de la page Services qui porte la même chose.
 *
 * Le flux des statuts n'en donne que le nombre (`background_count`) ; c'est lui qui
 * choisit les sessions à relire, et le journal qui dit lesquels sont encore ouverts.
 * Une session archivée en fait partie : ce qu'elle a laissé tourner tourne encore.
 *
 * Le rapprochement s'arrête à `serviceId` : écarter l'entrée de `/api/services` déjà
 * montrée par son travail revient à qui fusionne les deux listes (#215).
 */
export function registerProjectBackgroundRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  log: EventLog,
  scan: ScanBackgroundProcesses = defaultScan(ctx),
): void {
  app.get('/api/projects/:id/background', async (request): Promise<ProjectBackgroundDto[]> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }

    const project = ctx.db.select().from(projects).where(eq(projects.id, id)).get()
    if (!project || (project.ownerId !== user.id && project.visibility !== 'shared')) {
      throw notFound('project_not_found', 'Project not found.')
    }

    const rows = ctx.db
      .select({ id: conversations.id, title: conversations.title, agent: conversations.agent })
      .from(conversations)
      .where(and(eq(conversations.projectId, id), gt(conversations.backgroundCount, 0)))
      .orderBy(asc(conversations.createdAt))
      .all()

    const groups = rows.flatMap((row): ProjectBackgroundDto[] => {
      const work = log.openBackgroundWork(row.id)
      if (work.length === 0) return []
      const inputs = log.toolInputs(row.id, work.flatMap((task) => task.toolCallId ? [task.toolCallId] : []))
      const tasks = work.map((task): ProjectBackgroundTaskDto => {
        const call = task.toolCallId ? inputs.get(task.toolCallId) : undefined
        return { ...task, command: call ? bashCommand(call) : null, serviceId: null }
      })
      return [{ conversationId: row.id, title: row.title, agent: row.agent, tasks }]
    })
    if (groups.length === 0) return groups

    const processes = await scan()
    if (processes) for (const group of groups) matchProcesses(group, processes)
    return groups
  })
}

function defaultScan(ctx: AppContext): ScanBackgroundProcesses {
  return async () => {
    if (process.platform !== 'linux') return null
    const scanned = await serviceProcessScanner(processOrigins(ctx.config.paths.data)).scan()
    return scanned.map((entry) => ({
      id: entry.id, kind: entry.kind, conversationId: entry.origin?.conversationId ?? null,
      command: entry.command, startedAt: entry.startedAt,
    }))
  }
}

/**
 * Pose sur chaque travail l'entrée du scan qui le porte : lancée par la même session,
 * avec la même commande, sous la forme abrégée qu'en donne le scan. Deux travaux à la
 * même commande prennent leurs processus dans l'ordre de leur départ, chacun le sien.
 * Un outil d'agent (serveur MCP) ou un lanceur n'est jamais un travail de fond.
 */
function matchProcesses(group: ProjectBackgroundDto, processes: BackgroundProcess[]): void {
  const candidates = processes
    .filter((entry) => entry.conversationId === group.conversationId && entry.command !== null
      && (entry.kind === 'command' || entry.kind === 'detached'))
    .sort((a, b) => a.startedAt - b.startedAt)
  const taken = new Set<string>()
  const byStart = [...group.tasks].sort((a, b) => a.startedAt - b.startedAt)
  for (const task of byStart) {
    if (task.command === null) continue
    const command = summarizeCommandText(task.command)
    const found = candidates.find((entry) => !taken.has(entry.id) && entry.command === command)
    if (!found) continue
    taken.add(found.id)
    task.serviceId = found.id
  }
}
