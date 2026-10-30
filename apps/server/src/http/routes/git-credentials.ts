import type { FastifyInstance } from 'fastify'
import {
  GIT_USERNAME,
  GITHUB_HOST,
  gitHostSchema,
  putGitCredentialBodySchema,
  type GitCredentialListDto,
  type GitRepoListDto,
} from '@solera/protocol'
import type { RepoCatalog } from '../../git-credentials/catalog.js'
import { ForgeError, type ForgeClient } from '../../git-credentials/forges.js'
import type { GitCredentialInput, GitCredentialStore } from '../../git-credentials/store.js'
import { HttpError, badRequest, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'

/**
 * Accès aux forges git de l'utilisateur courant.
 *
 * Par compte et non par instance, contrairement aux secrets : cloner un dépôt privé est
 * un geste d'utilisateur. Chacun ne voit et ne modifie donc que ses propres credentials,
 * y compris un administrateur, qui n'a aucune raison d'emprunter le jeton d'un autre.
 *
 * Aucune route ne rend un jeton. Corriger une faute de frappe se fait en le réécrivant,
 * comme pour les secrets.
 */
export function registerGitCredentialRoutes(
  app: FastifyInstance,
  credentials: GitCredentialStore,
  catalog: RepoCatalog,
  forges: ForgeClient,
): void {
  app.get('/api/git-credentials', async (request): Promise<GitCredentialListDto> => {
    const user = requireUser(request)
    return { credentials: credentials.list(user.id) }
  })

  /**
   * `PUT` et non `POST` : écrire un jeton est idempotent, et le remplacer quand il
   * expire est le geste courant, pas l'exception.
   *
   * Pour GitHub et GitLab, le jeton est présenté à la forge avant d'être enregistré :
   * un jeton refusé ne s'écrit pas, et celui qui l'a collé l'apprend ici plutôt qu'au
   * premier clone. Le login que la forge rend est gardé pour l'affichage.
   */
  app.put('/api/git-credentials', async (request, reply) => {
    const user = requireUser(request)
    const body = putGitCredentialBodySchema.parse(request.body)

    let input: GitCredentialInput
    if (body.forge === 'other') {
      input = { ...body, login: null }
    } else {
      const host = body.forge === 'github' ? GITHUB_HOST : body.host
      const login = await forgeCall(() => forges.whoami(body.forge, host, body.token))
      input = { host, username: GIT_USERNAME[body.forge], token: body.token, forge: body.forge, login }
    }

    credentials.put(user.id, input)
    // Le catalogue en cache a été constitué avec le jeton précédent, qui ne donnait
    // peut-être pas accès aux mêmes dépôts.
    catalog.forget(user.id)

    reply.status(204)
  })

  app.delete('/api/git-credentials/:host', async (request, reply) => {
    const user = requireUser(request)
    const { host } = request.params as { host: string }

    // Validé avant d'atteindre la base : l'hôte vient de l'URL, et un motif refusé à
    // l'écriture n'a pas de raison d'être accepté à la suppression.
    if (!credentials.delete(user.id, gitHostSchema.parse(host))) {
      throw notFound('git_credential_not_found', 'No credential for this host.')
    }
    catalog.forget(user.id)

    reply.status(204)
  })

  /**
   * Dépôts accessibles avec le jeton, pour la combobox de création de projet.
   *
   * GitHub et GitLab seulement : chaque forge a sa propre API de listage, et rien dans
   * l'interface ne dépend de cette route, qui n'est qu'un raccourci. Coller une URL
   * reste la voie universelle.
   */
  app.get('/api/git-credentials/:host/repos', async (request): Promise<GitRepoListDto> => {
    const user = requireUser(request)
    const host = gitHostSchema.parse((request.params as { host: string }).host)
    const { q } = request.query as { q?: string }

    const credential = credentials.resolve(user.id, host)
    if (!credential) {
      throw notFound('git_credential_not_found', 'No credential for this host.')
    }
    const { forge } = credential
    if (forge === 'other') {
      throw badRequest(
        'git_repo_listing_unsupported',
        'Repository listing is only available for GitHub and GitLab.',
      )
    }

    return forgeCall(() => catalog.search(user.id, forge, host, credential.token, q ?? ''))
  })
}

/**
 * Un jeton refusé ou une forge injoignable n'est pas une panne de Solera : le code
 * distingue les cas, pour que l'interface dise quoi corriger.
 */
async function forgeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call()
  } catch (err) {
    if (!(err instanceof ForgeError)) throw err
    // 400 pour ce qui se corrige dans le formulaire (le jeton, l'adresse), 502 pour ce
    // qui tient à la forge ou au réseau entre elle et le serveur.
    const status = ['git_forge_token_rejected', 'git_forge_forbidden', 'git_forge_api_missing'].includes(err.code)
      ? 400
      : 502
    throw new HttpError(status, err.code, err.message, err.params)
  }
}
