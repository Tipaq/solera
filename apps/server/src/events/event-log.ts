import { EventEmitter } from 'node:events'
import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import { conversationPaths, conversations, events, writeTransaction, type Db, type Tx } from '@solera/db'
import {
  soleraEventSchema,
  type BackgroundTask,
  type JournalEntry,
  type SoleraEvent,
} from '@solera/protocol'
import { indexConversation, indexMessage } from '../search/search-index.js'
import {
  advanceIndex,
  emptySupersessionIndex,
  INDEXED_TYPES,
  isSuperseded,
  type SupersessionIndex,
} from './superseded.js'
import { bodyPayload, bodyWeight, prepareBodyPayload } from './event-bodies.js'
import { ThreadProjection } from './thread-projection.js'
import { replayPayload, replayWeight } from './tool-output.js'
import { touchedPaths } from './touched-paths.js'

/**
 * Le journal (invariant I2 de la spec).
 *
 * Tout ce que produit un agent est écrit ici avant d'être diffusé. Les clients ne
 * reçoivent jamais un événement qui ne serait pas déjà persisté, donc une coupure
 * réseau ne peut pas faire perdre d'information : à la reconnexion, le client rejoue
 * depuis son curseur.
 *
 * `seq` est strictement croissant par conversation. Il peut comporter des trous après
 * compaction des deltas ; la lecture se fait toujours par `seq > curseur`, jamais par
 * incrément supposé.
 */
/** Les trois formes d'interaction bloquante, indexées par l'événement qui les ouvre. */
const PROMPT_KINDS: Record<string, PromptKind | undefined> = {
  'permission.requested': 'permission',
  'question.requested': 'question',
  'plan.review_requested': 'plan',
  'elicitation.requested': 'elicitation',
}

const RESOLUTIONS: Record<PromptKind, string> = {
  permission: 'permission.resolved',
  question: 'question.resolved',
  plan: 'plan.review_resolved',
  elicitation: 'elicitation.resolved',
}

export type PromptKind = 'permission' | 'question' | 'plan' | 'elicitation'

/**
 * Tours du fil principal, comptés depuis le journal.
 *
 * Un par message de l'utilisateur : c'est le découpage de la réglette de repères
 * (`buildTurns` côté web), et les deux surfaces doivent s'accorder sur le même fil.
 * Compter aussi les messages de l'agent reviendrait à compter ses étapes, chacun de ses
 * appels d'outil en produisant un.
 *
 * Dérivé des messages et non des `turn.started`, dont il diffère dans les deux sens :
 * un tour s'ouvre aussi sans que personne n'écrive (reprise de session, réveil de
 * boucle, suite de plan), et un steer ajoute un message au tour en cours sans en ouvrir
 * un. Sur les conversations mesurées, un peu moins de la moitié s'écartent. C'est le
 * découpage du fil qui fait foi ici, pas le cycle de vie du runner : le nombre affiché
 * doit être celui des repères qu'on peut réellement atteindre.
 *
 * Sur `messageId` distinct et non sur les événements : un message arrive en plusieurs
 * `message.completed` (réflexion, puis appels d'outils). Les messages d'un sous-agent
 * portent un `parentToolCallId` et appartiennent à son fil, pas à celui-ci.
 *
 * Recompté plutôt qu'incrémenté : reconnaître le premier `message.completed` d'un
 * message demanderait de retenir le précédent, état de plus pour un compte qu'une
 * requête rend en une fois, et seulement en fin de tour.
 */
const TURN_COUNT = sql<number>`(
  select count(distinct ${events.payload} ->> '$.messageId')
  from ${events}
  where ${events.conversationId} = ${conversations.id}
    and ${events.type} = 'message.completed'
    and ${events.payload} ->> '$.role' = 'user'
    and coalesce(${events.payload} ->> '$.parentToolCallId', '') = ''
)`

/**
 * Les événements qui valent qu'on signale la conversation à son lecteur.
 *
 * Même doctrine que `NOTIFIABLE` du gestionnaire de sessions, et presque la même liste :
 * les moments où l'agent réclame une décision, et la fin d'un tour. `error` s'y ajoute,
 * qu'une notification n'annonce pas mais qui compte quand on retrouve le fil plus tard.
 *
 * Liste nommée plutôt qu'une exclusion des événements de service : le journal avance
 * aussi tout seul, et compter `session.ended` ou `usage.updated`, écrits une fois tout
 * le monde parti, allumait 57 conversations sur 80 sans que personne n'ait rien à y
 * lire. Une liste fermée se relit ; une règle par la négative se serait retrouvée
 * fausse au premier type d'événement ajouté.
 */
