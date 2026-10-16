import { and, eq, isNull } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { projects } from '@solera/db'
import { journalQuerySchema, type JournalDto } from '@solera/protocol'
import { readJournal } from '../../journal.js'
import { visibilityFilter } from '../../projects/scope.js'
import type { AppContext } from '../context.js'
import { badRequest, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * Le Journal, d'un projet et du portefeuille.
 *
 * Une route serveur et non une lecture côté web, parce que deux des sept sources ne
 * sont pas en base : les fusions se lisent dans git et les audits sur le disque. Le
 * navigateur n'a ni l'un ni l'autre, et les cinq autres demanderaient cinq appels et un
 * tri côté client pour un résultat qui serait alors tronqué différemment à chaque fois.
 *
 * Deux routes et un seul assembleur : F5 et F11 ne diffèrent que par l'ensemble de
 * projets qu'on lui passe, et par la pastille que la page pose en tête de ligne.
 */
export function registerJournalRoutes(app: FastifyInstance, ctx: AppContext): void {
  const window = (query: unknown): number => {
    const parsed = journalQuerySchema.safeParse(query)
    if (!parsed.success) throw badRequest('invalid_query', 'Invalid journal window.')
    return parsed.data.days
  }

  app.get('/api/projects/:projectId/journal', async (request): Promise<JournalDto> => {
    const user = requireUser(request)
    const { projectId } = request.params as { projectId: string }
    const project = ctx.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), visibilityFilter(user.id)))
      .get()
    if (!project) throw notFound('project_not_found', 'Project not found.')

    return readJournal(ctx.db, [project], window(request.query))
  })

  app.get('/api/journal', async (request): Promise<JournalDto> => {
    const user = requireUser(request)
    // Les projets archivés sont dehors, comme sur les quatre autres vues du
    // portefeuille : on les archive précisément pour qu'ils cessent de parler.
    const visible = ctx.db
      .select()
      .from(projects)
      .where(and(visibilityFilter(user.id), isNull(projects.archivedAt)))
      .all()

    return readJournal(ctx.db, visible, window(request.query))
  })
}
