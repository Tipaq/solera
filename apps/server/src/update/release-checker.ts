import type { ReleaseNote, VersionInfo } from '@solera/protocol'
import { INSTANCE_PROFILE } from '../instance/profile.js'
import { detectChannel } from './channel.js'
import { CURRENT_VERSION, compareVersions, parseVersion } from './version.js'

/**
 * Dépôt GitHub dont on lit les releases pour proposer une mise à jour : celui de
 * Solera, public depuis le 2026-10-28, qui publie ses propres releases depuis v0.19.0.
 * Jamais celui de Sillage, qui ferait installer le parent par-dessus le fork.
 *
 * L'application de bureau se met à jour seule : le serveur qu'elle embarque ne lit
 * aucune release. `SOLERA_UPDATE_REPO=` (vide) éteint la vérification.
 */
const GITHUB_REPO =
  process.env.SOLERA_UPDATE_REPO ?? (INSTANCE_PROFILE === 'desktop' ? '' : 'Tipaq/solera')

const CACHE_TTL_MS = 60 * 60 * 1000

interface GithubRelease {
  tag_name: string
  name: string | null
  body: string | null
  published_at: string
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: Array<{ name: string; browser_download_url: string }>
}

/**
 * Interroge l'API GitHub pour connaître la dernière version publiée.
 *
 * L'API non authentifiée est limitée à 60 requêtes/heure par IP : le résultat
 * est mis en cache une heure, et en cas d'échec on continue de servir la
 * dernière réponse connue plutôt que de casser l'écran À propos.
 */
export class ReleaseChecker {
  private releases: GithubRelease[] | null = null
  private fetchedAt: number | null = null
  private checkError: VersionInfo['checkError'] = null
  private inflight: Promise<void> | null = null

  async getVersionInfo(forceRefresh = false): Promise<VersionInfo> {
    const stale =
      this.fetchedAt === null || Date.now() - this.fetchedAt > CACHE_TTL_MS
    if (forceRefresh || stale) await this.refresh()

    const installed = CURRENT_VERSION
    const installedParsable = parseVersion(installed) !== null
    const published = (this.releases ?? [])
      .filter((r) => !r.draft && !r.prerelease)
      .sort((a, b) => compareVersions(b.tag_name, a.tag_name))

    const latest = published[0]?.tag_name.replace(/^v/, '') ?? null
    const newer = installedParsable
      ? published.filter((r) => compareVersions(r.tag_name, installed) > 0)
      : []

    return {
      version: installed,
      channel: detectChannel(),
      latest,
      // Une version non parsable (dev) ne doit jamais déclencher de proposition.
      updateAvailable: installedParsable && newer.length > 0,
      releases: newer.map(toNote),
      checkedAt: this.fetchedAt ? new Date(this.fetchedAt).toISOString() : null,
      checkError: this.checkError,
    }
  }

  /** URL du tarball de la release `tag` pour la plateforme courante, si connue. */
  findAsset(tag: string): string | null {
    const release = (this.releases ?? []).find(
      (r) => r.tag_name.replace(/^v/, '') === tag.replace(/^v/, ''),
    )
    if (!release) return null
    const platform = process.platform === 'darwin' ? 'darwin' : 'linux'
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const asset = release.assets.find((a) => a.name.endsWith(`${platform}-${arch}.tar.gz`))
    return asset?.browser_download_url ?? null
  }

  private refresh(): Promise<void> {
    // Une seule requête GitHub à la fois, même si plusieurs clients rafraîchissent.
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async doRefresh(): Promise<void> {
    if (GITHUB_REPO === '') {
      // Vérification éteinte : pas d'erreur à signaler, simplement aucune release
      // connue, donc aucune mise à jour proposée.
      this.releases = []
      this.fetchedAt = Date.now()
      this.checkError = null
      return
    }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'solera-update-checker',
          },
          signal: AbortSignal.timeout(10_000),
        },
      )
      if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
        this.checkError = 'rate_limited'
        return
      }
      if (!res.ok) {
        this.checkError = 'network'
        return
      }
      this.releases = (await res.json()) as GithubRelease[]
      this.fetchedAt = Date.now()
      this.checkError = null
    } catch {
      // Réseau coupé ou timeout : on garde le cache existant et on le signale.
      this.checkError = 'network'
    }
  }
}

function toNote(release: GithubRelease): ReleaseNote {
  return {
    tag: release.tag_name,
    name: release.name ?? release.tag_name,
    publishedAt: release.published_at,
    body: release.body ?? '',
    htmlUrl: release.html_url,
  }
}
