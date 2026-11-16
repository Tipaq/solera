import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { conversationHandoffs, conversations, type ConversationRow, type Db } from '@solera/db'
import { HOST_CONFINED_ENVIRONMENT, HOST_ENVIRONMENT, resolveAgentConfig, unattendedConfig, type AgentConfig, type AgentKind, type ExecutionEnvironment, type SchedulePlace, type SplitMode } from '@solera/protocol'
import { environmentColumns } from '../environments/environments.js'
import { EnvironmentUnavailableError } from '../environments/provider.js'
import type { OutgoingAttachment } from '../agents/types.js'
import type { SessionManager } from '../sessions/session-manager.js'
import { inheritedLayers, overridesFor } from './config-inheritance.js'

const PROVISIONAL_TITLE_MAX = 60

/**
 * Titre affiché entre la création et le résumé du CLI, c'est-à-dire le temps du
 * premier tour. Un extrait du message dit déjà de quoi il s'agit, contrairement à un
 * « Nouvelle conversation » identique pour toutes.
 */
export function provisionalTitle(firstMessage: string | undefined): string {
  const text = firstMessage?.trim().replace(/\s+/g, ' ')
  if (!text) return 'Nouvelle conversation'
  return text.length <= PROVISIONAL_TITLE_MAX
    ? text
    : `${text.slice(0, PROVISIONAL_TITLE_MAX).trimEnd()}...`
}

export interface CreateConversationInput {
  /** Null pour un fil libre, qui n'appartient à aucun projet. */
  projectId: string | null
  userId: string
  agent: AgentKind
  /**
   * La configuration voulue, entière. La conversation n'en retient que ce qui diffère de
   * son héritage (#120), et sa configuration effective est recalculée des niveaux.
   */
  config: AgentConfig
  worktreeId: string | null
  /** Carte traitée, quand la conversation est lancée depuis le board. */
  cardId: string | null
  /** Découper en cartes (#70), et la carte d'où le découpage part. Absents ailleurs. */
  purpose?: 'split' | null
  splitCardId?: string | null
  /** Le mode d'une session d'affinage (#184) ; `questions` pour un découpage qui n'en dit rien. */
  splitMode?: SplitMode | null
  title?: string
  /**
   * L'environnement d'exécution, figé à la création. Absent : celui du projet par
   * défaut, et l'hôte pour un fil libre, qui n'a pas de projet.
   */
  environment?: ExecutionEnvironment
  /**
   * Une session sans personne devant l'écran (#146) : tâche planifiée, carte d'un jalon,
   * session lancée par un agent, relecture. Sans `environment`, elle prend celui du
   * projet, confiné si `confined` le dit ou, à null, si le projet le règle. Confinée,
   * elle tourne sans demandes d'autorisation : personne n'y répondrait, et le
   * confinement est son garde-fou.
   */
  autonomous?: { confined: boolean | null }
  /**
   * Texte dont tirer le titre provisoire, quand le premier message ne s'y prête pas :
   * une mission confiée par une autre session commence par son enveloppe balisée.
   */
  titleSource?: string
  /** Jeton d'API à l'origine de la conversation ; null quand elle vient de l'interface. */
  origin: { tokenId: string; label: string } | null
  /** Tâche planifiée dont ce fil est un tir ; absent pour toute autre conversation. */
  scheduleId?: string
  /** Lieu d'un fil sans projet ouvert par une tâche Savoir ou Instance ; absent ailleurs. */
  place?: SchedulePlace | null
  /**
   * Contexte transmis depuis une autre conversation, quand celle-ci la continue dans un
   * autre CLI : écrit avec la ligne, pour que le premier démarrage du CLI le trouve.
   */
  handoff?: {
    fromConversationId: string
    throughSeq: number
    budgetTokens: number
    text: string
  }
  firstMessage?: {
    clientMessageId: string
    text: string
    attachments: OutgoingAttachment[]
    mentions: string[]
    skills: string[]
  }
}

