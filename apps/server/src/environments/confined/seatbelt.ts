import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { posix } from 'node:path'
import { isWithin, realPathOf } from './paths.js'
import type { Backend, Unavailable } from './backend.js'

/** Le `sandbox-exec` du système, toujours par son chemin absolu. */
export const SANDBOX_EXEC = '/usr/bin/sandbox-exec'

/** Darwin 23 est macOS 14, le plus ancien que le confinement accepte. */
const MIN_DARWIN_MAJOR = 23

/** Ce que tout bac à sable lit : la base système de macOS, Homebrew et `/opt`. */
export const SEATBELT_SYSTEM_DIRS = [
  '/bin',
  '/sbin',
  '/usr',
  '/System',
  '/Library',
  '/opt',
  '/private/etc',
  '/private/var/db',
  // `/bin/sh` y choisit le shell qu'il lance.
  '/private/var/select',
]

const XCODE_SELECT_LINK = '/var/db/xcode_select_link'

/** Les sockets et l'état des moteurs de conteneurs : une porte de sortie, jamais ouverte. */
const CONTAINER_ENGINE_HOME_DIRS = ['.docker', '.colima', '.orbstack', '.lima', '.rd']
const CONTAINER_ENGINE_SOCKETS = ['/private/var/run/docker.sock', '/private/var/run/com.docker.vmnetd.sock']

export function probeSeatbelt(): Unavailable | null {
  const major = Number(release().split('.')[0])
  if (Number.isFinite(major) && major < MIN_DARWIN_MAJOR) return { code: 'confinement_macos_too_old' }
  if (!existsSync(SANDBOX_EXEC)) return { code: 'confinement_failed', detail: `${SANDBOX_EXEC} is missing` }
  const result = spawnSync(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', '--', '/usr/bin/true'], {
    stdio: ['ignore', 'ignore', 'pipe'],
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status === 0) return null
  const stderr = (result.stderr ?? '').trim()
  // macOS refuse d'imbriquer deux bacs à sable : Solera lui-même tourne dans un autre.
  if (/Operation not permitted/iu.test(stderr)) return { code: 'confinement_seatbelt_nested', detail: stderr }
  return { code: 'confinement_failed', detail: stderr || result.error?.message || `exit ${String(result.status)}` }
}

/**
 * La base, refus par défaut, d'après la politique de Codex (Apache-2.0,
 * `codex-rs/sandboxing/src/seatbelt_base_policy.sbpl`) telle que Sandcastle la reprend :
 * processus, sysctl en lecture, services système, terminaux, réseau ouvert.
 */
const BASE = String.raw`(version 1)
(deny default)

(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))
(allow process-info* (target same-sandbox))

(allow sysctl-read
  (sysctl-name "hw.activecpu")
  (sysctl-name "hw.byteorder")
  (sysctl-name "hw.cachelinesize_compat")
  (sysctl-name "hw.cpufamily")
  (sysctl-name "hw.cputype")
  (sysctl-name "hw.logicalcpu")
  (sysctl-name "hw.logicalcpu_max")
  (sysctl-name "hw.machine")
  (sysctl-name "hw.memsize")
  (sysctl-name "hw.model")
  (sysctl-name "hw.ncpu")
  (sysctl-name "hw.nperflevels")
  (sysctl-name "hw.pagesize")
  (sysctl-name "hw.pagesize_compat")
  (sysctl-name "hw.physicalcpu")
  (sysctl-name "hw.physicalcpu_max")
  (sysctl-name "hw.vectorunit")
  (sysctl-name "machdep.cpu.brand_string")
  (sysctl-name "kern.argmax")
  (sysctl-name "kern.hostname")
  (sysctl-name "kern.maxfilesperproc")
  (sysctl-name "kern.maxproc")
  (sysctl-name "kern.osproductversion")
  (sysctl-name "kern.osrelease")
  (sysctl-name "kern.ostype")
  (sysctl-name "kern.osvariant_status")
  (sysctl-name "kern.osversion")
  (sysctl-name "kern.secure_kernel")
  (sysctl-name "kern.usrstack64")
  (sysctl-name "kern.version")
  (sysctl-name "sysctl.proc_cputype")
  (sysctl-name "vm.loadavg")
  (sysctl-name-prefix "hw.optional.")
  (sysctl-name-prefix "hw.perflevel")
  (sysctl-name-prefix "kern.proc.pgrp.")
  (sysctl-name-prefix "kern.proc.pid.")
  (sysctl-name-prefix "net.routetable."))

(allow iokit-open (iokit-registry-entry-class "RootDomainUserClient"))
(allow ipc-posix-sem)
(allow ipc-posix-shm-read* (ipc-posix-name "apple.shm.notification_center"))
(allow system-fsctl (fsctl-command FSIOC_CAS_BSDFLAGS))

(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.system.DirectoryService.libinfo_v1")
  (global-name "com.apple.system.logger")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.logd")
  (global-name "com.apple.diagnosticd")
  (global-name "com.apple.secinitd")
  (global-name "com.apple.trustd")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.SecurityServer")
  (global-name "com.apple.networkd")
  (global-name "com.apple.ocspd")
  (global-name "com.apple.SystemConfiguration.DNSConfiguration")
  (global-name "com.apple.SystemConfiguration.configd")
  (global-name "com.apple.PowerManagement.control"))

; Les métadonnées de tout chemin, jamais son contenu.
(allow file-read-metadata)
(allow file-read* (literal "/"))

(allow pseudo-tty)
(allow file-read* file-write* file-ioctl
  (literal "/dev/null")
  (literal "/dev/zero")
  (literal "/dev/tty")
  (literal "/dev/ptmx")
  (literal "/dev/dtracehelper")
  (regex #"^/dev/ttys[0-9]+$"))
(allow file-read* (literal "/dev/random") (literal "/dev/urandom"))
(allow file-read-data file-write-data (subpath "/dev/fd"))

; Réseau ouvert, localhost de l'hôte compris : c'est par lui que passe le MCP de Solera.
(allow network*)
(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))`

