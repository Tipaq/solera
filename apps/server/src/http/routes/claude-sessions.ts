import { randomUUID } from 'node:crypto'
import { eq, isNotNull, min } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSessionInfo, listSessions } from '@anthropic-ai/claude-agent-sdk'
import { conversations, projects, type ConversationRow } from '@solera/db'
import {
  readProjectDefaults,
  type ClaudeSessionsDto,
  type ClaudeSyncDto,
} from '@solera/protocol'
import type { AgentRegistry } from '../../agents/registry.js'
import type { TranslatedEvent } from '../../agents/claude/transcript.js'
import {
  importPreparedTranscript,
  prepareTranscript,
  savedTranscript,
} from '../../agents/claude/transcript-sync.js'
import { TranscriptChanged } from '../../agents/claude/transcript-reader.js'
import type { EventLog } from '../../events/event-log.js'
import type { SessionManager } from '../../sessions/session-manager.js'
import { readUserSettings } from '../../settings/user-settings.js'
import { agentCwd } from '../../workspace.js'
import { samePath } from '../../agents/paths.js'
import { badRequest, notFound } from '../errors.js'
import { requireUser } from '../require-user.js'
import type { AppContext } from '../context.js'
import { conversationToDto } from './conversations.js'

/**
 * Reprise dans Solera de sessions commencées avec le CLI Claude Code.
 *
 * Le daemon partage le compte et le disque du CLI : les transcripts de
 * `~/.claude/projects` sont directement lisibles, et `resume` continue une session
 * quel que soit l'outil qui l'a ouverte. Importer revient donc à créer une
 * conversation portant l'identifiant natif, et à reconstruire le journal depuis le
 * transcript (invariant I2). Rien n'est dupliqué côté CLI : les tours faits ensuite
 * dans Solera s'écrivent dans le même fichier, et `claude --resume` les montre.
 *
 * La seule contrainte reste de ne pas piloter la même session des deux côtés en même
 * temps ; la resynchronisation rattrape l'affichage après un passage par le CLI, elle
 * ne protège pas d'une écriture simultanée.
 */

const sessionIdSchema = z.string().uuid()

const TITLE_MAX = 60

function importTitle(info: { customTitle?: string; summary?: string } | null, firstPrompt: string | null): string {
  const fromInfo = (info?.customTitle ?? info?.summary)?.trim()
  if (fromInfo) return fromInfo

  const text = firstPrompt?.trim().replace(/\s+/g, ' ')
  if (!text) return 'Session importée'
  return text.length <= TITLE_MAX ? text : `${text.slice(0, TITLE_MAX).trimEnd()}...`
}

