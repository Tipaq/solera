import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { promisify } from 'node:util'
import { brotliDecompress } from 'node:zlib'
import type { AgentKind } from '@solera/protocol'
import { resolveBinary } from '../../agents/cli-binary.js'
import { launchOf } from '../../agents/launch.js'

const run = promisify(execFile)
const unbrotli = promisify(brotliDecompress)

/** Où le cache des CLI est monté dans tout dev container, en lecture seule. */
export const AGENTS_MOUNT = '/opt/solera/agents'

/** Le temps laissé à `npm pack` pour un paquet de plusieurs centaines de mégaoctets. */
const PACK_TIMEOUT_MS = 15 * 60 * 1000

/** Ce qu'un conteneur peut exécuter : son architecture, et sa libc. */
export interface LinuxTarget {
  arch: 'x64' | 'arm64'
  /** Alpine et ses dérivés : la libc de la plupart des binaires n'y est pas. */
  musl: boolean
}

/**
 * Le paquet npm qui porte le binaire Linux d'un CLI, et le chemin du binaire dans ce
 * paquet. Les quatre CLI publient un paquet par plateforme, que leur paquet principal
 * désigne en `optionalDependencies` ; on prend celui-là directement, sans le lanceur
 * Node du paquet principal : le conteneur n'a pas forcément Node.
 *
 * Sondé sur claude 2.1.301, codex 0.163.0, opencode 1.19.3 et grok 1.0.62.
 */
export function linuxPackage(kind: AgentKind, version: string, target: LinuxTarget): { spec: string; binary: string } {
  const { arch, musl } = target
  const suffix = musl ? '-musl' : ''
  switch (kind) {
    case 'claude':
      return { spec: `@anthropic-ai/claude-code-linux-${arch}${suffix}@${version}`, binary: 'claude' }
    case 'codex':
      // Un seul binaire Linux, lié statiquement à musl : il tourne sur les deux libc.
      return {
        spec: `@openai/codex@${version}-linux-${arch}`,
        binary: `vendor/${arch === 'x64' ? 'x86_64' : 'aarch64'}-unknown-linux-musl/bin/codex`,
      }
    case 'opencode':
      return { spec: `opencode-linux-${arch}${suffix}@${version}`, binary: 'bin/opencode' }
    case 'grok':
      // Livré compressé en brotli (`bin/grok.br`) : le postinstall du paquet principal le
      // décompresse, ce qu'on refait ici. Pas de variante musl.
      return { spec: `@xai-official/grok-linux-${arch}@${version}`, binary: 'bin/grok' }
  }
}

/**
 * Le cache des CLI Linux que Solera apporte dans les dev containers, à la manière du
 * serveur de VS Code (ADR 0001) : téléchargés sur l'hôte, à la version de l'hôte,
 * rangés sous `<données>/container-agents/` et montés en lecture seule à
 * `/opt/solera/agents`. Le conteneur n'a besoin ni de Node ni du réseau.
 *
 * Par `npm pack` plutôt que par une requête directe au registre : il suit le `.npmrc`
 * de l'utilisateur, donc le registre et le proxy d'une entreprise.
 */
export class ContainerAgents {
  private readonly inFlight = new Map<string, Promise<string>>()

  constructor(readonly root: string) {}

  /** Le dossier d'un CLI à une version, pour une cible, relatif à la racine du cache. */
  static entry(kind: AgentKind, version: string, target: LinuxTarget): string {
    return posix.join(kind, `${version}-linux-${target.arch}${target.musl && kind !== 'codex' ? '-musl' : ''}`)
  }

  /**
   * Le chemin du binaire **vu du conteneur**, une fois le CLI dans le cache. Télécharge
   * au premier besoin ; deux sessions qui le demandent ensemble partagent le
   * téléchargement.
   */
  async ensure(kind: AgentKind, version: string, target: LinuxTarget): Promise<string> {
    const entry = ContainerAgents.entry(kind, version, target)
    const { spec, binary } = linuxPackage(kind, version, target)
    const inside = posix.join(AGENTS_MOUNT, entry, 'package', binary)
    if (existsSync(join(this.root, entry, 'package', binary))) return inside
    let pending = this.inFlight.get(entry)
    if (!pending) {
      pending = this.download(entry, spec, binary)
        .then(() => inside)
        .finally(() => this.inFlight.delete(entry))
      this.inFlight.set(entry, pending)
    }
    return pending
  }

  /** Le dossier de l'hôte qui porte un chemin vu du conteneur sous `/opt/solera/agents`. */
  hostPathOf(insidePath: string): string | null {
    const relative = posix.relative(AGENTS_MOUNT, insidePath)
    if (relative.startsWith('..') || posix.isAbsolute(relative)) return null
    return join(this.root, ...relative.split('/'))
  }

  private async download(entry: string, spec: string, binary: string): Promise<void> {
    const npm = resolveBinary('npm')
    if (!npm) throw new Error(`npm is missing on the server: cannot fetch ${spec} for the dev container.`)
    await mkdir(this.root, { recursive: true })
    // Extrait à côté puis renommé : un téléchargement interrompu ne laisse jamais un
    // dossier à moitié rempli que `ensure` prendrait pour complet.
    const staging = await mkdtemp(join(this.root, '.staging-'))
    try {
      const launch = launchOf(npm)
      const packed = await run(
        launch.command,
        [...launch.args, 'pack', spec, '--pack-destination', staging, '--silent'],
        { timeout: PACK_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      )
      const tarball = packed.stdout.trim().split('\n').pop()?.trim()
      if (!tarball) throw new Error(`npm pack ${spec} did not say what it wrote.`)
      await run('tar', ['-xzf', join(staging, tarball), '-C', staging], { timeout: PACK_TIMEOUT_MS, windowsHide: true })
      await rm(join(staging, tarball), { force: true })
      const target = join(staging, 'package', binary)
      if (!existsSync(target) && existsSync(`${target}.br`)) {
        await writeFile(target, await unbrotli(await readFile(`${target}.br`)))
        await rm(`${target}.br`)
      }
      if (!existsSync(target)) throw new Error(`${spec} has no ${binary}: its layout changed.`)
      await chmod(target, 0o755)
      const final = join(this.root, entry)
      await mkdir(join(final, '..'), { recursive: true })
      await rm(final, { recursive: true, force: true })
      await rename(staging, final)
    } catch (err) {
      await rm(staging, { recursive: true, force: true })
      throw err
    }
  }
}
