import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readlinkSync } from 'node:fs'
import type { ConfinementPlan } from './plan.js'
import { anchorDirs, isWithin, realPathOf } from './paths.js'
import type { Backend, Launch, PrivateDirs, Unavailable } from './backend.js'

/** Le home privé, vu de l'intérieur. */
export const BWRAP_HOME = '/home/agent'
const BWRAP_TMP = '/tmp'

/** Ce que tout bac à sable voit en lecture seule : la chaîne d'outils du système. */
export const BWRAP_SYSTEM_DIRS = ['/usr', '/etc', '/bin', '/sbin', '/lib', '/lib32', '/lib64', '/libx32', '/opt']

/**
 * Cachés même quand le `PATH` les nomme : les lecteurs Windows et l'interopérabilité de
 * WSL, pour qu'aucun `.exe` ne tourne hors du confinement.
 */
export const BWRAP_DENIED_ROOTS = ['/mnt', '/run/WSL']

const INSTALL_COMMANDS: Array<{ ids: string[]; command: string }> = [
  { ids: ['debian', 'ubuntu'], command: 'sudo apt install bubblewrap' },
  { ids: ['fedora', 'rhel', 'centos', 'rocky', 'almalinux', 'amzn'], command: 'sudo dnf install bubblewrap' },
  { ids: ['arch', 'manjaro', 'endeavouros'], command: 'sudo pacman -S bubblewrap' },
  { ids: ['alpine'], command: 'sudo apk add bubblewrap' },
  { ids: ['opensuse', 'suse', 'sles', 'opensuse-leap', 'opensuse-tumbleweed'], command: 'sudo zypper install bubblewrap' },
]

/** Le profil AppArmor qui rend les espaces de noms à bwrap (Ubuntu 24.04 et suivantes). */
export const APPARMOR_FIX =
  `printf 'abi <abi/4.0>,\\ninclude <tunables/global>\\nprofile bwrap %s flags=(unconfined) {\\n  userns,\\n}\\n' "$(command -v bwrap)"` +
  ' | sudo tee /etc/apparmor.d/bwrap >/dev/null && sudo apparmor_parser -r /etc/apparmor.d/bwrap'

