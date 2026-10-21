import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { readdir, readFile, stat } from 'node:fs/promises'
import { delimiter, dirname, join } from 'node:path'
import type { PrototypeCandidateDto } from '@solera/protocol'
import { isNotNull } from 'drizzle-orm'
import { projects, type Db } from '@solera/db'

/**
 * Ce que le serveur MCP lit pour joindre le Storybook d'un design system.
 *
 * Un fichier et non un appel : le `.mjs` n'a que la base et le disque, aucun port vers
 * le daemon (voir l'en-tête de `solera-mcp.mjs`). Le daemon écrit, le MCP lit.
 */
export interface StorybookState {
  path: string
  status: 'starting' | 'ready' | 'failed'
  /** Posée dès le lancement, pour qu'un MCP qui attend sache déjà où frapper. */
  url: string | null
  pid: number | null
  /** La fin du journal du process quand il a échoué : c'est ce que l'agent relaiera. */
  error: string | null
  log: string
  /**
   * Le chemin sous lequel Solera relaie ce Storybook (`/ds/<jeton>/`), relatif à
   * l'origine de Solera : c'est ce qu'ouvre la vue Web, d'où qu'on la regarde.
   */
  base: string
  /** Le dossier des prototypes de ce DS, un sous-dossier par projet. */
  prototypes: string
  /**
   * Le `main.ts` du DS charge-t-il le module de Solera ? Sans cette ligne, le Storybook
   * tourne mais ignore les prototypes, et l'agent doit savoir pourquoi.
   */
  hooked: boolean
  updatedAt: number
}

interface Running {
  /** Null le temps de trouver un port, avant que le process existe. */
  child: ChildProcess | null
  /** Posée quand le Storybook répond : avant, le relais n'a nulle part où aller. */
  url: string | null
  lastUsed: number
  /** Arrêté par Solera : sa sortie n'est alors pas un échec à rapporter. */
  stopped: boolean
}

export interface StorybookSupervisorOptions {
  /** Où vivent les fichiers d'état et les journaux, sous les données de l'instance. */
  directory: string
  /**
   * Où vivent les prototypes, sous les données de l'instance : un dossier par DS, puis
   * un par projet. Hors du dépôt du projet comme de celui du DS (carte #63).
   */
  prototypesDirectory: string
  /** Les chemins de DS que des projets lient : le relais n'en sert pas d'autre. */
  linked: () => string[]
  /** Le module que le `main.ts` du DS charge (`storybook/solera-storybook.mjs`). */
  hookPath?: string
  /** Dit si une session travaille en ce moment dans un projet lié à ce DS. */
  inUse: (path: string) => boolean
  /** Sans session au travail depuis ce délai, le Storybook est arrêté. */
  idleMs?: number
  /** Au-delà, un Storybook qui ne répond pas est déclaré en échec. */
  startTimeoutMs?: number
}

const IDLE_MS = 15 * 60_000
const START_TIMEOUT_MS = 120_000
const LOG_TAIL_CHARS = 2000

/**
 * Les Storybook des design systems liés, lancés à la demande, un par dossier.
 *
 * Un par DS et non par projet : deux projets qui lient le même DS voient le même
 * manifeste, et deux serveurs de dev identiques ne feraient que doubler la mémoire. Le
 * serveur de dev plutôt qu'un build : le manifeste qu'il sert est toujours celui du code
 * présent, et c'est le même process qu'afficheront les prototypes (carte #63).
 *
 * Il démarre au premier tour d'une session dans un projet lié, et s'arrête quand plus
 * aucune session n'y travaille depuis un moment. Un tour peut durer bien plus longtemps
 * que ce délai : c'est pourquoi l'arrêt demande à `inUse` au lieu de compter depuis le
 * dernier démarrage de tour.
 */
export class StorybookSupervisor {
  private readonly running = new Map<string, Running>()
  private readonly directory: string
  private readonly idleMs: number
  private readonly startTimeoutMs: number
  private readonly sweep: NodeJS.Timeout
  private readonly secret: Buffer
  private readonly hookPath: string

