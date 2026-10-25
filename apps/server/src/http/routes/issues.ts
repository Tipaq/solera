import { count, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { cardIssues, cards, issueSources, projects, type IssueSourceRow, type ProjectRow } from '@solera/db'
import {
  issueSourceBodySchema,
  type CardIssueCommentsDto,
  type IssueSourceDto,
} from '@solera/protocol'
import { repositoryOf } from '../../issues/links.js'
import type { IssueSources } from '../../issues/service.js'
import type { AppContext } from '../context.js'
import { badRequest, forbidden, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * La source externe d'un projet (#84) et les commentaires des cartes qui en viennent.
 *
 * Brancher ou débrancher la source est un geste du propriétaire : c'est son jeton qui lit
 * et qui ferme les issues. Les commentaires se lisent en direct, sans stockage.
 */
export function registerIssueRoutes(app: FastifyInstance, ctx: AppContext, issues: IssueSources): void {
  const loadProject = (projectId: string, userId: string): ProjectRow => {
    const project = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get()
    if (!project || (project.ownerId !== userId && project.visibility !== 'shared')) {
      throw notFound('project_not_found', 'Project not found.')
    }
    return project
  }

  const loadOwned = (projectId: string, userId: string): ProjectRow => {
    const project = loadProject(projectId, userId)
    if (project.ownerId !== userId) {
      throw forbidden('issue_source_forbidden', 'Only the project owner can connect an issue source.')
    }
    return project
  }

  const toDto = (source: IssueSourceRow): IssueSourceDto => {
    const [linked] = ctx.db
      .select({ total: count() })
      .from(cardIssues)
      .where(eq(cardIssues.projectId, source.projectId))
      .all()
    return {
      provider: source.provider,
      repository: source.repository,
      polledAt: source.polledAt,
      error: source.error,
      cardCount: linked?.total ?? 0,
    }
  }

  const readSource = (projectId: string) =>
    ctx.db.select().from(issueSources).where(eq(issueSources.projectId, projectId)).get()

  app.get('/api/projects/:id/issue-source', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadProject(id, user.id)
    const source = readSource(id)
    return source ? toDto(source) : null
  })

  /**
   * Branche le dépôt, ou en change. Changer de dépôt repart de zéro : les curseurs du
   * précédent ne disent rien du nouveau. Les cartes déjà venues gardent leur lien.
   */
  app.put('/api/projects/:id/issue-source', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadOwned(id, user.id)
    const parsed = issueSourceBodySchema.safeParse(request.body ?? {})
    if (!parsed.success) throw badRequest('issue_source_invalid', 'The repository must read owner/name.')
    const body = parsed.data
    const existing = readSource(id)

    if (existing && existing.provider === body.provider && existing.repository === body.repository) {
      return toDto(existing)
    }
    if (existing) {
      ctx.db
        .update(issueSources)
        .set({
          provider: body.provider,
          repository: body.repository,
          issuesCursor: null,
          commentsCursor: null,
          viewer: null,
          polledAt: null,
          error: null,
        })
        .where(eq(issueSources.projectId, id))
        .run()
    } else {
      ctx.db
        .insert(issueSources)
        .values({ projectId: id, provider: body.provider, repository: body.repository, createdBy: user.id, createdAt: Date.now() })
        .run()
    }
    return toDto(readSource(id)!)
  })

  /** Débrancher n'efface rien : les cartes venues de la source restent, avec leur lien. */
  app.delete('/api/projects/:id/issue-source', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadOwned(id, user.id)
    ctx.db.delete(issueSources).where(eq(issueSources.projectId, id)).run()
    return reply.status(204).send()
  })

  /** Relire tout de suite, plutôt qu'attendre la minute. */
  app.post('/api/projects/:id/issue-source/poll', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    loadOwned(id, user.id)
    if (!readSource(id)) throw notFound('issue_source_not_found', 'This project has no issue source.')
    issues.requestPoll(id)
    return reply.status(202).send({ accepted: true })
  })

  /**
   * Les commentaires de l'issue d'une carte, lus en direct. Un outil qui ne répond pas ne
   * casse pas la fiche : la réponse dit l'erreur, et la carte s'affiche sans eux.
   */
  app.get('/api/cards/:id/issue/comments', async (request): Promise<CardIssueCommentsDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const card = ctx.db.select({ projectId: cards.projectId }).from(cards).where(eq(cards.id, id)).get()
    if (!card) throw notFound('card_not_found', 'Card not found.')
    loadProject(card.projectId, user.id)
    const link = ctx.db.select().from(cardIssues).where(eq(cardIssues.cardId, id)).get()
    if (!link) throw notFound('card_issue_not_found', 'This card does not come from an issue.')

    const repository = repositoryOf(link)
    if (!repository) return { comments: [], error: `Adresse d'issue illisible : ${link.url}` }
    try {
      const comments = await issues.adapter(link.provider).comments(repository, link.externalId, issues.tokenFor(card.projectId))
      return {
        comments: comments.map((comment) => ({
          id: comment.id,
          author: comment.author,
          body: comment.body,
          url: comment.url,
          createdAt: Date.parse(comment.createdAt),
        })),
        error: null,
      }
    } catch (err) {
      return { comments: [], error: err instanceof Error ? err.message : String(err) }
    }
  })
}
