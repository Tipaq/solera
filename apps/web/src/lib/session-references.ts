import { useCallback } from 'react'
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

/**
 * La même session, à son curseur de lecture près.
 *
 * Le curseur du fil ouvert avance toutes les deux secondes pendant un tour, et réécrit
 * la liste à chaque fois ; aucune puce ni suggestion ne l'affiche. Les autres champs se
 * comparent par identité : la liste en cache partage ses objets d'une réponse à
 * l'autre tant qu'ils n'ont pas bougé.
 */
function sameSession(a: ConversationDto, b: ConversationDto): boolean {
  if (a === b) return true
  const keys = Object.keys(a) as (keyof ConversationDto)[]
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => key === 'lastReadSeq' || a[key] === b[key])
}

function sameSessions(a: Map<string, ConversationDto>, b: Map<string, ConversationDto>): boolean {
  if (a.size !== b.size) return false
  for (const [id, session] of b) {
    const previous = a.get(id)
    if (!previous || !sameSession(previous, session)) return false
  }
  return true
}

// Tous les messages du fil lisent la même liste : son index se construit une fois par
// réponse du serveur, pas une fois par bulle.
const indexes = new WeakMap<ConversationDto[], Map<string, ProjectSessions>>()
/**
 * Le dernier index rendu par projet. Un projet dont les sessions n'ont pas bougé garde
 * le même objet d'une liste à l'autre : les messages qui le lisent ne rendent pas.
 */
let latest = new Map<string, ProjectSessions>()

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
  for (const [projectId, sessions] of byProject) {
    const previous = latest.get(projectId)
    if (previous && sameSessions(previous.sessions, sessions)) {
      index.set(projectId, previous)
      continue
    }
    const same = previous?.ids.size === sessions.size && [...sessions.keys()].every((id) => previous.ids.has(id))
    const ids = same && previous ? previous.ids : new Set(sessions.keys())
    index.set(projectId, { sessions, ids })
  }
  latest = index
  indexes.set(list, index)
  return index
}

/**
 * Les sessions qu'un texte du projet peut citer, archivées comprises.
 *
 * La liste de la sidebar, déjà en cache : aucune requête de plus, aucun fil chargé. Hors
 * projet, rien : un fil libre ne cite pas de session.
 *
 * Lue par `select` : chaque message monté s'abonne ici, et ne rend que lorsque les
 * sessions de son projet changent, pas à chaque réécriture de la liste.
 */
export function useSessionReferences(projectId: string | null | undefined): ProjectSessions & { loading: boolean } {
  const select = useCallback(
    (list: ConversationDto[]) => (projectId ? indexOf(list).get(projectId) : undefined) ?? EMPTY,
    [projectId],
  )
  const { data, isPending } = useAllConversations(select)
  return { ...(data ?? EMPTY), loading: isPending }
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
