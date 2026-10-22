import type { FastifyInstance } from 'fastify'
import { and, eq, isNull } from 'drizzle-orm'
import { conversations, projects } from '@solera/db'
import {
  paletteFilesQuerySchema,
  type PaletteCatalogDto,
  type PaletteFilesDto,
} from '@solera/protocol'
import { visibilityFilter } from '../../projects/scope.js'
import { searchProjectFiles, type FileSearchTarget } from '../../search/palette-files.js'
import type { SkillLibrary } from '../../skill-library/store.js'
import { conversationWorkspace } from '../../workspace.js'
import type { AppContext } from '../context.js'
import { requireUser } from '../require-user.js'

/**
 * Palette de recherche : ce qu'aucune liste de l'interface ne porte déjà.
 *
 * Projets visibles et non archivés seulement : la palette voit ce que la navigation
 * voit, comme la recherche dans les messages.
 */
export function registerPaletteRoutes(app: FastifyInstance, ctx: AppContext, library: SkillLibrary): void {
  const visibleProjects = (userId: string) =>
    ctx.db
      .select({ id: projects.id, name: projects.name, workspacePath: projects.workspacePath })
      .from(projects)
      .where(and(visibilityFilter(userId), isNull(projects.archivedAt)))
      .all()

  app.get('/api/palette/catalog', async (request): Promise<PaletteCatalogDto> => {
    const user = requireUser(request)
    return { skills: library.summaries(visibleProjects(user.id).map((project) => project.id)) }
  })

  app.get('/api/palette/files', async (request): Promise<PaletteFilesDto> => {
    const user = requireUser(request)
    const { q, conversationId } = paletteFilesQuerySchema.parse(request.query)

    const targets: FileSearchTarget[] = visibleProjects(user.id).map((project) => ({
      projectId: project.id,
      projectName: project.name,
      cwd: project.workspacePath,
    }))

    if (conversationId) {
      const row = ctx.db
        .select({ projectId: conversations.projectId })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get()
      const target = targets.find((entry) => entry.projectId === row?.projectId)
      // `conversationWorkspace` refait le contrôle d'accès ; une conversation que ce
      // compte ne voit pas appartient à un projet qu'il ne voit pas non plus, absent
      // de `targets`, donc rien n'est substitué.
      if (target) target.cwd = conversationWorkspace(ctx.db, conversationId, user.id)
    }

    return { projects: await searchProjectFiles(targets, q) }
  })
}
