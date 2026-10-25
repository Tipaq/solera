import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AgentConfig, ConversationStatus, SoleraEvent } from '@solera/protocol'
import { applyEvent, emptyChatState, isAwaitingUser, type ChatState } from './chat-fold'
import { fetchJournal, type JournalPage } from './conversations'
import { wsClient } from './ws-client'
import { translate } from './i18n'
import { ApiRequestError } from './api'
import { fetchThreadPage, mergeThreadPage } from './thread-pages'
import { JOURNAL_CACHE_BYTES, JOURNAL_CACHE_IDLE_MS, retainedBytes } from './cache-budget'

interface JournalSnapshot {
  state: ChatState
  cursor: number
  before: number
  hasMore: boolean
  bytes: number
}

const SNAPSHOT_KEY = 'chat-journal-snapshot-v2'

/** Les deltas sont appliqués par lots : un rendu par token effondre le framerate mobile. */
const FLUSH_INTERVAL_MS = 60

/** Le fold modifie l'objet reçu et ses compteurs de boucles : un instantané garde les siens. */
function snapshotState(state: ChatState): ChatState {
  return { ...state, loopFires: new Map(state.loopFires) }
}

export interface ChatStream {
  state: ChatState
  status: ConversationStatus
  connected: boolean
  /** Un process CLI tourne encore pour cette conversation. Null tant qu'on l'ignore. */
  warm: boolean | null
  /**
   * Configuration sous laquelle le CLI tourne vraiment, `null` à froid ou avant le
   * premier statut poussé. Elle diverge de celle enregistrée tant qu'un réglage que le
   * CLI ne sait pas changer en vol attend son redémarrage.
   */
  appliedConfig: AgentConfig | null
  /**
   * La vue d'ouverture n'est pas prête à être placée. Les tours plus anciens ont leur
   * propre état de chargement : la projection du serveur montre les tours récents
   * sans replier tout le journal.
   */
  loading: boolean
  error: string | null
  /** Des tours plus anciens restent sur le serveur. */
  hasMore: boolean
  loadingOlder: boolean
  loadOlder: () => Promise<void>
}

