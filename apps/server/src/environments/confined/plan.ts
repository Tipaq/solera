import { existsSync } from 'node:fs'
import { gitMounts } from './git.js'
import { hostToolchain, isWithin, outermost, realPathOf, type HostToolchain } from './paths.js'

/**
 * Ce qu'une session ou un terminal confiné doit voir de l'hôte, au-delà de la chaîne
 * d'outils : ce que l'appelant sait et que le fournisseur ne peut pas deviner.
 */
export interface ConfinementScope {
  /**
   * Les dossiers de travail : le dépôt ou le worktree, que l'agent écrit, et dont git
   * n'est inscriptible que pour ce qu'un commit écrit (voir `gitMounts`).
   */
  workspaces: string[]
  /** D'autres dossiers de l'hôte où il écrit : la mémoire du projet, le home du compte. */
  writable: string[]
  /** Lisibles seulement : la bibliothèque de skills, les consignes de l'utilisateur. */
  readable: string[]
  /**
   * Des liens posés dans le home privé (chemin relatif au home) vers un chemin de l'hôte
   * monté par ailleurs : les transcripts de Claude, les consignes de l'utilisateur.
   */
  homeLinks: Array<{ path: string; target: string }>
  /** Des variables propres au confinement : l'identité git que le home privé n'a plus. */
  env: Record<string, string>
}

/** Ce que le fournisseur monte, tout en chemins réels de l'hôte. */
export interface ConfinementPlan {
  toolchain: HostToolchain
  /** Lisibles, en plus des dossiers système. */
  readable: string[]
  /** Inscriptibles : dossiers de travail, dossiers communs de git, ceux de l'appelant. */
  writable: string[]
  /** En lecture seule même dans un dossier inscriptible : ce qui redirige git. */
  protected: string[]
  homeLinks: ConfinementScope['homeLinks']
  env: Record<string, string>
}

export interface PlanInput {
  scope: ConfinementScope
  path: string
  home: string
  coveredRoots: readonly string[]
  deniedRoots: readonly string[]
}

export function confinementPlan({ scope, path, home, coveredRoots, deniedRoots }: PlanInput): ConfinementPlan {
  const real = (paths: string[]) => paths.flatMap((p) => realPathOf(p) ?? [])
  const workspaces = real(scope.workspaces)
  const git = workspaces.map(gitMounts)
  const writable = outermost([...workspaces, ...git.flatMap((g) => g.writable), ...real(scope.writable)])
  // Un fichier de contrôle hors de tout dossier inscriptible n'a pas besoin d'être
  // protégé, et le monter rendrait lisible ce qui ne devait pas l'être.
  const protectedPaths = [...new Set(git.flatMap((g) => g.protected))].filter(
    (p) => existsSync(p) && writable.some((root) => isWithin(p, root)),
  )
  return {
    toolchain: hostToolchain({ path, home, coveredRoots, deniedRoots }),
    readable: outermost([...real(scope.readable), ...git.flatMap((g) => g.readable)]).filter(
      (p) => !writable.some((root) => isWithin(p, root)),
    ),
    writable,
    protected: protectedPaths,
    homeLinks: scope.homeLinks,
    env: scope.env,
  }
}

/**
 * Les variables de l'hôte qu'un processus confiné garde : la langue, le terminal, le
 * proxy et les certificats d'un réseau d'entreprise. Ni jeton ni socket : un agent
 * confiné ne reçoit que ce que Solera lui donne (Sandcastle fait de même).
 */
const KEPT_HOST_VARIABLES = new Set([
  'LANG',
  'LANGUAGE',
  'TERM',
  'COLORTERM',
  'TZ',
  'USER',
  'LOGNAME',
  'SHELL',
  'NO_COLOR',
  'FORCE_COLOR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
])

/**
 * Le seul moyen d'atteindre l'hôte depuis une variable : ses sockets et ses dossiers.
 * Écartées même quand l'appelant les pose.
 */
const HOST_BINDINGS = new Set([
  'SSH_AUTH_SOCK',
  'SSH_AGENT_PID',
  'GPG_AGENT_INFO',
  'DBUS_SESSION_BUS_ADDRESS',
  'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'XDG_STATE_HOME',
  'WSL_INTEROP',
  'DOCKER_HOST',
  'CLAUDE_CONFIG_DIR',
])

/**
 * L'environnement d'un processus confiné, depuis celui que l'appelant passe : ce qu'il a
 * ajouté à celui du serveur (le jeton du compte, l'origine, les réglages du CLI), plus
 * les variables de l'hôte qui ne portent pas de secret. Le reste de l'environnement du
 * serveur (un `GH_TOKEN`, une clé d'API de l'utilisateur) ne passe pas.
 */
export function confinedEnv(
  requested: NodeJS.ProcessEnv | undefined,
  host: NodeJS.ProcessEnv,
  fixed: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(requested ?? host)) {
    if (value === undefined || HOST_BINDINGS.has(key)) continue
    const added = requested !== undefined && host[key] !== value
    if (added || KEPT_HOST_VARIABLES.has(key) || key.startsWith('LC_')) env[key] = value
  }
  return { ...env, ...fixed }
}
