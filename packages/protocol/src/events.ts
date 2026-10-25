import { z } from 'zod'
import { contextBreakdownSchema } from './context.js'
import { elicitationContentSchema, elicitationFieldSchema } from './elicitation.js'
import { mcpServerStatusSchema } from './mcp.js'
import { slashCommandSchema } from './commands.js'
import { agentSkillSchema } from './skills.js'
import { cardColumnSchema } from './cards.js'
import { cardDraftCreatedSchema, cardDraftRefSchema, cardDraftSchema } from './card-draft.js'
import { toolPresentationSchema } from './tools.js'

/**
 * Schéma d'événements normalisé (invariant I3 de la spec).
 *
 * Chaque adaptateur de CLI traduit son flux natif vers ces événements. Le frontend
 * ne connaît que ce schéma et ignore quel CLI est derrière. Le payload natif brut est
 * conservé à part, dans la colonne `events.raw`, pour les renderers spécialisés.
 */

export const agentKindSchema = z.enum(['claude', 'codex', 'opencode', 'grok'])
export type AgentKind = z.infer<typeof agentKindSchema>

export const planStatusSchema = z.enum(['pending', 'in_progress', 'completed'])

/**
 * Désigne un corps volumineux resté sur le serveur : le champ `field` de l'événement
 * `seq`, ou de son bloc `block`. Un événement du journal ne change plus, donc la
 * référence vise toujours le même contenu, là où un identifiant d'appel peut être
 * réutilisé d'un tour à l'autre.
 */
export const eventBodyRefSchema = z.object({
  seq: z.number().int().positive(),
  field: z.enum(['input', 'output', 'patch']),
  block: z.number().int().nonnegative().optional(),
})
export type EventBodyRef = z.infer<typeof eventBodyRefSchema>

export const contentBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({
    type: z.literal('image'),
    mimeType: z.string(),
    url: z.string(),
    /** Dimensions lues dans l'en-tête quand l'image reste au serveur : la place est réservée avant qu'elle arrive. */
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
  }),
  /**
   * Pièce jointe non affichable en ligne. Le chemin transmis à l'agent n'apparaît pas
   * ici : le fil montre le fichier, pas son emplacement sur le disque du serveur.
   */
  z.object({
    type: z.literal('file'),
    name: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number(),
    url: z.string(),
  }),
  z.object({
    type: z.literal('tool_use'),
    toolCallId: z.string(),
    name: z.string(),
    input: z.unknown(),
    inputRef: eventBodyRefSchema.optional(),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolCallId: z.string(),
    output: z.unknown(),
    outputRef: eventBodyRefSchema.optional(),
    isError: z.boolean(),
  }),
])
export type ContentBlock = z.infer<typeof contentBlockSchema>

/**
 * Appel d'outil dont l'événement descend, quand il vient d'un sous-agent : c'est
 * l'appel qui a lancé ce sous-agent. Null pour tout ce que produit l'agent principal.
 *
 * Défaut à null plutôt que champ requis : le journal est rejoué indéfiniment (I2), et
 * les événements écrits avant l'ajout de ce champ doivent continuer à se relire.
 */
const parentToolCallIdSchema = z.string().nullable().default(null)

/** Une carte nommée dans une demande de changement : de quoi l'afficher sans relire la base. */
const cardFilingRefSchema = z.object({ cardId: z.string(), number: z.number(), title: z.string() })

/**
 * Ce que la clôture d'une carte touchera (#69), relevé au dépôt pour que la demande se
 * lise : ses conversations encore ouvertes, ses worktrees, les enfants encore ouvertes
 * qu'elle abandonnera, la branche de parente qu'elle supprimera. Le clic refait le
 * relevé : entre-temps, une session a pu s'ouvrir ou un arbre bouger.
 */
const cardCloseSchema = z.object({
  conversations: z.number(),
  worktrees: z.array(z.string()),
  abandon: z.array(cardFilingRefSchema),
  branch: z.string().nullable(),
})

/**
 * Pourquoi un worktree ou une branche est resté en place à la clôture : du travail non
 * commité, des commits que la forge n'a pas, une session au travail, un arbre que
 * partage une autre carte, un arbre que git n'a pas su juger, un refus de git, ou une
 * branche de parente dont la PR n'est pas fusionnée.
 */
export const cardCloseKeptReasonSchema = z.enum(['dirty', 'unpushed', 'busy', 'shared', 'unreadable', 'refused', 'unmerged'])
export type CardCloseKeptReason = z.infer<typeof cardCloseKeptReasonSchema>

/** Ce que la clôture d'une carte a réellement fait, écrit au clic. */
export const cardCloseOutcomeSchema = z.object({
  number: z.number(),
  archived: z.number(),
  /** Les worktrees retirés, par leur nom. */
  removed: z.array(z.string()),
  kept: z.array(z.object({ name: z.string(), reason: cardCloseKeptReasonSchema })),
  /** Les branches supprimées sur la forge. */
  deleted: z.array(z.string()),
  /** Les enfants passées en « abandonné ». */
  abandoned: z.array(z.number()),
})
export type CardCloseOutcome = z.infer<typeof cardCloseOutcomeSchema>

