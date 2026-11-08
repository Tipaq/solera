import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveBinary } from '../../agents/cli-binary.js'
import { launchOf } from '../../agents/launch.js'

const run = promisify(execFile)

/** La version de `@devcontainers/cli` que Solera installe quand le poste n'en a pas. */
export const DEVCONTAINER_CLI = { package: '@devcontainers/cli', version: '0.90.0' }

/** Un `up` qui construit une image peut durer : au-delà, on le dit perdu. */
const UP_TIMEOUT_MS = 30 * 60 * 1000
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000
const DOCKER_TIMEOUT_MS = 30_000

/** Où est la configuration d'un dev container dans un dossier, s'il en a une. */
export function devcontainerConfigOf(workspace: string): string | null {
  for (const candidate of [join(workspace, '.devcontainer', 'devcontainer.json'), join(workspace, '.devcontainer.json')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Un montage tel que `devcontainer up --mount` l'accepte : ni lecture seule ni options. */
export interface Mount {
  source: string
  target: string
}

/** Ce que `devcontainer up` rend sur sa dernière ligne, quand il réussit. */
export interface UpResult {
  containerId: string
  remoteUser: string
  remoteWorkspaceFolder: string
}

/** Un conteneur tel que `docker inspect` le décrit, réduit à ce que Solera lit. */
export interface ContainerInfo {
  id: string
  running: boolean
  /** Les destinations de ses montages, vues du conteneur. */
  mountTargets: string[]
}

/** Docker ou le CLI `devcontainer` manque : on dit quoi installer. */
export class ToolMissingError extends Error {
  constructor(
    readonly tool: 'docker' | 'devcontainer',
    message: string,
  ) {
    super(message)
    this.name = 'ToolMissingError'
  }
}

/**
 * Les deux outils que le fournisseur `devcontainer` pilote : le CLI officiel
 * `@devcontainers/cli` pour démarrer le conteneur selon le `devcontainer.json` du dépôt,
 * qu'on lit sans jamais l'écrire, et `docker` pour y lancer des processus.
 *
 * Le CLI officiel est cherché comme un CLI d'agent : dans le préfixe npm de Solera,
 * puis dans le PATH. Absent, Solera l'installe dans son préfixe.
 */
export class DevcontainerTools {
  private installing: Promise<string> | null = null

  constructor(private readonly managedDir: string) {}

  docker(): string {
    const docker = resolveBinary('docker')
    if (!docker) {
      throw new ToolMissingError(
        'docker',
        'Docker is not installed or not on the PATH of the Solera server. Install Docker (Docker Desktop on macOS and Windows, with WSL integration enabled for this distribution under WSL), then retry.',
      )
    }
    return docker
  }

  /** Le CLI `devcontainer`, installé dans le préfixe de Solera au premier besoin. */
  async devcontainer(): Promise<string> {
    const found = resolveBinary('devcontainer', this.managedDir)
    if (found) return found
    this.installing ??= this.install().finally(() => {
      this.installing = null
    })
    return this.installing
  }

  /** Docker répond-il ? Un client sans moteur (Docker Desktop éteint) ne suffit pas. */
  async assertDockerRunning(): Promise<void> {
    const docker = this.docker()
    try {
      await run(docker, ['version', '--format', '{{.Server.Version}}'], { timeout: DOCKER_TIMEOUT_MS, windowsHide: true })
    } catch (err) {
      const detail = (err as { stderr?: string }).stderr?.trim() || (err as Error).message
      throw new ToolMissingError('docker', `Docker is installed but its engine does not answer: start Docker, then retry. (${detail})`)
    }
  }

  /**
   * Démarre le dev container du dossier, ou réutilise celui qui tourne déjà pour lui,
   * y compris celui de VS Code : le CLI le retrouve par son label
   * `devcontainer.local_folder`. Les montages ne s'appliquent qu'à un conteneur créé ici.
   * Chaque ligne du journal passe par `onLog` pendant le démarrage.
   */
  async up(workspace: string, mounts: Mount[], onLog: (line: string) => void): Promise<UpResult> {
    const launch = await this.cli()
    const args = [
      ...launch.args,
      'up',
      '--workspace-folder',
      workspace,
      '--docker-path',
      this.docker(),
      ...mounts.flatMap((mount) => ['--mount', `type=bind,source=${mount.source},target=${mount.target}`]),
    ]
    return new Promise((resolve, reject) => {
      const child = spawn(launch.command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: UP_TIMEOUT_MS })
      let stdout = ''
      let pending = ''
      const tail: string[] = []
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        pending += chunk
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          tail.push(line)
          if (tail.length > 40) tail.shift()
          onLog(line)
        }
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (pending.trim()) tail.push(pending)
        const result = parseUpResult(stdout)
        if (code === 0 && result && 'containerId' in result) return resolve(result)
        const message = result && 'message' in result ? result.message : `devcontainer up exited with code ${code ?? '?'}`
        reject(new Error(`${message}\n${tail.slice(-15).join('\n')}`.trim()))
      })
    })
  }

  /**
   * Où le `devcontainer.json` monte le dossier du projet : un montage de Solera au même
   * chemin ferait doublon, ce que Docker refuse.
   */
  async workspaceFolder(workspace: string): Promise<string | null> {
    const launch = await this.cli()
    try {
      const { stdout } = await run(
        launch.command,
        [...launch.args, 'read-configuration', '--workspace-folder', workspace, '--docker-path', this.docker()],
        { timeout: DOCKER_TIMEOUT_MS * 2, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      )
      const parsed = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as { workspace?: { workspaceFolder?: unknown } }
      return typeof parsed.workspace?.workspaceFolder === 'string' ? parsed.workspace.workspaceFolder : null
    } catch (err) {
      const detail = (err as { stderr?: string }).stderr?.trim() || (err as Error).message
      throw new Error(`The devcontainer.json of ${workspace} cannot be read: ${detail}`)
    }
  }

  /**
   * L'adresse de l'hôte vue du conteneur : `host.docker.internal` sous Docker Desktop
   * (macOS, Windows, WSL), la passerelle du réseau du conteneur sous Linux.
   */
  async hostAddress(containerId: string): Promise<string> {
    const docker = this.docker()
    const info = await run(docker, ['info', '--format', '{{.OperatingSystem}}'], { timeout: DOCKER_TIMEOUT_MS, windowsHide: true })
    if (/docker desktop/i.test(info.stdout)) return 'host.docker.internal'
    const gateway = await run(
      docker,
      ['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.Gateway}} {{end}}', containerId],
      { timeout: DOCKER_TIMEOUT_MS, windowsHide: true },
    )
    return gateway.stdout.trim().split(/\s+/)[0] || 'host.docker.internal'
  }

  async inspect(containerId: string): Promise<ContainerInfo | null> {
    try {
      const { stdout } = await run(
        this.docker(),
        ['inspect', '--format', '{{.Id}}\t{{.State.Running}}\t{{range .Mounts}}{{.Destination}}\n{{end}}', containerId],
        { timeout: DOCKER_TIMEOUT_MS, windowsHide: true },
      )
      const [head = '', ...rest] = stdout.split('\n')
      const [id = containerId, running, firstMount = ''] = head.split('\t')
      return {
        id,
        running: running === 'true',
        mountTargets: [firstMount, ...rest].map((line) => line.trim()).filter(Boolean),
      }
    } catch {
      return null
    }
  }

  /** Joue une commande dans le conteneur, en root ou sous un utilisateur, et rend sa sortie. */
  async execIn(containerId: string, args: string[], user?: string): Promise<string> {
    const { stdout } = await run(
      this.docker(),
      ['exec', ...(user ? ['-u', user] : []), containerId, ...args],
      { timeout: DOCKER_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    )
    return stdout
  }

  /**
   * Comment lancer le CLI `devcontainer`. C'est un script Node : sous Windows son lanceur
   * `.cmd` se déplie, ailleurs on le passe au Node de ce serveur, le PATH d'un service
   * n'ayant pas forcément le sien.
   */
  private async cli(): Promise<{ command: string; args: string[] }> {
    const cli = await this.devcontainer()
    return process.platform === 'win32' ? launchOf(cli) : { command: process.execPath, args: [cli] }
  }

  private async install(): Promise<string> {
    const npm = resolveBinary('npm')
    if (!npm) {
      throw new ToolMissingError(
        'devcontainer',
        `The devcontainer CLI is missing and npm is not available to install it: run \`npm install -g ${DEVCONTAINER_CLI.package}\` on the Solera server.`,
      )
    }
    await mkdir(this.managedDir, { recursive: true })
    const launch = launchOf(npm)
    try {
      await run(
        launch.command,
        [
          ...launch.args,
          'install',
          '-g',
          '--prefix',
          this.managedDir,
          '--no-fund',
          '--no-audit',
          `${DEVCONTAINER_CLI.package}@${DEVCONTAINER_CLI.version}`,
        ],
        { timeout: INSTALL_TIMEOUT_MS, windowsHide: true },
      )
    } catch (err) {
      const detail = (err as { stderr?: string }).stderr?.trim() || (err as Error).message
      throw new ToolMissingError(
        'devcontainer',
        `Installing ${DEVCONTAINER_CLI.package} failed: ${detail}. Install it yourself with \`npm install -g ${DEVCONTAINER_CLI.package}\`.`,
      )
    }
    const installed = resolveBinary('devcontainer', this.managedDir)
    if (!installed) throw new ToolMissingError('devcontainer', `${DEVCONTAINER_CLI.package} was installed but cannot be found.`)
    return installed
  }
}

/** La dernière ligne JSON de `devcontainer up` : son verdict. */
export function parseUpResult(
  stdout: string,
): UpResult | { outcome: 'error'; message: string } | null {
  const lines = stdout.split('\n').map((line) => line.trim()).filter((line) => line.startsWith('{'))
  const last = lines.at(-1)
  if (!last) return null
  try {
    const parsed = JSON.parse(last) as Record<string, unknown>
    if (parsed.outcome === 'success' && typeof parsed.containerId === 'string') {
      return {
        containerId: parsed.containerId,
        remoteUser: typeof parsed.remoteUser === 'string' ? parsed.remoteUser : 'root',
        remoteWorkspaceFolder: typeof parsed.remoteWorkspaceFolder === 'string' ? parsed.remoteWorkspaceFolder : '/',
      }
    }
    const message = [parsed.message, parsed.description].filter((part) => typeof part === 'string').join(': ')
    return { outcome: 'error', message: message || 'devcontainer up failed' }
  } catch {
    return null
  }
}
