import type { FastifyInstance } from 'fastify'
import {
  createClaudeAccountBodySchema,
  startClaudeLoginBodySchema,
  submitClaudeLoginCodeBodySchema,
  updateClaudeAccountBodySchema,
  claudeSecretKind,
  type ClaudeAccount,
  type ClaudeAccountListDto,
  type ClaudeLoginStatusDto,
} from '@solera/protocol'
import type { ClaudeIdentify } from '../../claude-accounts/identity.js'
import type { ClaudeLoginService } from '../../claude-accounts/login.js'
import type { ClaudeAccountStore } from '../../claude-accounts/store.js'
import { HttpError, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * Comptes Claude supplémentaires de l'utilisateur courant.
 *
 * Par compte Solera et non par instance, comme les credentials git : un jeton de
 * `setup-token` ou une clé API engage l'abonnement ou la facture de quelqu'un.
 * Chacun ne voit et ne modifie que les siens, administrateur compris.
 *
 * Aucune route ne rend un secret. Il se remplace entier quand il expire, au bout d'un
 * an pour un jeton, ce qui est le geste courant.
 *
 * Un abonnement est nommé par son adresse, que `identify` lit sous le jeton : un jeton
 * collé d'une adresse déjà connue est refusé, et un jeton qui remplace celui d'un compte
 * doit mener à la même adresse. Une clé API n'a pas d'adresse, son alias la nomme.
 */
export function registerClaudeAccountRoutes(
  app: FastifyInstance,
  accounts: ClaudeAccountStore,
  login: ClaudeLoginService,
  identify: ClaudeIdentify | null = null,
): void {
  const unknownLogin = () => notFound('claude_login_not_found', 'Unknown sign-in.')
  const unknownAccount = () => notFound('claude_account_not_found', 'Unknown Claude account.')

  /** L'adresse d'un jeton collé ; une clé API n'en a pas. */
  const emailOf = async (token: string): Promise<string | null> => {
    if (claudeSecretKind(token) !== 'oauth' || !identify) return null
    const email = await identify({ token })
    if (!email) {
      throw new HttpError(400, 'claude_account_unidentified', 'Claude could not tell which account this token belongs to. It may be revoked.')
    }
    return email
  }

  app.get('/api/claude-accounts', async (request): Promise<ClaudeAccountListDto> => {
    const user = requireUser(request)
    return { accounts: accounts.list(user.id) }
  })

  app.post('/api/claude-accounts', async (request, reply): Promise<ClaudeAccount> => {
    const user = requireUser(request)
    const body = createClaudeAccountBodySchema.parse(request.body)
    const alias = body.alias ?? null
    if (claudeSecretKind(body.token) === 'apiKey' && !alias) {
      throw new HttpError(400, 'claude_account_alias_required', 'An API key has no address: give it a name.')
    }
    const email = await emailOf(body.token)
    const existing = email ? accounts.findByEmail(user.id, email) : undefined
    if (existing) {
      throw new HttpError(409, 'claude_account_email_taken', '{email} is already connected. Reconnect that account instead.', { email: email! })
    }

    reply.status(201)
    return accounts.create(user.id, { email, alias }, body.token)
  })

  /**
   * Connexion guidée d'un abonnement : lance `claude setup-token`, rend l'URL à
   * ouvrir ; le code que la page affiche revient par la route suivante, et le compte
   * naît quand le CLI a imprimé le jeton.
   */
  app.post('/api/claude-accounts/login', async (request, reply): Promise<ClaudeLoginStatusDto> => {
    const user = requireUser(request)
    const body = startClaudeLoginBodySchema.parse(request.body)
    reply.status(201)
    return login.start(user.id, body.alias ?? null)
  })

  /**
   * Reconnexion d'un abonnement : la même connexion guidée, dont le jeton remplace celui
   * du compte s'il mène à la même adresse.
   */
  app.post('/api/claude-accounts/:id/reconnect', async (request, reply): Promise<ClaudeLoginStatusDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const account = accounts.find(user.id, id)
    if (!account) throw unknownAccount()
    if (account.kind !== 'oauth') {
      throw new HttpError(400, 'claude_account_not_oauth', 'An API key is replaced, not reconnected.')
    }
    reply.status(201)
    return login.start(user.id, null, id)
  })

  app.get('/api/claude-accounts/login/:loginId', async (request): Promise<ClaudeLoginStatusDto> => {
    const user = requireUser(request)
    const { loginId } = request.params as { loginId: string }
    const status = login.status(user.id, loginId)
    if (!status) throw unknownLogin()
    return status
  })

  app.post('/api/claude-accounts/login/:loginId/code', async (request): Promise<ClaudeLoginStatusDto> => {
    const user = requireUser(request)
    const { loginId } = request.params as { loginId: string }
    const body = submitClaudeLoginCodeBodySchema.parse(request.body)
    const status = login.submitCode(user.id, loginId, body.code)
    if (!status) throw unknownLogin()
    return status
  })

  app.delete('/api/claude-accounts/login/:loginId', async (request, reply) => {
    const user = requireUser(request)
    const { loginId } = request.params as { loginId: string }
    if (!(await login.cancel(user.id, loginId))) throw unknownLogin()
    reply.status(204)
  })

  /**
   * Jauge d'un abonnement existant : une connexion `claude auth login`, suivie comme la
   * connexion guidée, par les routes `/login/:loginId`. Une clé API n'a pas de forfait.
   */
  app.post('/api/claude-accounts/:id/gauge', async (request, reply): Promise<ClaudeLoginStatusDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const account = accounts.find(user.id, id)
    if (!account) throw unknownAccount()
    if (account.kind !== 'oauth') {
      throw new HttpError(400, 'claude_account_no_plan', 'An API key has no plan limits to read.')
    }
    reply.status(201)
    return login.startGauge(user.id, id)
  })

  app.patch('/api/claude-accounts/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const body = updateClaudeAccountBodySchema.parse(request.body)
    const account = accounts.find(user.id, id)
    if (!account) throw unknownAccount()
    if (account.kind === 'apiKey' && body.alias === null && (!body.token || claudeSecretKind(body.token) === 'apiKey')) {
      throw new HttpError(400, 'claude_account_alias_required', 'An API key has no address: it keeps its name.')
    }
    const email = body.token ? await emailOf(body.token) : null
    if (email && account.email && email !== account.email) {
      throw new HttpError(409, 'claude_account_email_mismatch', 'This token belongs to {email}, not {expected}.', { email, expected: account.email })
    }
    const other = email ? accounts.findByEmail(user.id, email) : undefined
    if (other && other.id !== id) {
      throw new HttpError(409, 'claude_account_email_taken', '{email} is already connected. Reconnect that account instead.', { email: email! })
    }
    accounts.update(user.id, id, { ...body, ...(email ? { email } : {}) })
    reply.status(204)
  })

  /**
   * Les conversations qui désignaient ce compte gardent son identifiant : elles
   * repartiront sur la connexion du CLI, avec un avis dans le fil, plutôt que d'être
   * injouables. Les retoucher ici reviendrait à réécrire des configurations une à une.
   */
  app.delete('/api/claude-accounts/:id', async (request, reply) => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }

    if (!accounts.delete(user.id, id)) throw unknownAccount()
    reply.status(204)
  })
}
