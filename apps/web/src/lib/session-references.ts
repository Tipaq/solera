import type { ConversationDto } from '@solera/protocol'
import { useAllConversations } from './conversations'

interface ProjectSessions {
  sessions: Map<string, ConversationDto>
  /**
   * Les identifiants seuls, qui ne changent d'objet que si une session apparaît ou
   * disparaît. Le rendu markdown en dépend : un renommage ou un changement d'état ne
   * doit pas relancer l'analyse de chaque message du fil.
   */
  ids: ReadonlySet<string>
}

const EMPTY: ProjectSessions = { sessions: new Map(), ids: new Set() }

// Tous les messages du fil lisent la même liste : son index se construit une fois par
// réponse du serveur, pas une fois par bulle.
const indexes = new WeakMap<ConversationDto[], Map<string, ProjectSessions>>()
let latestIds = new Map<string, ReadonlySet<string>>()

function indexOf(list: ConversationDto[]): Map<string, ProjectSessions> {
  const cached = indexes.get(list)
  if (cached) return cached
  const byProject = new Map<string, Map<string, ConversationDto>>()
  for (const session of list) {
    if (!session.projectId) continue
    const group = byProject.get(session.projectId) ?? new Map<string, ConversationDto>()
    group.set(session.id, session)
    byProject.set(session.projectId, group)
  }
  const index = new Map<string, ProjectSessions>()
  const nextIds = new Map<string, ReadonlySet<string>>()
  for (const [projectId, sessions] of byProject) {
    const previous = latestIds.get(projectId)
    const same = previous?.size === sessions.size && [...sessions.keys()].every((id) => previous.has(id))
    const ids = same && previous ? previous : new Set(sessions.keys())
    index.set(projectId, { sessions, ids })
    nextIds.set(projectId, ids)
  }
  latestIds = nextIds
  indexes.set(list, index)
  return index
}

/**
 * Les sessions qu'un texte du projet peut citer, archivées comprises.
 *
 * La liste de la sidebar, déjà en cache : aucune requête de plus, aucun fil chargé. Hors
 * projet, rien : un fil libre ne cite pas de session.
 */
export function useSessionReferences(projectId: string | null | undefined): ProjectSessions & { loading: boolean } {
  const { data, isPending } = useAllConversations()
  const found = data && projectId ? indexOf(data).get(projectId) : undefined
  return { ...(found ?? EMPTY), loading: isPending }
}

function searchable(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase()
}

/** Au-delà, la liste défile pour rien : on affine la recherche. */
const MAX_SUGGESTIONS = 12

/**
 * Les sessions qui répondent à une recherche `@@`, les plus récentes d'abord.
 *
 * Chaque mot doit se trouver dans le titre, le CLI ou l'identifiant, sans égard aux
 * accents. Les archivées ne sortent que sur une recherche : sans mot, la liste propose
 * ce qui vit encore.
 */
export function matchSessions(
  sessions: Map<string, ConversationDto>,
  query: string,
  excludeId?: string,
): ConversationDto[] {
  const words = searchable(query.trim()).split(/\s+/).filter(Boolean)
  return [...sessions.values()]
    .filter(
      (session) =>
        session.id !== excludeId &&
        (words.length > 0 || session.archivedAt === null) &&
        words.every((word) => searchable(`${session.title} ${session.agent} ${session.id}`).includes(word)),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SUGGESTIONS)
}
