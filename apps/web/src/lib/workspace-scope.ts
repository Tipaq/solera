/**
 * Portée du panneau latéral : le répertoire consulté appartient soit à une
 * conversation (son cwd, worktree compris), soit à un projet (son workspace), soit à un
 * worktree sans session, ouvert depuis Travail ou l'Aperçu (carte #169).
 *
 * Encodée en chaîne plutôt qu'en objet : une conversation garde son identifiant nu, ce
 * qui laisse inchangés les appels du fil (openTab, clés de cache) qui ne connaissent
 * qu'elle ; un projet et un worktree se préfixent. Les formes ne peuvent pas se
 * confondre, et le décodage vit ici, nulle part ailleurs.
 */
export type WorkspaceScope = string

export type WorkspaceScopeKind = 'conversation' | 'project' | 'worktree'

const PROJECT_PREFIX = 'project:'
const WORKTREE_PREFIX = 'worktree:'

export const projectScope = (projectId: string): WorkspaceScope =>
  `${PROJECT_PREFIX}${projectId}`

export const worktreeScope = (worktreeId: string): WorkspaceScope =>
  `${WORKTREE_PREFIX}${worktreeId}`

/** La portée d'un message du serveur, qui la donne en deux champs. */
export function encodeScope(kind: WorkspaceScopeKind, id: string): WorkspaceScope {
  if (kind === 'project') return projectScope(id)
  if (kind === 'worktree') return worktreeScope(id)
  return id
}

export function decodeScope(scope: WorkspaceScope): {
  kind: WorkspaceScopeKind
  id: string
} {
  if (scope.startsWith(PROJECT_PREFIX)) return { kind: 'project', id: scope.slice(PROJECT_PREFIX.length) }
  if (scope.startsWith(WORKTREE_PREFIX)) return { kind: 'worktree', id: scope.slice(WORKTREE_PREFIX.length) }
  return { kind: 'conversation', id: scope }
}

const API_ROOT: Record<WorkspaceScopeKind, string> = {
  conversation: '/api/conversations',
  project: '/api/projects',
  worktree: '/api/worktrees',
}

/** Préfixe des routes du panneau pour cette portée. */
export function workspaceApiBase(scope: WorkspaceScope): string {
  const { kind, id } = decodeScope(scope)
  return `${API_ROOT[kind]}/${id}`
}