export interface SeatbeltPolicy {
  profile: string
  /** Les `-D` : aucun chemin n'est écrit dans le profil, donc rien à échapper. */
  params: Array<[string, string]>
}

/** Les dossiers qui ne doivent être ni renommés ni supprimés : ceux qui portent un fichier protégé. */
function anchoredDirs(writable: readonly string[], protectedPaths: readonly string[]): string[] {
  const dirs = new Set(writable)
  for (const path of protectedPaths) {
    const roots = writable.filter((root) => isWithin(path, root))
    let dir = posix.dirname(path)
    while (roots.some((root) => isWithin(dir, root))) {
      dirs.add(dir)
      const parent = posix.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return [...dirs]
}

export function seatbeltPolicy(input: {
  readable: readonly string[]
  writable: readonly string[]
  protected: readonly string[]
  hostHome: string
}): SeatbeltPolicy {
  const params: Array<[string, string]> = []
  const ref = (prefix: string, value: string) => {
    const key = `${prefix}_${String(params.length)}`
    params.push([key, value])
    return `(param "${key}")`
  }
  const subpaths = (operations: string, refs: string[]) =>
    refs.length === 0 ? [] : [`(allow ${operations}\n${refs.map((r) => `  (subpath ${r})`).join('\n')})`]
  const readable = [...new Set(input.readable)].map((p) => ref('READ', p))
  const writable = [...new Set(input.writable)].map((p) => ref('WRITE', p))
  const engines = [
    ...CONTAINER_ENGINE_SOCKETS.map((socket) => `  (literal ${ref('ENGINE', socket)})`),
    ...CONTAINER_ENGINE_HOME_DIRS.map((name) => `  (subpath ${ref('ENGINE', posix.join(input.hostHome, name))})`),
  ]
  const protectedRefs = [...new Set(input.protected)].map((p) => ref('PROTECTED', p))
  const anchors = anchoredDirs(input.writable, input.protected).map((p) => ref('ANCHOR', p))
  const profile = [
    BASE,
    '; Lecture seule : la chaîne d’outils et ce qu’on donne à lire.',
    ...subpaths('file-read* file-map-executable', readable),
    '; Lecture et écriture : les dossiers de travail, git, le home et le tmp privés.',
    ...subpaths('file-read* file-write* file-map-executable', writable),
    `(deny file-read* file-write* network-outbound process-exec\n${engines.join('\n')})`,
    '(deny mach-lookup (xpc-service-name-prefix ""))',
    '; En dernier, pour que rien au-dessus ne les rouvre : les fichiers de contrôle de git.',
    ...protectedRefs.map((r) => `(deny file-write* (subpath ${r}))`),
    ...anchors.map((r) => `(deny file-write-unlink (require-all (vnode-type DIRECTORY) (literal ${r})))`),
    '(deny system-fcntl (fcntl-command 80 110))',
    '',
  ].join('\n')
  return { profile, params }
}

export const seatbeltBackend: Backend = {
  name: 'seatbelt',
  coveredRoots: SEATBELT_SYSTEM_DIRS,
  deniedRoots: [],
  // Seatbelt ne remonte rien : le home et le tmp privés sont vus à leur chemin d'hôte.
  home: (dirs) => dirs.home,
  tmp: (dirs) => dirs.tmp,
  wrap: (plan, dirs, launch, extraReadable) => {
    const developerDir = realPathOf(XCODE_SELECT_LINK)
    const policy = seatbeltPolicy({
      readable: [
        ...SEATBELT_SYSTEM_DIRS,
        ...(developerDir ? [developerDir] : []),
        ...plan.toolchain.readableDirs,
        ...plan.readable,
        ...extraReadable,
      ],
      writable: [...plan.writable, dirs.home, dirs.tmp],
      protected: plan.protected,
      hostHome: homedir(),
    })
    return {
      command: SANDBOX_EXEC,
      args: [
        '-p',
        policy.profile,
        ...policy.params.map(([key, value]) => `-D${key}=${value}`),
        '--',
        launch.command,
        ...launch.args,
      ],
      // Son propre groupe : la fermeture tue le groupe entier. Un processus qui en sort
      // par `setsid` y échappe, la limite que Sandcastle documente aussi.
      detached: !launch.pty,
    }
  },
}