/**
 * Portée d'une décision de permission : deux valeurs, et pas trois.
 *
 * `once` ne vaut que pour cet appel ; `session` vaut jusqu'à la fin de l'instance de
 * CLI. Il n'y a pas de troisième portée parce qu'une autorisation permanente voudrait
 * dire une liste d'autorisations par outil avec son écran de révocation, qui n'existe
 * pas : le besoin « trop de clics » se traite par le mode de permission de la
 * conversation (`agent-config.ts`), pas par une portée de plus sur le clic.
 *
 * `always` est accepté en entrée et replié sur `session` : le journal est rejoué
 * indéfiniment (I2), et les lignes écrites quand l'enum avait trois valeurs doivent
 * continuer à se relire. Un événement qui ne parse pas est remplacé par une erreur
 * visible dans le fil (`event-log.ts`, `parseStored`), ce qui laisserait une demande de
 * permission ancienne éternellement « en attente ». Rien ne produit plus cette valeur,
 * et l'enum des requêtes (`api.ts`, `v1.ts`) ne l'accepte plus.
 */
const permissionScopeSchema = z
  .enum(['once', 'session', 'always'])
  .transform((scope) => (scope === 'always' ? 'session' : scope))

/** Une option proposée par le CLI dans une demande de permission. */
export const permissionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  scope: permissionScopeSchema,
  behavior: z.enum(['allow', 'deny']),
})
export type PermissionOption = z.infer<typeof permissionOptionSchema>

/** Un choix proposé pour une question posée par l'agent. */
export const questionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
  /** Aperçu facultatif : maquette, extrait de code, exemple de configuration. */
  preview: z.string().nullable().default(null),
})
export type QuestionOption = z.infer<typeof questionOptionSchema>

/**
 * Une question posée par l'agent, normalisée entre les deux CLI.
 *
 * Claude passe par l'outil `AskUserQuestion`, Codex par la requête
 * `item/tool/requestUserInput`. Les deux décrivent la même chose : un intitulé, des
 * options, et la façon d'y répondre.
 */
export const agentQuestionSchema = z.object({
  /** Clé de la réponse. Codex la fournit, Claude utilise l'intitulé lui-même. */
  id: z.string(),
  header: z.string(),
  question: z.string(),
  /** Plusieurs options peuvent être retenues à la fois. */
  multiSelect: z.boolean().default(false),
  /** Une réponse libre est acceptée en plus des options proposées. */
  allowOther: z.boolean().default(false),
  /** La saisie ne doit pas s'afficher en clair. */
  secret: z.boolean().default(false),
  /** Vide quand seule une réponse libre est attendue. */
  options: z.array(questionOptionSchema).default([]),
})
export type AgentQuestion = z.infer<typeof agentQuestionSchema>

/**
 * Une façon de poursuivre après validation d'un plan, proposée par l'adaptateur.
 *
 * Comme `permission.requested.suggestions` : c'est le CLI qui sait quels modes il
 * accepte ensuite, pas le schéma commun. `id` est opaque pour le journal et l'UI, et
 * n'a de sens que pour l'adaptateur qui l'a émis (un mode de permission chez Claude).
 */
export const planFollowUpOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  hint: z.string().default(''),
})
export type PlanFollowUpOption = z.infer<typeof planFollowUpOptionSchema>

/**
 * Un travail qui continue en dehors du tour : workflow, sous-agent passé en fond,
 * commande lancée en tâche de fond, surveillance d'un service.
 *
 * `kind` reste une chaîne libre plutôt qu'une énumération : le CLI en ajoute au fil
 * des versions et retombe sur son discriminant brut pour ceux qu'il ne nomme pas.
 * L'UI traduit ceux qu'elle connaît et affiche les autres tels quels, au lieu de
 * refuser un événement dont le seul tort serait d'être récent.
 */
export const backgroundTaskSchema = z.object({
  id: z.string(),
  kind: z.string(),
  description: z.string(),
})
export type BackgroundTask = z.infer<typeof backgroundTaskSchema>

/**
 * Une tâche planifiée qui rouvrira la session d'elle-même : `/loop`, qu'il tourne à
 * intervalle fixe ou à cadence choisie par l'agent. Les deux passent par le même
 * registre côté CLI, le second s'y inscrivant comme tâche à tir unique réarmée à
 * chaque tour.
 *
 * `schedule` est une expression cron à cinq champs, interprétée dans le fuseau du
 * serveur. Elle ne donne pas la date du prochain tir : le CLI ajoute une gigue qui va
 * jusqu'à la moitié de l'intervalle, donc l'affichage montre la cadence et le dernier
 * réveil observé plutôt qu'un compte à rebours qui mentirait.
 *
 * `prompt` est tronqué à 1000 caractères par le CLI, avec un marqueur en fin de chaîne.
 */
export const loopSchema = z.object({
  id: z.string(),
  schedule: z.string(),
  recurring: z.boolean(),
  prompt: z.string(),
})
export type Loop = z.infer<typeof loopSchema>

/** Un fichier changé par un tour, entre les deux captures. Null pour un binaire. */
export const checkpointFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable().default(null),
  kind: z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'typechange']),
  added: z.number().nullable().default(null),
  removed: z.number().nullable().default(null),
})
export type CheckpointFile = z.infer<typeof checkpointFileSchema>

