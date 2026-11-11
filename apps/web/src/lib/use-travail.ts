import { useCallback, useMemo, useRef, useState } from 'react'
import { JOURNAL_DEFAULT_DAYS, type AgentKind, type JournalEntryDto, type ProjectDto } from '@solera/protocol'
import { useActivityRows, type ActivityRow } from './activity-rows'
import { useCards } from './cards'
import { useBranchInfos, useCodeData } from './code-data'
import { rowInTree, entryInTree, scopeOf, treeOf, type TreeRow } from './code-model'
import { useAllConversations } from './conversations'
import { useJournal } from './journal'
import { useActiveMilestones } from './milestones'
import { cardMilestones } from './travail-model'
import { useInbox } from './use-inbox'

/** Au-delà, l'historique ne s'allonge plus : un an de `git log` suffit à tout fil. */
const MAX_JOURNAL_DAYS = 365

/**
 * Tout ce que l'onglet Travail lit d'un projet : le vivant et l'historique du fil, les
 * arbres et les branches du modèle « Code », « Ce qui t'attend », et ce qui rattache
 * une ligne du fil à un arbre et à un jalon.
 *
 * Aucune requête de plus que l'Activité, l'Aperçu et le Journal n'en faisaient : React
 * Query les partage. Rien n'est filtré ici ; la page le fait, avec `travail-model`.
 */
export function useTravail(projectId: string, project: ProjectDto) {
  const rows = useActivityRows(projectId, project)
  const { data: runs } = useActiveMilestones(projectId)
  const { data: cards } = useCards(projectId)
  const { data: allConversations } = useAllConversations()
  const conversations = useMemo(() => (allConversations ?? []).filter((entry) => entry.projectId === projectId), [allConversations, projectId])
  const code = useCodeData(projectId, project)
  const branches = useBranchInfos(projectId, project, code)
  const inbox = useInbox({ projectId })

  // « Plus ancien » élargit la fenêtre ; la lecture précédente reste affichée pendant
  // que la suivante arrive, pour que le fil ne se vide pas sous les yeux.
  const [windowDays, setWindowDays] = useState(JOURNAL_DEFAULT_DAYS)
  const { data: fresh, isFetching, isPending: journalPending } = useJournal(projectId, windowDays)
  const lastJournal = useRef(fresh)
  if (fresh) lastJournal.current = fresh
  const journal = fresh ?? lastJournal.current
  const loadOlder = useCallback(() => setWindowDays((current) => Math.min(current * 2, MAX_JOURNAL_DAYS)), [])

  // Le vivant, sans les terminées ; l'historique, sans les sessions vivantes, que
  // « Maintenant » montre déjà.
  const live = useMemo(() => rows.filter((row) => row.group !== 'done'), [rows])
  const history = useMemo(() => {
    const liveIds = new Set(live.map((row) => row.entry.conversation.id))
    return (journal?.entries ?? []).filter((entry) => !entry.conversationId || !liveIds.has(entry.conversationId))
  }, [journal, live])

  const scopes = useMemo(() => new Map(code.trees.map((tree) => [tree.key, scopeOf(tree, conversations)])), [code.trees, conversations])
  const milestones = useMemo(() => cardMilestones(cards ?? []), [cards])
  const byId = useMemo(() => new Map(conversations.map((entry) => [entry.id, entry])), [conversations])

  const treeOfEntry = useCallback(
    (entry: JournalEntryDto): TreeRow | null => treeOf(code.trees, (tree) => entryInTree(entry, tree, scopes.get(tree.key)!)),
    [code.trees, scopes],
  )
  const treeOfRow = useCallback(
    (row: ActivityRow): TreeRow | null => treeOf(code.trees, (tree) => rowInTree(row, tree, scopes.get(tree.key)!)),
    [code.trees, scopes],
  )
  /** L'agent d'une ligne d'historique : celui de sa session. */
  const agentOf = useCallback((entry: JournalEntryDto): AgentKind | null => (entry.conversationId ? (byId.get(entry.conversationId)?.agent ?? null) : null), [byId])

  return {
    /** Toutes les sessions du projet, terminées comprises. */
    rows,
    live,
    history,
    runs: runs ?? [],
    inbox,
    cards: cards ?? [],
    conversations,
    code,
    branches,
    scopes,
    milestones,
    treeOfEntry,
    treeOfRow,
    agentOf,
    journal: {
      days: journal?.days ?? windowDays,
      pending: journalPending && !journal,
      loadOlder,
      canLoadOlder: windowDays < MAX_JOURNAL_DAYS,
      loadingOlder: isFetching && !fresh,
    },
  }
}

export type Travail = ReturnType<typeof useTravail>
