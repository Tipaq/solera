import { execFile, spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { copyFile, cp, lstat, mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, posix } from 'node:path'
import { spawn as spawnPty, type IPty } from 'node-pty'
import { HOST_CONFINED_ENVIRONMENT, type ExecutionEnvironment } from '@solera/protocol'
import { resolveBinary } from '../../agents/cli-binary.js'
import type { EnvironmentProvider, ExecRequest, ExecResult, PtyRequest, SpawnRequest } from '../provider.js'
import type { Backend, Launch, PrivateDirs } from './backend.js'
import { confinedEnv, confinementPlan, type ConfinementPlan, type ConfinementScope } from './plan.js'
import { executableRoot, isWithin, realPathOf } from './paths.js'

const PRIVATE_PREFIX = 'solera-confined-'

/** Un processus lancé dans le bac à sable, et de quoi le tuer avec tout ce qu'il a lancé. */
interface Tracked {
  kill(): void
}

/**
 * L'hôte, confiné (ADR 0001, #144) : la chaîne d'outils de l'hôte en lecture seule,
 * l'écriture limitée aux dossiers de travail, un home et un tmp privés, aucun
 * identifiant de l'hôte, le réseau ouvert.
 *
 * Une instance par propriétaire : le runner d'une session, un terminal. Chaque lancement
 * est un bac à sable neuf, qui partage le home et le tmp privés des autres lancements de
 * la même instance. `close` tue tout ce qu'elle a lancé et efface ses dossiers privés :
 * c'est la fin de la session.
 */
export class ConfinedEnvironment implements EnvironmentProvider {
  readonly environment: ExecutionEnvironment = HOST_CONFINED_ENVIRONMENT
  private dirs: PrivateDirs | null = null
  private readonly plans = new Map<string, ConfinementPlan>()
  private readonly live = new Set<Tracked>()
  private closed = false

  constructor(
    private readonly backend: Backend,
    private readonly scope: ConfinementScope,
    private readonly host: { env: NodeJS.ProcessEnv; home: string } = { env: process.env, home: homedir() },
  ) {}

  spawn(request: SpawnRequest): ChildProcessWithoutNullStreams {
    const wrapped = this.wrap(request, false)
    const child = spawnProcess(wrapped.command, wrapped.args, {
      cwd: request.cwd,
      env: wrapped.env,
      signal: request.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: wrapped.detached,
    })
    this.track(child.pid, wrapped.detached, () => child.kill('SIGKILL'), (done) => child.once('exit', done))
    return child
  }

  spawnPty(request: PtyRequest): IPty {
    const wrapped = this.wrap(request, true)
    const pty = spawnPty(wrapped.command, wrapped.args, {
      name: request.name,
      cols: request.cols,
      rows: request.rows,
      cwd: request.cwd,
      env: wrapped.env,
    })
    // Un pseudo-terminal est chef de son groupe : seatbelt tue le groupe, bwrap n'a qu'à
    // tuer son processus extérieur.
    this.track(pty.pid, this.backend.name === 'seatbelt', () => pty.kill('SIGKILL'), (done) => pty.onExit(done))
    const signal = request.signal
    if (signal) {
      const kill = () => pty.kill()
      signal.addEventListener('abort', kill, { once: true })
      pty.onExit(() => signal.removeEventListener('abort', kill))
    }
    return pty
  }

  exec(request: ExecRequest): Promise<ExecResult> {
    const wrapped = this.wrap(request, false)
    return new Promise((resolve, reject) => {
      const child = execFile(
        wrapped.command,
        wrapped.args,
        { cwd: request.cwd, env: wrapped.env, signal: request.signal, timeout: request.timeoutMs, killSignal: 'SIGKILL' },
        (err, stdout, stderr) => {
          const code = err ? (err as { code?: unknown }).code : 0
          if (err && typeof code !== 'number') return reject(err)
          resolve({ stdout: String(stdout), stderr: String(stderr), code: typeof code === 'number' ? code : 0 })
        },
      )
      this.track(child.pid, false, () => child.kill('SIGKILL'), (done) => child.once('exit', done))
    })
  }

  /** La chaîne d'outils est celle de l'hôte : le CLI s'y cherche de la même façon. */
  resolveBinary(binary: string, managedDir: string): string | null {
    return resolveBinary(binary, managedDir)
  }

  /** Les dossiers de travail sont montés à leur propre chemin. */
  pathInside(hostPath: string): string {
    return hostPath
  }

  urlOfHost(url: string): string {
    return url
  }

  async copyIn(hostPath: string, insidePath: string): Promise<void> {
    const target = this.hostPathOf(insidePath)
    if (hostPath !== target) await cp(hostPath, target, { recursive: true })
  }

  async copyOut(insidePath: string, hostPath: string): Promise<void> {
    const source = this.hostPathOf(insidePath)
    if (source !== hostPath) await cp(source, hostPath, { recursive: true })
  }

  /**
   * Les pièces jointes d'un message, rendues lisibles : leur dossier mêle celles de tous
   * les projets, il n'est donc pas monté. Chacune est copiée dans le tmp privé, et le
   * chemin que l'agent reçoit est celui de la copie. Une image envoyée en ligne n'a pas
   * besoin de chemin : le serveur la lit sur l'hôte.
   */
  async shareAttachments<T extends { id: string; filename: string; path: string; inlineImage: boolean }>(
    attachments: T[],
  ): Promise<T[]> {
    return Promise.all(
      attachments.map(async (attachment) => {
        if (attachment.inlineImage) return attachment
        const inside = posix.join(
          this.backend.tmp(this.privateDirs()),
          'solera-attachments',
          attachment.id,
          basename(attachment.filename) || 'file',
        )
        const target = this.hostPathOf(inside)
        await mkdir(dirname(target), { recursive: true })
        await copyFile(attachment.path, target)
        return { ...attachment, path: inside }
      }),
    )
  }

  async close(): Promise<void> {
    this.closed = true
    for (const tracked of this.live) tracked.kill()
    this.live.clear()
    if (this.dirs) await rm(this.dirs.root, { recursive: true, force: true })
    this.dirs = null
    for (const plan of this.plans.values()) {
      for (const placeholder of plan.placeholders) await removeEmptyFile(placeholder)
    }
  }

  /** Ce que le bac à sable voit : utile aux tests et au diagnostic. */
  planFor(path: string): ConfinementPlan {
    let plan = this.plans.get(path)
    if (!plan) {
      plan = confinementPlan({
        scope: this.scope,
        path,
        home: this.host.home,
        coveredRoots: this.backend.coveredRoots,
        deniedRoots: this.backend.deniedRoots,
      })
      this.plans.set(path, plan)
    }
    return plan
  }

  private wrap(request: SpawnRequest, pty: boolean) {
    if (this.closed) throw new Error('This confined environment is closed.')
    const dirs = this.privateDirs()
    const requestedPath = request.env?.PATH ?? this.host.env.PATH ?? ''
    const plan = this.planFor(requestedPath)
    const env = confinedEnv(request.env, this.host.env, {
      ...plan.env,
      PATH: plan.toolchain.pathEntries.length > 0 ? plan.toolchain.pathEntries.join(':') : '/usr/local/bin:/usr/bin:/bin',
      HOME: this.backend.home(dirs),
      TMPDIR: this.backend.tmp(dirs),
    })
    // Le CLI et son interpréteur peuvent vivre hors du `PATH` : dans les données de
    // Solera, ou dans le paquet que le SDK désigne en premier argument.
    const extraReadable = [request.command, request.args[0] ?? '']
      .map((path) => executableRoot(path, this.host.home))
      .filter((root): root is string => root !== null)
    // Par son chemin réel : un lien comme `agents/bin/claude` vit dans un dossier que le
    // bac à sable ne montre pas, seule sa cible y est.
    const command = (request.command.startsWith('/') && realPathOf(request.command)) || request.command
    const launch: Launch = { command, args: request.args, cwd: request.cwd, env, pty }
    return { ...this.backend.wrap(plan, dirs, launch, extraReadable), env }
  }

  private track(
    pid: number | undefined,
    group: boolean,
    killOne: () => void,
    onExit: (done: () => void) => void,
  ): void {
    if (pid === undefined) return
    const tracked: Tracked = {
      kill: () => {
        if (group) {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch {
            // Déjà mort.
          }
        }
        try {
          killOne()
        } catch {
          // Déjà mort.
        }
      },
    }
    this.live.add(tracked)
    // Sous bwrap, la fin du processus extérieur emporte tout le bac à sable. Sous
    // seatbelt, son groupe peut lui survivre : on le garde jusqu'à la fermeture.
    if (!group) onExit(() => this.live.delete(tracked))
  }

  private privateDirs(): PrivateDirs {
    if (this.dirs) return this.dirs
    sweepStalePrivateDirs()
    // Le chemin réel : seatbelt compare des chemins réels (`/private/var/…` sous macOS).
    const root = realpathSync(mkdtempSync(join(tmpdir(), `${PRIVATE_PREFIX}${process.pid}-`)))
    const dirs = { root, home: join(root, 'home'), tmp: join(root, 'tmp') }
    mkdirSync(dirs.home, { mode: 0o700 })
    mkdirSync(dirs.tmp, { mode: 0o700 })
    for (const link of this.scope.homeLinks) {
      const at = join(dirs.home, link.path)
      mkdirSync(dirname(at), { recursive: true })
      symlinkSync(link.target, at)
    }
    this.dirs = dirs
    return dirs
  }

  private hostPathOf(insidePath: string): string {
    const dirs = this.privateDirs()
    const path = posix.normalize(insidePath)
    const home = this.backend.home(dirs)
    const tmp = this.backend.tmp(dirs)
    if (isWithin(path, home)) return join(dirs.home, posix.relative(home, path))
    if (isWithin(path, tmp)) return join(dirs.tmp, posix.relative(tmp, path))
    return path
  }
}

let swept = false

/**
 * Les dossiers privés laissés par un serveur mort sans fermer ses bacs à sable. Le pid
 * dans le nom les attribue : ceux d'une autre instance vivante ne sont pas touchés.
 */
function sweepStalePrivateDirs(): void {
  if (swept) return
  swept = true
  let names: string[]
  try {
    names = readdirSync(tmpdir())
  } catch {
    return
  }
  for (const name of names) {
    const pid = Number(/^solera-confined-(\d+)-/u.exec(name)?.[1])
    if (!pid || pid === process.pid || alive(pid)) continue
    try {
      rmSync(join(tmpdir(), name), { recursive: true, force: true })
    } catch {
      // Un autre utilisateur, ou déjà parti.
    }
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Retire un `.git` posé par le confinement, s'il est resté le fichier vide qu'on a posé. */
async function removeEmptyFile(path: string): Promise<void> {
  try {
    const stats = await lstat(path)
    if (stats.isFile() && stats.size === 0) await rm(path)
  } catch {
    // Déjà parti.
  }
}
