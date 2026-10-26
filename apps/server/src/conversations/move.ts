import { resolve } from 'node:path'
import { eq, min } from 'drizzle-orm'
import { conversationHandoffs, conversations, type ConversationRow } from '@solera/db'
import { RESUMES_FROM_OTHER_DIRECTORY } from '@solera/protocol'
import { copyTranscript } from '../agents/claude/transcript.js'
import type { EventLog } from '../events/event-log.js'
import type { AppContext } from '../http/context.js'
import type { SessionManager } from '../sessions/session-manager.js'
import { agentCwd } from '../workspace.js'
import { buildHandoff, DEFAULT_HANDOFF_TOKENS, readHandoffItems } from './handoff.js'
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
 * Deux choses partent avec le déplacement, parce qu'elles appartenaient au projet
 * qu'on quitte : le worktree et la carte. La mémoire de l'agent, elle, reste (carte
 * #118, voir `planSessionCarry`) : la session native est gardée quand le répertoire de
 * travail ne change pas, ou quand le CLI sait la reprendre depuis le nouveau ; sinon le
 * CLI repart sur une session neuve, amorcée d'une sélection du journal de Solera. Le
 * journal, lui, est intact : c'est ce que la personne relit, et le fil ne perd pas une
 * ligne.
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

/**
 * Ce que devient la session native du CLI quand le fil change de projet.
 *
 * - `none` : il n'y en a pas encore, rien à garder.
 * - `same` : le CLI tourne dans le même dossier avant et après — un fil rangé dans le
 *   projet dont il occupait déjà la racine. La reprise continue telle quelle.
 * - `resume` : le dossier change, et le CLI reprend sa session depuis le nouveau
 *   (`RESUMES_FROM_OTHER_DIRECTORY`). Pour Claude, le transcript est recopié sous le
 *   nouveau cwd, où Solera le relit.
 * - `relay` : le dossier change et le CLI ne sait pas y reprendre. La session est
 *   lâchée, et la suivante démarre avec le fil en contexte (`conversation_handoffs`).
 *
 * `from` est nul quand l'ancien dossier ne se résout plus : un worktree disparu.
 */
export interface SessionCarry {
  carry: 'none' | 'same' | 'resume' | 'relay'
  from: string | null
  to: string
}

export function planSessionCarry(
  ctx: AppContext,
  conversation: ConversationRow,
  projectId: string | null,
): SessionCarry {
  const threads = ctx.config.paths.threads
  let from: string | null
  try {
    from = resolve(agentCwd(ctx.db, threads, conversation))
  } catch {
    from = null
  }
  // Ce que `move` écrit : le projet de destination, sans worktree.
  const to = resolve(agentCwd(ctx.db, threads, { ...conversation, projectId, worktreeId: null }))
  if (!conversation.agentSessionId) return { carry: 'none', from, to }
  if (from === to) return { carry: 'same', from, to }
  return { carry: RESUMES_FROM_OTHER_DIRECTORY[conversation.agent] ? 'resume' : 'relay', from, to }
}

export async function moveConversation(
  ctx: AppContext,
  sessions: SessionManager,
  log: EventLog,
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

  const plan = planSessionCarry(ctx, conversation, projectId)
  if (plan.carry === 'resume' && conversation.agent === 'claude' && plan.from) {
    // Sans la copie, le CLI reprendrait quand même par l'identifiant : un échec ici
    // coûte la resynchronisation du transcript, pas la mémoire.
    await copyTranscript(plan.from, plan.to, conversation.agentSessionId!).catch(() => false)
  }
  if (plan.carry === 'relay') relayThread(ctx, log, conversation, projectId)

  const patch: Partial<ConversationRow> = {
    projectId,
    worktreeId: null,
    cardId: null,
    agentSessionId: plan.carry === 'relay' ? null : conversation.agentSessionId,
    position: (lowest?.min ?? 0) - 1,
    updatedAt: Date.now(),
  }
  ctx.db.update(conversations).set(patch).where(eq(conversations.id, conversation.id)).run()
  return { ok: true, row: { ...conversation, ...patch }, moved: true }
}

/**
 * Amorce la session suivante du fil lui-même, par le canal des transferts.
 *
 * Un transfert déjà là (le fil continuait un autre CLI) est gardé en tête : il est
 * l'histoire d'avant ce fil, que le journal de celui-ci ne contient pas. Un fil sans
 * message n'a rien à transmettre.
 */
function relayThread(
  ctx: AppContext,
  log: EventLog,
  conversation: ConversationRow,
  projectId: string | null,
): void {
  const items = readHandoffItems(log, conversation.id)
  if (items.length === 0) return
  const relay = buildHandoff(
    items,
    {
      id: conversation.id,
      title: conversation.title,
      agent: conversation.agent,
      rereadable: projectId !== null,
    },
    conversation.agent,
    DEFAULT_HANDOFF_TOKENS,
    'relocation',
  )
  const previous = ctx.db
    .select()
    .from(conversationHandoffs)
    .where(eq(conversationHandoffs.conversationId, conversation.id))
    .get()
  const text = previous ? `${previous.text}\n\n${relay.text}` : relay.text
  ctx.db
    .insert(conversationHandoffs)
    .values({
      conversationId: conversation.id,
      fromConversationId: previous?.fromConversationId ?? conversation.id,
      throughSeq: conversation.lastSeq,
      budgetTokens: DEFAULT_HANDOFF_TOKENS,
      text,
      createdAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: conversationHandoffs.conversationId,
      set: { throughSeq: conversation.lastSeq, text, createdAt: Date.now() },
    })
    .run()
}
