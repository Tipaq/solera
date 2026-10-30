import type { GitForge, GitRepoDto } from '@solera/protocol'

/**
 * Ce que Solera sait demander à l'API d'une forge : qui est le titulaire d'un jeton, et
 * à quels dépôts il donne accès.
 *
 * GitHub et GitLab seulement : une forge `other` n'a pas d'API connue, son jeton est
 * rendu à git sans avoir été vérifié. Une forge de plus s'ajoute ici, par un `whoami` et
 * une page de dépôts ; la connexion par OAuth, quand elle viendra, obtiendra un jeton
 * par une autre voie mais le vérifiera de la même façon.
 */

export type ApiForge = Exclude<GitForge, 'other'>

/** L'adresse de l'API, injectable pour que les tests parlent à un faux serveur local. */
export type ApiBase = (forge: ApiForge, host: string) => string

export const defaultApiBase: ApiBase = (forge, host) =>
  forge === 'github' ? 'https://api.github.com' : `https://${host}/api/v4`

/** Cent est le maximum accepté par les deux API ; en demander moins multiplierait les pages. */
export const PER_PAGE = 100

/**
 * Dix secondes : une API qui répond met moins d'une seconde, et une GitLab d'entreprise
 * injoignable (hors VPN, pare-feu qui jette les paquets) ferait sinon attendre le
 * formulaire jusqu'au délai du système, plusieurs minutes.
 */
const TIMEOUT_MS = 10_000

/** Le code est ce que l'interface traduit ; le message anglais n'est qu'un repli. */
export class ForgeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message)
    this.name = 'ForgeError'
  }
}

interface GitHubRepo {
  full_name: string
  name: string
  clone_url: string
  private: boolean
  description: string | null
  pushed_at: string | null
}

interface GitLabProject {
  path_with_namespace: string
  /** Le dernier segment de l'URL, et donc le dossier que git créerait ; `name` peut porter des espaces. */
  path: string
  http_url_to_repo: string
  visibility?: 'private' | 'internal' | 'public'
  description: string | null
  last_activity_at: string | null
}

export class ForgeClient {
  private readonly apiBase: ApiBase
  private readonly timeoutMs: number

  constructor(options: { apiBase?: ApiBase; timeoutMs?: number } = {}) {
    this.apiBase = options.apiBase ?? defaultApiBase
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  }

  /** Le login du titulaire du jeton ; lève une `ForgeError` si la forge le refuse. */
  async whoami(forge: ApiForge, host: string, token: string): Promise<string> {
    if (forge === 'github') {
      const user = (await this.request(forge, host, token, '/user')) as { login?: unknown }
      return this.field(user.login, host)
    }
    const user = (await this.request(forge, host, token, '/user')) as { username?: unknown }
    return this.field(user.username, host)
  }

  /** Une page de dépôts, les plus récemment actifs d'abord. */
  async reposPage(forge: ApiForge, host: string, token: string, page: number): Promise<GitRepoDto[]> {
    if (forge === 'github') {
      const repos = (await this.request(forge, host, token, '/user/repos', {
        per_page: String(PER_PAGE),
        page: String(page),
        // Le tri par date de push met en tête ceux sur lesquels on travaille, ce qui est
        // exactement l'ordre voulu quand la combobox s'ouvre sans qu'on ait rien tapé.
        sort: 'pushed',
        // Sans ce paramètre, l'API ne rend que les dépôts dont le compte est propriétaire,
        // et ceux de ses organisations manqueraient à l'appel.
        affiliation: 'owner,collaborator,organization_member',
      })) as GitHubRepo[]
      return repos.map(fromGitHub)
    }

    const projects = (await this.request(forge, host, token, '/projects', {
      // Les projets dont le compte est membre, et pas tous ceux que l'instance rend
      // visibles : sur GitLab.com, ce serait des millions de projets publics.
      membership: 'true',
      // Pas de `simple=true`, qui allégerait la réponse : il retire `visibility`, et
      // la liste ne saurait plus dire quel dépôt est privé.
      per_page: String(PER_PAGE),
      page: String(page),
      order_by: 'last_activity_at',
    })) as GitLabProject[]
    return projects.map(fromGitLab)
  }