/**
 * Crée une conversation et lui envoie son premier message.
 *
 * Partagé entre l'interface et l'API : le vocabulaire diffère mais le geste est le
 * même, et deux copies auraient divergé au premier champ ajouté.
 */
export async function createConversation(
  db: Db,
  sessions: SessionManager,
  input: CreateConversationInput,
): Promise<ConversationRow> {
  const now = Date.now()
  // Un fil libre n'a pas de projet à confiner : il ne tourne pas, plutôt que de tourner
  // libre sans que personne l'ait voulu.
  if (input.projectId === null && input.autonomous?.confined) {
    throw new EnvironmentUnavailableError(HOST_CONFINED_ENVIRONMENT, 'Only a project session can be confined.')
  }
  const environment =
    input.environment ??
    (input.projectId === null
      ? HOST_ENVIRONMENT
      : input.autonomous
        ? sessions.environments.forAutonomous(input.projectId, input.autonomous.confined)
        : sessions.environments.ofProject(input.projectId))
  const wanted = input.autonomous && environment.confined ? unattendedConfig(input.config) : input.config
  const owner = { userId: input.userId, projectId: input.projectId, agent: input.agent }
  const overrides = await overridesFor(db, (config) => sessions.resolveDefaults(config), owner, wanted)
  const config = await sessions.resolveDefaults(
    resolveAgentConfig(input.agent, inheritedLayers(db, owner).map((named) => named.layer), overrides),
  )
  // Refusé à la création plutôt qu'au premier lancement : un fil qui ne pourra jamais
  // démarrer ne doit pas apparaître dans la liste, que l'environnement soit choisi ou
  // hérité du projet.
  sessions.environments.assertAvailable(input.projectId, environment)
  const row: ConversationRow = {
    id: randomUUID(),
    projectId: input.projectId,
    worktreeId: input.worktreeId,
    cardId: input.cardId,
    purpose: input.purpose ?? null,
    splitCardId: input.splitCardId ?? null,
    splitMode: input.purpose === 'split' ? (input.splitMode ?? 'questions') : null,
    userId: input.userId,
    title: input.title ?? provisionalTitle(input.titleSource ?? input.firstMessage?.text),
    titleSetByUser: input.title !== undefined,
    titleSetByAgent: false,
    agent: input.agent,
    ...environmentColumns(environment),
    agentSessionId: null,
    forkedFromId: null,
    handoffFromId: input.handoff?.fromConversationId ?? null,
    createdByTokenId: input.origin?.tokenId ?? null,
    originLabel: input.origin?.label ?? null,
    scheduleId: input.scheduleId ?? null,
    place: input.projectId === null ? (input.place ?? null) : null,
    config: JSON.stringify(config),
    configOverrides: JSON.stringify(overrides),
    status: 'idle',
    backgroundCount: 0,
    loopCount: 0,
    lastSeq: 0,
    lastNotableSeq: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    turnCount: 0,
    journalBytes: 0,
    contextUsedTokens: null,
    contextMaxTokens: null,
    model: null,
    pinned: false,
    // La colonne survit à l'ordre manuel qu'elle servait : les listes trient par
    // activité récente, plus personne ne la lit.
    position: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(conversations).values(row).run()
  if (input.handoff) {
    db.insert(conversationHandoffs)
      .values({ conversationId: row.id, createdAt: now, ...input.handoff })
      .run()
  }

  if (input.firstMessage) {
    // Si l'envoi échoue, la conversation ne doit pas rester comme un fil vide :
    // on la retire et on remonte l'erreur telle quelle.
    try {
      await sessions.sendMessage(
        row.id,
        input.firstMessage.clientMessageId,
        input.firstMessage.text,
        input.firstMessage.attachments,
        input.firstMessage.mentions,
        input.firstMessage.skills,
      )
    } catch (err) {
      db.delete(conversations).where(eq(conversations.id, row.id)).run()
      throw err
    }
  }

  return row
}