const NOTABLE = new Set<SoleraEvent['type']>([
  'turn.completed',
  'error',
  'permission.requested',
  'question.requested',
  'elicitation.requested',
  'plan.review_requested',
  // Un message de session retenu attend qu'une personne le remette ou l'écarte.
  'session_message.held',
  // Une demande de rangement attend un clic, et rien ne la périme : elle doit se voir
  // dans la liste tant que personne n'a répondu.
  'filing.requested',
  // Le jumeau carte, et il en a encore plus besoin : c'est le propriétaire du *projet*
  // qui tranche, et il n'a aucune raison d'avoir ce fil ouvert. Sans ce mot, la
  // proposition est invisible et tient pourtant la place de l'unique demande en attente
  // de la conversation, qui ne peut alors plus rien proposer.
  'card_filing.requested',
  // Un brouillon de cartes (#70) attend lui aussi un clic du propriétaire du projet.
  'card_draft.proposed',
  // Une décision attend une personne, souvent pendant des heures : comme les deux
  // rangements, elle doit se voir dans la liste tant que personne n'a répondu.
  'decision.requested',
])

/**
 * Poids d'une entrée sur disque, en octets et non en caractères : un fil accentué ou
 * riche en emoji pèse davantage que ce que `String.length` en dit.
 */
function byteSize(payload: string, raw: string | null): number {
  return Buffer.byteLength(payload) + (raw === null ? 0 : Buffer.byteLength(raw))
}

/** Les événements dont la projection de transport peut alléger le corps. */
const BODY_TYPES = new Set<SoleraEvent['type']>([
  'message.completed',
  'tool.started',
  'tool.input_updated',
  'tool.completed',
  'diff.updated',
])

/**
 * Budget des index de relecture gardés en mémoire, ceux des conversations ouvertes
 * récemment. Compté en octets estimés et non en nombre d'index : celui d'une très
 * longue conversation pèse autant que des dizaines de petites.
 */
const SUPERSESSION_INDEX_BYTES = 16 * 1024 * 1024

export class EventLog {
  /** Le fil projeté de chaque conversation, tenu à jour après chaque écriture. */
  readonly thread: ThreadProjection
  private readonly bus = new EventEmitter()
  private readonly supersession = new Map<string, SupersessionIndex>()
  private readonly indexWeights = new WeakMap<SupersessionIndex, { seq: number; bytes: number }>()

  constructor(private readonly db: Db) {
    // Une conversation très suivie (plusieurs onglets, mobile et desktop) dépasse
    // vite la limite par défaut de 10 écouteurs.
    this.bus.setMaxListeners(200)
    this.thread = new ThreadProjection(db, this)
  }

  /**
   * Incrémente `seq` et insère l'événement dans la même transaction : deux écritures
   * concurrentes sur la même conversation ne peuvent pas obtenir le même numéro.
   */
  append(
    conversationId: string,
    event: SoleraEvent,
    raw?: unknown,
    rawFormat?: string,
  ): JournalEntry {
    const ts = Date.now()

    const entry = writeTransaction(this.db, (tx): JournalEntry => {
      const row = tx
        .select({ lastSeq: conversations.lastSeq })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get()

      if (!row) throw new Error(`Conversation inconnue : ${conversationId}`)
      const seq = row.lastSeq + 1

      const payload = JSON.stringify(event)
      const storedRaw = raw === undefined ? null : JSON.stringify(raw)

      tx.insert(events)
        .values({
          conversationId,
          seq,
          ts,
          type: event.type,
          payload,
          raw: storedRaw,
          rawFormat: raw === undefined ? null : (rawFormat ?? null),
        })
        .run()

      tx.update(conversations)
        .set({
          lastSeq: seq,
          ...(NOTABLE.has(event.type) ? { lastNotableSeq: seq } : {}),
          updatedAt: ts,
          journalBytes: sql`${conversations.journalBytes} + ${byteSize(payload, storedRaw)}`,
        })
        .where(eq(conversations.id, conversationId))
        .run()

      // Dans la même transaction que l'écriture du journal : l'index ne peut pas
      // contenir un message que le journal n'aurait pas, ni l'inverse.
      if (event.type === 'message.completed') indexMessage(tx, conversationId, seq)
      recordTouchedPaths(tx, conversationId, event, ts)

      return { conversationId, seq, ts, event }
    })

    this.bus.emit(conversationId, entry)
    this.bus.emit(ALL_EVENTS, entry)
    this.thread.schedule(conversationId)
    return entry
  }

