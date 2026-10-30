import type { GitRepoDto } from '@solera/protocol'
import { subsequenceGaps } from '../subsequence.js'
import { ForgeClient, PER_PAGE, type ApiForge } from './forges.js'

/**
 * Les dépôts auxquels un jeton donne accès, pour la combobox de création de projet.
 *
 * La liste est rapatriée en une fois puis filtrée en mémoire, plutôt que d'interroger
 * l'API de recherche de la forge à chaque frappe. Trois raisons : celle de GitHub est
 * limitée à trente requêtes par minute, son qualificatif `user:` rate les dépôts
 * d'organisation auxquels le compte a accès, et un filtrage local répond sans latence.
 */

/** Dix pages, soit mille dépôts. Au-delà, la combobox n'est plus le bon outil. */
const MAX_PAGES = 10

/**
 * Durée de vie du cache.
 *
 * Assez long pour qu'une session de création de projet ne rappelle pas l'API à chaque
 * ouverture du formulaire, assez court pour qu'un dépôt créé à l'instant apparaisse
 * sans qu'il faille redémarrer Solera.
 */
const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  repos: GitRepoDto[]
  truncated: boolean
  fetchedAt: number
}

export class RepoCatalog {
  private readonly cache = new Map<string, CacheEntry>()

  constructor(
    private readonly client: ForgeClient = new ForgeClient(),
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Les dépôts du compte sur cet hôte, filtrés par `query`.
   *
   * Le cache est indexé par utilisateur et par hôte : deux comptes de la même instance
   * ont deux jetons et ne voient pas les mêmes dépôts, et un même compte peut avoir
   * GitHub et la GitLab de son entreprise.
   */
  async search(
    ownerId: string,
    forge: ApiForge,
    host: string,
    token: string,
    query: string,
  ): Promise<{ repos: GitRepoDto[]; truncated: boolean }> {
    const key = cacheKey(ownerId, host)
    const cached = this.cache.get(key)
    const entry =
      cached && this.now() - cached.fetchedAt < CACHE_TTL_MS
        ? cached
        : await this.load(key, forge, host, token)

    return { repos: filter(entry.repos, query), truncated: entry.truncated }
  }

  /** Après l'écriture ou la suppression d'un jeton, ce qui est en cache ne vaut plus. */
  forget(ownerId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(cacheKey(ownerId, ''))) this.cache.delete(key)
    }
  }

  private async load(key: string, forge: ApiForge, host: string, token: string): Promise<CacheEntry> {
    const repos: GitRepoDto[] = []
    let truncated = false

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const batch = await this.client.reposPage(forge, host, token, page)
      repos.push(...batch)

      if (batch.length < PER_PAGE) break
      if (page === MAX_PAGES) truncated = true
    }

    const entry: CacheEntry = { repos, truncated, fetchedAt: this.now() }
    this.cache.set(key, entry)
    return entry
  }
}

/** Le séparateur ne peut figurer ni dans un identifiant ni dans un hôte. */
const cacheKey = (ownerId: string, host: string) => `${ownerId}\0${host}`

/** Sans requête, l'ordre de la forge est déjà le bon : le plus récemment actif d'abord. */
function filter(repos: GitRepoDto[], query: string): GitRepoDto[] {
  const trimmed = query.trim()
  if (!trimmed) return repos.slice(0, 50)

  return repos
    .map((repo) => ({ repo, rank: rank(repo, trimmed) }))
    .filter((entry): entry is { repo: GitRepoDto; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 50)
    .map(({ repo }) => repo)
}

function rank(repo: GitRepoDto, query: string): number | null {
  // Le nom seul d'abord : qui tape « solera » cherche `moi/solera`, pas un dépôt dont
  // le propriétaire contient ces lettres. Le nom complet ne sert qu'ensuite, pour que
  // « marl/sil » reste possible.
  const onName = subsequenceGaps(repo.name, query)
  if (onName !== null) return onName * 4 + repo.name.length

  const onFullName = subsequenceGaps(repo.fullName, query)
  if (onFullName === null) return null
  return onFullName * 4 + repo.fullName.length + 100
}
