import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { cards, projects, type CardRow, type ProjectRow } from '@solera/db'
import { startMilestoneBodySchema, updateMilestoneRunBodySchema } from '@solera/protocol'
import type { MilestoneRuns } from '../../milestones/milestone-runs.js'
import { requireUser } from '../require-user.js'
import type { AppContext } from '../context.js'
import { badRequest, notFound } from '../errors.js'

/**
 * Lancer un jalon (#72) : l'aperçu, le lancement, et la conduite du pilotage (pause,
 * reprise, arrêt, concurrence). Le jalon est une carte parente ; ses enfants partent.
 */
export function registerMilestoneRoutes(app: FastifyInstance, ctx: AppContext, milestones: MilestoneRuns): void {
  const loadParent = (cardId: string, userId: string): { card: CardRow; project: ProjectRow } => {
    const card = ctx.db.select().from(cards).where(eq(cards.id, cardId)).get()
    if (!card) throw notFound('card_not_found', 'Card not found.')
    const project = ctx.db.select().from(projects).where(eq(projects.id, card.projectId)).get()
    if (!project || (project.ownerId !== userId && project.visibility !== 'shared')) {
      throw notFound('card_not_found', 'Card not found.')
    }
    const child = ctx.db.select({ id: cards.id }).from(cards).where(eq(cards.parentId, card.id)).limit(1).get()
    if (!child) throw badRequest('card_not_parent', 'Only a card with child cards can be launched as a milestone.')
    return { card, project }
  }

  app.get('/api/cards/:id/milestone/plan', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { card } = loadParent(id, user.id)
    return milestones.plan(card)
  })

  /** Le pilotage vivant, ou à défaut le dernier ; `null` pour un jalon jamais lancé. */
  app.get('/api/cards/:id/milestone', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { card } = loadParent(id, user.id)
    const run = milestones.latestRun(card.id)
    return run ? milestones.read(run) : null
  })

  app.post('/api/cards/:id/milestone', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = startMilestoneBodySchema.parse(request.body ?? {})
    const { card, project } = loadParent(id, user.id)
    return reply.status(201).send(await milestones.launch(card, project, user.id, body))
  })

  app.patch('/api/cards/:id/milestone', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = updateMilestoneRunBodySchema.parse(request.body ?? {})
    const { card } = loadParent(id, user.id)
    const run = milestones.latestRun(card.id)
    if (!run) throw notFound('milestone_not_running', 'This milestone has not been launched.')
    return milestones.update(run, user.id, body)
  })
}
