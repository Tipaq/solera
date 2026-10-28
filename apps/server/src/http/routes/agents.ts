import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  agentKindSchema,
  PREFERRED_CLI_RELEASES,
  type AgentAuthDto,
  type AgentKind,
  type ProjectCommandsDto,
  type UsagePeekDto,
} from '@solera/protocol'
import { UNKNOWN_AUTH } from '../../agents/auth.js'
import type { CliInstaller } from '../../agents/cli-install.js'
import type { AgentAdapter, AgentRegistry } from '../../agents/registry.js'
import type { ClaudeAccountStore } from '../../claude-accounts/store.js'
import type { CodexAccountHomes } from '../../codex-accounts/homes.js'
import type { CodexAccountStore } from '../../codex-accounts/store.js'
import type { GrokAccountHomes } from '../../grok-accounts/homes.js'
import type { GrokAccountStore } from '../../grok-accounts/store.js'
import { projectCwd } from '../../workspace.js'
import type { AppContext } from '../context.js'
import { HttpError } from '../errors.js'
import { requireUser } from '../require-user.js'

const commandsQuerySchema = z.object({
  agent: agentKindSchema,
  worktreeId: z.string().optional(),
  refresh: z.string().optional(),
})

/**
 * Une sonde CLI qui échoue vaut 502, jamais une liste vide : renvoyer un catalogue
 * en dur ou un tableau nu mentirait sur ce qui est réellement disponible. Absent, non
 * authentifié ou trop lent, le CLI échoue toujours de la même façon.
 */
function cliUnavailable(
  adapter: AgentAdapter,
  code: string,
  message: string,
  err: unknown,
): HttpError {
  return new HttpError(502, code, message, {
    label: adapter.label,
    error: err instanceof Error ? err.message : String(err),
  })
}

