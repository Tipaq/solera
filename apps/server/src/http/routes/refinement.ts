import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { cards, projects } from '@solera/db'
import type { CardRefinementDetailDto } from '@solera/protocol'
import { readRefinementDetail } from '../../cards/refinement.js'
import type { EventLog } from '../../events/event-log.js'
import type { AppContext } from '../context.js'
import { notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * L'affinage d'une carte lu hors du fil (#184) : la page d'un jalon résume sa session
 * d'affinage — état, questions, brouillon — sans ouvrir la conversation.
 *
 * À part des routes de cartes parce qu'il lit le journal. Lisible par qui voit le projet ;
 * trancher le brouillon ou le changement reste aux routes de décision de la conversation,
 * réservées au propriétaire.
 */
export function registerRefinementRoutes(app: FastifyInstance, ctx: AppContext, log: EventLog): void {
  app.get('/api/cards/:id/refinement', async (request): Promise<CardRefinementDetailDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const card = ctx.db.select({ projectId: cards.projectId }).from(cards).where(eq(cards.id, id)).get()
    const project = card
      ? ctx.db.select({ ownerId: projects.ownerId, visibility: projects.visibility }).from(projects).where(eq(projects.id, card.projectId)).get()
      : undefined
    if (!project || (project.ownerId !== user.id && project.visibility !== 'shared')) {
      throw notFound('card_not_found', 'Card not found.')
    }
    return readRefinementDetail(ctx.db, log, id)
  })
}