  /**
   * Ajoute d'un bloc les événements traduits d'un transcript CLI (import ou
   * resynchronisation), avec leurs dates d'origine.
   *
   * Une transaction pour l'ensemble : un import de plusieurs centaines d'événements
   * en autant de transactions multiplierait les fsync pour rien, et un échec à
   * mi-course laisserait un fil tronqué sans que rien ne le dise. La diffusion sur le
   * bus reste par événement, comme pour `append` : un onglet déjà abonné voit la
   * resynchronisation arriver en direct.
   */
  appendBatch(
    conversationId: string,
    batch: { ts: number; event: SoleraEvent; raw?: unknown }[],
    /** Provenance commune des `raw` du lot, quand ils viennent d'une même source. */
    rawFormat?: string,
    /** Écrit le curseur d'un import de transcript dans la même transaction que ses événements. */
    checkpoint?: (tx: Tx, lastSeq: number) => void,
    /** Un import en flux ne recompte les tours qu'à la fin, pas à chacun de ses petits lots. */
    recountTurns = true,
  ): number {
    if (batch.length === 0 && !checkpoint) return 0

    const entries = writeTransaction(this.db, (tx): JournalEntry[] => {
      const row = tx
        .select({ lastSeq: conversations.lastSeq })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get()
      if (!row) throw new Error(`Conversation inconnue : ${conversationId}`)

      let bytes = 0
      let notableSeq = 0
      const appended = batch.map((item, index): JournalEntry => {
        const seq = row.lastSeq + index + 1
        if (NOTABLE.has(item.event.type)) notableSeq = seq
        const payload = JSON.stringify(item.event)
        const storedRaw = item.raw === undefined ? null : JSON.stringify(item.raw)
        bytes += byteSize(payload, storedRaw)

        tx.insert(events)
          .values({
            conversationId,
            seq,
            ts: item.ts,
            type: item.event.type,
            payload,
            raw: storedRaw,
            rawFormat: item.raw === undefined ? null : (rawFormat ?? null),
          })
          .run()
        if (item.event.type === 'message.completed') indexMessage(tx, conversationId, seq)
        recordTouchedPaths(tx, conversationId, item.event, item.ts)
        return { conversationId, seq, ts: item.ts, event: item.event }
      })

      checkpoint?.(tx, row.lastSeq + batch.length)

      // Le compte de tours est repris ici et pas au fil des insertions : un import
      // amène des messages entiers d'un coup, et une seule requête les couvre tous.
      // Mais pas à chaque lot d'un import en flux : recompter tout le journal à chaque
      // fois rendrait l'import quadratique.
      if (batch.length || recountTurns) {
        tx.update(conversations)
          .set({
            lastSeq: row.lastSeq + batch.length,
            ...(notableSeq > 0 ? { lastNotableSeq: notableSeq } : {}),
            updatedAt: Date.now(),
            journalBytes: sql`${conversations.journalBytes} + ${bytes}`,
            ...(recountTurns ? { turnCount: TURN_COUNT } : {}),
          })
          .where(eq(conversations.id, conversationId))
          .run()
      }

      return appended
    })

    for (const entry of entries) this.bus.emit(conversationId, entry)
    if (entries.length) this.thread.schedule(conversationId)
    return entries.at(-1)?.seq ?? 0
  }

  /**
   * Repères pour aligner le journal sur le transcript CLI.
   *
   * `uuids` : identifiants de transcript déjà connus, portés par les `raw` (le flux
   * vivant comme l'import les conservent). Le dernier commun aux deux côtés donne le
   * point de reprise. `startedToolCallIds` et `completedToolCallIds` : les appels
   * d'outils déjà journalisés, dont l'entrée de transcript peut se trouver après ce
   * point quand un tour a été interrompu, et qu'il ne faut pas réimporter en doublon.
   * `subAgentIds` : les appels dont le sous-agent a déjà laissé des traces au journal.
   * Il distingue, pour un fichier de sous-agent sans `uuid` commun, celui qui est déjà
   * journalisé d'un fichier neuf.
   *
   * Contrat Claude : `raw.uuid` est un identifiant d'entrée du transcript de Claude
   * Code, seul CLI à en écrire un. Les `raw` Codex n'en portent pas, la lecture est
   * donc inoffensive ailleurs, mais elle n'a de sens que pour cet adaptateur.
   */
  importAnchors(conversationId: string): {
    uuids: Set<string>
    startedToolCallIds: Set<string>
    completedToolCallIds: Set<string>
    subAgentIds: Set<string>
  } {
    // Seuls les identifiants passent en JS : les `raw` natifs comme les payloads
    // normalisés d'une longue conversation dépassent chacun le tas du daemon.
    const rows = this.db
      .select({
        type: events.type,
        uuid: sql<string | null>`case when json_valid(${events.raw}) and json_type(${events.raw}, '$.uuid') = 'text'
          then ${events.raw} ->> '$.uuid' end`,
        toolCallId: sql<string | null>`case when json_type(${events.payload}, '$.toolCallId') = 'text'
          then ${events.payload} ->> '$.toolCallId' end`,
        parentToolCallId: sql<string | null>`case when json_type(${events.payload}, '$.parentToolCallId') = 'text'
          then ${events.payload} ->> '$.parentToolCallId' end`,
      })
      .from(events)
      .where(eq(events.conversationId, conversationId))
      .all()

    const uuids = new Set<string>()
    const startedToolCallIds = new Set<string>()
    const completedToolCallIds = new Set<string>()
    const subAgentIds = new Set<string>()
    for (const row of rows) {
      if (row.uuid !== null) uuids.add(row.uuid)
      if (row.type === 'tool.started' && row.toolCallId !== null) startedToolCallIds.add(row.toolCallId)
      if (row.type === 'tool.completed' && row.toolCallId !== null) completedToolCallIds.add(row.toolCallId)
      if (row.parentToolCallId !== null) subAgentIds.add(row.parentToolCallId)
    }
    return { uuids, startedToolCallIds, completedToolCallIds, subAgentIds }
  }

  read(conversationId: string, afterSeq: number, limit: number): JournalEntry[] {
    const rows = this.db
      .select()
      .from(events)
      .where(and(eq(events.conversationId, conversationId), gt(events.seq, afterSeq)))
      .orderBy(asc(events.seq))
      .limit(limit)
      .all()

    return rows.map((row) => ({
      conversationId: row.conversationId,
      seq: row.seq,
      ts: row.ts,
      event: this.parseStored(row.seq, row.payload),
    }))
  }

