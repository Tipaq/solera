import { execFile, spawn as spawnProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { spawn as spawnPty, type IPty } from 'node-pty'
import type { ExecutionEnvironment } from '@solera/protocol'
import type { EnvironmentProvider, ExecRequest, ExecResult, PtyRequest, SpawnRequest } from '../provider.js'

/** Le dev container d'un projet, une fois démarré : ce qu'il faut pour y lancer un processus. */
export interface RunningContainer {
  id: string
  /** L'utilisateur sous lequel le `devcontainer.json` fait travailler (`remoteUser`). */
  user: string
  /** Le shell de connexion de cet utilisateur dans le conteneur. */
  loginShell: string
  /** Le dossier du projet sur l'hôte, et là où le `devcontainer.json` le monte. */
  workspace: string
  remoteWorkspaceFolder: string
  /**
   * Le conteneur a les montages de Solera : il l'a créé lui-même. Faux pour un conteneur
   * que VS Code a démarré avant lui : on y ouvre des terminaux, pas de session d'agent.
   */
  solerasMounts: boolean
  /**
   * L'environnement de l'utilisateur dans le conteneur, tel que `devcontainer exec` le
   * compose (`remoteEnv`, `userEnvProbe`) : le PATH d'un nvm ou d'un sdkman y est.
   */
  env: Record<string, string>
  /** Le CLI de chaque agent dans le conteneur, par nom de binaire. */
  agents: Map<string, string>
  /** L'hôte vu du conteneur : `host.docker.internal`, ou la passerelle sous Linux. */
  hostAddress: string
}

/**
 * Les variables qui décrivent l'hôte et non ce que Solera ajoute : le conteneur garde
 * les siennes. Le reste de ce qui diffère de l'environnement du serveur (jetons, homes de
 * compte, origine des processus) traverse.
 */
const HOST_ONLY = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'HOSTNAME',
  '_',
])

/** Le délai laissé à un processus du conteneur pour finir avant d'être tué. */
const KILL_AFTER_S = 3

/** Les shells de l'hôte qu'un terminal ou une action demande : remplacés par celui du conteneur. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'pwsh', 'powershell'])

/**
 * Le dev container d'un projet, non confiné (ADR 0001, #140) : le CLI entier et les
 * terminaux y tournent, par `docker exec`, sous l'utilisateur du `devcontainer.json`.
 *
 * `docker exec` plutôt que `devcontainer exec` à chaque lancement : il prend un dossier
 * de travail, ne relance pas Node ni la lecture de la configuration, et laisse les
 * secrets dans l'environnement du client (`-e NOM` sans valeur) au lieu de la ligne de
 * commande. Ce que `devcontainer exec` ajoute (l'environnement de l'utilisateur) est lu
 * une fois au démarrage du conteneur et rejoué ici.
 *
 * Partagé par toutes les sessions non confinées du projet : `close` ne fait rien, Solera
 * n'arrête jamais le conteneur de lui-même.
 */
export class DevcontainerEnvironment implements EnvironmentProvider {
  readonly environment: ExecutionEnvironment = { where: 'devcontainer', confined: false }

  constructor(
    private readonly container: RunningContainer,
    private readonly docker: string,
    private readonly host: NodeJS.ProcessEnv = process.env,
  ) {}

  get containerId(): string {
    return this.container.id
  }