export function registerAgentRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  registry: AgentRegistry,
  installer: CliInstaller,
  claudeAccounts: ClaudeAccountStore,
  codexAccounts: { store: CodexAccountStore; homes: CodexAccountHomes },
  grokAccounts: { store: GrokAccountStore; homes: GrokAccountHomes },
): void {
  /** Le nom du CLI vient de la requête : un inconnu vaut 404, pas un défaut silencieux. */
  /**
   * Ce qui désigne un compte supplémentaire au CLI, résolu avec son propriétaire :
   * l'identifiant vient du navigateur, et celui d'un autre utilisateur ne doit rendre
   * ni jeton ni consommation. Null pour un compte inconnu, ou un CLI sans comptes.
   */
  const accountCredential = (agent: string, userId: string, accountId: string): string | null => {
    if (agent === 'claude') {
      // Le dossier de sa jauge s'il en a une ; une chaîne vide dit « compte connu, sans
      // jauge », et l'adaptateur répond sans sonder.
      const account = claudeAccounts.find(userId, accountId)
      if (!account) return null
      return account.gauge && claudeAccounts.gauges ? claudeAccounts.gauges.path(accountId) : ''
    }
    if (agent === 'codex') {
      const account = codexAccounts.store.find(userId, accountId)
      return account && account.status === 'ready' ? codexAccounts.homes.ensure(accountId) : null
    }
    if (agent === 'grok') {
      const account = grokAccounts.store.find(userId, accountId)
      return account && account.status === 'ready' ? grokAccounts.homes.ensure(accountId) : null
    }
    return null
  }
  /**
   * Vrai quand le compte appartient à l'utilisateur, sans rien résoudre ni créer : la
   * connexion du CLI (null) est partagée, un compte supplémentaire n'est qu'à son
   * propriétaire.
   */
  const ownsAccount = (agent: AgentKind, userId: string, accountId: string | null): boolean => {
    if (accountId === null) return true
    if (agent === 'claude') return claudeAccounts.find(userId, accountId) !== undefined
    if (agent === 'codex') return codexAccounts.store.find(userId, accountId) !== undefined
    if (agent === 'grok') return grokAccounts.store.find(userId, accountId) !== undefined
    return false
  }
  const resolveAdapter = (agent: string): AgentAdapter => {
    const adapter = registry.find(agent)
    if (!adapter) throw new HttpError(404, 'unknown_agent', 'Unknown CLI: {agent}.', { agent })
    return adapter
  }
  const paramsAgent = (params: unknown) => (params as { agent: string }).agent

  /**
   * Présence et version des CLI, tous agents confondus.
   *
   * Solera ne transporte plus les binaires : ils viennent du système, donc l'écran doit
   * pouvoir dire lequel manque et pourquoi plutôt que de proposer un agent que le serveur
   * échouerait à lancer. `?refresh=1` force la sonde, pour le bouton de rafraîchissement
   * après une installation faite à côté.
   */
  app.get('/api/agents', async (request) => {
    requireUser(request)
    const force = (request.query as { refresh?: string }).refresh === '1'

    // En parallèle : chaque sonde absente coûte une résolution de PATH, chaque sonde
    // présente un lancement de process, et les faire à la queue leu leu ferait attendre
    // l'écran pour rien.
    const agents = await Promise.all(
      registry.all().map(async (adapter) => ({
        ...(await adapter.cli.describe(force)),
        preferredVersion: PREFERRED_CLI_RELEASES[adapter.kind].version,
        install: installer.state(adapter.kind),
      })),
    )
    return { agents }
  })

  /**
   * Connexion de chaque CLI installé et activé, sans ouvrir de session : la page de
   * brouillon la montre à côté du choix du CLI. Un adaptateur qui échoue ou n'a rien de
   * bon marché à dire répond `unknown` pour lui seul, jamais une erreur pour la liste.
   * `?refresh=1` court-circuite les caches.
   */
  app.get('/api/agents/auth', async (request): Promise<{ entries: AgentAuthDto[] }> => {
    requireUser(request)
    const force = (request.query as { refresh?: string }).refresh === '1'

    const entries = await Promise.all(
      registry.all().map(async (adapter): Promise<AgentAuthDto | null> => {
        const cli = await adapter.cli.describe().catch(() => null)
        if (!cli?.enabled || !cli.installed) return null
        const auth = await (adapter.auth?.(force) ?? Promise.resolve(UNKNOWN_AUTH)).catch(() => UNKNOWN_AUTH)
        return {
          agent: adapter.kind,
          account: null,
          status: auth.status,
          method: auth.method,
          plan: auth.plan,
          identity: auth.identity,
        }
      }),
    )
    return { entries: entries.filter((entry) => entry !== null) }
  })

  /**
   * Aperçu gratuit de la consommation : la dernière lecture complète gardée en mémoire et
   * les signaux de limite des vrais tours, par CLI et par compte. Ne sonde jamais — c'est
   * `/api/agents/:agent/usage` qui coûte un process. Seuls la connexion du CLI et les
   * comptes de l'utilisateur y figurent.
   */
  app.get('/api/agents/usage/peek', async (request): Promise<{ entries: UsagePeekDto[] }> => {
    const user = requireUser(request)
    return { entries: registry.usageLedger.peek((agent, account) => ownsAccount(agent, user.id, account)) }
  })

  /**
   * Installe la version testée d'un CLI dans le préfixe que Solera gère.
   *
   * Répond avant la fin : le paquet pèse plusieurs centaines de mégaoctets, et attendre
   * dans la requête la ferait dépendre de la patience d'un proxy. L'avancement se lit
   * sur `GET /api/agents`.
   */
  app.post('/api/agents/:agent/install', async (request, reply) => {
    requireUser(request)
    const adapter = resolveAdapter(paramsAgent(request.params))

    if (!installer.start(adapter.kind)) {
      throw new HttpError(
        409,
        'install_in_progress',
        'An installation of {label} is already in progress.',
        { label: adapter.label },
      )
    }
    return reply.status(202).send(installer.state(adapter.kind))
  })

  /**
   * Consommation du compte. Lue à la demande plutôt que poussée : chaque lecture
   * démarre un process CLI, et la valeur n'intéresse que le moment où on l'ouvre.
   * `?refresh=1` court-circuite le cache, pour le bouton de rafraîchissement.
   * `?account=` lit celle d'un compte supplémentaire de l'utilisateur, sous son jeton.
   */
  app.get('/api/agents/:agent/usage', async (request) => {
    const user = requireUser(request)
    const adapter = resolveAdapter(paramsAgent(request.params))
    const { refresh, account } = request.query as { refresh?: string; account?: string }
    const force = refresh === '1'

    try {
      if (!account) {
        const usage = await adapter.usage(force)
        registry.usageLedger.recordProbe(adapter.kind, null, usage)
        return usage
      }
      const credential = accountCredential(adapter.kind, user.id, account)
      if (credential === null || !adapter.usageForAccount) {
        throw new HttpError(404, 'agent_account_not_found', 'Unknown account for this CLI.')
      }
      const usage = await adapter.usageForAccount(account, credential, force)
      // Gardée pour l'aperçu gratuit, sous le compte qui l'a produite.
      registry.usageLedger.recordProbe(adapter.kind, account, usage)
      return usage
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw cliUnavailable(
        adapter,
        'usage_unavailable',
        'Could not read usage from {label}: {error}.',
        err,
      )
    }
  })

  app.get('/api/agents/:agent/models', async (request) => {
    requireUser(request)
    const adapter = resolveAdapter(paramsAgent(request.params))

    try {
      return await adapter.models()
    } catch (err) {
      throw cliUnavailable(
        adapter,
        'model_list_unavailable',
        'Could not read models from {label}: {error}.',
        err,
      )
    }
  })

  /**
   * Commandes en `/` proposables depuis le brouillon d'une conversation.
   *
   * Le fil reçoit sa liste du runner au premier tour ; avant ce tour il n'y a ni session
   * ni journal, seulement un dossier et un CLI choisi. Portée par le projet comme
   * `/files`, et lue dans le même dossier que lui : les commandes de projet vivent dans
   * l'arbre. `?refresh=1` court-circuite le cache, comme pour `/usage`.
   */
  app.get('/api/projects/:id/commands', async (request): Promise<ProjectCommandsDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const { agent, worktreeId, refresh } = commandsQuerySchema.parse(request.query)
    const cwd = projectCwd(ctx.db, id, user.id, worktreeId)
    const adapter = resolveAdapter(agent)

    try {
      return await adapter.commands(cwd, refresh === '1')
    } catch (err) {
      throw cliUnavailable(
        adapter,
        'command_list_unavailable',
        'Could not read commands from {label}: {error}.',
        err,
      )
    }
  })
}