  /**
   * Page de relecture d'historique, sans ce que la suite du journal rend caduc
   * (`superseded.ts`) ni les sorties d'outils volumineuses (`tool-output.ts`), et bornée
   * en octets autant qu'en lignes.
   *
   * Les lignes sont d'abord listées sans leur contenu (`octet_length` lit la taille sans
   * charger le payload), puis seules celles qu'on garde sont lues et validées : un patch
   * écarté ne quitte pas le disque.
   *
   * La borne en octets protège le tas du daemon. Deux mille lignes consécutives pèsent
   * jusqu'à 141 Mo sur une conversation de la base, quand la plupart tiennent en quelques
   * centaines de ko. Une page garde toujours au moins un événement, sans quoi un
   * événement plus lourd que la borne ne passerait jamais.
   *
   * `nextAfter` est le dernier `seq` examiné, gardé ou non : la page suivante reprend là.
   */
  readForReplay(
    conversationId: string,
    afterSeq: number,
    limits: {
      rows: number
      bytes: number
      /** Corps lourds en références (`event-bodies.ts`), pour un client qui sait les demander. */
      bodies?: boolean
      /** Sans tri de supplantation : la projection veut tout, et n'a pas à bâtir l'index. */
      unfiltered?: boolean
    },
  ): { entries: JournalEntry[]; nextAfter: number } {
    // Revenir sur un fil projeté inchangé ne demande pas d'index de supplantation.
    const lastSeq =
      this.db
        .select({ seq: conversations.lastSeq })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get()?.seq ?? 0
    if (afterSeq >= lastSeq) return { entries: [], nextAfter: afterSeq }
    const index = limits.unfiltered ? null : this.supersessionIndex(conversationId)
    const listed = this.db
      .select({
        seq: events.seq,
        type: events.type,
        bytes: limits.bodies ? bodyWeight : replayWeight,
        toolCallId: sql<string | null>`case when ${events.type} = 'tool.output_delta'
          then ${events.payload} ->> '$.toolCallId' end`,
      })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), gt(events.seq, afterSeq)))
      .orderBy(asc(events.seq))
      .limit(limits.rows)
      .all()

    const kept: number[] = []
    let bytes = 0
    let nextAfter = afterSeq
    for (const row of listed) {
      if (!index || !isSuperseded(index, row)) {
        if (kept.length > 0 && bytes + row.bytes > limits.bytes) break
        kept.push(row.seq)
        bytes += row.bytes
      }
      nextAfter = row.seq
    }

    if (kept.length === 0) return { entries: [], nextAfter }

    const rows = this.db
      .select({ seq: events.seq, ts: events.ts, payload: limits.bodies ? bodyPayload : replayPayload })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), inArray(events.seq, kept)))
      .orderBy(asc(events.seq))
      .all()

    return {
      entries: rows.map((row) => ({
        conversationId,
        seq: row.seq,
        ts: row.ts,
        event: this.parseStored(row.seq, row.payload, limits.bodies),
      })),
      nextAfter,
    }
  }

  /** Le rattrapage du socket garde tous les `seq`, mais la représentation légère de REST. */
  readWithBodies(conversationId: string, afterSeq: number, limit: number): JournalEntry[] {
    return this.db
      .select({ seq: events.seq, ts: events.ts, payload: bodyPayload })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), gt(events.seq, afterSeq)))
      .orderBy(asc(events.seq))
      .limit(limit)
      .all()
      .map((row) => ({
        conversationId,
        seq: row.seq,
        ts: row.ts,
        event: this.parseStored(row.seq, row.payload, true),
      }))
  }

  /** Un événement en direct est déjà écrit : on projette cette ligne-là, jamais un appel plus récent. */
  withBodies(entry: JournalEntry): JournalEntry {
    if (!BODY_TYPES.has(entry.event.type)) return entry
    return this.readWithBodies(entry.conversationId, entry.seq - 1, 1)[0] ?? entry
  }

  /**
   * Un corps laissé au serveur par la projection de transport. Le chemin JSON est
   * construit ici et jamais reçu du client, et seuls les champs que la projection
   * remplace sont lisibles : rien du `raw` natif.
   */
  eventBody(
    conversationId: string,
    seq: number,
    field: 'input' | 'output' | 'patch',
    block?: number,
  ): { value: unknown } | null {
    const path = block === undefined ? `$.${field}` : `$.blocks[${block}].${field}`
    const row = this.db
      .select({
        value: sql<string | null>`${events.payload} -> ${path}`,
        type: events.type,
        blockType: sql<string | null>`${events.payload} ->> ${block === undefined ? '$.type' : `$.blocks[${block}].type`}`,
      })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), eq(events.seq, seq)))
      .get()
    if (!row || row.value === null) return null
    const allowed =
      block === undefined
        ? (field === 'input' && (row.type === 'tool.started' || row.type === 'tool.input_updated')) ||
          (field === 'output' && row.type === 'tool.completed') ||
          (field === 'patch' && row.type === 'diff.updated')
        : row.type === 'message.completed' &&
          ((field === 'input' && row.blockType === 'tool_use') ||
            (field === 'output' && row.blockType === 'tool_result'))
    return allowed ? { value: JSON.parse(row.value) } : null
  }

  /** L'URL `data:` d'une image de message, servie à part du fil. */
  eventImage(conversationId: string, seq: number, block: number): string | null {
    const row = this.db
      .select({ url: sql<string | null>`${events.payload} ->> ${`$.blocks[${block}].url`}` })
      .from(events)
      .where(
        and(
          eq(events.conversationId, conversationId),
          eq(events.seq, seq),
          eq(events.type, 'message.completed'),
          sql`${events.payload} ->> ${`$.blocks[${block}].type`} = 'image'`,
        ),
      )
      .get()
    return row?.url ?? null
  }

  /**
   * Index de supplantation d'une conversation, à jour de son dernier `seq`.
   *
   * Construit une fois (44 ms sur la plus lourde en base), puis avancé à chaque page sur
   * les seuls événements arrivés depuis : relire toute la suite du journal à chaque page
   * coûterait autant que ce qu'on cherche à épargner.
   */
  private supersessionIndex(conversationId: string): SupersessionIndex {
    const lastSeq =
      this.db
        .select({ lastSeq: conversations.lastSeq })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .get()?.lastSeq ?? 0

    let index = this.supersession.get(conversationId)
    // Un journal ne raccourcit que remis à zéro hors du daemon : l'index repart alors de
    // rien, plutôt que de trier selon un journal qui n'existe plus.
    if (!index || index.seq > lastSeq) index = emptySupersessionIndex()

    if (lastSeq > index.seq) {
      const rows = this.db
        .select({
          seq: events.seq,
          type: events.type,
          toolCallId: sql<string | null>`case when ${events.type} = 'tool.completed'
            then ${events.payload} ->> '$.toolCallId' end`,
        })
        .from(events)
        .where(
          and(
            eq(events.conversationId, conversationId),
            gt(events.seq, index.seq),
            lte(events.seq, lastSeq),
            inArray(events.type, INDEXED_TYPES),
          ),
        )
        .orderBy(asc(events.seq))
        .all()
      advanceIndex(index, rows, lastSeq)
    }

    // Réinsérée pour passer en queue : une `Map` garde l'ordre d'insertion, donc la
    // première clé est celle qu'on a relue le moins récemment.
    this.supersession.delete(conversationId)
    this.supersession.set(conversationId, index)
    if (this.indexWeights.get(index)?.seq !== index.seq) {
      let weight = 128 + conversationId.length * 2 + index.diffTurn.size * 48 + index.turnDiffs.size * 80
      for (const key of index.completed.keys()) weight += 64 + key.length * 2
      this.indexWeights.set(index, { seq: index.seq, bytes: weight })
    }
    // Du plus récent au plus ancien : ce qui dépasse le budget sort, et l'index qu'on
    // vient de relire passe toujours en premier.
    let bytes = 0
    for (const [id, cached] of [...this.supersession].reverse()) {
      bytes += this.indexWeights.get(cached)?.bytes ?? 0
      if (bytes > SUPERSESSION_INDEX_BYTES && id !== conversationId) this.supersession.delete(id)
    }
    return index
  }

  /**
   * Les derniers événements de certains types, du plus récent au plus ancien.
   *
   * Replier un journal entier pour dire où en est une conversation coûterait le prix de
   * tout son historique à chaque appel. Ce qui décrit le présent tient dans les
   * dernières entrées, et `limit` borne la lecture.
   */
  latest(conversationId: string, types: string[], limit: number): JournalEntry[] {
    const rows = this.db
      .select()
      .from(events)
      .where(and(eq(events.conversationId, conversationId), inArray(events.type, types)))
      .orderBy(desc(events.seq))
      .limit(limit)
      .all()

    return rows.map((row) => ({
      conversationId: row.conversationId,
      seq: row.seq,
      ts: row.ts,
      event: this.parseStored(row.seq, row.payload),
    }))
  }

  /**
   * Dernier texte que l'agent a adressé à l'utilisateur, hors sous-agents : ce qu'un
   * appelant sans interface (webhook, tir planifié suivant) retient d'un tour.
   */
  lastAssistantText(conversationId: string): string | null {
    const entries = this.latest(conversationId, ['message.completed'], 20)
    for (const entry of entries) {
      const event = entry.event as {
        role?: string
        parentToolCallId?: string | null
        blocks?: { type: string; text?: string }[]
      }
      if (event.role !== 'assistant' || event.parentToolCallId !== null) continue
      const text = (event.blocks ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim()
      if (text) return text
    }
    return null
  }

  /**
   * Remet le compte de tours d'aplomb sur ce que contient le journal.
   *
   * Appelée en fin de tour : c'est le moment où les messages du tour sont tous écrits,
   * et une fois par tour suffit pour une ligne de sidebar.
   */
  refreshTurnCount(conversationId: string): void {
    this.db
      .update(conversations)
      .set({ turnCount: TURN_COUNT })
      .where(eq(conversations.id, conversationId))
      .run()
  }

  /** Nombre d'événements d'un type, sans les charger. */
  count(conversationId: string, type: string): number {
    const row = this.db
      .select({ n: sql<number>`count(*)` })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), eq(events.type, type)))
      .get()

    return row?.n ?? 0
  }

  /**
   * Demandes d'interaction encore ouvertes : une requête dont la résolution n'a jamais
   * été journalisée.
   *
   * Un daemon tué net n'exécute pas la sortie de ses runners, donc rien ne vient
   * clore les demandes en cours. Sans ce relevé, le fil rejoué garderait
   * indéfiniment une question posée et une conversation coincée en attente.
   */
  openPrompts(conversationId: string): { kind: PromptKind; requestId: string }[] {
    const rows = this.db
      .select({ type: events.type, payload: events.payload })
      .from(events)
      .where(
        and(
          eq(events.conversationId, conversationId),
          inArray(events.type, [...Object.keys(PROMPT_KINDS), ...Object.values(RESOLUTIONS)]),
        ),
      )
      .orderBy(asc(events.seq))
      .all()

    const open = new Map<string, PromptKind>()
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as { requestId?: string }
      if (typeof payload.requestId !== 'string') continue

      const kind = PROMPT_KINDS[row.type]
      if (kind) open.set(payload.requestId, kind)
      else open.delete(payload.requestId)
    }

    return [...open].map(([requestId, kind]) => ({ kind, requestId }))
  }

  /** Une question asynchrone peut rester ouverte sur une conversation au repos. */
  openAsyncQuestionConversationIds(): string[] {
    return this.db.selectDistinct({ id: events.conversationId }).from(events).where(sql`
      ${events.type} = 'question.requested' AND ${events.payload} ->> '$.blocking' = 0
      AND NOT EXISTS (
        SELECT 1 FROM events AS resolved
        WHERE resolved.conversation_id = ${events.conversationId}
          AND resolved.type = 'question.resolved'
          AND resolved.seq > ${events.seq}
          AND resolved.payload ->> '$.requestId' = ${events.payload} ->> '$.requestId'
      )
    `).all().map((row) => row.id)
  }

  /**
   * Les travaux de fond que le journal donne encore pour vivants.
   *
   * Même service que `openPrompts`, pour la liste de niveau. Le CLI publie l'ensemble
   * de ses travaux à chaque changement et ne publie rien en mourant : sa dernière liste
   * reste donc le dernier mot du journal, dont tout l'affichage est dérivé. C'est ce
   * relevé qui dit ce qu'il reste à clore quand le process s'en va.
   *
   * Rejoué dans l'ordre, avec la même sémantique que le fold côté web : la liste de
   * niveau remplace, une fin de travail retire, une fin de session vide tout.
   */
  openBackgroundTasks(conversationId: string): BackgroundTask[] {
    const rows = this.db
      .select({ type: events.type, payload: events.payload })
      .from(events)
      .where(
        and(
          eq(events.conversationId, conversationId),
          inArray(events.type, ['background.updated', 'task.completed', 'session.ended']),
        ),
      )
      .orderBy(asc(events.seq))
      .all()

    let live = new Map<string, BackgroundTask>()
    for (const row of rows) {
      if (row.type === 'session.ended') {
        live.clear()
        continue
      }

      const payload = JSON.parse(row.payload) as { tasks?: BackgroundTask[]; taskId?: string }
      if (row.type === 'background.updated') {
        live = new Map((payload.tasks ?? []).map((task) => [task.id, task]))
      } else if (typeof payload.taskId === 'string') {
        live.delete(payload.taskId)
      }
    }

    return [...live.values()]
  }

  /**
   * Copie le début d'un journal vers une autre conversation, pour un fork.
   *
   * `raw` est copié aussi : c'est lui qui porte l'identifiant de transcript dont un
   * fork ultérieur de la branche aura besoin (invariant I3). Les `seq` sont renumérotés
   * depuis 1, la nouvelle conversation ayant sa propre séquence.
   *
   * Le fil forké serait vide sans cette copie, alors que l'agent, lui, se souvient :
   * c'est exactement le genre d'écart entre affichage et réalité que l'invariant I2
   * interdit.
   */
  copyThrough(fromConversationId: string, toConversationId: string, throughSeq: number): number {
    const rows = this.db
      .select()
      .from(events)
      .where(and(eq(events.conversationId, fromConversationId), lte(events.seq, throughSeq)))
      .orderBy(asc(events.seq))
      .all()

    writeTransaction(this.db, (tx) => {
      let bytes = 0
      rows.forEach((row, index) => {
        bytes += byteSize(row.payload, row.raw)
        tx.insert(events)
          .values({
            conversationId: toConversationId,
            seq: index + 1,
            ts: row.ts,
            type: row.type,
            payload: row.payload,
            raw: row.raw,
            rawFormat: row.rawFormat,
          })
          .run()
      })

      tx.update(conversations)
        .set({ lastSeq: rows.length, journalBytes: bytes, turnCount: TURN_COUNT })
        .where(eq(conversations.id, toConversationId))
        .run()

      // La copie n'emprunte pas `append` : sans cette ligne, une branche resterait
      // introuvable par la recherche alors que son fil, lui, contient bien tout.
      indexConversation(tx, toConversationId)
    })

    return rows.length
  }

  /**
   * Payload natif du dernier événement d'un type donné, jusqu'à `throughSeq`.
   *
   * Sert au fork Claude : le point de coupe est une entrée du fichier de transcript,
   * dont l'identifiant n'existe que dans `raw`.
   *
   * `topLevelOnly` écarte les événements produits par un sous-agent (payload portant
   * un `parentToolCallId`) : leur `raw` vient d'une sidechain du transcript, et un
   * point de coupe pris là viserait le mauvais fichier. Les événements d'avant le
   * champ n'en portent pas et restent inclus, comme avant.
   */
  lastRawOfType(
    conversationId: string,
    type: string,
    throughSeq: number,
    opts: { topLevelOnly?: boolean } = {},
  ): unknown {
    const conditions = [
      eq(events.conversationId, conversationId),
      eq(events.type, type),
      lte(events.seq, throughSeq),
    ]
    if (opts.topLevelOnly) {
      conditions.push(sql`coalesce(${events.payload} ->> '$.parentToolCallId', '') = ''`)
    }

    const row = this.db
      .select({ raw: events.raw })
      .from(events)
      .where(and(...conditions))
      .orderBy(desc(events.seq))
      .limit(1)
      .get()

    return row?.raw ? JSON.parse(row.raw) : null
  }

  /**
   * Sortie complète d'un appel d'outil, que la relecture d'historique ne rend qu'en
   * aperçu au-delà d'une certaine taille.
   *
   * Le filtre sur `toolCallId` est fait par SQLite plutôt qu'en JS : charger tous les
   * appels de la conversation pour en retenir un seul se paie sur un fil qui en porte
   * des milliers.
   */
  toolOutput(conversationId: string, toolCallId: string): { output: unknown } | null {
    const row = this.db
      .select({ payload: events.payload })
      .from(events)
      .where(
        and(
          eq(events.conversationId, conversationId),
          eq(events.type, 'tool.completed'),
          sql`${events.payload} ->> '$.toolCallId' = ${toolCallId}`,
        ),
      )
      .orderBy(desc(events.seq))
      .limit(1)
      .get()

    if (!row) return null
    return { output: (JSON.parse(row.payload) as { output?: unknown }).output ?? null }
  }

  /**
   * Payloads natifs d'un appel d'outil : celui de son démarrage et celui de sa fin.
   *
   * C'est là que vit le détail d'une modification de fichier, que le schéma normalisé
   * ne porte pas : le contenu écrit et l'extrait remplacé côté Claude, le patch
   * unifié côté Codex. L'invariant I3 n'est pas contourné pour autant : la lecture est
   * faite par l'adaptateur du CLI concerné, jamais par le frontend.
   */
  rawOfTool(conversationId: string, toolCallId: string): { started: unknown; completed: unknown } {
    // Un seul diff chargeait jusqu'ici tous les payloads d'outils de la conversation
    // (des centaines de Mo) en JS. On garde le dernier natif de chaque sorte, y compris
    // quand un identifiant d'appel est réutilisé ; `idx_events_native_tool` sert la requête.
    const latest = (type: 'tool.started' | 'tool.completed'): unknown => {
      const row = this.db
        .select({ raw: events.raw })
        .from(events)
        .where(
          and(
            eq(events.conversationId, conversationId),
            eq(events.type, type),
            sql`nullif(${events.raw}, '') is not null`,
            sql`${events.payload} ->> '$.toolCallId' = ${toolCallId}`,
          ),
        )
        .orderBy(desc(events.seq))
        .limit(1)
        .get()
      return row?.raw ? JSON.parse(row.raw) : null
    }
    return { started: latest('tool.started'), completed: latest('tool.completed') }
  }

  /**
   * Nature du changement journalisé pour ce couple appel/fichier.
   *
   * Relue plutôt que reçue du client : c'est elle qui décide si un contenu écrit se
   * présente comme une création complète ou comme une réécriture sans point de
   * comparaison, et le journal en est la seule source (invariant I2).
   */
  fileEditAction(
    conversationId: string,
    toolCallId: string,
    path: string,
  ): 'created' | 'modified' | 'deleted' | null {
    const rows = this.db
      .select({ payload: events.payload })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), eq(events.type, 'file.edited')))
      .all()

    for (const row of rows) {
      const payload = JSON.parse(row.payload) as {
        toolCallId?: string
        path?: string
        action?: 'created' | 'modified' | 'deleted'
      }
      if (payload.toolCallId === toolCallId && payload.path === path) return payload.action ?? null
    }
    return null
  }

  /** Nombre d'événements d'un type donné, avant et après un point de coupe. */
  countByType(conversationId: string, type: string, throughSeq: number): { kept: number; total: number } {
    const rows = this.db
      .select({ seq: events.seq })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), eq(events.type, type)))
      .all()

    return {
      kept: rows.filter((row) => row.seq <= throughSeq).length,
      total: rows.length,
    }
  }

  /**
   * Messages mis en file dont le départ n'a jamais été journalisé.
   *
   * Distinct de `openPrompts` : la clé est un `queueId`, et la résolution ne porte pas
   * de décision mais une raison de sortie.
   */
  openQueuedMessages(conversationId: string): string[] {
    const rows = this.db
      .select({ type: events.type, payload: events.payload })
      .from(events)
      .where(
        and(
          eq(events.conversationId, conversationId),
          inArray(events.type, ['message.queued', 'message.dequeued']),
        ),
      )
      .orderBy(asc(events.seq))
      .all()

    const open = new Set<string>()
    for (const row of rows) {
      const payload = JSON.parse(row.payload) as { queueId?: string }
      if (typeof payload.queueId !== 'string') continue
      if (row.type === 'message.queued') open.add(payload.queueId)
      else open.delete(payload.queueId)
    }

    return [...open]
  }

  /**
   * La demande de rangement d'une conversation, telle que le journal la porte.
   *
   * Lue ici plutôt que recalculée : la demande dit le projet de destination, et c'est
   * exactement ce que l'affichage a montré à la personne qui clique. La ligne
   * `agent_requests` reste l'autorité sur l'attente ; le journal, sur le contenu.
   */
  openFiling(
    conversationId: string,
    requestId: string,
  ): Extract<SoleraEvent, { type: 'filing.requested' }> | null {
    const rows = this.db
      .select({ seq: events.seq, payload: events.payload })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), eq(events.type, 'filing.requested')))
      .orderBy(asc(events.seq))
      .all()

    for (const row of rows) {
      const event = this.parseStored(row.seq, row.payload)
      if (event.type === 'filing.requested' && event.requestId === requestId) return event
    }
    return null
  }

  /**
   * La proposition de déplacement de cartes, telle que le journal la porte.
   *
   * Même raison que `openFiling`, et le même découpage d'autorité : la ligne
   * `agent_requests` dit si la demande attend encore, le journal dit ce que la personne a
   * sous les yeux — les cartes, les colonnes visées et les raisons. Les colonnes de
   * départ, elles, sont relues en base au clic : la carte a pu bouger depuis.
   */
  openCardFiling(
    conversationId: string,
    requestId: string,
  ): Extract<SoleraEvent, { type: 'card_filing.requested' }> | null {
    const rows = this.db
      .select({ seq: events.seq, payload: events.payload })
      .from(events)
      .where(and(eq(events.conversationId, conversationId), eq(events.type, 'card_filing.requested')))
      .orderBy(asc(events.seq))
      .all()

    for (const row of rows) {
      const event = this.parseStored(row.seq, row.payload)
      if (event.type === 'card_filing.requested' && event.requestId === requestId) return event
    }
    return null
  }

  /**
   * Les événements sont validés à la relecture, pas seulement castés.
   *
   * C'est ce qui applique les valeurs par défaut du schéma aux entrées écrites avant
   * l'ajout d'un champ : le journal est rejoué indéfiniment (invariant I2), donc une
   * ancienne forme doit continuer à produire un affichage juste plutôt qu'un `NaN`.
   */
  private parseStored(seq: number, payload: string, bodies = false): SoleraEvent {
    const raw: unknown = bodies ? prepareBodyPayload(payload) : JSON.parse(payload)
    const parsed = soleraEventSchema.safeParse(raw)
    if (parsed.success) return parsed.data

    // Un événement irrécupérable est remplacé par une erreur visible dans le fil :
    // le masquer laisserait un trou silencieux dans l'historique.
    return {
      type: 'error',
      code: 'event_unreadable',
      message: `Event ${seq} is unreadable (${parsed.error.issues[0]?.message ?? 'unknown shape'}).`,
      recoverable: true,
    }
  }

  subscribe(conversationId: string, listener: (entry: JournalEntry) => void): () => void {
    this.bus.on(conversationId, listener)
    return () => this.bus.off(conversationId, listener)
  }

  /**
   * Toutes les conversations à la fois, pour les consommateurs transverses (webhooks).
   *
   * Volontairement absent du chemin des imports (`appendBatch`) : rejouer un transcript
   * n'est pas de l'activité, et notifier un appelant pour chaque événement importé
   * l'inonderait de tours vieux de plusieurs jours.
   */
  subscribeAll(listener: (entry: JournalEntry) => void): () => void {
    this.bus.on(ALL_EVENTS, listener)
    return () => this.bus.off(ALL_EVENTS, listener)
  }
}

/** Canal du bus réservé aux abonnés transverses ; hors de portée d'un id de conversation. */
const ALL_EVENTS = Symbol('all-events')

/**
 * Mémorise les chemins hors cwd que l'événement révèle (voir `touched-paths.ts`), dans
 * la transaction du journal : la vue des chantiers les lit au lieu de rebalayer les
 * événements, et ne peut pas en voir un que le journal n'aurait pas.
 */
function recordTouchedPaths(
  tx: Tx,
  conversationId: string,
  event: SoleraEvent,
  ts: number,
): void {
  for (const path of touchedPaths(event)) {
    tx.insert(conversationPaths)
      .values({ conversationId, path, lastTs: ts })
      .onConflictDoUpdate({
        target: [conversationPaths.conversationId, conversationPaths.path],
        set: { lastTs: sql`max(${conversationPaths.lastTs}, ${ts})` },
      })
      .run()
  }
}
