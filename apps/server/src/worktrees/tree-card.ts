import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { cards, conversations, worktrees, type Db } from '@solera/db'
import { cardNumberOfBranch, type TreeCardFields } from '@solera/protocol'

const NONE: TreeCardFields = { card: null, cardSource: null }

/**
 * La carte des arbres et des branches d'un projet, et d'où elle vient (#168) : la session
 * la plus récente de l'arbre qui traite une carte, sinon la carte pour laquelle l'arbre a
 * été créé, sinon le numéro du nom de la branche s'il désigne une carte du projet.
 *
 * Une branche sans arbre se juge par l'arbre retiré qui la portait, s'il y en a eu un :
 * ses sessions et sa carte de création restent en base. Seules les sessions dont le cwd
 * est l'arbre comptent : une session de la racine qui y a écrit au passage n'en fait pas
 * sa carte.
 *
 * Tout est lu une fois par calcul de la liste, pas une fois par arbre.
 */
export function treeCards(db: Db, projectId: string) {
  const projectCards = db
    .select({ id: cards.id, number: cards.number })
    .from(cards)
    .where(eq(cards.projectId, projectId))
    .all()
  const byId = new Map(projectCards.map((card) => [card.id, card]))
  const byNumber = new Map(projectCards.map((card) => [card.number, card]))

  // La plus récente d'abord : la première carte vue pour un arbre est la sienne.
  const ofSessions = new Map<string, { id: string; number: number }>()
  const sessions = db
    .select({ worktreeId: conversations.worktreeId, cardId: conversations.cardId })
    .from(conversations)
    .where(and(eq(conversations.projectId, projectId), isNotNull(conversations.worktreeId), isNotNull(conversations.cardId)))
    .orderBy(desc(conversations.updatedAt))
    .all()
  for (const session of sessions) {
    const card = byId.get(session.cardId!)
    if (card && !ofSessions.has(session.worktreeId!)) ofSessions.set(session.worktreeId!, card)
  }

  // Retirés compris : l'index unique n'en garde qu'un par nom.
  const rows = db
    .select({ id: worktrees.id, name: worktrees.name, cardId: worktrees.cardId })
    .from(worktrees)
    .where(eq(worktrees.projectId, projectId))
    .all()
  const rowsById = new Map(rows.map((row) => [row.id, row]))
  const rowsByName = new Map(rows.map((row) => [row.name, row]))

  const resolve = (row: { id: string; cardId: string | null } | null, branch: string | null): TreeCardFields => {
    const bySession = row ? ofSessions.get(row.id) : undefined
    if (bySession) return { card: bySession, cardSource: 'session' }
    const created = row?.cardId ? byId.get(row.cardId) : undefined
    if (created) return { card: created, cardSource: 'created' }
    const number = branch ? cardNumberOfBranch(branch) : null
    const named = number === null ? undefined : byNumber.get(number)
    return named ? { card: named, cardSource: 'name' } : NONE
  }

  return {
    /** Un arbre, par sa ligne en base (aucune pour un arbre créé au shell) et sa branche. */
    ofTree: (tree: { id: string | null; branch: string | null }): TreeCardFields =>
      resolve(tree.id ? (rowsById.get(tree.id) ?? null) : null, tree.branch),
    /** Une branche sans arbre, par l'arbre retiré qui la portait s'il y en a eu un. */
    ofBranch: (name: string): TreeCardFields => resolve(rowsByName.get(name) ?? null, name),
  }
}
