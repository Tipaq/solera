import { eq, min } from 'drizzle-orm'
import { conversations, type ConversationRow } from '@solera/db'
import type { AppContext } from '../http/context.js'
import type { SessionManager } from '../sessions/session-manager.js'
import { inProject } from './scope.js'

/**
 * *Ranger…* — la destination d'une conversation, choisie après coup.
 *
 * Partagé par la route, où une personne clique, et par le daemon, qui applique un
 * rangement qu'un agent a demandé et qu'elle a accordé. Les deux posent exactement les
 * mêmes questions sur l'état du fil ; ce qu'ils ne partagent pas est la visibilité, qui
 * reste chez chaque appelant — la route demande « cet utilisateur voit-il le projet de
 * destination », le daemon « la session demandeuse voyait-elle ce fil ».
 *
 * Trois choses partent avec le déplacement, parce qu'elles appartenaient au projet
 * qu'on quitte : le worktree, la carte, et la session native du CLI. Cette dernière est
 * le prix à payer et il se paie une fois : un CLI retrouve ses sessions par leur
 * répertoire de travail, et celui-ci vient de changer — un `--resume` pointerait sur un
 * dossier où il n'y a rien. Le journal de Solera, lui, est intact : c'est ce que la
 * personne relit, et le fil ne perd pas une ligne.
 *
 * La ligne `worktrees` reste et le dossier sur le disque n'est pas touché : le travail
 * non commité demeure dans le projet de départ, visible et récupérable. Un arbre du
 * dépôt de P n'aurait aucun sens dans Q.
 *
 * Refusé pendant un tour : le CLI tourne alors dans l'ancien dossier, et lui changer sa
 * destination sous les pieds ne se rattraperait pas.
 */

export type MoveRefusal = 'busy' | 'scheduled'

export type MoveResult =
  | { ok: true; row: ConversationRow; moved: boolean }
  | { ok: false; refusal: MoveRefusal }

export async function moveConversation(
  ctx: AppContext,
  sessions: SessionManager,
  conversation: ConversationRow,
  projectId: string | null,
): Promise<MoveResult> {
  // Déjà là : rien à faire, et surtout pas relâcher un runner qui travaille bien.
  if (conversation.projectId === projectId) {
    return { ok: true, row: conversation, moved: false }
  }
  if (conversation.status === 'running' || conversation.status === 'awaiting_input') {
    return { ok: false, refusal: 'busy' }
  }
  if (conversation.scheduleId) return { ok: false, refusal: 'scheduled' }

  const [lowest] = ctx.db
    .select({ min: min(conversations.position) })
    .from(conversations)
    .where(inProject(projectId))
    .all()

  // Avant d'écrire : un runner encore chaud garde son répertoire de travail en
  // mémoire, et le tour suivant partirait du dossier qu'on vient de quitter. Le refus
  // dit qu'un tour a démarré entre-temps.
  if (!(await sessions.releaseRunner(conversation.id))) return { ok: false, refusal: 'busy' }

  const patch: Partial<ConversationRow> = {
    projectId,
    worktreeId: null,
    cardId: null,
    agentSessionId: null,
    position: (lowest?.min ?? 0) - 1,
    updatedAt: Date.now(),
  }
  ctx.db.update(conversations).set(patch).where(eq(conversations.id, conversation.id)).run()
  return { ok: true, row: { ...conversation, ...patch }, moved: true }
}
