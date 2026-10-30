import type { FastifyInstance } from 'fastify'
import { agentKindSchema, type ClaudeLoginStatusDto, type CodexLoginStatusDto, type GrokLoginStatusDto } from '@solera/protocol'
import type { ClaudeLoginService } from '../../claude-accounts/login.js'
import type { CodexLoginService } from '../../codex-accounts/login.js'
import type { GrokLoginService } from '../../grok-accounts/login.js'
import { HttpError } from '../errors.js'
import { requireAdmin } from '../require-user.js'

/**
 * Connexion propre d'un CLI, menée depuis l'interface plutôt qu'au terminal.
 *
 * Elle est partagée par tous les utilisateurs de l'instance — c'est elle que prennent
 * les sessions sans compte — : la mener, c'est engager un abonnement pour tout le monde.
 * Toutes les routes sont donc réservées à l'administrateur.
 *
 * Claude passe par le dialogue de `ClaudeLoginService` : la réponse porte un `loginId`,
 * et la suite (relecture, code, annulation) emprunte les routes
 * `/api/claude-accounts/login/:loginId`, liées à qui l'a lancée. Codex et Grok passent
 * par le code d'appareil, suivi ici. OpenCode n'a pas de place : son `auth login` fait
 * choisir un fournisseur dans un menu, il reste au terminal.
 */
export function registerAgentLoginRoutes(
  app: FastifyInstance,
  login: {
    claude: Pick<ClaudeLoginService, 'startCli'>
    codex: Pick<CodexLoginService, 'cliStatus' | 'startCliDeviceCode' | 'cancelCli'>
    grok: Pick<GrokLoginService, 'cliStatus' | 'startCliDeviceCode' | 'cancelCli'>
  },
): void {
  const agentOf = (params: unknown) => {
    const parsed = agentKindSchema.safeParse((params as { agent: string }).agent)
    if (!parsed.success) {
      throw new HttpError(404, 'unknown_agent', 'Unknown CLI: {agent}.', { agent: (params as { agent: string }).agent })
    }
    return parsed.data
  }
  const unsupported = () =>
    new HttpError(400, 'agent_login_unsupported', 'This CLI signs in from a terminal only.')
  /** Le service à code d'appareil de ce CLI, ou rien pour ceux qui n'en ont pas. */
  const deviceLogin = (agent: string) => (agent === 'codex' ? login.codex : agent === 'grok' ? login.grok : null)
  /** Ce que le CLI a refusé, tel quel : c'est lui qui sait pourquoi. */
  const refused = (agent: string, err: unknown) =>
    new HttpError(502, `${agent}_login_failed`, agent === 'grok' ? 'Grok could not sign in: {error}.' : 'Codex could not sign in: {error}.', {
      error: err instanceof Error ? err.message : String(err),
    })

  app.post('/api/agents/:agent/login', async (request, reply): Promise<ClaudeLoginStatusDto | CodexLoginStatusDto | GrokLoginStatusDto> => {
    const user = requireAdmin(request)
    const agent = agentOf(request.params)
    if (agent === 'claude') {
      reply.status(201)
      return login.claude.startCli(user.id)
    }
    const device = deviceLogin(agent)
    if (!device) throw unsupported()
    try {
      return await device.startCliDeviceCode()
    } catch (err) {
      throw refused(agent, err)
    }
  })

  app.get('/api/agents/:agent/login', async (request): Promise<CodexLoginStatusDto | GrokLoginStatusDto> => {
    requireAdmin(request)
    const device = deviceLogin(agentOf(request.params))
    if (!device) throw unsupported()
    return device.cliStatus()
  })

  app.delete('/api/agents/:agent/login', async (request, reply) => {
    requireAdmin(request)
    const device = deviceLogin(agentOf(request.params))
    if (!device) throw unsupported()
    await device.cancelCli()
    reply.status(204)
  })
}
