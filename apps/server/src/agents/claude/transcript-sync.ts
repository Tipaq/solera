import { createHash, type Hash } from 'node:crypto'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { claudeTranscriptCursors, conversations, type Db } from '@solera/db'
import type { EventLog } from '../../events/event-log.js'
import {
  entryTs,
  spawnedAgents,
  transcriptPath,
  transcriptTranslator,
  TRANSCRIPT_RAW_FORMAT,
  type TranslatedEvent,
  type TranscriptTranslationState,
} from './transcript.js'
import {
  assertTranscriptStamp,
  sameStamp,
  TranscriptChanged,
  TranscriptReader,
  type TranscriptStamp,
} from './transcript-reader.js'

/**
 * Synchronisation bornée d'un transcript Claude Code avec le journal.
 *
 * Avant, chaque ouverture relisait le transcript entier, le traduisait en entier et
 * remontait tout le journal en mémoire pour trouver le point commun : sur une longue
 * conversation, des centaines de Mo à chaque fois. Désormais, un curseur par fichier
 * (position, empreinte du préfixe, état du traducteur) est enregistré dans la même
 * transaction que les événements qu'il couvre, et la synchronisation suivante reprend
 * là. Les lots sont bornés en nombre et en octets.
 */

type Anchors = ReturnType<EventLog['importAnchors']>
interface Cursor {
  offset: number
  digest: string
  stamp: TranscriptStamp
  complete: boolean
  translation: TranscriptTranslationState
  agents: [string, string][]
}
interface Saved {
  version: 1
  path: string
  sources: Record<string, Cursor>
  recount?: boolean
}
interface Source {
  path: string
  thread: string | null
  start: Cursor
  seed: Hash
  stamp: TranscriptStamp
  unchanged: boolean
  /** Les liens connus vont jusqu'à la fin du fichier, mais ne deviennent durables qu'à l'import de leur ligne. */
  discovered: Map<string, string>
}
export interface PreparedTranscript {
  path: string
  sources: Source[]
  firstPrompt: string | null
  model: string | null
  firstTs: number | null
  bytesRead: number
  parsed: number
  mainEntries: number
  needsRecount: boolean
}

const emptyDigest = () => createHash('sha256').digest('hex')
const emptyAnchors = (): Anchors => ({
  uuids: new Set(),
  startedToolCallIds: new Set(),
  completedToolCallIds: new Set(),
  subAgentIds: new Set(),
})

/**
 * Le curseur enregistré, s'il vaut encore. Il dépend aussi de l'avancée du journal :
 * un événement écrit en direct par le CLI depuis le rend caduc.
 */
export function savedTranscript(db: Db, id: string, lastSeq: number): Saved | undefined {
  const row = db
    .select()
    .from(claudeTranscriptCursors)
    .where(eq(claudeTranscriptCursors.conversationId, id))
    .get()
  if (!row || row.journalSeq !== lastSeq) return undefined
  try {
    const state = JSON.parse(row.state) as Saved
    return state.version === 1 ? state : undefined
  } catch {
    return undefined
  }
}

/**
 * Repère les fichiers à lire et d'où reprendre chacun, sans garder le corps des
 * messages. Même un parent inchangé peut avoir des sous-agents qui grandissent : on
 * suit donc les liens de chaque fichier.
 */