  spawn(request: SpawnRequest): ChildProcessWithoutNullStreams {
    const { args, env, pidFile } = this.dockerExec(request, false)
    const child = spawnProcess(this.docker, args, {
      env,
      signal: request.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    // Tuer le client `docker exec` ne tue pas ce qu'il a lancé dans le conteneur.
    child.once('exit', () => this.reap(pidFile, this.command(request.command)))
    return child
  }

  spawnPty(request: PtyRequest): IPty {
    const { args, env, pidFile } = this.dockerExec(request, true)
    const pty = spawnPty(this.docker, args, {
      name: request.name,
      cols: request.cols,
      rows: request.rows,
      env: env as Record<string, string>,
    })
    pty.onExit(() => this.reap(pidFile, this.command(request.command)))
    const signal = request.signal
    if (signal) {
      const kill = () => pty.kill()
      signal.addEventListener('abort', kill, { once: true })
      pty.onExit(() => signal.removeEventListener('abort', kill))
    }
    return pty
  }

  exec(request: ExecRequest): Promise<ExecResult> {
    const { args, env, pidFile } = this.dockerExec(request, false)
    return new Promise((resolve, reject) => {
      execFile(
        this.docker,
        args,
        { env, signal: request.signal, timeout: request.timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => {
          this.reap(pidFile, this.command(request.command))
          const code = err ? (err as { code?: unknown }).code : 0
          if (err && typeof code !== 'number') return reject(err)
          resolve({ stdout: String(stdout), stderr: String(stderr), code: typeof code === 'number' ? code : 0 })
        },
      )
    })
  }

  /** Le CLI d'un agent, tel que Solera l'a apporté dans le conteneur ; rien d'autre. */
  resolveBinary(binary: string): string | null {
    return this.container.agents.get(binaryName(binary)) ?? null
  }

  /**
   * Avec les montages de Solera, les dossiers de travail sont au même chemin que sur
   * l'hôte : les liens d'un worktree (`.git`, `gitdir`) restent valides. Sans eux, seul
   * le dossier du projet existe, là où le `devcontainer.json` le monte.
   */
  pathInside(hostPath: string): string {
    if (this.container.solerasMounts) return hostPath
    const relative = posix.relative(this.container.workspace, hostPath)
    if (relative.startsWith('..') || posix.isAbsolute(relative)) return hostPath
    return posix.join(this.container.remoteWorkspaceFolder, relative)
  }

  /** La boucle locale de l'hôte devient l'hôte vu du conteneur. */
  urlOfHost(url: string): string {
    const parsed = new URL(url)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) return url
    parsed.hostname = this.container.hostAddress
    return parsed.toString().replace(/\/$/, '')
  }

  async copyIn(hostPath: string, insidePath: string): Promise<void> {
    await this.dockerCommand(['cp', hostPath, `${this.container.id}:${insidePath}`])
  }

  async copyOut(insidePath: string, hostPath: string): Promise<void> {
    await this.dockerCommand(['cp', `${this.container.id}:${insidePath}`, hostPath])
  }

  async close(): Promise<void> {}

  /**
   * La ligne de `docker exec` d'un lancement. Le processus écrit son pid dans un fichier
   * du conteneur avant de se remplacer par la commande : c'est ce qui permet de le tuer
   * quand le client meurt.
   */
  private dockerExec(request: SpawnRequest, tty: boolean) {
    const pidFile = `/tmp/solera-${randomUUID()}.pid`
    const passed = this.passedEnv(request.env)
    const flags = [
      ...Object.entries(this.container.env).flatMap(([key, value]) => (key in passed ? [] : ['-e', `${key}=${value}`])),
      // Sans valeur : docker la prend dans l'environnement de son client, où on la pose.
      ...Object.keys(passed).flatMap((key) => ['-e', key]),
    ]
    const cwd = request.cwd ? this.pathInside(request.cwd) : this.container.remoteWorkspaceFolder
    const args = [
      'exec',
      '-i',
      ...(tty ? ['-t'] : []),
      '-u',
      this.container.user,
      '-w',
      cwd,
      ...flags,
      this.container.id,
      '/bin/sh',
      '-c',
      'echo $$ >"$0"; exec "$@"',
      pidFile,
      ...this.commandLine(request, tty),
    ]
    return { args, env: { ...this.host, ...passed }, pidFile }
  }

  /** Une commande de l'hôte, dite dans les termes du conteneur. */
  private commandLine(request: SpawnRequest, tty: boolean): string[] {
    const command = this.command(request.command)
    // Un terminal vide : le shell de connexion, qui charge le profil du conteneur.
    if (command === this.container.loginShell && request.args.length === 0 && tty) return [command, '-l']
    return [command, ...request.args]
  }

  private command(command: string): string {
    return SHELLS.has(binaryName(command)) && !this.container.agents.has(binaryName(command))
      ? this.container.loginShell
      : command
  }

  /** Ce que Solera ajoute à l'environnement du serveur, sans ce qui ne vaut que pour l'hôte. */
  private passedEnv(env: NodeJS.ProcessEnv | undefined): Record<string, string> {
    if (!env) return {}
    const passed: Record<string, string> = {}
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined || HOST_ONLY.has(key) || key.startsWith('DOCKER_')) continue
      if (this.host[key] === value) continue
      passed[key] = value
    }
    return passed
  }

  /**
   * Tue le processus d'un lancement s'il vit encore, avec tout son groupe : un shell
   * interactif ignore SIGTERM, et une action `pnpm dev` a des enfants qui tiennent un
   * port. HUP et TERM d'abord, KILL si le groupe vit encore après `KILL_AFTER_S`.
   * Vérifie d'abord que ce pid porte toujours la commande lancée : un pid peut avoir
   * été repris. `docker exec` fait de son processus le chef de sa session et de son
   * groupe, avec ou sans terminal : le groupe porte donc son pid.
   */
  private reap(pidFile: string, command: string): void {
    const script =
      'f="$0"; c="$1"; [ -f "$f" ] || exit 0; p=$(cat "$f"); rm -f "$f"; ' +
      '[ -r "/proc/$p/cmdline" ] && tr "\\000" " " <"/proc/$p/cmdline" | grep -qF -- "$c" || exit 0; ' +
      'kill -HUP "-$p" 2>/dev/null; kill -TERM "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null; ' +
      `i=0; while [ $i -lt ${KILL_AFTER_S * 10} ] && kill -0 "-$p" 2>/dev/null; do sleep 0.1; i=$((i+1)); done; ` +
      'kill -KILL "-$p" 2>/dev/null; exit 0'
    execFile(
      this.docker,
      ['exec', '-u', 'root', this.container.id, '/bin/sh', '-c', script, pidFile, command],
      { timeout: (KILL_AFTER_S + 15) * 1000, windowsHide: true },
      () => undefined,
    )
  }

  private dockerCommand(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(this.docker, args, { timeout: 120_000, windowsHide: true }, (err, _stdout, stderr) =>
        err ? reject(new Error(String(stderr).trim() || err.message)) : resolve(),
      )
    })
  }
}

/** `claude`, `/usr/bin/zsh`, `C:\…\codex.cmd` → `claude`, `zsh`, `codex`. */
export function binaryName(command: string): string {
  const base = command.split(/[\\/]/).pop() ?? command
  return base.replace(/\.(cmd|bat|exe)$/i, '')
}