  constructor(private readonly options: StorybookSupervisorOptions) {
    this.directory = options.directory
    this.idleMs = options.idleMs ?? IDLE_MS
    this.startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS
    this.hookPath = options.hookPath ?? resolveHook()
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    this.secret = loadOrCreateSecret(join(this.directory, 'relay.key'))
    this.reapStale()
    this.sweep = setInterval(() => this.stopIdle(), 60_000)
    this.sweep.unref()
  }

  /** Le fichier d'état d'un DS, qu'il tourne ou non : c'est ce que le MCP reçoit. */
  statePath(path: string): string {
    return join(this.directory, `${key(path)}.json`)
  }

  /**
   * Le jeton du relais de ce DS : le seul secret du chemin `/ds/<jeton>/`.
   *
   * Stable d'un lancement à l'autre, pour qu'un aperçu ouvert depuis le fil marche
   * encore après l'arrêt du Storybook, qui repart alors à la demande. Tiré d'une clé de
   * l'instance et non du chemin seul : le chemin d'un DS se devine.
   */
  token(path: string): string {
    return createHmac('sha256', this.secret).update(path).digest('hex').slice(0, 32)
  }

  base(path: string): string {
    return `/ds/${this.token(path)}/`
  }

  /** Le dossier des prototypes d'un DS, tous projets confondus. */
  prototypesOf(path: string): string {
    return prototypesOfDesignSystem(this.options.prototypesDirectory, path)
  }

  /** Le dossier où les agents d'un projet écrivent leurs prototypes sur ce DS. */
  projectPrototypes(path: string, projectId: string): string {
    const directory = join(this.prototypesOf(path), projectId)
    mkdirSync(directory, { recursive: true })
    return directory
  }

  /**
   * Le Storybook qu'un jeton désigne, pour le relais : son adresse quand il répond,
   * `null` tant qu'il démarre. Le lance s'il ne tourne pas, et le compte comme servi :
   * quelqu'un le regarde, même sans session au travail.
   */
  resolve(token: string): { path: string; url: string | null } | null {
    const path = this.options.linked().find((candidate) => this.token(candidate) === token)
    if (!path) return null
    this.ensure(path)
    return { path, url: this.running.get(path)?.url ?? null }
  }

  /** Lance le Storybook du DS s'il ne tourne pas, et le compte comme servi maintenant. */
  ensure(path: string): void {
    const current = this.running.get(path)
    if (current) {
      current.lastUsed = Date.now()
      return
    }
    // Réservé tout de suite, avant l'attente du port : deux sessions qui démarrent en
    // même temps lanceraient sinon deux Storybook sur le même DS.
    const slot: Running = { child: null, url: null, lastUsed: Date.now(), stopped: false }
    this.running.set(path, slot)
    void this.start(path, slot)
  }

  shutdown(): void {
    clearInterval(this.sweep)
    for (const path of [...this.running.keys()]) this.stop(path)
  }