export const soleraEventSchema = z.discriminatedUnion('type', [
  // Cycle de vie
  z.object({
    type: z.literal('session.started'),
    agent: agentKindSchema,
    agentSessionId: z.string(),
    model: z.string(),
    cwd: z.string(),
    tools: z.array(z.string()),
  }),
  z.object({
    type: z.literal('session.ended'),
    reason: z.enum(['completed', 'interrupted', 'error']),
  }),
  z.object({ type: z.literal('turn.started') }),
  z.object({
    type: z.literal('turn.completed'),
    stopReason: z.string(),
    costUsd: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    /**
     * L'essentiel du contexte d'un CLI transite par le cache : ne compter que
     * `inputTokens` donne un total sans rapport avec la consommation réelle (2 contre
     * 33 231 sur un tour observé). Défaut à 0 pour les événements journalisés avant
     * l'ajout de ces champs.
     */
    cacheCreationTokens: z.number().default(0),
    cacheReadTokens: z.number().default(0),
  }),

  // Contenu
  z.object({
    type: z.literal('message.started'),
    messageId: z.string(),
    role: z.enum(['user', 'assistant']),
  }),
  z.object({
    type: z.literal('message.delta'),
    messageId: z.string(),
    text: z.string(),
    parentToolCallId: parentToolCallIdSchema,
  }),
  /**
   * Un même `messageId` peut recevoir plusieurs `message.completed` successifs : les
   * CLI livrent un message assistant par morceaux (réflexion, puis appels d'outils).
   * Le fold de rendu ajoute les blocs à la suite, il ne les remplace pas.
   */
  z.object({
    type: z.literal('message.completed'),
    messageId: z.string(),
    role: z.enum(['user', 'assistant']),
    blocks: z.array(contentBlockSchema),
    parentToolCallId: parentToolCallIdSchema,
  }),
  z.object({
    type: z.literal('thinking.delta'),
    messageId: z.string(),
    text: z.string(),
    parentToolCallId: parentToolCallIdSchema,
  }),
  /**
   * Taille de la réflexion en cours, en tokens estimés.
   *
   * Accompagne `thinking.delta` frame par frame quand la pensée est révélée, et le
   * remplace entièrement quand le modèle la cache : le flux ne porte alors plus rien
   * qui distingue un agent qui réfléchit d'un agent bloqué, et ce compteur est sa
   * seule preuve de vie.
   *
   * `estimatedTokens` est une estimation du CLI, remise à zéro à chaque bloc de
   * réflexion : elle sert à faire bouger un indicateur, pas à compter la facture, que
   * `turn.completed` seul arrête.
   *
   * Sans identifiant de message ni de fil : le CLI n'en attache pas, cette progression
   * appartient au tour et non à une bulle.
   */
  z.object({
    type: z.literal('thinking.progress'),
    estimatedTokens: z.number(),
  }),

  // Outils
  z.object({
    type: z.literal('tool.started'),
    toolCallId: z.string(),
    name: z.string(),
    presentation: toolPresentationSchema.optional(),
    input: z.unknown(),
    inputRef: eventBodyRefSchema.optional(),
    parentToolCallId: z.string().nullable(),
  }),
  z.object({
    type: z.literal('tool.output_delta'),
    toolCallId: z.string(),
    chunk: z.string(),
  }),
  z.object({
    type: z.literal('tool.input_updated'),
    toolCallId: z.string(),
    /** Codex peut changer la nature d'un appel à sa complétion, Grok préciser son nom natif. */
    name: z.string().optional(),
    presentation: toolPresentationSchema.optional(),
    input: z.unknown(),
    inputRef: eventBodyRefSchema.optional(),
  }),
  z.object({
    type: z.literal('tool.completed'),
    toolCallId: z.string(),
    output: z.unknown(),
    outputRef: eventBodyRefSchema.optional(),
    isError: z.boolean(),
    durationMs: z.number(),
    /**
     * Taille réelle de la sortie, présente seulement quand `output` n'a pas été
     * transmise. Une relecture d'historique retire les sorties volumineuses pour ne pas
     * transférer des mégaoctets que personne ne lit ; la carte de l'appel demande le
     * corps complet à l'ouverture. Posé aussi sur le direct, pour une connexion qui a
     * demandé les références de corps (`bodies`).
     */
    outputBytes: z.number().optional(),
  }),

  // Interaction requise
  z.object({
    type: z.literal('permission.requested'),
    requestId: z.string(),
    toolName: z.string(),
    input: z.unknown(),
    suggestions: z.array(permissionOptionSchema),
    /**
     * Libellés rédigés par le CLI lui-même. Ils décrivent l'action bien mieux qu'une
     * phrase reconstruite depuis le nom de l'outil, qui ne sait rien du contexte
     * (chemin hors des dossiers autorisés, règle déclenchée, portée demandée).
     *
     * Nullables et facultatifs : le journal est rejoué indéfiniment (I2), et les
     * événements écrits avant l'ajout de ces champs doivent continuer à se relire.
     */
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal('permission.resolved'),
    requestId: z.string(),
    decision: z.enum(['allowed', 'denied', 'expired']),
    scope: permissionScopeSchema,
    decidedBy: z.string().nullable(),
  }),

  /**
   * Un agent demande à ranger une conversation dans un projet, et attend un clic.
   *
   * Couple requête/résolution sur le modèle des permissions juste au-dessus, et pour la
   * même raison : la demande vit dans le fil, à sa place chronologique, et c'est le
   * journal rejoué qui dit si elle attend encore.
   *
   * Posée dans le journal de la conversation **déplacée**, qui n'est pas forcément celle
   * qui demande : c'est son propriétaire qui accorde, et c'est chez lui que la demande
   * doit apparaître.
   */
  z.object({
    type: z.literal('filing.requested'),
    /** L'id de la ligne `agent_requests` : ce que la route de décision reprend. */
    requestId: z.string(),
    /** Le fil déplacé : celui-ci, ou un autre que la session demandeuse voyait. */
    conversationId: z.string(),
    conversationTitle: z.string(),
    projectId: z.string(),
    projectName: z.string(),
    /** Ce qui part avec le déplacement, pour que la demande affiche son prix. */
    worktree: z.object({ name: z.string(), dirtyFiles: z.number() }).nullable(),
    card: z.object({ number: z.number(), title: z.string() }).nullable(),
    /** Faux quand la session n'avait de toute façon pas de reprise CLI. */
    resumable: z.boolean(),
  }),
  z.object({
    type: z.literal('filing.resolved'),
    requestId: z.string(),
    decision: z.enum(['accepted', 'refused', 'impossible']),
    decidedBy: z.string().nullable(),
    /**
     * Pourquoi `impossible`, revérifié au moment du clic. Nullable et facultatif : le
     * journal est rejoué indéfiniment (I2), et les événements écrits avant l'ajout de ce
     * champ doivent continuer à se relire.
     */
    reason: z.string().nullable().optional(),
  }),

  /**
   * Un agent propose de changer une ou plusieurs cartes du board, et attend un clic :
   * leur colonne, et depuis #66 leur parente, leur échéance et leurs liens « bloque ».
   * Même motif que `filing.*`, avec trois écarts que la carte #54 arbitre.
   *
   * **Posée dans le journal de la conversation qui demande**, et non dans celui d'un fil
   * déplacé : une carte n'a pas de fil à elle. C'est pourtant le **propriétaire du
   * projet** qui accorde, pas celui de la conversation — c'est le board qu'on range. Les
   * deux ne se confondent que sur une instance à un seul compte.
   *
   * **Une demande porte plusieurs cartes**, appliquées en une transaction : le refus des
   * listes de #23 tenait à deux temps d'exécution différents, et dix lignes `card_moves`
   * écrites d'un tenant n'en ont qu'un.
   *
   * **La raison est obligatoire, par carte** : une demande sans raison écrite n'est pas
   * une proposition, c'est un ordre poli. `move_conversation` s'en passe parce que son
   * prix se calcule tout seul.
   */
  z.object({
    type: z.literal('card_filing.requested'),
    /** L'id de la ligne `agent_requests` : ce que la route de décision reprend. */
    requestId: z.string(),
    /**
     * Les cartes proposées, dans l'ordre où l'agent les a données, avec leur colonne
     * d'arrivée et la raison qu'il en donne.
     *
     * `fromColumn` est l'état au dépôt, affiché pour que la demande se lise ; c'est la
     * colonne relue **au clic** qui part dans `card_moves`, la carte ayant pu bouger
     * entre-temps.
     *
     * Chaque changement est facultatif, mais une ligne en porte au moins un. `toColumn`
     * l'est devenu avec #66 ; les demandes d'avant l'ont toutes, et se relisent pareil.
     * Une parente ou une échéance porte sa valeur au dépôt (`from`) : au clic, une carte
     * dont la valeur a changé entre-temps sort du lot, comme une carte qui a bougé.
     */
    cards: z
      .array(
        z.object({
          cardId: z.string(),
          number: z.number(),
          title: z.string(),
          fromColumn: cardColumnSchema,
          toColumn: cardColumnSchema.optional(),
          /** La parente avant et après ; `to: null` détache la carte. */
          parent: z.object({ from: cardFilingRefSchema.nullable(), to: cardFilingRefSchema.nullable() }).optional(),
          /** L'échéance avant et après, en minuit local ; `to: null` l'enlève. */
          dueAt: z.object({ from: z.number().nullable(), to: z.number().nullable() }).optional(),
          /** Les cartes que celle-ci bloquera. */
          blocks: z.array(cardFilingRefSchema).optional(),
          /** Les cartes qu'elle cessera de bloquer. */
          unblocks: z.array(cardFilingRefSchema).optional(),
          /**
           * Clore la carte (#69) : avec `toColumn` (« terminé » par défaut, ou
           * « abandonné ») si elle n'y est pas déjà, puis archiver ses conversations,
           * retirer ses worktrees et supprimer ses branches fusionnées.
           */
          close: cardCloseSchema.optional(),
          reason: z.string(),
        }),
      )
      .min(1),
  }),
  z.object({
    type: z.literal('card_filing.resolved'),
    requestId: z.string(),
    decision: z.enum(['accepted', 'refused', 'impossible']),
    decidedBy: z.string().nullable(),
    /**
     * Pourquoi `impossible`, revérifié au moment du clic — une carte a pu disparaître,
     * ou déjà se trouver dans la colonne visée. Nullable et facultatif : le journal est
     * rejoué indéfiniment (I2).
     */
    reason: z.string().nullable().optional(),
    /**
     * Les cartes réellement déplacées, telles que `card_moves` les a reçues. Facultatif
     * et vide par défaut, pour la même raison que `reason`.
     *
     * Écrit ici et pas déduit de la requête : entre le dépôt et le clic, une carte a pu
     * bouger, et c'est ce mouvement-là qui a eu lieu.
     */
    moved: z
      .array(z.object({ number: z.number(), fromColumn: cardColumnSchema, toColumn: cardColumnSchema }))
      .default([]),
    /**
     * Les cartes dont les changements ont été appliqués, colonne comprise ou non. Absent
     * des événements d'avant #66, où `moved` disait tout : le lecteur s'y replie.
     */
    applied: z.array(z.number()).optional(),
    /** Ce que les clôtures accordées ont fait, carte par carte (#69). */
    closed: z.array(cardCloseOutcomeSchema).optional(),
  }),

  /**
   * Un agent propose un découpage en cartes (`propose_cards`, #70), et ne crée rien.
   *
   * Posé dans le journal de la conversation qui propose, comme `card_filing.requested`.
   * Le brouillon y est entier : c'est lui que le bloc éditable affiche, et c'est sa
   * version corrigée que la route de validation reçoit. Une nouvelle proposition de la
   * même conversation remplace celle qui attendait (`superseded`).
   */
  z.object({
    type: z.literal('card_draft.proposed'),
    requestId: z.string(),
    draft: cardDraftSchema,
  }),
  z.object({
    type: z.literal('card_draft.resolved'),
    requestId: z.string(),
    decision: z.enum(['created', 'refused', 'superseded']),
    decidedBy: z.string().nullable(),
    /** La parente des cartes créées, neuve ou existante ; null sans parente ou sans création. */
    parent: cardDraftRefSchema.nullable().default(null),
    /** Les cartes créées, dans l'ordre du brouillon validé. Vide hors création. */
    created: z.array(cardDraftCreatedSchema).default([]),
    /**
     * Le brouillon tel qu'il a été validé, corrections de la personne comprises : c'est
     * lui que le bloc montre ensuite, et non celui de l'agent, dont une carte ou un lien
     * a pu être retiré. Absent hors création.
     */
    draft: cardDraftSchema.optional(),
  }),

  /**
   * Une session demande une décision (`request_decision`), sans se bloquer.
   *
   * Posée dans le journal de la conversation qui demande, à sa place chronologique,
   * comme `card_filing.requested`. L'autorité reste la ligne `agent_requests` : le
   * journal dit ce qui a été demandé et ce qu'il en est advenu, la route de réponse
   * relit la ligne.
   */
  z.object({
    type: z.literal('decision.requested'),
    /** L'id de la ligne `agent_requests` : ce que le dialogue de réponse ouvre. */
    requestId: z.string(),
    question: z.string(),
    context: z.string(),
    options: z.array(z.string()),
    defaultOption: z.string().nullable(),
    expiresAt: z.number(),
  }),
  z.object({
    type: z.literal('decision.resolved'),
    requestId: z.string(),
    /** Qui a clos la décision : une personne, l'échéance, ou l'archivage. */
    by: z.enum(['user', 'default', 'expired', 'withdrawn']),
    option: z.string().nullable(),
    text: z.string().nullable(),
    decidedBy: z.string().nullable(),
  }),

  // Questions posées par l'agent
  z.object({
    type: z.literal('question.requested'),
    requestId: z.string(),
    questions: z.array(agentQuestionSchema),
    /** Absent dans les anciens journaux : la question bloque alors le tour. */
    blocking: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('question.resolved'),
    requestId: z.string(),
    status: z.enum(['answered', 'cancelled', 'expired']),
    /** Réponses retenues, par identifiant de question. */
    answers: z.record(z.string(), z.array(z.string())).default({}),
    decidedBy: z.string().nullable(),
  }),

  /**
   * Message écrit pendant qu'un tour est déjà en cours.
   *
   * Il n'est pas transmis au CLI tout de suite : poussé en cours de tour, il se mêle
   * au contexte du tour courant, ce qui a été observé sur le CLI installé (la réponse
   * au second message est sortie avant la fin du premier, puis une seconde fois). La
   * file vit donc côté serveur, et ces deux événements la rendent visible.
   */
  z.object({
    type: z.literal('message.queued'),
    queueId: z.string(),
    text: z.string(),
    /** Nombre de pièces jointes, pour l'afficher sans exposer leur contenu. */
    attachmentCount: z.number().default(0),
  }),
  z.object({
    type: z.literal('message.dequeued'),
    queueId: z.string(),
    /**
     * `sent` : le message part au CLI et devient un message ordinaire du fil.
     * `steered` : il y part aussi, mais dans le tour en cours plutôt qu'au suivant.
     */
    reason: z.enum(['sent', 'steered', 'cancelled', 'expired']),
  }),

  /**
   * Message d'une autre session que Solera n'a pas remis.
   *
   * Le relais relance une session au repos pour lui remettre un message, sauf quand un
   * échange tourne en rond ou qu'elle a déjà été trop relancée sans personne : il le
   * retient alors, et ces deux événements le rendent visible, pour qu'une personne le
   * remette ou l'écarte au lieu qu'il attende en silence. `text` est l'enveloppe
   * complète, voir `parseSessionMessage`.
   */
  z.object({
    type: z.literal('session_message.held'),
    messageId: z.string(),
    text: z.string(),
    reason: z.enum(['loop', 'rate']),
  }),
  z.object({
    type: z.literal('session_message.released'),
    messageId: z.string(),
    /** `delivered` remis au CLI, `read` lu par l'outil, `discarded` écarté, `expired` trop vieux. */
    reason: z.enum(['delivered', 'read', 'discarded', 'expired']),
  }),

  // Saisie réclamée par un serveur MCP (elicitation/create)
  z.object({
    type: z.literal('elicitation.requested'),
    requestId: z.string(),
    /** Serveur MCP à l'origine de la demande, à afficher : il n'est pas de confiance. */
    serverName: z.string(),
    /**
     * `form` attend une saisie, `url` demande d'ouvrir une page (authentification).
     * Codex a un troisième mode, `openai/form`, normalisé ici comme un formulaire.
     */
    mode: z.enum(['form', 'url']),
    message: z.string(),
    /** Renseignée en mode `url` uniquement. */
    url: z.string().nullable().default(null),
    fields: z.array(elicitationFieldSchema).default([]),
    title: z.string().nullable().default(null),
  }),
  z.object({
    type: z.literal('elicitation.resolved'),
    requestId: z.string(),
    /** `expired` n'existe pas dans MCP : c'est la clôture d'une demande sans réponse. */
    status: z.enum(['accept', 'decline', 'cancel', 'expired']),
    content: elicitationContentSchema.default({}),
    decidedBy: z.string().nullable(),
  }),

  // Validation d'un plan avant passage à l'exécution
  z.object({
    type: z.literal('plan.review_requested'),
    requestId: z.string(),
    /** Le plan, en markdown, tel que l'agent le propose. */
    plan: z.string(),
    /**
     * Suites possibles après validation, fournies par l'adaptateur. Défaut vide pour
     * les événements journalisés avant l'ajout du champ : l'UI propose alors une
     * validation sans changement de mode.
     */
    followUpOptions: z.array(planFollowUpOptionSchema).default([]),
  }),
  z.object({
    type: z.literal('plan.review_resolved'),
    requestId: z.string(),
    decision: z.enum(['approved', 'rejected', 'expired']),
    /**
     * Suite adoptée quand le plan est accepté : l'`id` d'une option proposée. C'est ce
     * qui distingue « valide et poursuis en demandant » de « valide et laisse
     * écrire ». Chaîne opaque ici : c'est l'adaptateur émetteur qui la valide, le
     * schéma commun n'a pas à connaître les modes de permission d'un CLI.
     */
    followUpMode: z.string().nullable().default(null),
    decidedBy: z.string().nullable(),
  }),

  /**
   * Le résumé du contexte a commencé.
   *
   * Sans ce repère, une compaction se présente comme un tour ordinaire : l'agent
   * paraît réfléchir alors qu'il réécrit sa mémoire, ce qui peut durer bien plus
   * longtemps qu'une réponse et n'en produira aucune.
   *
   * Aucun des deux CLI n'annonce d'avancement chiffré : l'événement dit qu'une
   * compaction est en cours, et c'est tout ce qu'ils permettent d'affirmer.
   */
  z.object({ type: z.literal('context.compaction_started') }),

  /**
   * L'agent a modifié un fichier du workspace.
   *
   * Événement normalisé plutôt qu'une déduction côté client à partir des noms
   * d'outils : c'est exactement ce que l'invariant I3 impose, et les deux CLI le
   * disent différemment (outils `Write`/`Edit` chez Claude, items `fileChange` chez
   * Codex). L'historique des modifications devient ainsi dérivable du seul journal,
   * donc rejouable et identique pour les deux.
   *
   * `toolCallId` rattache la modification à l'appel qui l'a produite, pour que
   * l'historique puisse renvoyer au fil.
   */
  z.object({
    type: z.literal('file.edited'),
    toolCallId: z.string(),
    /** Relatif au répertoire de travail quand il en fait partie, absolu sinon. */
    path: z.string(),
    action: z.enum(['created', 'modified', 'deleted']),
  }),

  /**
   * Le contexte vient d'être résumé.
   *
   * Journalisé parce que rien d'autre ne le montre : le fil ne perd aucun message,
   * mais la mémoire de l'agent, elle, a changé. Sans ce repère, une réponse qui ignore
   * un détail donné plus haut paraît inexplicable.
   *
   * `preTokens` et `postTokens` sont nullables : Claude les fournit, l'item de Codex
   * ne porte qu'un identifiant. Inventer un chiffre serait pire que de ne pas
   * l'afficher.
   */
  z.object({
    type: z.literal('context.compacted'),
    trigger: z.enum(['manual', 'auto', 'unknown']),
    preTokens: z.number().nullable().default(null),
    postTokens: z.number().nullable().default(null),
  }),

  /**
   * Les travaux de fond vivants ont changé : un workflow a démarré, une commande
   * lancée en tâche de fond s'est terminée, un sous-agent est passé en arrière-plan.
   *
   * Sémantique de remplacement, et non d'incrément : chaque événement porte la liste
   * complète, l'état d'affichage se remplace au lieu de s'apparier. C'est ce qui
   * distingue ce travail-là du reste du journal, où un début et une fin se répondent.
   * Un événement manqué ne peut donc pas laisser un indicateur allumé pour toujours.
   *
   * Sans ça, un workflow tourne pendant plusieurs minutes sans que rien ne l'affiche :
   * le tour se termine, le fil passe au repos, et des fichiers changent sous les yeux
   * de l'utilisateur dans une session qui se dit inactive.
   */
  z.object({
    type: z.literal('background.updated'),
    tasks: z.array(backgroundTaskSchema),
  }),

  /**
   * L'inventaire MCP de la session a changé : un serveur s'est connecté, a échoué, ou
   * réclame une authentification.
   *
   * Même sémantique de remplacement que `background.updated` : le CLI publie l'état de
   * tous ses serveurs à la fois, jamais un delta. La liste contient aussi les serveurs
   * venus du disque du CLI, marqués `external`, parce que l'utilisateur les subit au
   * même titre que les siens et doit pouvoir les voir échouer.
   *
   * Sans ça, un serveur mal configuré échoue en silence : l'agent n'a simplement pas
   * l'outil attendu, et rien ne distingue ce cas d'un modèle qui a choisi de ne pas
   * s'en servir.
   */
  z.object({
    type: z.literal('mcp.updated'),
    servers: z.array(mcpServerStatusSchema),
  }),

  /**
   * Les commandes en `/` que le CLI reconnaît pour cette session.
   *
   * Même sémantique de remplacement que `mcp.updated` : le CLI republie la liste
   * entière dès qu'elle bouge, et elle bouge en cours de session, une compétence
   * pouvant être découverte quand l'agent descend dans un sous-répertoire.
   *
   * Déjà réduite à ce que Solera sait proposer : le filtrage se fait à la source, où
   * l'on sait de quel CLI vient la liste.
   */
  z.object({
    type: z.literal('commands.updated'),
    commands: z.array(slashCommandSchema),
  }),

  /**
   * Les compétences que le CLI met à disposition de la session, référencées en `$`.
   *
   * Même sémantique de remplacement que `commands.updated`, et même volatilité : le
   * CLI surveille les fichiers de compétences et signale qu'ils ont bougé. Publié par
   * Codex seul, Claude exposant les siennes parmi ses commandes en `/`.
   */
  z.object({
    type: z.literal('skills.updated'),
    skills: z.array(agentSkillSchema),
  }),

  /**
   * Les boucles armées pour cette session, relevées à la fin de chaque tour.
   *
   * Même sémantique de remplacement que `background.updated`, et pour une raison plus
   * forte encore : le CLI n'annonce ni la création ni la fin d'une boucle, il répond
   * seulement quand on lui demande la liste. Une boucle expirée disparaît donc sans
   * rien émettre, et seul le relevé suivant la fait tomber.
   *
   * Sans ça une conversation qui se réveille toute seule est indiscernable d'une
   * conversation terminée, et le tour qu'elle ouvre s'affiche comme si l'utilisateur
   * l'avait écrit.
   */
  z.object({
    type: z.literal('loops.updated'),
    loops: z.array(loopSchema),
  }),

  /**
   * Une consigne est entrée dans la session sans que Solera l'ait envoyée : le CLI l'a
   * réinjectée lui-même, une boucle arrivée à échéance étant le cas courant.
   *
   * Reconnue à ce que le CLI la livre en texte, là où les messages de Solera sont
   * toujours des blocs et ceux du CLI des résultats d'outils. C'est ce que compte le
   * nombre d'itérations d'une boucle, faute de compteur côté CLI.
   */
  z.object({
    type: z.literal('prompt.injected'),
    text: z.string(),
  }),

  /**
   * Un travail vient d'être enregistré par le CLI.
   *
   * Complète la liste de niveau sur un point qu'elle ne porte pas : l'appel d'outil
   * d'où vient le travail. C'est lui qui permet de distinguer un sous-agent que le fil
   * suit déjà d'un travail que plus personne ne regarde, les deux étant annoncés dans
   * la même liste.
   */
  z.object({
    type: z.literal('task.started'),
    taskId: z.string(),
    /** Nul pour un travail que le harnais lance de lui-même, sans passer par un outil. */
    toolCallId: z.string().nullable().default(null),
    kind: z.string(),
    description: z.string(),
  }),

  /**
   * Un travail a avancé.
   *
   * Émis à chaque appel d'outil du travail, ce qui suffit à le décrire : un agent qui
   * n'appelle rien est en train de réfléchir, et le dernier outil reste alors ce qu'on
   * peut dire de plus juste sur ce qu'il fait.
   *
   * `activity` est la description que le CLI donne du moment présent, pas un cumul :
   * chaque événement remplace le précédent.
   */
  z.object({
    type: z.literal('task.progress'),
    taskId: z.string(),
    activity: z.string(),
    lastTool: z.string().nullable().default(null),
    toolUses: z.number(),
    totalTokens: z.number(),
    durationMs: z.number(),
  }),

  /**
   * Un travail s'est arrêté, avec ce qu'il en reste.
   *
   * `summary` est le compte rendu du CLI. Pour un travail que le fil suivait, il
   * double le résultat de l'appel d'outil ; pour un travail de fond, c'est la seule
   * réponse à « qu'a-t-il fait pendant ce temps », la liste de niveau se contentant
   * de le retirer.
   */
  z.object({
    type: z.literal('task.completed'),
    taskId: z.string(),
    status: z.enum(['completed', 'failed', 'stopped']),
    summary: z.string(),
    durationMs: z.number().nullable().default(null),
    /** Travail d'entretien, que le CLI demande de ne pas montrer dans le fil. */
    ambient: z.boolean().default(false),
  }),

  // Métadonnées
  z.object({
    type: z.literal('agent.notice'),
    /** Identifiant stable pour remplacer un état répété dans le rendu. */
    id: z.string().optional(),
    code: z.string(),
    message: z.string(),
    level: z.enum(['info', 'warning']),
    /** Détails repliables, utiles aussi pour les événements d'un CLI plus récent. */
    details: z.unknown().optional(),
  }),
  /**
   * Le message suivant que le CLI prédit, un par tour, après le `result`.
   *
   * Remplacé et jamais complété : une suggestion ne vaut que pour le tour qui vient,
   * et le rendu l'efface dès qu'un message part, quel qu'il soit.
   */
  z.object({
    type: z.literal('suggestion.updated'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('plan.updated'),
    items: z.array(z.object({ text: z.string(), status: planStatusSchema })),
  }),
  /**
   * `costUsd` est le coût API équivalent calculé par le CLI. Sur un compte par
   * abonnement il ne correspond à aucune facturation : c'est `rateLimit` qui décrit
   * la ressource réellement consommée. L'UI choisit lequel afficher selon le compte.
   */
  z.object({
    type: z.literal('usage.updated'),
    costUsd: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    /**
     * Les deux champs ci-dessous sont tolérants : le journal est rejoué indéfiniment
     * (invariant I2), donc un événement écrit avant l'ajout d'un champ doit continuer
     * à se relire. Sans ces défauts, un ancien `usage.updated` produisait un `NaN`.
     *
     * Occupation de la fenêtre de contexte. C'est la ressource qui décide quand une
     * conversation devra être compactée, indépendante du quota de facturation.
     */
    context: z
      .object({
        usedTokens: z.number(),
        maxTokens: z.number(),
        /**
         * De 0 à 1, rapport de l'occupation à la fenêtre ci-dessus.
         *
         * Calculé et non recopié du CLI : Claude rend un pourcentage entier, rapporté
         * à une fenêtre qui n'est pas toujours celle qu'il annonce par ailleurs. Le
         * laisser passer tel quel faisait dire à la pastille et à la modale deux
         * pourcentages différents pour la même conversation.
         */
        ratio: z.number(),
        /**
         * Ce qui occupe la fenêtre, quand le CLI le dit. Toujours `null` chez
         * opencode, qui ne donne qu'un total.
         */
        breakdown: contextBreakdownSchema.nullish().default(null),
      })
      .nullable()
      .optional(),
    rateLimit: z
      .object({
        type: z.string(),
        status: z.enum(['allowed', 'allowed_warning', 'rejected']).default('allowed'),
        /** Part du quota consommée, de 0 à 1. Absente si le CLI ne la donne pas. */
        utilization: z.number().nullish().default(null),
        /**
         * Remise à zéro de la fenêtre, en millisecondes. Les événements anciens la
         * portent en secondes : tout horodatage sous 1e12 est antérieur à 2001, donc
         * nécessairement des secondes. La conversion est idempotente.
         */
        resetsAt: z
          .number()
          .nullish()
          .default(null)
          .transform((value) =>
            value === null || value === undefined ? null : value < 1e12 ? value * 1000 : value,
          ),
      })
      .nullable()
      .optional(),
  }),
  /**
   * Points de reprise d'un tour : l'état du workspace capturé avant et après.
   *
   * Deux événements et non un, parce que ce sont deux moments : `checkpoint.started`
   * précède le message de l'utilisateur, et `checkpoint.completed` arrive quand la
   * capture d'après est finie, c'est-à-dire après `turn.completed` et peut-être après
   * le message suivant. La clé les relie, et désigne les refs git de la capture.
   */
  z.object({
    type: z.literal('checkpoint.started'),
    key: z.string(),
  }),
  z.object({
    type: z.literal('checkpoint.completed'),
    key: z.string(),
    /** `failed` : la capture d'après n'a pas pu être faite, `reason` dit pourquoi. */
    status: z.enum(['ready', 'failed']),
    reason: z.string().nullable().default(null),
    files: z.array(checkpointFileSchema).default([]),
    /** Vrai quand la liste a été coupée : le diff complet reste lisible par l'API. */
    truncated: z.boolean().default(false),
    /** Fichiers apportés par un pull, une fusion ou un rebase pendant le tour, écartés. */
    excluded: z.number().default(0),
  }),
  /** Le workspace a été ramené à l'état d'avant ce tour, à la demande de l'utilisateur. */
  z.object({
    type: z.literal('checkpoint.restored'),
    key: z.string(),
    written: z.number(),
    deleted: z.number(),
  }),
  z.object({
    type: z.literal('diff.updated'),
    /** Diff unifié natif, lorsqu'il est fourni. */
    patch: z.string().optional(),
    patchRef: eventBodyRefSchema.optional(),
    files: z.array(
      z.object({ path: z.string(), added: z.number(), removed: z.number() }),
    ),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    recoverable: z.boolean(),
  }),
])

export type SoleraEvent = z.infer<typeof soleraEventSchema>
export type SoleraEventType = SoleraEvent['type']

/** Un événement tel qu'il sort du journal : le payload plus sa position et sa date. */
export interface JournalEntry {
  conversationId: string
  seq: number
  ts: number
  event: SoleraEvent
}