export async function prepareTranscript(
  cwd: string,
  sessionId: string,
  saved?: Saved,
  getAnchors: () => Anchors = emptyAnchors,
  hasHistory = false,
): Promise<PreparedTranscript | null> {
  const path = transcriptPath(cwd, sessionId)
  if (saved?.path !== path) saved = undefined
  const result: PreparedTranscript = {
    path,
    sources: [],
    firstPrompt: null,
    model: null,
    firstTs: null,
    bytesRead: 0,
    parsed: 0,
    mainEntries: 0,
    needsRecount: saved?.recount ?? false,
  }
  const pending: [string, string | null][] = [[path, null]]
  const visited = new Set<string>()
  for (const [sourcePath, thread] of pending) {
    if (visited.has(sourcePath)) continue
    visited.add(sourcePath)
    const reader = await TranscriptReader.open(sourcePath)
    if (!reader) {
      // Un sous-agent encore en cours, ou d'une version de CLI qui n'écrivait pas ces
      // fichiers, ne laisse rien : le reste de l'import n'en dépend pas.
      if (thread === null) return null
      continue
    }
    try {
      const previous = saved?.sources[sourcePath]
      let start: Cursor = {
        offset: 0,
        digest: emptyDigest(),
        stamp: reader.stamp,
        complete: false,
        translation: transcriptTranslator(cwd, thread).snapshot(),
        agents: [],
      }
      let seed = createHash('sha256')
      let resumed = false
      const unchanged = previous?.complete === true && sameStamp(previous.stamp, reader.stamp)
      if (unchanged) {
        start = previous
        resumed = true
      } else if (previous && previous.offset <= reader.stamp.size) {
        seed = await reader.prefix(previous.offset)
        if (seed.copy().digest('hex') === previous.digest && (await reader.isRecordBoundary(previous.offset))) {
          start = previous
          resumed = true
        } else seed = createHash('sha256')
      }
      const discovered = new Map(start.agents)
      const enqueueChildren = () => {
        for (const [agentId, callId] of discovered) {
          // Les métadonnées du transcript nomment des fichiers, jamais un chemin hors de la session.
          if (/^[a-zA-Z0-9_-]+$/.test(agentId)) {
            pending.push([join(path.replace(/\.jsonl$/, ''), 'subagents', `agent-${agentId}.jsonl`), callId])
          }
        }
      }
      if (!unchanged) {
        const anchors = resumed ? null : getAnchors()
        const translator = transcriptTranslator(cwd, thread, start.translation)
        // Sans curseur, il faut un point commun avec le journal (un `uuid` déjà vu). Un
        // fil neuf n'en a pas besoin, ni un sous-agent qui n'a encore rien laissé au journal.
        let foundAnchor =
          resumed || (!hasHistory && thread === null) || (thread !== null && !anchors?.subAgentIds.has(thread))
        const scanSeed = seed.copy()
        for await (const line of reader.lines(start.offset, scanSeed)) {
          if (!line.entry) continue
          if (thread === null) result.mainEntries++
          for (const pair of spawnedAgents([line.entry])) discovered.set(...pair)
          const events = translator.push(line.entry)
          if (events.length) result.firstTs = Math.min(result.firstTs ?? Infinity, events[0]!.ts)
          if (thread === null && !result.firstPrompt) {
            const first = events.find(
              ({ event }) => event.type === 'message.completed' && event.role === 'user',
            )?.event
            if (first?.type === 'message.completed') {
              result.firstPrompt =
                first.blocks
                  .find((block) => block.type === 'text')
                  ?.text.trim()
                  .replace(/\s+/g, ' ')
                  .slice(0, 256) ?? null
            }
          }
          if (anchors && typeof line.entry.uuid === 'string' && anchors.uuids.has(line.entry.uuid)) {
            foundAnchor = true
            start = {
              offset: line.end,
              digest: line.digest,
              stamp: reader.stamp,
              complete: false,
              translation: translator.snapshot(),
              agents: [...discovered],
            }
            seed = scanSeed.copy()
          }
        }
        // Journal et transcript sans point commun : reprendre au hasard doublerait le
        // fil, on ne devine jamais.
        if (!foundAnchor) {
          if (thread === null) return null
          enqueueChildren()
          continue
        }
        if (thread === null) result.model = translator.snapshot().model
      } else if (thread === null) result.model = start.translation.model
      result.sources.push({ path: sourcePath, thread, start, seed, stamp: reader.stamp, unchanged, discovered })
      enqueueChildren()
    } finally {
      result.bytesRead += reader.bytesRead
      result.parsed += reader.parsed
      await reader.file.close()
    }
  }
  return result
}

interface Piece {
  events: TranslatedEvent[]
  cursor: Cursor
  ts: number
}

async function* pieces(source: Source, cwd: string): AsyncGenerator<Piece> {
  if (source.unchanged) return
  const reader = await TranscriptReader.open(source.path)
  if (!reader) throw new TranscriptChanged('Transcript disappeared')
  try {
    if (!sameStamp(reader.stamp, source.stamp)) throw new TranscriptChanged('Transcript changed before import')
    const translator = transcriptTranslator(cwd, source.thread, source.start.translation)
    const agents = new Map(source.start.agents)
    let cursor = { ...source.start, stamp: source.stamp, complete: false }
    let ts = 0
    for await (const line of reader.lines(source.start.offset, source.seed.copy())) {
      const events = line.entry ? translator.push(line.entry) : []
      if (line.entry) {
        for (const pair of spawnedAgents([line.entry])) agents.set(...pair)
        ts = entryTs(line.entry)
      }
      cursor = {
        ...cursor,
        offset: line.end,
        digest: line.digest,
        translation: translator.snapshot(),
        agents: [...agents],
      }
      yield { events, cursor, ts }
    }
    yield { events: [], cursor: { ...cursor, complete: true }, ts }
  } finally {
    await reader.file.close()
  }
}

/**
 * Importe ce que `prepareTranscript` a repéré, par lots bornés en lignes et en octets
 * sérialisés, chaque lot écrit avec son curseur dans la même transaction SQLite.
 *
 * Les fils (principal et sous-agents) sont fusionnés par horodatage : le CLI les écrit
 * dans des fichiers séparés, mais ils appartiennent au même journal.
 */