  private async start(path: string, slot: Running): Promise<void> {
    const log = join(this.directory, `${key(path)}.log`)
    const base = this.base(path)
    const prototypes = this.prototypesOf(path)
    mkdirSync(prototypes, { recursive: true })
    const hooked = loadsSoleraModule(path)
    const write = (state: Omit<StorybookState, 'path' | 'log' | 'base' | 'prototypes' | 'hooked' | 'updatedAt'>) =>
      writeFileSync(
        this.statePath(path),
        JSON.stringify({ ...state, path, log, base, prototypes, hooked, updatedAt: Date.now() } satisfies StorybookState),
        { mode: 0o600 },
      )

    const entry = findStorybookEntry(path)
    if (!entry) {
      this.running.delete(path)
      write({
        status: 'failed',
        url: null,
        pid: null,
        error: `No storybook package found in a node_modules above ${path}: install the design system's dependencies.`,
      })
      return
    }

    const port = await freePort()
    // Arrêté pendant qu'on cherchait un port, à l'arrêt du daemon par exemple.
    if (slot.stopped) return
    const url = `http://127.0.0.1:${port}`
    const out = openSync(log, 'w', 0o600)
    // `NODE_ENV` retiré : le daemon publié tourne en `production`, et un serveur de dev
    // qui en hérite sert React en mode production, ou refuse de partir.
    const { NODE_ENV: _omitted, ...environment } = process.env
    const child = spawn(
      process.execPath,
      [entry, 'dev', '-p', String(port), '--exact-port', '--host', '127.0.0.1', '--ci', '--no-open', '-c', '.storybook'],
      {
        cwd: path,
        // Son propre groupe, pour arrêter d'un signal Storybook et les workers qu'il lance.
        detached: true,
        stdio: ['ignore', out, out],
        env: {
          ...environment,
          // Sous systemd le PATH est minimal : les sous-process de Storybook doivent
          // trouver le même node que le sien.
          PATH: [dirname(process.execPath), environment.PATH ?? ''].join(delimiter),
          STORYBOOK_DISABLE_TELEMETRY: '1',
          // Lus par la ligne que le DS ajoute à son `main.ts`, puis par le module
          // qu'elle charge : les prototypes, et le chemin du relais.
          SOLERA_STORYBOOK: this.hookPath,
          SOLERA_PROTOTYPES: prototypes,
          SOLERA_STORYBOOK_BASE: base,
        },
      },
    )
    slot.child = child
    write({ status: 'starting', url, pid: child.pid ?? null, error: null })

    let settled = false
    child.on('exit', (code, signal) => {
      if (this.running.get(path) === slot) this.running.delete(path)
      settled = true
      if (slot.stopped) return
      write({
        status: 'failed',
        url: null,
        pid: null,
        error: `Storybook exited (${signal ?? `code ${code}`}).\n${tail(log)}`,
      })
    })

    const deadline = Date.now() + this.startTimeoutMs
    while (!settled && Date.now() < deadline) {
      if (await responds(`${url}/index.json`)) {
        settled = true
        slot.url = url
        write({ status: 'ready', url, pid: child.pid ?? null, error: null })
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (settled) return
    settled = true
    this.stop(path)
    // Écrit après l'arrêt, qui retire le fichier : c'est l'échec qui doit rester lisible.
    write({
      status: 'failed',
      url: null,
      pid: null,
      error: `Storybook did not answer within ${Math.round(this.startTimeoutMs / 1000)} s.\n${tail(log)}`,
    })
  }

  private stop(path: string): void {
    const current = this.running.get(path)
    this.running.delete(path)
    rmSync(this.statePath(path), { force: true })
    if (!current) return
    current.stopped = true
    if (current.child?.pid) killGroup(current.child.pid)
  }

  private stopIdle(): void {
    const now = Date.now()
    for (const [path, entry] of this.running) {
      if (this.options.inUse(path)) {
        entry.lastUsed = now
      } else if (now - entry.lastUsed > this.idleMs) {
        this.stop(path)
      }
    }
  }

  /**
   * Arrête ce qu'un daemon précédent a laissé tourner.
   *
   * Le groupe est détaché pour pouvoir être tué d'un coup ; la contrepartie est qu'il
   * survit à un daemon tué sans avoir pu ranger. Le nom du process est vérifié avant le
   * signal : un pid se recycle, et celui-là pourrait être n'importe quoi aujourd'hui.
   */
  private reapStale(): void {
    for (const file of readdirSync(this.directory)) {
      if (!file.endsWith('.json')) continue
      const statePath = join(this.directory, file)
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf8')) as StorybookState
        if (state.pid && isStorybook(state.pid)) killGroup(state.pid)
      } catch {
        /* Un état illisible n'a rien à arrêter : on le retire quand même. */
      }
      rmSync(statePath, { force: true })
    }
  }
}

/**
 * Le module que charge la ligne du DS, selon qu'on tourne sur les sources ou sur le
 * bundle : même logique que le serveur MCP (`agents/mcp-builtin.ts`).
 */
function resolveHook(): string {
  const candidates = [
    join(import.meta.dirname, '../storybook/solera-storybook.mjs'),
    join(import.meta.dirname, 'storybook/solera-storybook.mjs'),
  ]
  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new Error(`Module Storybook de Solera introuvable (cherché : ${candidates.join(', ')})`)
  return found
}

function loadOrCreateSecret(file: string): Buffer {
  try {
    const existing = readFileSync(file)
    if (existing.length >= 32) return existing
  } catch {
    /* Absente : créée ci-dessous. */
  }
  const secret = randomBytes(32)
  writeFileSync(file, secret, { mode: 0o600 })
  return secret
}

/** La ligne que le DS ajoute à la fin de son `.storybook/main.ts` : voir `solera-storybook.mjs`. */
export const DESIGN_SYSTEM_LINE =
  'export default process.env.SOLERA_STORYBOOK ? (await import(process.env.SOLERA_STORYBOOK)).default(config) : config'

/** Vrai si la configuration Storybook du DS lit `SOLERA_STORYBOOK`. */
function loadsSoleraModule(path: string): boolean {
  for (const name of ['main.ts', 'main.mts', 'main.js', 'main.mjs', 'main.cjs', 'main.cts']) {
    try {
      return readFileSync(join(path, '.storybook', name), 'utf8').includes('SOLERA_STORYBOOK')
    } catch {
      /* Pas ce nom-là. */
    }
  }
  return false
}

/** La racine des prototypes, sous les données de l'instance. */
export function prototypesRoot(dataDirectory: string): string {
  return join(dataDirectory, 'prototypes')
}

/** Le dossier des prototypes d'un DS : un par DS, sous la racine. */
export function prototypesOfDesignSystem(prototypesDirectory: string, path: string): string {
  return join(prototypesDirectory, key(path))
}

/** Le tag qu'un agent pose sur la story d'un composant absent du DS. */
const CANDIDATE_TAG = /\btags\s*:\s*\[[^\]]*['"]candidate['"]/

/**
 * Les candidats d'un dossier de prototypes, lus dans les fichiers et non dans l'index de
 * Storybook : la liste doit se montrer aussi quand aucun Storybook ne tourne.
 */
export async function listCandidates(directory: string): Promise<PrototypeCandidateDto[]> {
  let names: string[]
  try {
    names = await readdir(directory, { recursive: true })
  } catch {
    return []
  }
  const candidates: PrototypeCandidateDto[] = []
  for (const name of names) {
    const match = /(?:^|\/)([^/]+)\.stories\.[jt]sx?$/.exec(name)
    if (!match) continue
    const path = join(directory, name)
    try {
      const [content, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
      if (CANDIDATE_TAG.test(content)) candidates.push({ name: match[1]!, path, modifiedAt: info.mtimeMs })
    } catch {
      /* Retiré pendant la lecture. */
    }
  }
  return candidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

function key(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 16)
}

/**
 * Le point d'entrée du paquet `storybook`, cherché en remontant depuis le DS.
 *
 * En remontant parce qu'un DS peut être un sous-dossier d'un monorepo dont les
 * dépendances sont à la racine. Le fichier JS et non `.bin/storybook` : ce dernier est un
 * script shell qui cherche `node` dans un PATH que systemd a vidé.
 */
export function findStorybookEntry(path: string): string | null {
  let directory = path
  for (;;) {
    const manifest = join(directory, 'node_modules', 'storybook', 'package.json')
    if (existsSync(manifest)) {
      const { bin } = JSON.parse(readFileSync(manifest, 'utf8')) as {
        bin?: string | Record<string, string>
      }
      const relative = typeof bin === 'string' ? bin : bin?.storybook
      if (relative) return join(dirname(manifest), relative)
    }
    const parent = dirname(directory)
    if (parent === directory) return null
    directory = parent
  }
}

/** Les chemins de DS que des projets lient, chacun une fois. */
export function linkedDesignSystems(db: Db): string[] {
  return db
    .selectDistinct({ path: projects.designSystemPath })
    .from(projects)
    .where(isNotNull(projects.designSystemPath))
    .all()
    .map((row) => row.path)
    .filter((path): path is string => path !== null)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

function tail(log: string): string {
  try {
    return readFileSync(log, 'utf8').slice(-LOG_TAIL_CHARS)
  } catch {
    return ''
  }
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    /* Déjà mort. */
  }
}

function isStorybook(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes('storybook')
  } catch {
    return false
  }
}
