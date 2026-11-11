import { execFile } from 'node:child_process'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Une taille mesurée reste servie ce temps-là sans être remesurée : un `du` sur un
 * `node_modules` coûte des secondes, et la taille d'un arbre bouge peu d'un tour à l'autre.
 */
const TTL_MS = 10 * 60_000

/** Au-delà, une mesure est abandonnée : un disque qui ne répond plus ne bloque pas la file. */
const MEASURE_TIMEOUT_MS = 5 * 60_000

export type Measure = (path: string) => Promise<number | null>

interface Entry {
  bytes: number | null
  measuredAt: number
}

/**
 * La taille sur disque des arbres et des racines, par chemin, mesurée hors du chemin de
 * toute réponse.
 *
 * Une lecture ne fait jamais attendre : elle rend ce qui est connu et met en file ce qui
 * manque ou a vieilli. La file passe une mesure à la fois, à basse priorité, parce que la
 * machine est partagée avec les sessions.
 */
export class DiskUsage {
  private readonly entries = new Map<string, Entry>()
  private readonly queue = new Set<string>()
  /** Le chemin en cours de mesure, et s'il a été oublié entre-temps : sa mesure ne le ramène pas. */
  private measuring: { path: string; forgotten: boolean } | null = null
  private running: Promise<void> | null = null
  private readonly measure: Measure
  private readonly now: () => number

  constructor(options: { measure?: Measure; now?: () => number } = {}) {
    this.measure = options.measure ?? measureDisk
    this.now = options.now ?? Date.now
  }

  /**
   * La taille connue du chemin, et si elle reste à mesurer pour la première fois. Une
   * taille vieillie est rendue telle quelle pendant que la suivante se mesure.
   */
  read(path: string): { bytes: number | null; pending: boolean } {
    const entry = this.entries.get(path)
    if (!entry || this.now() - entry.measuredAt >= TTL_MS) this.enqueue(path)
    return { bytes: entry?.bytes ?? null, pending: !entry }
  }

  /** Oublie la taille d'un chemin : un arbre nettoyé, qui pourrait revenir au même endroit. */
  forget(path: string): void {
    this.entries.delete(path)
    this.queue.delete(path)
    if (this.measuring?.path === path) this.measuring.forgotten = true
  }

  /** La file vide : pour les tests, qui n'ont pas d'horloge à attendre. */
  async idle(): Promise<void> {
    while (this.running) await this.running
  }

  private enqueue(path: string): void {
    // Déjà en mesure : la file l'aurait mesuré deux fois de suite.
    if (this.measuring?.path === path && !this.measuring.forgotten) return
    this.queue.add(path)
    this.running ??= this.drain()
  }

  private async drain(): Promise<void> {
    // La file se vide et le drapeau tombe dans le même pas : un chemin ajouté entre les
    // deux attendrait la lecture suivante sans que rien ne le mesure.
    try {
      await this.drainQueue()
    } finally {
      this.running = null
    }
  }

  private async drainQueue(): Promise<void> {
    for (let path = first(this.queue); path !== undefined; path = first(this.queue)) {
      this.queue.delete(path)
      const measuring = (this.measuring = { path, forgotten: false })
      const bytes = await this.measure(path).catch((err: unknown) => {
        console.warn(`[worktrees] taille illisible ${path} :`, err)
        return null
      })
      this.measuring = null
      if (!measuring.forgotten) this.entries.set(path, { bytes, measuredAt: this.now() })
    }
  }
}

const first = (set: Set<string>) => set.values().next().value

/** Sous Linux, `ionice` n'existe pas toujours (une image minimale) : on s'en passe alors. */
let ioniceMissing = false

/**
 * L'espace qu'occupe un dossier, en octets, ou null s'il ne se mesure pas.
 *
 * Par `du`, sous `nice` et, sous Linux, `ionice` en classe « idle » : ses lectures
 * passent après celles des sessions. Sans `du` (Windows), par un parcours des fichiers.
 * `-x` reste sur le système de fichiers du dossier, `-k` est la seule unité que tous les
 * `du` connaissent.
 */
export async function measureDisk(path: string, platform: NodeJS.Platform = process.platform): Promise<number | null> {
  if (platform === 'win32') return withTimeout(walkSize(path)).catch(() => null)
  const ionice = platform === 'linux' && !ioniceMissing
  const args = ['-n', '19', ...(ionice ? ['ionice', '-c', '3'] : []), 'du', '-skx', path]
  const { code, stdout } = await run('nice', args)
  // `nice` rend 127 quand la commande qu'il lance n'existe pas.
  if (code === 127 && ionice) {
    ioniceMissing = true
    return measureDisk(path, platform)
  }
  // `du` sort en erreur sur un fichier illisible mais donne quand même son total.
  const kib = Number.parseInt(stdout.split(/\s/, 1)[0] ?? '', 10)
  return Number.isFinite(kib) && stdout.trim() ? kib * 1024 : null
}

/** Le parcours n'a pas de process à tuer : passé le délai, on cesse de l'attendre. */
function withTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('mesure trop longue')), MEASURE_TIMEOUT_MS)
    timer.unref()
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

function run(command: string, args: string[]): Promise<{ code: number | null; stdout: string }> {
  return new Promise((done) => {
    execFile(command, args, { encoding: 'utf8', timeout: MEASURE_TIMEOUT_MS, windowsHide: true }, (err, stdout) => {
      const code = err ? (typeof err.code === 'number' ? err.code : null) : 0
      done({ code, stdout: err?.killed ? '' : stdout })
    })
  })
}

/**
 * La somme des fichiers d'un dossier, sans suivre les liens ni compter deux fois un
 * fichier lié en dur. Les blocs alloués quand le système les donne, la taille sinon.
 */
export async function walkSize(root: string): Promise<number> {
  const seen = new Set<string>()
  let total = 0
  const visit = async (path: string): Promise<void> => {
    const stats = await lstat(path).catch(() => null)
    if (!stats) return
    if (stats.nlink > 1 && !stats.isDirectory()) {
      const id = `${stats.dev}:${stats.ino}`
      if (seen.has(id)) return
      seen.add(id)
    }
    total += Number.isFinite(stats.blocks) && stats.blocks > 0 ? stats.blocks * 512 : stats.size
    if (!stats.isDirectory()) return
    const names = await readdir(path).catch(() => [] as string[])
    // Un dossier après l'autre : un parcours en largeur ouvrirait des milliers de
    // descripteurs à la fois sur un `node_modules`.
    for (const name of names) await visit(join(path, name))
  }
  await visit(root)
  return total
}
