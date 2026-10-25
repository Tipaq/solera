import { createHash, type Hash } from 'node:crypto'
import { open, stat, type FileHandle } from 'node:fs/promises'
import type { TranscriptEntry } from './transcript.js'

/** Ce qui identifie un état du fichier : un transcript réécrit ou remplacé ne le garde pas. */
export interface TranscriptStamp {
  dev: string
  ino: string
  birth: string
  mtime: string
  ctime: string
  size: number
}

/** Le transcript a bougé pendant la lecture : la synchronisation s'arrête et repassera. */
export class TranscriptChanged extends Error {}

/**
 * Lecture d'un transcript JSONL par blocs de taille fixe, un enregistrement à la fois.
 * Les positions comptent des octets UTF-8, pas des caractères JS : ce sont elles qu'un
 * curseur enregistre.
 */
export class TranscriptReader {
  bytesRead = 0
  parsed = 0

  private constructor(
    readonly file: FileHandle,
    readonly stamp: TranscriptStamp,
    readonly path: string,
  ) {}

  static async open(path: string): Promise<TranscriptReader | null> {
    let file: FileHandle
    try {
      file = await open(path, 'r')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    try {
      return new TranscriptReader(file, await stampOf(file), path)
    } catch (error) {
      await file.close()
      throw error
    }
  }

  async assertStable(): Promise<void> {
    await assertTranscriptStamp(this.path, this.stamp)
  }

  async isRecordBoundary(offset: number): Promise<boolean> {
    if (offset === 0 || offset === this.stamp.size) return true
    const bytes = Buffer.alloc(2)
    const result = await this.file.read(bytes, 0, 2, offset - 1)
    this.bytesRead += result.bytesRead
    // Un dernier objet JSON valide a pu être importé avant son saut de ligne. L'écriture
    // suivante doit le clore, pas prolonger un enregistrement déjà retenu.
    return bytes[0] === 10 || bytes[1] === 10 || bytes[1] === 13
  }

  /**
   * L'empreinte de tout le préfixe déjà importé. Vérifier le préfixe entier, et pas
   * seulement la taille, attrape une réécriture suivie d'un ajout.
   */
  async prefix(end: number): Promise<Hash> {
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(64 * 1024)
    for (let position = 0; position < end; ) {
      const { bytesRead } = await this.file.read(buffer, 0, Math.min(buffer.length, end - position), position)
      if (bytesRead === 0) throw new TranscriptChanged('Transcript was truncated')
      hash.update(buffer.subarray(0, bytesRead))
      this.bytesRead += bytesRead
      position += bytesRead
    }
    return hash
  }

  async *lines(
    start: number,
    hash: Hash,
  ): AsyncGenerator<{ entry: TranscriptEntry | null; end: number; digest: string }> {
    let position = start
    let chunks: Buffer[] = []
    let length = 0
    const parse = (bytes: Buffer, terminated: boolean): TranscriptEntry | null | undefined => {
      const line = bytes.toString('utf8')
      // Depuis 2.1.300, le rejeu du CLI duplique prompts et outils. Un enregistrement
      // terminé s'écarte sans décoder son arbre JSON ; une fin inachevée doit rester
      // relisable. Sondé sur 2.1.301 : ces lignes commencent par le type, et l'ancrage
      // empêche d'écarter un message qui ne ferait que citer ce format.
      if (terminated && /^\s*\{\s*"type"\s*:\s*"api-request(?:-shape|-blob)?"\s*[,}]/.test(line)) return null
      try {
        this.parsed++
        const entry: unknown = JSON.parse(line)
        if (!entry || typeof entry !== 'object') return null
        // Le filtre reste juste si une future version déplace la propriété type.
        if (/^api-request(?:-shape|-blob)?$/.test(String((entry as TranscriptEntry).type))) return null
        return entry as TranscriptEntry
      } catch {
        // Une ligne tronquée au milieu du fichier n'invalide pas le reste ; en fin de
        // fichier, c'est une écriture en cours qu'on relira la prochaine fois.
        return terminated ? null : undefined
      }
    }
    while (position < this.stamp.size) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, this.stamp.size - position))
      const { bytesRead } = await this.file.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) throw new TranscriptChanged('Transcript was truncated')
      this.bytesRead += bytesRead
      const chunk = buffer.subarray(0, bytesRead)
      let startInChunk = 0
      for (;;) {
        const newline = chunk.indexOf(10, startInChunk)
        if (newline === -1) break
        const piece = chunk.subarray(startInChunk, newline + 1)
        const line = chunks.length ? Buffer.concat([...chunks, piece], length + piece.length) : piece
        hash.update(line)
        yield { entry: parse(line, true) ?? null, end: position + newline + 1, digest: hash.copy().digest('hex') }
        chunks = []
        length = 0
        startInChunk = newline + 1
      }
      if (startInChunk < chunk.length) {
        const piece = chunk.subarray(startInChunk)
        chunks.push(piece)
        length += piece.length
      }
      position += bytesRead
    }
    if (length) {
      const tail = Buffer.concat(chunks, length)
      const entry = parse(tail, false)
      if (entry !== undefined) {
        hash.update(tail)
        yield { entry, end: position, digest: hash.copy().digest('hex') }
      }
    }
    await this.assertStable()
  }
}

export function sameStamp(a: TranscriptStamp, b: TranscriptStamp): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.birth === b.birth &&
    a.size === b.size &&
    a.mtime === b.mtime &&
    a.ctime === b.ctime
  )
}

function stampFromStats(value: import('node:fs').BigIntStats): TranscriptStamp {
  return {
    dev: String(value.dev),
    ino: String(value.ino),
    birth: String(value.birthtimeNs),
    mtime: String(value.mtimeNs),
    ctime: String(value.ctimeNs),
    size: Number(value.size),
  }
}

async function stampOf(file: FileHandle): Promise<TranscriptStamp> {
  const value = await file.stat({ bigint: true })
  if (!value.isFile()) throw new Error('Transcript is not a regular file')
  return stampFromStats(value)
}

export async function assertTranscriptStamp(path: string, expected: TranscriptStamp): Promise<void> {
  try {
    if (sameStamp(expected, stampFromStats(await stat(path, { bigint: true })))) return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  throw new TranscriptChanged('Transcript changed during synchronization')
}
