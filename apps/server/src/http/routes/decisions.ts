import type { FastifyInstance } from 'fastify'
import { answerDecisionBodySchema } from '@solera/protocol'
import type { Decisions } from '../../decisions/decisions.js'
import { requireUser } from '../require-user.js'

/**
 * Les décisions du compte — celles qui attendent, la réponse — et ce qui
 * t'attend dans l'Activité de la colonne (#121), qui y ajoute les accords en attente.
 */
export function registerDecisionRoutes(app: FastifyInstance, decisions: Decisions): void {
  app.get('/api/awaiting', async (request) => {
    const user = requireUser(request)
    return { requests: decisions.awaiting(user.id) }
  })

  app.get('/api/awaiting/:id/request', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    return decisions.requestEntry(user.id, id)
  })

  app.get('/api/decisions', async (request) => {
    const user = requireUser(request)
    const { status } = request.query as { status?: string }
    return { decisions: decisions.list(user.id, status === 'all' ? 'all' : 'pending') }
  })

  app.get('/api/decisions/:id', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    return decisions.get(user.id, id)
  })

  app.post('/api/decisions/:id/answer', async (request) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    return decisions.answer(user.id, id, answerDecisionBodySchema.parse(request.body))
  })
}