export function useChatStream(
  conversationId: string | undefined,
  initialStatus: ConversationStatus,
): ChatStream {
  const [state, setState] = useState<ChatState>(emptyChatState)
  const [status, setStatus] = useState<ConversationStatus>(initialStatus)
  const [connected, setConnected] = useState(false)
  const [warm, setWarm] = useState<boolean | null>(null)
  const [appliedConfig, setAppliedConfig] = useState<AgentConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const older = useRef<() => Promise<void>>(async () => {})
  const loadOlder = useCallback(() => older.current(), [])
  const queryClient = useQueryClient()

  useEffect(() => {
    setStatus(initialStatus)
  }, [initialStatus])

  useEffect(() => {
    if (!conversationId) return
    const id = conversationId

    const controller = new AbortController()
    const { signal } = controller
    // Cache de l'onglet, effacé avec les autres requêtes à la déconnexion. La
    // projection ne dit rien dans une langue : un changement de langue le garde.
    const snapshotKey = [SNAPSHOT_KEY, conversationId]
    queryClient.setQueryDefaults([SNAPSHOT_KEY], { gcTime: JOURNAL_CACHE_IDLE_MS })
    const snapshot = queryClient.getQueryData<JournalSnapshot>(snapshotKey)
    // L'état du rejeu reste local à cet abonnement : un rappel tardif de la
    // conversation précédente ne doit jamais toucher au curseur de la suivante.
    let currentState = snapshot ? snapshotState(snapshot.state) : emptyChatState()
    let pending: JournalPage = []
    let flushTimer: number | null = null
    let replay: Promise<void> | null = null
    let subscription: { active: boolean; stop: () => void } | null = null
    // Dernier `seq` examiné, qui n'est pas `state.lastSeq` : le serveur fusionne les
    // deltas d'une page sous le `seq` du premier fragment. Reprendre sur l'état ferait
    // redemander des fragments déjà fusionnés, et leur texte s'ajouterait une seconde
    // fois au message en cours.
    let cursor = snapshot?.cursor ?? 0
    let before = snapshot?.before ?? Number.MAX_SAFE_INTEGER
    let more = snapshot?.hasMore ?? false
    let initialized = !!snapshot
    setHasMore(more)
    setLoadingOlder(false)
    setState(currentState)
    setLoading(true)
    setError(null)
    setConnected(false)
    setWarm(null)
    setAppliedConfig(null)

    const apply = (entries: JournalPage, readThrough: number) => {
      if (signal.aborted) return
      for (const { seq, ts, event } of entries) {
        // Un événement déjà appliqué (rejeu après rechargement REST) est ignoré :
        // c'est ce qui garantit qu'une reconnexion ne duplique jamais le fil.
        if (seq <= cursor) continue
        currentState = applyEvent(currentState, seq, ts, event)
        cursor = seq
      }
      cursor = Math.max(cursor, readThrough)
      setState(currentState)
    }

    const flush = () => {
      if (flushTimer !== null) clearTimeout(flushTimer)
      flushTimer = null
      if (pending.length === 0) return
      apply(pending, cursor)
      pending = []
    }

    const stopSubscription = () => {
      if (!subscription) return
      subscription.active = false
      subscription.stop()
      subscription = null
    }

    /**
     * Rattrape par REST : la page du fil projeté à l'ouverture et pour remonter
     * l'historique (`history`), le journal ensuite. `refresh` recharge la page récente
     * quand le direct parle d'un message que le client n'a pas.
     */
    const loadFromRest = (history: boolean | 'refresh' = false): Promise<void> => {
      if (signal.aborted) return Promise.resolve()
      if (replay) return replay

      // Un événement en direct, de `seq` plus grand, cacherait derrière le garde
      // d'idempotence ce qui manque encore de l'historique. L'abonnement s'arrête le
      // temps du REST ; le journal garde ce qui arrive, et l'abonnement suivant le
      // rejoue après le curseur atteint.
      stopSubscription()
      flush()
      replay = (async () => {
        try {
          if (history || !initialized) {
            try {
              const page = await fetchThreadPage(
                id,
                signal,
                history === 'refresh' ? 0 : history ? before : undefined,
                history ? cursor : undefined,
              )
              if (signal.aborted) return
              currentState = history && !page.reset ? mergeThreadPage(currentState, page.state) : page.state
              cursor = page.cursor
              if (history !== 'refresh' || page.reset) {
                before = page.before
                more = page.hasMore
              }
              setHasMore(more)
              setState(currentState)
              initialized = true
            } catch (err) {
              if (signal.aborted || history || (err instanceof ApiRequestError && ![404, 503].includes(err.status))) {
                throw err
              }
              // Un serveur plus ancien, ou une projection indisponible : le journal reste là.
              await fetchJournal(id, cursor, apply, signal)
              initialized = true
            }
          } else {
            await fetchJournal(id, cursor, apply, signal)
          }
          if (signal.aborted) return

          // L'état de lecture ne dépend pas de ce cache de retour, qu'on peut évincer.
          // Un checkpoint seulement après un rattrapage complet : un curseur de page
          // fusionnée ne doit jamais aller avec un état encore incomplet.
          const bytes = retainedBytes(currentState, JOURNAL_CACHE_BYTES)
          if (bytes <= JOURNAL_CACHE_BYTES) {
            queryClient.setQueryData<JournalSnapshot>(snapshotKey, {
              state: snapshotState(currentState),
              cursor,
              before,
              hasMore: more,
              bytes,
            })
          } else queryClient.removeQueries({ queryKey: snapshotKey, exact: true })
          const snapshots = queryClient
            .getQueryCache()
            .findAll({ queryKey: [SNAPSHOT_KEY] })
            .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
          let retained = 0
          for (const old of snapshots) {
            retained += (old.state.data as JournalSnapshot).bytes
            if (retained > JOURNAL_CACHE_BYTES) queryClient.removeQueries({ queryKey: old.queryKey, exact: true })
          }
          setError(null)
          setLoading(false)
        } catch (err) {
          if (signal.aborted) return
          setError(err instanceof Error ? err.message : translate('journal.content.error'))
          setLoading(false)
        } finally {
          replay = null
          if (!signal.aborted) setLoadingOlder(false)
          if (!signal.aborted) subscribeLive()
        }
      })()
      return replay
    }

    function subscribeLive() {
      const live = { active: true, stop: () => {} }
      subscription = live
      let hasConnected = false
      wsClient.setCursor(id, cursor)
      live.stop = wsClient.subscribe(id, cursor, {
        onEvent: (seq: number, ts: number, event: SoleraEvent) => {
          if (!live.active || signal.aborted || seq <= cursor) return
          const received = pending.at(-1)?.seq ?? cursor
          if (seq <= received) return
          // Un saut peut venir d'un historique compacté ou d'une trame tardive de
          // l'abonnement précédent. Le REST tranche, avant qu'un état plus récent
          // ne cache le trou.
          if (seq > received + 1) {
            void loadFromRest()
            return
          }
          // Un ancien message, pas encore chargé, peut recevoir d'autres blocs sous le
          // même identifiant natif. On relit sa ligne avant de replier : en inventer
          // une ici la doublerait à la pagination.
          if (
            more &&
            (event.type === 'message.completed' || event.type === 'message.delta' || event.type === 'thinking.delta'
              ? !currentState.items.some((item) => item.kind === 'message' && item.id === event.messageId)
              : event.type === 'agent.notice' &&
                event.id &&
                !currentState.items.some((item) => item.kind === 'notice' && item.id === event.id))
          ) {
            void loadFromRest('refresh')
            return
          }
          pending.push({ seq, ts, event })
          if (flushTimer === null) flushTimer = window.setTimeout(flush, FLUSH_INTERVAL_MS)
        },
        onStatus: (next, isWarm, applied) => {
          if (!live.active || signal.aborted) return
          setStatus(next)
          setWarm(isWarm)
          setAppliedConfig(applied)
        },
        onTitle: () => {
          if (!live.active || signal.aborted) return
          // Le titre vit dans la ligne de conversation, pas dans le journal : il faut
          // relire, ici la sidebar comme l'en-tête.
          void queryClient.invalidateQueries({ queryKey: ['conversation', id] })
          void queryClient.invalidateQueries({ queryKey: ['conversations'] })
        },
        onCatchupNeeded: () => {
          if (live.active) void loadFromRest()
        },
        onConnectionChange: (isConnected) => {
          if (!live.active || signal.aborted) return
          setConnected(isConnected)
          // Le premier abonnement suit déjà le REST. Une reconnexion peut avoir manqué
          // des événements si le socket a été tué sans que le serveur s'en aperçoive :
          // on rejoue depuis le curseur.
          if (isConnected && hasConnected) void loadFromRest()
          if (isConnected) hasConnected = true
        },
      })
    }

    older.current = () => {
      if (!more || signal.aborted) return Promise.resolve()
      setLoadingOlder(true)
      return loadFromRest(true)
    }
    void loadFromRest()
    return () => {
      controller.abort()
      stopSubscription()
      if (flushTimer !== null) clearTimeout(flushTimer)
      pending = []
    }
  }, [conversationId, queryClient])

  return {
    state,
    status: reconcileStatus(status, state),
    connected,
    warm,
    appliedConfig,
    loading,
    error,
    hasMore,
    loadingOlder,
    loadOlder,
  }
}

/**
 * Réconcilie le statut poussé avec ce que dit le journal (invariant I2).
 *
 * Le journal ne peut qu'ajouter de l'occupation, jamais en retirer : une sollicitation
 * ouverte ou un tour en cours priment sur un statut qui n'est pas encore arrivé, mais
 * un journal qui paraît au repos ne fait pas taire le serveur.
 *
 * Il le faisait, et ramenait tout `running` poussé à `idle` : la sidebar montrait la
 * conversation en cours pendant que l'en-tête n'affichait rien et que la barre de saisie
 * gardait son bouton d'envoi. Le statut du serveur est la valeur en base, poussée à
 * chaque transition, renvoyée en instantané à chaque abonnement, et remise à
 * `interrupted` au démarrage du daemon pour les conversations qu'un arrêt brutal avait
 * laissées en cours. Rien ne justifie de le contredire.
 */
function reconcileStatus(pushed: ConversationStatus, state: ChatState): ConversationStatus {
  if (state.items.some(isAwaitingUser)) return 'awaiting_input'
  if (state.turnRunning) return 'running'
  return pushed
}