export async function importPreparedTranscript(options: {
  prepared: PreparedTranscript
  db: Db
  log: EventLog
  id: string
  cwd: string
  lastSeq: number
  anchors?: Anchors
  opening?: TranslatedEvent
  release: () => Promise<boolean>
}): Promise<{ imported: number; lastSeq: number }> {
  const { prepared, db, log, id, cwd } = options
  const state: Saved = {
    version: 1,
    path: prepared.path,
    sources: Object.fromEntries(prepared.sources.map((source) => [source.path, source.start])),
    recount: prepared.needsRecount,
  }
  let expectedSeq = options.lastSeq
  let imported = 0
  let released = false
  let batch: TranslatedEvent[] = options.opening ? [options.opening] : []
  let bytes = 0
  let records = 0
  let lastEvent: TranslatedEvent | undefined
  const iterators = prepared.sources.map((source) => pieces(source, cwd))
  try {
    const heads = await Promise.all(iterators.map((iterator) => iterator.next()))
    const flush = async (final = false) => {
      for (const source of prepared.sources) await assertTranscriptStamp(source.path, source.stamp)
      // Un runner encore chaud garde un contexte qui ignore ces tours : on l'arrête, la
      // reprise au prochain message repartira du fichier, qui a tout.
      if (batch.length && !released) {
        if (!(await options.release())) throw new TranscriptChanged('Conversation became active')
        released = true
      }
      // Ce qui s'écrit en direct entre deux lectures passe avant l'import. Aucun curseur
      // ne doit couvrir des entrées qui n'ont pas été écrites avec ce lot.
      const current = db
        .select({ seq: conversations.lastSeq, status: conversations.status })
        .from(conversations)
        .where(eq(conversations.id, id))
        .get()
      if (
        !current ||
        current.seq !== expectedSeq ||
        current.status === 'running' ||
        current.status === 'awaiting_input'
      ) {
        throw new TranscriptChanged('Journal changed during import')
      }
      if (batch.length) state.recount = true
      const recount = final && state.recount
      if (final) state.recount = false
      log.appendBatch(
        id,
        batch,
        TRANSCRIPT_RAW_FORMAT,
        (tx, seq) => {
          if (seq !== expectedSeq + batch.length) throw new TranscriptChanged('Journal changed before commit')
          const value = JSON.stringify(state)
          tx.insert(claudeTranscriptCursors)
            .values({ conversationId: id, journalSeq: seq, state: value })
            .onConflictDoUpdate({
              target: claudeTranscriptCursors.conversationId,
              set: { journalSeq: seq, state: value },
            })
            .run()
          expectedSeq = seq
        },
        recount,
      )
      batch = []
      bytes = 0
      records = 0
    }
    for (;;) {
      let selected = -1
      for (let i = 0; i < heads.length; i++) {
        const head = heads[i]!
        if (!head.done && (selected === -1 || head.value.ts < heads[selected]!.value!.ts)) selected = i
      }
      if (selected === -1) break
      const piece = heads[selected]!.value!
      state.sources[prepared.sources[selected]!.path] = piece.cursor
      for (const item of piece.events) {
        const event = item.event
        // Un tour interrompu peut laisser son appel d'outil après le point commun alors
        // que le flux vivant l'a déjà journalisé. Le début compte autant que le
        // résultat : un `tool.started` en double rouvre le tour dans le fil replié.
        if (event.type === 'tool.started' && options.anchors?.startedToolCallIds.has(event.toolCallId)) continue
        if (
          (event.type === 'tool.completed' || event.type === 'file.edited') &&
          options.anchors?.completedToolCallIds.has(event.toolCallId)
        ) {
          continue
        }
        batch.push(item)
        imported++
        lastEvent = item
        bytes += Buffer.byteLength(JSON.stringify(item))
      }
      records++
      // Un enregistrement du transcript reste atomique, même plus gros que le budget.
      if (batch.length >= 128 || bytes >= 1024 * 1024 || records >= 512) await flush()
      heads[selected] = await iterators[selected]!.next()
    }
    // Rien ne tournera plus après ce rattrapage : le lot doit laisser le fil au repos,
    // sinon un tour ouvert en son milieu resterait affiché « en cours » à chaque
    // rechargement. Le traducteur ne clôt que les tours qu'il a vus s'ouvrir.
    if (lastEvent && lastEvent.event.type !== 'turn.completed' && lastEvent.event.type !== 'session.ended') {
      batch.push({ ts: lastEvent.ts, event: { type: 'session.ended', reason: 'interrupted' } })
    }
    if (prepared.sources.some((source) => !source.unchanged) || batch.length || state.recount) await flush(true)
    return { imported, lastSeq: expectedSeq }
  } finally {
    for (const iterator of iterators) await iterator.return(undefined)
  }
}