export function registerClaudeSessionRoutes(
  app: FastifyInstance,
  ctx: AppContext,
  log: EventLog,
  sessions: SessionManager,
  registry: AgentRegistry,
): void {
  /** Une synchronisation en cours par conversation : deux onglets qui s'ouvrent la partagent. */
  const syncing = new Map<string, Promise<ClaudeSyncDto>>()
  const loadProject = (projectId: string, userId: string) => {
    const project = ctx.db.select().from(projects).where(eq(projects.id, projectId)).get()
    if (!project) throw notFound('project_not_found', 'Project not found.')
    if (project.ownerId !== userId && project.visibility !== 'shared') {
      throw notFound('project_not_found', 'Project not found.')
    }
    return project
  }

  /** Identifiants de session déjà rattachés à une conversation, tous projets confondus. */
  const linkedSessionIds = () =>
    new Set(
      ctx.db
        .select({ agentSessionId: conversations.agentSessionId })
        .from(conversations)
        .where(isNotNull(conversations.agentSessionId))
        .all()
        .map((row) => row.agentSessionId as string),
    )

  app.get('/api/projects/:id/claude-sessions', async (request): Promise<ClaudeSessionsDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }
    const project = loadProject(id, user.id)

    let found
    try {
      found = await listSessions({ dir: project.workspacePath, limit: 40 })
    } catch (err) {
      throw badRequest(
        'sessions_unavailable',
        'Unable to list CLI sessions: {reason}.',
        { reason: err instanceof Error ? err.message : String(err) },
      )
    }

    const linked = linkedSessionIds()
    return {
      sessions: found
        // Une session d'un autre dossier ne serait pas reprenable : le CLI retrouve
        // son transcript par le chemin, pas par le seul identifiant. Même dossier au sens
        // du système : la casse et les séparateurs varient d'un terminal à l'autre.
        .filter((session) => session.cwd === undefined || samePath(session.cwd, project.workspacePath))
        .filter((session) => !linked.has(session.sessionId))
        // Sans premier message, il n'y a rien à reprendre : ce sont des sessions
        // ouvertes puis refermées aussitôt.
        .filter((session) => Boolean(session.firstPrompt?.trim()))
        .map((session) => ({
          sessionId: session.sessionId,
          title: (session.customTitle ?? session.summary).trim() || 'Session sans titre',
          firstPrompt: session.firstPrompt ?? null,
          gitBranch: session.gitBranch ?? null,
          lastModified: session.lastModified,
        })),
    }
  })

  app.post('/api/projects/:id/claude-sessions/:sessionId/import', async (request, reply) => {
    const user = requireUser(request)
    const params = request.params as { id: string; sessionId: string }
    const sessionId = sessionIdSchema.parse(params.sessionId)
    const project = loadProject(params.id, user.id)

    if (linkedSessionIds().has(sessionId)) {
      throw badRequest('session_already_imported', 'This session already has a conversation.')
    }

    const prepared = await prepareTranscript(project.workspacePath, sessionId)
    if (!prepared || prepared.mainEntries === 0) {
      throw notFound(
        'transcript_not_found',
        'No transcript found for this session in the project folder.',
      )
    }
    const info =
      (await getSessionInfo(sessionId, { dir: project.workspacePath }).catch(() => null)) ?? null

    // Le préréglage du projet puis les défauts du compte, comme pour une conversation
    // ouverte depuis l'interface : adopter une session du CLI n'est pas une raison de
    // repartir des défauts du protocole, que la personne a peut-être justement changés.
    const defaults =
      readProjectDefaults(project.defaultConfig).claude ??
      readUserSettings(ctx.db, user.id).agentDefaults.claude
    const config = await registry.adapter('claude').resolveDefaults(defaults)

    const [lowest] = ctx.db
      .select({ min: min(conversations.position) })
      .from(conversations)
      .where(eq(conversations.projectId, project.id))
      .all()

    const now = Date.now()
    const row: ConversationRow = {
      id: randomUUID(),
      projectId: project.id,
      worktreeId: null,
      // Une session importée depuis le CLI ne vient d'aucune carte.
      cardId: null,
      purpose: null,
      splitCardId: null,
      userId: user.id,
      title: importTitle(info, prepared.firstPrompt),
      titleSetByUser: false,
      titleSetByAgent: false,
      agent: 'claude',
      agentSessionId: sessionId,
      forkedFromId: null,
      handoffFromId: null,
      createdByTokenId: null,
      originLabel: null,
      scheduleId: null,
      config: JSON.stringify(config),
      status: 'idle',
      backgroundCount: 0,
      loopCount: 0,
      lastSeq: 0,
      lastNotableSeq: 0,
      costUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      // Repris par `appendBatch` avec les événements de la session adoptée.
      turnCount: 0,
      journalBytes: 0,
      contextUsedTokens: null,
      contextMaxTokens: null,
      model: null,
      pinned: false,
      position: (lowest?.min ?? 0) - 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    // Un autre import a pu finir pendant la lecture du transcript.
    if (linkedSessionIds().has(sessionId)) {
      throw badRequest('session_already_imported', 'This session already has a conversation.')
    }
    ctx.db.insert(conversations).values(row).run()

    const opening: TranslatedEvent = {
      ts: prepared.firstTs ?? now,
      event: {
        type: 'session.started',
        agent: 'claude',
        agentSessionId: sessionId,
        // Le transcript ne déclare ni la liste d'outils ni toujours un modèle : on
        // journalise ce qu'il dit, pas ce qu'on suppose.
        model: prepared.model ?? '',
        cwd: project.workspacePath,
        tools: [],
      },
    }
    try {
      const { lastSeq } = await importPreparedTranscript({
        prepared,
        db: ctx.db,
        log,
        id: row.id,
        cwd: project.workspacePath,
        lastSeq: 0,
        opening,
        release: async () => true,
      })
      return reply.status(201).send(conversationToDto({ ...row, lastSeq }, user.id, 0, null, false))
    } catch (error) {
      // Un import initial qui échoue ne doit pas réserver l'identifiant natif avec un
      // journal partiel.
      ctx.db.delete(conversations).where(eq(conversations.id, row.id)).run()
      throw error
    }
  })

  /**
   * Rattrape dans le journal les tours faits au CLI depuis le dernier point commun.
   *
   * Appelée à l'ouverture d'une conversation Claude : le CLI relit toujours le
   * transcript complet, mais le journal de Solera est sa propre copie, et sans ce
   * rattrapage l'affichage ignorerait ce qui s'est passé hors de Solera.
   */
  app.post('/api/conversations/:id/claude-sync', async (request): Promise<ClaudeSyncDto> => {
    const user = requireUser(request)
    const { id } = request.params as { id: string }

    const conversation = ctx.db.select().from(conversations).where(eq(conversations.id, id)).get()
    if (!conversation) throw notFound('conversation_not_found', 'Conversation not found.')
    if (conversation.userId !== user.id) throw notFound('conversation_not_found', 'Conversation not found.')
    if (conversation.agent !== 'claude') {
      throw badRequest('claude_only', 'Only Claude Code conversations can be resynced.')
    }

    // Rien à faire tant que la session n'a jamais démarré, ou qu'un tour est en
    // cours : le transcript est alors en train de s'écrire, on repassera.
    if (!conversation.agentSessionId) return { imported: 0 }
    if (conversation.status === 'running' || conversation.status === 'awaiting_input') {
      return { imported: 0 }
    }

    const pending = syncing.get(id)
    if (pending) return pending
    const sync = (async (): Promise<ClaudeSyncDto> => {
      try {
        const cwd = agentCwd(ctx.db, ctx.config.paths.threads, conversation)
        // Les repères ne se calculent que sans curseur valable : ils lisent tout le journal.
        let anchors: ReturnType<EventLog['importAnchors']> | undefined
        const prepared = await prepareTranscript(
          cwd,
          conversation.agentSessionId!,
          savedTranscript(ctx.db, id, conversation.lastSeq),
          () => (anchors ??= log.importAnchors(id)),
          conversation.lastSeq > 0,
        )
        if (!prepared) return { imported: 0 }
        const result = await importPreparedTranscript({
          prepared,
          db: ctx.db,
          log,
          id,
          cwd,
          lastSeq: conversation.lastSeq,
          anchors,
          // Un tour a pu démarrer pendant la lecture : il journalise lui-même ce qu'il
          // produit, et importer par-dessus doublerait le fil.
          release: () => sessions.releaseRunner(id),
        })
        return { imported: result.imported }
      } catch (error) {
        // Le CLI vivant gagne les courses. Les lots déjà écrits gardent leur curseur, et
        // la prochaine ouverture au repos reprend ce qui bougeait encore.
        if (error instanceof TranscriptChanged) return { imported: 0 }
        throw error
      }
    })()
    syncing.set(id, sync)
    try {
      return await sync
    } finally {
      syncing.delete(id)
    }
  })
}