function distroIds(): string[] {
  let osRelease = ''
  for (const file of ['/etc/os-release', '/usr/lib/os-release']) {
    try {
      osRelease = readFileSync(file, 'utf8')
      break
    } catch {
      // Le suivant.
    }
  }
  const field = (name: string) =>
    (new RegExp(`^${name}=(.*)$`, 'mu').exec(osRelease)?.[1] ?? '').replaceAll(/["']/gu, '').trim()
  return [field('ID'), ...field('ID_LIKE').split(/\s+/u)].map((id) => id.toLowerCase()).filter(Boolean)
}

/**
 * Bubblewrap peut-il confiner sur cette machine, et sinon pourquoi et quelle commande
 * lancer. Un essai réel plutôt qu'une lecture de réglages : AppArmor, un noyau sans
 * espaces de noms et un `bwrap` absent se voient tous à l'usage.
 */
export function probeBwrap(): Unavailable | null {
  const result = spawnSync('bwrap', ['--ro-bind', '/', '/', '--unshare-pid', '--dev', '/dev', '--proc', '/proc', 'true'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    timeout: 30_000,
  })
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    const ids = distroIds()
    const known = INSTALL_COMMANDS.find((entry) => entry.ids.some((id) => ids.includes(id)))
    return { code: 'confinement_bwrap_missing', fix: known?.command ?? 'bubblewrap' }
  }
  if (result.status === 0) return null
  const stderr = (result.stderr ?? '').trim()
  // Le profil AppArmor ne sert que si c'est AppArmor qui refuse : un noyau où les
  // espaces de noms sont coupés autrement (`unprivileged_userns_clone`,
  // `max_user_namespaces`) tombe dans le cas général, avec ce que bwrap a dit.
  if (/namespace|uid map|permission denied/iu.test(stderr) && apparmorRestrictsUserns()) {
    return { code: 'confinement_userns_blocked', fix: APPARMOR_FIX, detail: stderr }
  }
  return { code: 'confinement_failed', detail: stderr || result.error?.message || `exit ${String(result.status)}` }
}

function apparmorRestrictsUserns(): boolean {
  try {
    return readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1'
  } catch {
    return false
  }
}

/** Monte chaque dossier système en lecture seule, ou le recrée en lien (`/usr` fusionné). */
function systemDirArgs(): string[] {
  return BWRAP_SYSTEM_DIRS.flatMap((dir) => {
    try {
      return ['--symlink', readlinkSync(dir), dir]
    } catch {
      return existsSync(dir) ? ['--ro-bind', dir, dir] : []
    }
  })
}

/** `/etc/resolv.conf` peut pointer hors des dossiers système (WSL le lie dans `/mnt/wsl`). */
function resolvConfArgs(): string[] {
  const target = realPathOf('/etc/resolv.conf')
  return !target || BWRAP_SYSTEM_DIRS.some((dir) => isWithin(target, dir)) ? [] : ['--ro-bind', target, target]
}

/** Les dossiers qui portent un fichier protégé, montés sur eux-mêmes : un point de montage ne se renomme pas. */
export function anchorArgs(writable: readonly string[], protectedPaths: readonly string[]): string[] {
  return anchorDirs(writable, protectedPaths).flatMap((anchor) => ['--bind', anchor, anchor])
}

/**
 * Les arguments de bwrap pour un lancement : l'hôte en lecture seule pour ce qu'il faut
 * d'outils, `/home` et `/tmp` remplacés, les dossiers de travail inscriptibles à leur
 * propre chemin, puis les fichiers de contrôle de git remontés en lecture seule par-dessus.
 *
 * `--die-with-parent` : tuer le bwrap extérieur, ou le serveur, tue tout l'espace de PID,
 * y compris ce que l'agent a détaché. Le réseau reste partagé. Un pseudo-terminal garde
 * sa session : `--new-session` lui retirerait son terminal de contrôle, et il n'a
 * personne d'autre à qui injecter des frappes.
 */
export function bwrapArgs(plan: ConfinementPlan, dirs: PrivateDirs, launch: Launch, extraReadable: readonly string[]): string[] {
  const writable = plan.writable
  const readable = [...plan.readable, ...plan.toolchain.readableDirs, ...extraReadable].filter(
    (dir) => !BWRAP_SYSTEM_DIRS.some((system) => isWithin(dir, system)) && !writable.some((root) => isWithin(dir, root)),
  )
  return [
    ...systemDirArgs(),
    ...resolvConfArgs(),
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/home',
    '--bind',
    dirs.home,
    BWRAP_HOME,
    '--bind',
    dirs.tmp,
    BWRAP_TMP,
    ...[...new Set(readable)].flatMap((dir) => ['--ro-bind', dir, dir]),
    ...plan.toolchain.symlinks.flatMap((link) => ['--symlink', link.target, link.path]),
    ...writable.flatMap((dir) => ['--bind', dir, dir]),
    ...anchorArgs(writable, plan.protected),
    ...plan.protected.flatMap((path) => ['--ro-bind', path, path]),
    // Le tmpfs qui remplace `/home` n'a servi qu'à porter les points de montage : en
    // lecture seule, l'agent n'écrit que là où on l'a dit.
    '--remount-ro',
    '/home',
    '--clearenv',
    ...Object.entries(launch.env).flatMap(([key, value]) => ['--setenv', key, value]),
    '--unshare-all',
    '--share-net',
    '--die-with-parent',
    ...(launch.pty ? [] : ['--new-session']),
    ...(launch.cwd ? ['--chdir', launch.cwd] : []),
    '--',
    launch.command,
    ...launch.args,
  ]
}

export const bwrapBackend: Backend = {
  name: 'bwrap',
  coveredRoots: BWRAP_SYSTEM_DIRS,
  deniedRoots: BWRAP_DENIED_ROOTS,
  home: () => BWRAP_HOME,
  tmp: () => BWRAP_TMP,
  wrap: (plan, dirs, launch, extraReadable) => ({
    command: 'bwrap',
    args: bwrapArgs(plan, dirs, launch, extraReadable),
    detached: false,
  }),
}