  private async request(
    forge: ApiForge,
    host: string,
    token: string,
    path: string,
    params: Record<string, string> = {},
  ): Promise<unknown> {
    const url = new URL(`${this.apiBase(forge, host)}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    const headers: Record<string, string> =
      forge === 'github'
        ? {
            authorization: `Bearer ${token}`,
            accept: 'application/vnd.github+json',
            'x-github-api-version': '2022-11-28',
            'user-agent': 'solera',
          }
        : // `Bearer` plutôt que `PRIVATE-TOKEN` : GitLab accepte les deux pour un jeton
          // personnel, et seul le premier vaut aussi pour un jeton OAuth.
          { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': 'solera' }

    let response: Response
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) })
    } catch (err) {
      throw offline(host, err, this.timeoutMs)
    }

    if (response.status === 401) {
      throw new ForgeError('git_forge_token_rejected', 'The forge rejected the token.')
    }
    if (response.status === 403) {
      throw new ForgeError('git_forge_forbidden', 'The forge refused the request.')
    }
    // Une adresse qui répond mais pas comme une API de forge : une faute de frappe dans
    // l'hôte d'une GitLab, ou un serveur qui n'en est pas une.
    if (response.status === 404) {
      throw new ForgeError('git_forge_api_missing', '{host} does not answer like this forge.', { host })
    }
    if (!response.ok) {
      throw new ForgeError('git_forge_unreachable', 'The forge answered {status}.', {
        status: `${response.status} ${response.statusText}`,
      })
    }

    try {
      return await response.json()
    } catch {
      throw new ForgeError('git_forge_api_missing', '{host} does not answer like this forge.', { host })
    }
  }

  private field(value: unknown, host: string): string {
    if (typeof value === 'string' && value) return value
    throw new ForgeError('git_forge_api_missing', '{host} does not answer like this forge.', { host })
  }
}

/**
 * Un échec avant toute réponse : la forge n'a rien pu dire du jeton. Le distinguer d'un
 * refus est tout l'intérêt, une GitLab d'entreprise joignable du poste mais pas du
 * serveur ressemblerait sinon à un jeton mal recopié.
 */
function offline(host: string, err: unknown, timeoutMs: number): ForgeError {
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return new ForgeError('git_forge_timeout', '{host} did not answer within {seconds} s.', {
      host,
      seconds: Math.round(timeoutMs / 1000),
    })
  }
  // `fetch` enveloppe la vraie cause (ENOTFOUND, ECONNREFUSED, un certificat refusé)
  // dans un `TypeError: fetch failed` qui ne dit rien.
  const cause = err instanceof Error ? (err.cause as { code?: string; message?: string } | undefined) : undefined
  const reason = cause?.code ?? cause?.message ?? (err instanceof Error ? err.message : String(err))
  return new ForgeError('git_forge_offline', 'Solera could not reach {host} ({reason}).', { host, reason })
}

function fromGitHub(repo: GitHubRepo): GitRepoDto {
  return {
    fullName: repo.full_name,
    name: repo.name,
    cloneUrl: repo.clone_url,
    isPrivate: repo.private,
    description: repo.description,
    pushedAt: repo.pushed_at ? Date.parse(repo.pushed_at) : null,
  }
}

function fromGitLab(project: GitLabProject): GitRepoDto {
  return {
    fullName: project.path_with_namespace,
    name: project.path,
    cloneUrl: project.http_url_to_repo,
    // `internal` est visible de tout compte de l'instance, mais pas du monde : pour qui
    // clone, il se comporte comme un privé.
    isPrivate: project.visibility !== 'public',
    description: project.description || null,
    pushedAt: project.last_activity_at ? Date.parse(project.last_activity_at) : null,
  }
}
