import type { CardColumn, ConversationDto, WorktreeStatusListDto } from '@solera/protocol'
import type { LiveConversation } from './activity'
import { threadState } from './signals'

/**
 * Les quatre groupes de l'onglet Activité, dans l'ordre où ils s'affichent : ce qui
 * attend un geste de toi, ce qui attend ta relecture, ce qui travaille, ce qui est fini.
 *
 * Référence : planche B1 de `docs/audits/2026-10-21-page-projet/final/`.
 */
export type ActivityGroup = 'asking' | 'review' | 'running' | 'done'

export const ACTIVITY_GROUPS: ActivityGroup[] = ['asking', 'review', 'running', 'done']

/**
 * Le groupe d'une session.
 *
 * **Une erreur monte avec les attentes** : dans l'agent view de Claude Code, une session
 * échouée va dans « Completed » ; ici elle te demande d'agir, au même titre qu'une
 * question (tranché par Tim le 2026-10-25). C'est la charte de `threadState` qui dit ce
 * qu'est une erreur, interruption comprise.
 *
 * Ce qui travaille passe avant la relecture : une carte posée en *À vérifier* alors que
 * sa session tourne encore n'est pas prête, elle le sera à la fin du tour.
 */
export function activityGroupOf(entry: LiveConversation, column: CardColumn | null): ActivityGroup {
  const state = threadState({ status: entry.status, busy: entry.running, unread: entry.unread })
  if (state === 'broken' || state === 'awaiting') return 'asking'
  if (state === 'working') return 'running'
  // Les PR ouvertes s'y ajouteront avec leur badge (#115).
  if (column === 'review') return 'review'
  return 'done'
}

/** Où travaille une session : un worktree, ou la racine du projet. */
export interface SessionPlace {
  root: boolean
  /** La branche extraite, ou le nom du worktree quand git ne la donne pas. Null si inconnue. */
  branch: string | null
}

/**
 * La branche de chaque session, tirée de **la seule** liste d'état des worktrees du
 * projet (#78) : aucune lecture de `git/head` par fil.
 *
 * Seul le lien `worktree` compte, c'est-à-dire le cwd : une session de la racine qui a
 * écrit dans un arbre y est liée par `edited`, mais elle n'y travaille pas. Une session
 * sans worktree est à la racine, sur la branche du projet.
 */
export function sessionPlaceOf(
  conversation: Pick<ConversationDto, 'id' | 'worktreeId'>,
  trees: WorktreeStatusListDto | undefined,
  rootBranch: string | null,
): SessionPlace {
  if (!conversation.worktreeId) return { root: true, branch: rootBranch }
  const tree = trees?.worktrees.find(
    (entry) =>
      entry.id === conversation.worktreeId ||
      entry.conversations.some((link) => link.id === conversation.id && link.link === 'worktree'),
  )
  return { root: false, branch: tree ? (tree.branch ?? tree.name) : null }
}

/**
 * Le filtre de la barre, sur le modèle de celui de l'agent view : des jetons séparés
 * par des espaces, tous exigés.
 *
 * - `s:attend`, `s:relire`, `s:cours`, `s:fini` (ou leurs équivalents anglais) gardent
 *   un groupe ; un début de mot suffit, et plusieurs `s:` s'additionnent ;
 * - `#61` garde les sessions de la carte 61 ;
 * - le reste est du texte libre, cherché dans le nom, la branche et le titre de la carte.
 */
export interface ActivityFilter {
  /** Null sans jeton `s:` ; vide quand un `s:` ne désigne aucun groupe. */
  groups: ActivityGroup[] | null
  cards: number[]
  words: string[]
}

/** Les mots qui désignent chaque groupe après `s:`, en français et en anglais. */
const GROUP_WORDS: Record<ActivityGroup, string[]> = {
  asking: ['attend', 'demande', 'erreur', 'waiting', 'asking', 'error'],
  review: ['relire', 'relecture', 'review'],
  running: ['cours', 'running', 'working'],
  done: ['fini', 'terminée', 'terminee', 'done', 'finished'],
}

export function parseActivityFilter(query: string): ActivityFilter {
  const filter: ActivityFilter = { groups: null, cards: [], words: [] }
  for (const token of query.toLocaleLowerCase().split(/\s+/).filter(Boolean)) {
    const state = /^s:(.+)$/.exec(token)
    if (state) {
      const prefix = state[1]!
      filter.groups ??= []
      for (const group of ACTIVITY_GROUPS) {
        if (GROUP_WORDS[group].some((word) => word.startsWith(prefix)) && !filter.groups.includes(group)) {
          filter.groups.push(group)
        }
      }
      continue
    }
    const card = /^#(\d+)$/.exec(token)
    if (card) {
      filter.cards.push(Number(card[1]))
      continue
    }
    filter.words.push(token)
  }
  return filter
}

/** Ce que le filtre lit d'une ligne. */
export interface ActivityRowFacts {
  group: ActivityGroup
  title: string
  branch: string | null
  card: { number: number; title: string } | null
}

export function matchesActivity(filter: ActivityFilter, row: ActivityRowFacts): boolean {
  // Un `s:` qui ne désigne aucun groupe ne garde rien : mieux vaut une liste vide qu'un
  // filtre qui ne filtre pas sans le dire.
  if (filter.groups && !filter.groups.includes(row.group)) return false
  if (filter.cards.length > 0 && (!row.card || !filter.cards.includes(row.card.number))) return false
  const haystack = [row.title, row.branch ?? '', row.card?.title ?? ''].join('\n').toLocaleLowerCase()
  return filter.words.every((word) => haystack.includes(word))
}

/** Vrai si le filtre ne garde pas tout : sert à dire « aucune session ne correspond ». */
export function isActiveFilter(filter: ActivityFilter): boolean {
  return filter.groups !== null || filter.cards.length > 0 || filter.words.length > 0
}
