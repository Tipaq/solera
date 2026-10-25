import type { AgentKind, CardColumn, CardRelationKind, InstructionsMode } from '@solera/protocol'
import { sql } from 'drizzle-orm'
import {
  blob,
  index,
  type AnySQLiteColumn,
  integer,
  primaryKey,
  sqliteTable,
  text,
  real,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

/**
 * Le schéma couvre l'ensemble de la spec, y compris les tables que les lots suivants
 * utiliseront, pour n'avoir qu'une migration initiale à appliquer. Les colonnes JSON
 * sont typées via `$type<>` et sérialisées par la couche d'accès.
 */

const timestamp = (name: string) => integer(name, { mode: 'number' })

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: timestamp('created_at').notNull(),
})

export const authSessions = sqliteTable(
  'auth_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('idx_auth_sessions_user').on(t.userId)],
)

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    workspacePath: text('workspace_path').notNull(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id),
    visibility: text('visibility').$type<'private' | 'shared'>().notNull(),
    color: text('color'),
    /**
     * JSON `ProjectAgentDefaults` : un préréglage de la barre de saisie par CLI, socle
     * des conversations du projet sous les défauts du compte. Le CLI lui-même n'est
     * pas une propriété du projet : il est choisi par conversation (colonne
     * `conversations.agent`), pour qu'un même projet porte du Claude et du Codex — d'où
     * un préréglage par CLI plutôt qu'un seul. La forme d'avant, une configuration
     * seule, se relit encore (`readProjectDefaults`).
     */
    defaultConfig: text('default_config'),
    /**
     * Ordre manuel dans la sidebar, réécrit en bloc par le glisser-déposer. Un
     * nouveau projet prend une position supérieure au maximum existant, pour se
     * ranger en fin de liste plutôt que de s'insérer au milieu.
     */
    position: integer('position').notNull().default(0),
    /**
     * Où vivent les consignes du projet : dans Solera (`solera`), injectées aux deux
     * CLI pendant que les `CLAUDE.md` et `AGENTS.md` du dépôt sont masqués, ou dans le
     * dépôt (`repo`), que les CLI lisent d'eux-mêmes. Fixé à la création ; null pour
     * les projets d'avant, résolu d'après le dossier (voir `instructions/store.ts`).
     */
    instructionsMode: text('instructions_mode').$type<InstructionsMode>(),
    /**
     * Le design system lié : un chemin absolu vers un dossier qui porte un
     * `.storybook/`. Un chemin et non un dépôt, parce qu'un DS peut être la racine d'un
     * dépôt dédié comme un sous-dossier d'un dépôt qui en porte plusieurs. Plusieurs
     * projets peuvent pointer sur le même. Null : pas de DS.
     */
    designSystemPath: text('design_system_path'),
    /**
     * Capturer l'état du workspace avant et après chaque tour (refs git cachées), pour
     * montrer ce qu'un tour a changé et pouvoir y revenir. Vrai par défaut ; à couper
     * sur un dépôt si lourd que la capture retarde visiblement l'envoi d'un message.
     */
    turnCheckpoints: integer('turn_checkpoints', { mode: 'boolean' }).notNull().default(true),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('idx_projects_owner').on(t.ownerId)],
)

/**
 * SOLERA.md : des consignes tenues par Solera, communes à Claude et à Codex, injectées
 * dans le prompt système de chaque session. Une ligne globale (`id` = `global`, sans
 * projet) et une par projet (`id` = l'identifiant du projet).
 *
 * En base et non en fichier pour la même raison que l'image : le serveur MCP, qui y
 * réécrit à la demande d'un agent, n'a que la base.
 */
export const instructions = sqliteTable('instructions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  /** Dernière main : une personne, ou la session d'un agent passé par les outils MCP. */
  updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedByConversationId: text('updated_by_conversation_id'),
})

/**
 * L'image d'un projet, ce qui le fait reconnaître d'un coup d'œil dans la navigation.
 *
 * Dans sa propre table et non en colonne de `projects` : chaque lecture d'un projet
 * ramènerait sinon le blob, alors qu'il ne sert qu'à la route qui le sert. En base
 * plutôt que sur disque parce que le serveur MCP, qui la pose au nom d'un agent, n'a
 * que la base ; et la cascade retire l'image avec le projet sans fichier à ramasser.
 */
export const projectImages = sqliteTable('project_images', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  mimeType: text('mime_type').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  /**
   * Posée par un agent faute de logo dans le projet. Tant que c'est vrai, les sessions
   * se voient rappeler de la remplacer dès qu'un vrai logo existe ; une image choisie
   * par une personne n'est jamais provisoire.
   */
  provisional: integer('provisional', { mode: 'boolean' }).notNull().default(false),
  /** Sert aussi de version dans l'URL, pour que le cache du navigateur suive. */
  updatedAt: timestamp('updated_at').notNull(),
})

export const worktrees = sqliteTable(
  'worktrees',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    path: text('path').notNull(),
    baseRef: text('base_ref').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
    removedAt: timestamp('removed_at'),
  },
  (t) => [uniqueIndex('idx_worktrees_project_name').on(t.projectId, t.name)],
)

/**
 * Chemins absolus qu'une conversation a touchés hors de son répertoire de travail.
 *
 * Une session notée à la racine du projet qui écrit dans `~/projects/x-feature` y
 * travaille en réalité : c'est ce rattachement « a écrit dans » que la vue des
 * chantiers croise avec les worktrees du dépôt. Tenu à jour à l'écriture du journal,
 * avec un rattrapage unique à la migration, pour ne pas rebalayer des millions
 * d'événements à chaque lecture. Distinct de `conversations.worktree_id`, qui décide du
 * cwd de la reprise et ne doit jamais être réécrit après coup.
 */
export const conversationPaths = sqliteTable(
  'conversation_paths',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** Chemin absolu d'un fichier édité, ou d'un dossier cité par une commande. */
    path: text('path').notNull(),
    lastTs: timestamp('last_ts').notNull(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.path] })],
)

/**
 * Cartes du board : le travail à faire, distinct de la conversation qui l'exécute.
 *
 * Une carte survit à ses sessions et en porte plusieurs ; c'est ce qui la sépare d'une
 * conversation, laquelle est une tentative d'exécution qui se termine et s'archive. Le
 * rattachement vit sur `conversations.card_id`, une conversation ne traitant qu'une
 * carte à la fois.
 */
export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * Numéro court affiché et cité (`#12`), attribué à la création et jamais réutilisé.
     *
     * Un UUID ne se tape pas dans un message et ne se lit pas dans un nom de branche.
     * La séquence est par projet, comme les issues d'une forge.
     */
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /**
     * Position choisie dans le workflow. Jamais nommée `status` : ce mot désigne l'état
     * d'exécution d'une conversation, et les deux ne doivent pas se confondre.
     * L'activité et l'état de merge sont dérivés et n'ont donc pas de colonne ici.
     */
    column: text('column').$type<CardColumn>().notNull(),
    /** Ordre manuel dans sa colonne, croissant. Réécrit en bloc par le glisser-déposer. */
    position: integer('position').notNull().default(0),
    /**
     * Échéance, nullable : une carte sans date est la norme, et une date posée sur
     * chaque carte d'un projet solo serait du théâtre.
     */
    dueAt: timestamp('due_at'),
    /**
     * La carte parente : les cartes forment un arbre, et c'est la seule hiérarchie du
     * board. Un jalon n'est pas un type, c'est une carte de haut niveau qui a une
     * échéance et des enfants ; découper une carte, c'est lui en ajouter, sans qu'elle
     * change de nature. Une table `milestones` aurait dupliqué ce qu'une carte porte
     * déjà : un nom, une date, un fil de notes, un état.
     *
     * Profondeur libre dans le modèle (l'interface en rend bien trois niveaux), sans
     * cycle : la route qui rattache refuse une descendante (`cards/tree.ts`).
     *
     * La colonne d'une carte qui a des enfants est déduite d'eux et réécrite quand l'un
     * bouge, sauf une fois fermée : c'est une personne qui la ferme.
     *
     * `set null` : supprimer une parente détache ses enfants au lieu de les emporter.
     * Anciennement `milestone_card_id` (migration 0054).
     */
    parentId: text('parent_id').references((): AnySQLiteColumn => cards.id, {
      onDelete: 'set null',
    }),
    /**
     * Date d'acceptation ; `null` pour une carte venue de l'extérieur (une issue
     * absorbée) que personne n'a encore acceptée. Elle attend en tête de « à faire »
     * avec la pastille « nouvelle », et ne lance pas de session. Une carte créée dans
     * Solera est acceptée à sa création.
     */
    acceptedAt: timestamp('accepted_at'),
    /**
     * « À préciser » depuis : un état de la carte dans « à faire », pas une colonne. La
     * session qui l'a lancée attend des réponses avant d'écrire du code. Effacé dès que
     * la carte quitte « à faire », par quelque chemin que ce soit (`cards/moves.ts`).
     */
    toClarifySince: timestamp('to_clarify_since'),
    /**
     * La branche d'une carte parente, où ses enfants se fusionnent (#68) : créée et
     * poussée au premier besoin, puis gardée pour qu'un titre renommé ne la déplace pas.
     * Null pour une carte sans enfant, ou dont aucune enfant n'a encore eu d'arbre.
     */
    branch: text('branch'),
    /**
     * La PR de cette branche vers la branche par défaut, ouverte par Solera quand toutes
     * les enfants sont closes (#68). C'est une personne qui la fusionne, jamais Solera.
     */
    branchPrNumber: integer('branch_pr_number'),
    branchPrUrl: text('branch_pr_url'),
    createdBy: text('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_cards_project_number').on(t.projectId, t.number),
    index('idx_cards_project_column').on(t.projectId, t.column, t.position),
    index('idx_cards_parent').on(t.parentId),
  ],
)

/**
 * Liens « bloque » posés à la main : `source` empêche `target` d'avancer.
 *
 * Seconde table de liens, à côté de `card_refs`, et surtout pas un `type` sur
 * celle-là : `card_refs` est dérivée du texte et réécrite à chaque enregistrement,
 * donc une correction de phrase y effacerait un blocage que quelqu'un a constaté. Un
 * seul type pour commencer — c'est le seul qui porte ce qu'aucun autre champ ne porte,
 * « n'ouvre pas #26 avant #25 ».
 */
export const cardBlocks = sqliteTable(
  'card_blocks',
  {
    /** La carte qui bloque. */
    sourceId: text('source_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /** La carte empêchée d'avancer. */
    targetId: text('target_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceId, t.targetId] }),
    index('idx_card_blocks_target').on(t.targetId),
  ],
)

/**
 * Liens informatifs posés à la main (#109) : « liée à », et « doublon de » d'une carte
 * vers son originale.
 *
 * Une troisième table plutôt qu'un `kind` sur `card_blocks` : ceux-ci ne changent ni
 * l'ordre du travail ni la colonne, et c'est pourquoi un agent les pose seul, sans clic,
 * quand un blocage passe par une demande. Les mêler obligerait chaque lecture d'un
 * blocage à filtrer ce qui n'en est pas un.
 *
 * « Liée à » est symétrique et s'écrit une seule fois, la plus petite des deux clés en
 * `source` : le lire des deux bouts ne demande qu'un `OR`, et le poser depuis l'autre
 * carte ne fait pas de doublon. « Doublon de » va de la copie vers l'originale, et une
 * copie n'a qu'une originale.
 */
export const cardRelations = sqliteTable(
  'card_relations',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['related', 'duplicate_of'] }).$type<CardRelationKind>().notNull(),
    /** La personne qui l'a posé, ou le compte de la session. */
    createdBy: text('created_by').references(() => users.id),
    /** La session qui l'a posé, s'il vient d'un agent. Sans clé étrangère, comme les notes. */
    conversationId: text('conversation_id'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceId, t.targetId, t.kind] }),
    index('idx_card_relations_target').on(t.targetId),
  ],
)

/**
 * Une ligne par changement de colonne : d'où, vers où, par qui, quand.
 *
 * Table étroite et en ajout seul, parce que `cards` ne porte que `column` et
 * `updated_at`, qu'une simple correction de titre réécrit : sans elle, on ne peut pas
 * dire **quand** une carte a été terminée, et c'est précisément ce que le Journal
 * raconte. Elle doit être écrite partout où une colonne change — le glisser-déposer,
 * le menu du panneau, et le passage automatique en « en cours » au lancement d'une
 * session. Un seul chemin oublié, et elle ment.
 */
export const cardMoves = sqliteTable(
  'card_moves',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    fromColumn: text('from_column').$type<CardColumn>().notNull(),
    toColumn: text('to_column').$type<CardColumn>().notNull(),
    /**
     * Null quand le compte a été supprimé : le mouvement reste daté et vrai. Null aussi
     * quand personne n'a fait le geste : le passage en « Terminé » à la fusion du worktree.
     */
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * La session qui a déplacé la carte d'elle-même, par `move_card`. Null pour un geste
     * de personne, y compris une demande `request_card_change` accordée d'un clic : le
     * mouvement est alors celui de qui a cliqué. `user_id` reste rempli pour un agent, au
     * nom du propriétaire de la conversation, pour que tout lecteur qui ne regarde que lui
     * continue de savoir pour qui le geste a été fait.
     *
     * Sans clé étrangère, comme `agent_requests.conversation_id` : un `ADD COLUMN` de
     * SQLite ne sait pas poser `ON DELETE SET NULL`, et une clé sans action bloquerait la
     * suppression de la conversation. Un mouvement survit à la session qui l'a fait.
     */
    conversationId: text('conversation_id'),
    movedAt: timestamp('moved_at').notNull(),
  },
  (t) => [index('idx_card_moves_card').on(t.cardId, t.movedAt)],
)

/**
 * Références `#12` trouvées dans la description d'une carte, réécrites à chaque
 * enregistrement.
 *
 * Table dérivée du texte, comme l'index de recherche l'est du journal : elle ne porte
 * rien que la description n'ait déjà, et sert à répondre « qui me référence » sans
 * balayer toutes les descriptions du projet.
 *
 * La cible cascade comme la source : une carte supprimée ne doit pas laisser de
 * backlink vers le vide. Le texte, lui, garde son `#12`, qui s'affichera comme une
 * référence morte plutôt que de disparaître de la prose.
 */
export const cardRefs = sqliteTable(
  'card_refs',
  {
    sourceId: text('source_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.targetId] }), index('idx_card_refs_target').on(t.targetId)],
)

/**
 * Ce qu'une session a appris ou fait sur une carte, et que la suivante doit savoir.
 *
 * Un flux ajouté, jamais réécrit, et c'est ce qui le distingue de la description : la
 * description est l'énoncé du travail, tenu par une personne ; les notes sont son
 * historique, écrit surtout par les agents. Les fondre ferait qu'un compte rendu de
 * session efface la consigne qu'il était censé suivre.
 *
 * Chaque note dit qui l'a écrite et quand. C'est ce qui répond à l'objection faite au
 * magasin de mémoire dans cette roadmap : une note anonyme et sans date vieillit en
 * silence et finit par tromper, une note signée d'une session datée se relativise seule.
 */
export const cardNotes = sqliteTable(
  'card_notes',
  {
    id: text('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /**
     * Session auteure, null quand la note est écrite à la main. Sans cascade : le compte
     * rendu d'un travail survit à la suppression de la conversation qui l'a produit,
     * c'est même à ce moment-là qu'il devient la seule trace.
     */
    conversationId: text('conversation_id'),
    userId: text('user_id').references(() => users.id),
    body: text('body').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('idx_card_notes_card').on(t.cardId, t.createdAt)],
)

/**
 * La revue d'une PR de carte (#68) : la session qui a écrit le code ouvre sa PR et la
 * signale (`request_review`), une session de revue lancée par le serveur la relit et
 * rend son verdict (`submit_review`), et les deux se renvoient la balle jusqu'au vert.
 *
 * Une ligne par PR, tenue à jour d'un tour à l'autre plutôt qu'une ligne par tour : ce
 * que la boucle a besoin de savoir, c'est où elle en est. L'historique des tours vit
 * dans les deux fils et dans les notes de la carte.
 *
 * Le webhook « PR ouverte » ne peut pas joindre Solera, et c'est pourquoi la PR est
 * signalée par la session plutôt qu'observée sur la forge.
 */
export const cardReviews = sqliteTable(
  'card_reviews',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    /** Sans clé étrangère, comme les messages entre sessions : la revue reste lisible. */
    authorConversationId: text('author_conversation_id').notNull(),
    /** Null le temps de lancer la session de revue, posé avant son premier message. */
    reviewerConversationId: text('reviewer_conversation_id'),
    prNumber: integer('pr_number').notNull(),
    prUrl: text('pr_url').notNull(),
    branch: text('branch').notNull(),
    base: text('base').notNull(),
    /** Le dernier commit signalé par l'auteur, celui que la revue en cours relit. */
    headSha: text('head_sha').notNull(),
    /** Le commit du dernier verdict : un `request_review` sur le même ne relance rien. */
    reviewedSha: text('reviewed_sha'),
    round: integer('round').notNull().default(1),
    /** Trois par défaut ; une personne qui accorde un tour de plus le relève d'un. */
    maxRounds: integer('max_rounds').notNull().default(3),
    /**
     * `reviewing` : la revue tourne ; `changes` : l'auteur corrige ; `approved` : au
     * vert ; `escalated` : le plafond est atteint et une personne tranche
     * (`decision_id`) ; `closed` : la PR ne se relit plus.
     *
     * Pour une carte enfant dont la PR vise la branche de sa parente, le vert devient
     * `to_merge` : le serveur fusionne dès que la session auteure est au repos
     * (`merging` le temps de l'appel), puis `merged`, ou `merge_failed` avec la raison
     * en note sur la carte.
     */
    state: text('state', {
      enum: ['reviewing', 'changes', 'approved', 'escalated', 'closed', 'to_merge', 'merging', 'merged', 'merge_failed'],
    })
      .notNull()
      .default('reviewing'),
    /** La décision déposée au plafond (`agent_requests.id`). */
    decisionId: text('decision_id'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    uniqueIndex('idx_card_reviews_pr').on(t.projectId, t.prNumber),
    index('idx_card_reviews_card').on(t.cardId),
    index('idx_card_reviews_reviewer').on(t.reviewerConversationId),
  ],
)

/**
 * Un message d'une session à une autre du même projet.
 *
 * Déposé par le serveur MCP, qui n'a qu'un accès à la base, et remis par le daemon, qui
 * seul tient les runners : la table est la boîte aux lettres entre les deux process.
 * `deliveredAt` nul veut dire « pas encore remis », et c'est ce que le relais balaie.
 *
 * Sans clé étrangère vers `conversations` : un échange reste lisible par celle qui
 * reste quand l'autre est supprimée, comme une note de carte survit à son auteure.
 */
export const sessionMessages = sqliteTable(
  'session_messages',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromConversationId: text('from_conversation_id').notNull(),
    toConversationId: text('to_conversation_id').notNull(),
    /**
     * `message` d'une session à une autre ; `broadcast` annoncé à toutes celles qui
     * travaillent ; `done`, écrit par le relais, prévient qu'une session surveillée a fini ;
     * `decision`, écrit par le daemon, rend à une session la réponse à sa demande de
     * décision (`agent_requests.kind = 'request_decision'`). Expéditrice et destinataire
     * y sont la même conversation : c'est Solera qui parle, au nom de qui a répondu.
     * `cards` de même, pour la validation d'un brouillon de cartes (#70).
     */
    kind: text('kind', { enum: ['message', 'broadcast', 'done', 'decision', 'cards'] }).notNull().default('message'),
    body: text('body').notNull(),
    /** Message auquel celui-ci répond, pour compter la profondeur d'un échange. */
    replyTo: text('reply_to'),
    createdAt: timestamp('created_at').notNull(),
    /**
     * Posé quand le relais retient le message au lieu de relancer le destinataire. Sert
     * à n'annoncer la retenue qu'une fois dans son fil, redémarrage du daemon compris.
     */
    heldAt: timestamp('held_at'),
    deliveredAt: timestamp('delivered_at'),
    /**
     * `steer` injecté dans un tour ouvert, `queue` mis en file derrière lui, `wake` en
     * ouvrant un tour, `read` lu par l'outil avant d'avoir été remis, `failed` quand la
     * remise a échoué : il n'est pas retenté, pour ne pas relancer en boucle un CLI qui
     * refuse de démarrer, mais reste lisible par l'outil. Les trois derniers ne sont pas
     * des remises : `discarded` écarté par une personne, `expired` retenu trop
     * longtemps, `skipped` une annonce arrivée quand le destinataire ne travaillait plus.
     */
    deliveredVia: text('delivered_via', {
      enum: ['steer', 'queue', 'wake', 'read', 'failed', 'discarded', 'expired', 'skipped'],
    }),
  },
  (t) => [
    index('idx_session_messages_to').on(t.toConversationId, t.createdAt),
    index('idx_session_messages_pending').on(t.deliveredAt),
  ],
)

/**
 * Une session qui a demandé à être prévenue de la fin du travail d'une autre.
 *
 * Plutôt que de relancer `list_sessions` en boucle, ce qui coûte un tour à chaque
 * coup d'œil : le relais surveille, et dépose un message `done` au moment voulu.
 */
export const sessionWatches = sqliteTable(
  'session_watches',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    watcherConversationId: text('watcher_conversation_id').notNull(),
    targetConversationId: text('target_conversation_id').notNull(),
    createdAt: timestamp('created_at').notNull(),
    /** Posé quand le message `done` est déposé, ou quand la surveillance expire. */
    firedAt: timestamp('fired_at'),
  },
  (t) => [index('idx_session_watches_open').on(t.firedAt)],
)

/**
 * Une demande qu'une session adresse au daemon : lancer une autre session, créer une
 * carte, lire le catalogue des modèles, proposer un rangement.
 *
 * Même boîte aux lettres que `session_messages`, mais avec retour : le serveur MCP
 * dépose la demande puis attend que le daemon y écrive son résultat, parce que
 * l'agent a besoin de la réponse pour continuer (l'identifiant de la session lancée,
 * ou la liste des modèles qui existent quand il en a nommé un faux). Seul le daemon
 * tient le catalogue des CLI, les runners et la création de worktrees.
 *
 * Gardée après traitement : c'est elle qui dit qui a lancé quoi, et donc la profondeur
 * d'une chaîne de lancements et leur nombre dans l'heure.
 */
export const agentRequests = sqliteTable(
  'agent_requests',
  {
    id: text('id').primaryKey(),
    /**
     * Projet de la session qui demande, ou NULL quand c'est un fil libre.
     *
     * Nullable depuis que le serveur MCP démarre sans projet : un fil libre a lui aussi
     * des demandes à déposer, et elles ne parlent d'aucun projet. Les genres qui, eux,
     * en exigent un le réclament à leur tour dans `handle()`, plutôt que la colonne pour
     * tout le monde.
     */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * Conversation qui demande. Sans clé étrangère, comme les messages entre sessions.
     *
     * Vide quand la demande vient du serveur MCP en mode global, branché de l'extérieur
     * sur toute l'instance (`docs/mcp.md`) : il n'y a alors pas de session, et c'est
     * `user_id` qui dit pour qui agir.
     */
    conversationId: text('conversation_id').notNull(),
    /** Compte au nom duquel agir quand aucune conversation ne demande. */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', {
      enum: [
        'start_session',
        'create_card',
        'list_models',
        'schedule_task',
        'create_project',
        'move_conversation',
        // Proposer un changement de carte que seul un clic applique : colonne, parente,
        // échéance, liens « bloque ». Appelé `request_card_move` avant #66, qui l'a
        // élargi au-delà de la colonne (migration 0055).
        'request_card_change',
        // Le déplacement direct de sa propre carte, que l'agent fait seul.
        'move_card',
        // Les autres gestes qu'un agent fait seul sur sa carte (#66) : ils s'ajoutent ou
        // se reprennent, et ne défont le choix de personne.
        'append_card_description',
        'edit_subtasks',
        'link_card',
        // Promouvoir une sous-tâche de sa carte en carte sœur (#71).
        'promote_subtask',
        // Les liens informatifs entre cartes (#109) : ils ne défont rien.
        'relate_cards',
        // Un brouillon de découpage en cartes (#70) : rien n'est créé avant le clic.
        'propose_cards',
        // Le titre de sa propre session, qui doit être annoncé aux clients.
        'rename_session',
        'request_decision',
        // La revue d'une PR de carte (#68) : l'auteur la signale, la revue rend son verdict.
        'request_review',
        'submit_review',
        // Worktrees : git et l'avancement des arbres ne vivent que dans le daemon.
        'create_worktree',
        'list_worktrees',
        // Gestes sur une session existante, au nom d'un compte : ceux d'un client MCP
        // hors session, qui n'a pas de runner pour les faire lui-même.
        'message_session',
        'interrupt_session',
        'reply_session',
        // Actions de projet : le daemon seul lance les unités et les terminaux.
        'register_action',
        'remove_action',
        'run_action',
      ],
    }).notNull(),
    /**
     * Arguments de l'outil, en JSON, tels que l'agent les a donnés.
     *
     * Sauf pour `request_decision`, que le daemon réécrit une fois validée sous la forme
     * `{question, context, options, defaultOption}` : la demande se relit pendant des
     * heures, par l'interface et par le balayage des échéances, et une forme normalisée
     * évite que chacun refasse les mêmes nettoyages.
     */
    payload: text('payload').notNull(),
    createdAt: timestamp('created_at').notNull(),
    /** Posé par le daemon quand la demande est traitée, réussie ou non. */
    settledAt: timestamp('settled_at'),
    /** Texte rendu à l'agent : le compte rendu, ou ce qui l'a empêché. */
    result: text('result'),
    isError: integer('is_error', { mode: 'boolean' }).notNull().default(false),
    /** Session née de la demande, pour remonter une chaîne de lancements. */
    launchedConversationId: text('launched_conversation_id'),
    /**
     * Quand l'utilisateur a accordé un rangement — celui d'une conversation
     * (`move_conversation`) ou celui d'une ou plusieurs cartes (`request_card_change`).
     *
     * Pour une conversation, la promesse vit dans la ligne et non en mémoire : un
     * déplacement accepté doit survivre au redémarrage du serveur, là où un runner, lui,
     * ne survit pas. C'est le balayage du daemon qui l'applique, dès que la conversation
     * se tait.
     *
     * Un rangement de cartes, lui, est appliqué par le clic même : il n'a pas de runner
     * à relâcher ni de tour à attendre, et les lignes `card_moves` s'écrivent dans la
     * transaction de la route. La date reste posée, pour dire **quand** la personne a
     * accordé, mais `resolved_at` la suit du même instant.
     */
    acceptedAt: timestamp('accepted_at'),
    /**
     * Quand la demande a cessé d'attendre quoi que ce soit : refusée, appliquée, ou
     * devenue impossible. Distincte de `settled_at`, qui dit seulement que l'agent a eu
     * sa réponse — et il l'a dès le dépôt, l'accord venant bien plus tard.
     *
     * C'est elle qui porte l'invariant « une demande de rangement en attente à la fois »
     * et qui met la ligne hors de portée de `STALE_MS`, taillé pour un daemon et non
     * pour un humain.
     *
     * Pour une décision (`request_decision`), posée quelle que soit l'issue : réponse,
     * choix par défaut appliqué, échéance sans réponse ou retrait à l'archivage. C'est
     * `answer` qui dit laquelle, et `accepted_at` qui date la réponse quand il y en a eu
     * une.
     */
    resolvedAt: timestamp('resolved_at'),
    /**
     * L'échéance d'une décision : passé ce moment, le balayage applique le choix par
     * défaut s'il y en a un, ou dit à l'agent que personne n'a répondu. Bornée au dépôt
     * par `decisionMaxHours` de la configuration de la session.
     *
     * Nulle pour tous les autres genres : un rangement n'expire pas, il attend un clic.
     */
    expiresAt: timestamp('expires_at'),
    /**
     * Ce qu'il est advenu d'une décision, en JSON :
     * `{option?, text?, by: 'user' | 'default' | 'expired' | 'withdrawn', userId?}`.
     *
     * `user` quand une personne a tranché (`userId` dit qui, `option` et `text` ce
     * qu'elle a répondu), `default` quand l'échéance a appliqué le choix prévu par
     * l'agent, `expired` quand elle est passée sans réponse ni défaut, `withdrawn` quand
     * la conversation a été archivée avant. Nulle tant que la décision attend, et pour
     * tous les autres genres. Du JSON plutôt que quatre colonnes : seul ce genre-là s'en
     * sert, et la ligne est relue entière à chaque fois.
     */
    answer: text('answer'),
    /**
     * Pour une ancienne proposition « nettoyer ? » que Solera posait lui-même dès qu'un
     * arbre était fusionné : l'arbre visé. Il n'en pose plus ; celles qui attendaient sont
     * retirées au démarrage (`Decisions.retireWorktreeProposals`), et les closes restent
     * lisibles dans l'historique. Une telle ligne appartient au propriétaire du projet et
     * ne part à aucune session.
     */
    worktreePath: text('worktree_path'),
  },
  (t) => [
    index('idx_agent_requests_pending').on(t.settledAt),
    index('idx_agent_requests_from').on(t.conversationId, t.kind, t.createdAt),
    index('idx_agent_requests_launched').on(t.launchedConversationId),
    // Les rangements de conversation accordés, que le balayage cherche toutes les
    // demi-secondes. Seules les demandes de rangement posent cette date : l'index ne
    // porte donc qu'elles, et le balayage filtre encore sur le genre — un rangement de
    // carte est déjà appliqué quand sa date arrive.
    index('idx_agent_requests_accepted').on(t.acceptedAt),
    // Ce qui attend encore une personne : les décisions dont le balayage surveille
    // l'échéance, et la section « À décider » de la colonne, qui y ajoute les deux
    // rangements. Toutes deux filtrent sur le genre et sur une clôture absente.
    index('idx_agent_requests_open').on(t.kind, t.resolvedAt),
  ],
)

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').primaryKey(),
    /**
     * Projet auquel ce fil appartient, ou NULL : un fil libre n'appartient à rien.
     *
     * On ouvre une conversation parce qu'on a une question ; savoir qu'elle relève d'un
     * projet vient après, parfois jamais. Le rangement est un geste séparé et tardif
     * (`Ranger…`), et ne rien ranger reste une réponse valable.
     *
     * Nullable plutôt qu'un projet « personnel » caché, et c'est le point : un projet,
     * c'est un répertoire de travail, et un fil libre n'en a pas. Un faux projet aurait
     * donné un vrai dossier à l'insu de tout le monde — fichiers, git, terminaux —
     * alors qu'ici le type dit l'absence, et chaque chemin qui supposait un dossier
     * cesse de compiler au lieu de marcher en silence.
     */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** NULL signifie que l'agent travaille à la racine du projet. */
    worktreeId: text('worktree_id').references(() => worktrees.id),
    /**
     * Carte que cette conversation traite, si elle en traite une.
     *
     * Rattachement, et non simple mention : citer `#12` dans un message donne du
     * contexte au modèle sans engager la conversation, alors que cette colonne est ce
     * dont l'activité d'une carte se déduit. Poser l'un pour l'autre ferait compter une
     * session au chantier voisin dont elle a seulement parlé.
     *
     * Sans cascade : supprimer une carte n'efface pas les conversations qui l'ont
     * traitée, elles redeviennent des conversations ordinaires.
     */
    cardId: text('card_id'),
    /**
     * Ce que la conversation est venue faire, quand ce n'est pas le travail ordinaire :
     * `split`, découper un chantier en cartes depuis une dictée (#70). Son briefing le dit
     * à l'agent à chaque démarrage, et c'est pour ça que l'état vit ici et non dans le
     * premier message, qu'une reprise ne relit pas.
     */
    purpose: text('purpose', { enum: ['split'] }),
    /**
     * La carte d'où le découpage est parti, proposée comme parente des cartes du
     * brouillon. Pas `cardId` : la conversation ne *traite* pas cette carte, elle n'en
     * fait pas avancer la colonne et ne livre pas de PR pour elle. Sans cascade, comme
     * `cardId`.
     */
    splitCardId: text('split_card_id'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    /**
     * Vrai dès que l'utilisateur renomme : le titre proposé par le CLI ne doit plus
     * jamais l'écraser derrière son dos.
     */
    titleSetByUser: integer('title_set_by_user', { mode: 'boolean' }).notNull().default(false),
    /**
     * Vrai quand l'agent a nommé sa session par `rename_session` : le résumé que le CLI
     * propose plus tard ne l'écrase plus. Un titre de l'utilisateur, lui, l'emporte
     * toujours, et le renommer remet ce drapeau à faux.
     */
    titleSetByAgent: integer('title_set_by_agent', { mode: 'boolean' }).notNull().default(false),
    // Dérivé de l'enum du protocole : ajouter un CLI ne demande pas de retoucher
    // la colonne, et une divergence entre les deux listes ne peut plus s'installer.
    agent: text('agent').$type<AgentKind>().notNull(),
    /** Identifiant natif du CLI, pour `--resume` ou `thread/resume`. */
    agentSessionId: text('agent_session_id'),
    /**
     * Conversation dont celle-ci est issue par fork, si elle l'est.
     *
     * Sans cascade : supprimer l'originale ne doit pas emporter ses branches, qui
     * sont des conversations à part entière. La référence devient alors orpheline et
     * l'UI cesse simplement d'afficher la provenance.
     */
    forkedFromId: text('forked_from_id'),
    /**
     * Conversation que celle-ci continue dans un autre CLI, si c'est une suite.
     *
     * Distinct du fork : l'agent ne reprend pas l'historique natif, il reçoit une
     * sélection du fil, tenue dans `conversation_handoffs`. Sans cascade, comme
     * `forkedFromId` : la suite survit à l'originale.
     */
    handoffFromId: text('handoff_from_id'),
    /**
     * Jeton d'API qui a créé la conversation, pour l'audit et pour que `GET /api/v1/tasks`
     * puisse rendre à un appelant ce qu'il a lui-même lancé. Sans cascade : supprimer un
     * jeton n'efface pas les conversations qu'il a ouvertes.
     */
    createdByTokenId: text('created_by_token_id'),
    /**
     * Libellé du jeton d'origine, figé à la création. NULL vaut « créée dans l'interface ».
     *
     * Dupliqué du jeton à dessein : c'est ce qui permet à la sidebar de garder son
     * marqueur quand le jeton a été supprimé.
     */
    originLabel: text('origin_label'),
    /**
     * Tâche planifiée dont un tir a ouvert cette conversation, si c'en est un.
     *
     * C'est ce qui la sort de la liste principale : une tâche horaire y poserait
     * vingt-quatre lignes par jour, que la sidebar range à la place sous leur tâche.
     * Le tir précis se retrouve par `scheduled_runs.conversation_id`.
     *
     * Sans cascade, comme `cardId` : supprimer une tâche n'efface pas ce que ses tirs
     * ont produit. La route de suppression vide la colonne et range les fils, qui
     * redeviennent des conversations ordinaires.
     */
    scheduleId: text('schedule_id'),
    /** JSON AgentConfig. */
    config: text('config').notNull(),
    status: text('status')
      .$type<'idle' | 'running' | 'awaiting_input' | 'interrupted' | 'error'>()
      .notNull(),
    /**
     * Travaux de fond et boucles vivants, tels que le dernier `background.updated` et
     * le dernier `loops.updated` les décrivent.
     *
     * Persistés alors qu'ils appartiennent au process CLI et meurent avec lui, parce
     * qu'ils sont le seul signe qu'une conversation `idle` travaille encore : le statut
     * retombe à la fin du tour, pas à la fin du travail. Sans eux, répondre « cette
     * session travaille-t-elle » demande de replier le journal de chaque conversation,
     * ce qui est ruineux dès qu'on en énumère plus d'une.
     *
     * Remis à zéro au démarrage par `recoverInterrupted` : les process sont morts avec
     * le daemon, donc toute valeur non nulle relue au boot est un reste.
     */
    backgroundCount: integer('background_count').notNull().default(0),
    loopCount: integer('loop_count').notNull().default(0),
    lastSeq: integer('last_seq').notNull().default(0),
    /**
     * Dernier `seq` qui valait qu'on prévienne le lecteur, d'où se déduit le non-lu.
     *
     * Distinct de `lastSeq` parce que le journal avance aussi tout seul : une session
     * qui se refroidit ou un relevé d'usage sont écrits après le départ de tout le
     * monde, et les compter allumait 57 conversations sur 80 sans que personne n'ait
     * rien à y lire. Voir `NOTABLE` dans l'`EventLog` pour la liste retenue.
     */
    lastNotableSeq: integer('last_notable_seq').notNull().default(0),
    /**
     * Métriques de volume, tenues à jour à l'écriture du journal.
     *
     * Persistées pour la même raison que `backgroundCount` : la sidebar en affiche pour
     * des conversations qu'elle n'a pas ouvertes, et les recalculer demanderait de
     * replier le journal de chacune, ce qui est ruineux dès qu'on en énumère plus d'une.
     *
     * `turnCount` compte les tours, un par message de l'utilisateur : les traits de la
     * réglette de repères. Compter les messages de l'agent reviendrait à compter ses
     * étapes, chaque appel d'outil en produisant un.
     *
     * Le découpage du fil, pas le cycle de vie du runner : le compte s'écarte des
     * `turn.started` dans les deux sens, un tour pouvant s'ouvrir sans message et un
     * steer ajoutant un message sans ouvrir de tour.
     */
    turnCount: integer('turn_count').notNull().default(0),
    /** Poids du journal sur disque, payloads et `raw` compris. */
    journalBytes: integer('journal_bytes').notNull().default(0),
    /**
     * Dernière occupation de la fenêtre de contexte annoncée par le CLI, et modèle de la
     * dernière session ouverte. NULL tant que le CLI n'en a rien dit.
     *
     * Distincts de `inputTokens`/`outputTokens`, qui cumulent la facturation depuis le
     * début : le contexte se vide à chaque compaction, et c'est lui qui dit quand la
     * prochaine arrivera.
     */
    contextUsedTokens: integer('context_used_tokens'),
    contextMaxTokens: integer('context_max_tokens'),
    model: text('model'),
    costUsd: real('cost_usd').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
    /**
     * Ordre manuel dans le projet, réécrit par le glisser-déposer. Croissant : une
     * nouvelle conversation reçoit une position inférieure au minimum existant, pour
     * apparaître en tête comme le faisait le tri par date.
     */
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('idx_conversations_project').on(t.projectId, t.position),
    index('idx_conversations_user').on(t.userId),
    index('idx_conversations_schedule').on(t.scheduleId),
  ],
)

/**
 * Le contexte transmis à une conversation qui en continue une autre dans un autre CLI.
 *
 * Le texte est figé à la création, comme un fork fige le journal : la source peut
 * continuer après, la suite est partie de ce qu'elle était à ce moment-là. Dans sa
 * propre table parce qu'il pèse jusqu'à 64 ko et ne sert qu'au démarrage du CLI, là
 * où la ligne de conversation est relue à chaque liste.
 */
export const conversationHandoffs = sqliteTable('conversation_handoffs', {
  conversationId: text('conversation_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  fromConversationId: text('from_conversation_id').notNull(),
  /** Dernier `seq` de la source pris en compte, pour dire jusqu'où la suite a vu. */
  throughSeq: integer('through_seq').notNull(),
  budgetTokens: integer('budget_tokens').notNull(),
  /** Le bloc injecté au CLI, tel quel. */
  text: text('text').notNull(),
  createdAt: timestamp('created_at').notNull(),
})

/**
 * Tâches planifiées : un prompt que le daemon rejoue à cadence fixe, chaque tir dans une
 * session neuve.
 *
 * Portées par Solera parce qu'aucun CLI n'a de planificateur local durable : le
 * `CronCreate` de Claude meurt avec sa session, Codex n'en a pas. Le daemon, lui,
 * tourne en permanence.
 */
export const scheduledTasks = sqliteTable(
  'scheduled_tasks',
  {
    id: text('id').primaryKey(),
    /** Projet visé, ou NULL : une tâche planifiée n'a pas besoin de projet non plus. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /** Compte au nom duquel les tirs s'ouvrent : celui qui a créé la tâche. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    agent: text('agent').$type<AgentKind>().notNull(),
    /**
     * JSON AgentConfig : modèle, effort et permissions, figés par tâche.
     *
     * Une copie et non les défauts du projet relus à chaque tir : personne n'est au
     * clavier pour répondre à une demande de permission, donc le garde-fou d'un tir
     * doit être celui qu'on a choisi en créant la tâche, pas celui du jour.
     */
    config: text('config').notNull(),
    prompt: text('prompt').notNull(),
    /** JSON `ScheduleCadence` : intervalle, motif cron ou date unique. */
    cadence: text('cadence').notNull(),
    /** `fresh` : une session neuve par tir. Seul mode pour l'instant. */
    executionMode: text('execution_mode').$type<'fresh'>().notNull().default('fresh'),
    /** Que faire d'un tir qui arrive pendant que le précédent tourne encore. */
    overlapPolicy: text('overlap_policy').$type<'skip' | 'wait'>().notNull().default('skip'),
    /** Au-delà, le tir est interrompu : rien d'autre n'arrêterait un agent qui s'égare. */
    maxDurationMinutes: integer('max_duration_minutes').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    /** Conversation qui a créé la tâche par `schedule_task` ; NULL depuis l'interface. */
    createdByConversationId: text('created_by_conversation_id'),
    /**
     * Script de vérification joué avant le tour LLM, NULL sans vérification. Son code de
     * sortie décide du lancement et sa sortie rejoint le prompt (voir `scheduler/check.ts`).
     *
     * Le contenu et non un chemin : le daemon l'exécute hors de toute session, et c'est ce
     * texte précis qu'on valide. Un fichier pourrait changer après coup, y compris sous la
     * main d'un tir qui tourne sans demander de permission.
     */
    checkScript: text('check_script'),
    checkTimeoutSeconds: integer('check_timeout_seconds').notNull().default(120),
    /**
     * Validation du script par une personne. NULL tant qu'un agent l'a écrit ou modifié
     * sans qu'on l'ait relu : le tir est alors écarté, ni script ni LLM.
     */
    checkApprovedAt: timestamp('check_approved_at'),
    /** Conversation qui a proposé le script actuel ; NULL quand il vient de l'interface. */
    checkProposedBy: text('check_proposed_by'),
    lastRunAt: timestamp('last_run_at'),
    /** NULL quand plus rien n'est prévu : tâche ponctuelle déjà tirée. */
    nextRunAt: timestamp('next_run_at'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [
    index('idx_scheduled_tasks_project').on(t.projectId),
    index('idx_scheduled_tasks_due').on(t.enabled, t.nextRunAt),
  ],
)

/**
 * Un tir d'une tâche planifiée, y compris ceux qui n'ont rien lancé.
 *
 * Un tir sauté ou raté au lancement y laisse une ligne sans conversation : sans elle,
 * une tâche qui ne part jamais ressemblerait à une tâche qui n'a rien trouvé.
 */
export const scheduledRuns = sqliteTable(
  'scheduled_runs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => scheduledTasks.id, { onDelete: 'cascade' }),
    /** Sans clé étrangère : le fil peut être supprimé, le tir reste dans l'historique. */
    conversationId: text('conversation_id'),
    trigger: text('trigger').$type<'schedule' | 'manual'>().notNull(),
    /** `checking` : la vérification tourne, ou la session démarre derrière elle. */
    status: text('status')
      .$type<'checking' | 'running' | 'succeeded' | 'failed' | 'timed_out' | 'skipped'>()
      .notNull(),
    /** L'heure prévue, que `startedAt` dépasse quand le daemon était arrêté ou occupé. */
    scheduledFor: timestamp('scheduled_for').notNull(),
    startedAt: timestamp('started_at').notNull(),
    finishedAt: timestamp('finished_at'),
    /** Ce qui a empêché ou coupé le tir, rédigé pour être lu tel quel. */
    error: text('error'),
    /**
     * Dernière réponse de l'agent, tronquée, recopiée à la fin du tir.
     *
     * Dupliquée du journal à dessein : c'est ce que le tir suivant reçoit dans son
     * prompt, et il doit le recevoir même si le fil a été supprimé entre-temps.
     */
    summary: text('summary'),
    /**
     * Ce qu'a donné la vérification, NULL quand le tir n'en a pas joué. La sortie standard
     * est celle que le prompt a reçue ; l'erreur standard sert au débogage.
     */
    checkExitCode: integer('check_exit_code'),
    checkOutput: text('check_output'),
    checkStderr: text('check_stderr'),
    checkDurationMs: integer('check_duration_ms'),
  },
  (t) => [
    index('idx_scheduled_runs_task').on(t.taskId, t.startedAt),
    index('idx_scheduled_runs_open').on(t.status),
  ],
)

/**
 * Jusqu'où chaque lecteur est allé dans chaque conversation.
 *
 * Le journal avance tout seul : un agent qui travaille pendant qu'on regarde ailleurs
 * produit des événements que personne ne voit passer, et la ligne de sidebar reste
 * identique à celle d'un fil mort depuis trois semaines. Comparer ce curseur à
 * `conversations.lastSeq` est ce qui distingue les deux.
 *
 * Par lecteur et non par conversation : dans un projet partagé, deux comptes n'ont pas
 * lu la même chose. Le propriétaire du fil n'a aucun statut particulier ici.
 *
 * Ligne absente = jamais ouvert, donc tout est non lu. La migration qui crée la table
 * pose une ligne à jour pour chaque couple existant, faute de quoi la fonctionnalité
 * s'allumerait partout à la première mise à jour.
 */
export const conversationReads = sqliteTable(
  'conversation_reads',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Ne recule jamais : l'écriture prend le maximum avec la valeur déjà en base. */
    lastReadSeq: integer('last_read_seq').notNull().default(0),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
)

/**
 * Actions de projet : des boutons qui lancent une commande, créés depuis l'interface ou
 * proposés par un agent avec `register_action`.
 *
 * En base et non dans un fichier du dépôt : Solera n'impose pas son outillage aux
 * projets qu'il pilote.
 */
export const projectActions = sqliteTable(
  'project_actions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    description: text('description'),
    kind: text('kind').$type<'task' | 'service'>().notNull(),
    command: text('command').notNull(),
    /** Relatif au worktree où l'action est lancée ; NULL pour sa racine. */
    subdir: text('subdir'),
    /** Gabarit d'URL où ouvrir un service, `{port}` compris. */
    url: text('url'),
    /**
     * NULL tant qu'une personne n'a pas relu la commande : posée à la création depuis
     * l'interface, effacée quand un agent change ce qui s'exécute.
     */
    approvedAt: timestamp('approved_at'),
    /** Dernière conversation à l'avoir créée ou modifiée par MCP ; NULL depuis l'interface. */
    agentConversationId: text('agent_conversation_id'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [index('idx_project_actions_project').on(t.projectId, t.createdAt)],
)

/**
 * Le journal (invariant I2). `seq` est strictement croissant et sans trou par
 * conversation. WITHOUT ROWID parce que la clé primaire composite est déjà l'ordre
 * de lecture naturel.
 */
export const events = sqliteTable(
  'events',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    ts: timestamp('ts').notNull(),
    type: text('type').notNull(),
    /** JSON SoleraEvent. */
    payload: text('payload').notNull(),
    /** JSON natif du CLI, conservé pour les renderers d'outils spécialisés. */
    raw: text('raw'),
    /**
     * Provenance du `raw` (« claude-agent-sdk@0.3 », « codex-app-server@v2 »...).
     *
     * Sans elle, la forme du payload natif se devine par `conversations.agent`, ce
     * qui ne survit pas à un changement de protocole du CLI : deux générations de
     * `raw` se mélangent alors dans un même fil sans que rien ne les distingue.
     * Nullable : les événements d'avant l'estampille restent de la génération
     * courante de leur agent, jusqu'au premier bump.
     */
    rawFormat: text('raw_format'),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.seq] }),
    // Retrouver le natif d'un appel d'outil (pour un diff) sans décoder les sorties,
    // parfois énormes, de tous les autres.
    index('idx_events_native_tool')
      .on(t.conversationId, t.type, sql`(${t.payload} ->> '$.toolCallId')`, t.seq)
      .where(sql`${t.type} = 'tool.started' or ${t.type} = 'tool.completed'`),
  ],
)

/**
 * Où en est l'import d'un transcript Claude Code : un curseur par fichier, écrit dans
 * la même transaction que les événements qu'il couvre. Reconstructible : sans lui, la
 * synchronisation suivante repart du point commun avec le journal.
 */
export const claudeTranscriptCursors = sqliteTable('claude_transcript_cursors', {
  conversationId: text('conversation_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  /** Le `lastSeq` du journal à l'écriture : s'il a bougé depuis, le curseur ne vaut plus. */
  journalSeq: integer('journal_seq').notNull(),
  state: text('state').notNull(),
})

export const permissionRequests = sqliteTable(
  'permission_requests',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    /** Position de l'événement `permission.requested` associé dans le journal. */
    seq: integer('seq').notNull(),
    toolName: text('tool_name').notNull(),
    input: text('input').notNull(),
    status: text('status')
      .$type<'pending' | 'allowed' | 'denied' | 'expired'>()
      .notNull(),
    decisionScope: text('decision_scope').$type<'once' | 'session'>(),
    decidedBy: text('decided_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull(),
    decidedAt: timestamp('decided_at'),
  },
  (t) => [index('idx_permission_requests_pending').on(t.conversationId, t.status)],
)

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    /**
     * Null tant que la pièce jointe n'a pas été envoyée : elle est téléversée avant
     * que la conversation existe, puisqu'une conversation naît de son premier message.
     */
    conversationId: text('conversation_id').references(() => conversations.id, {
      onDelete: 'cascade',
    }),
    /** Une pièce appartient soit à une conversation, soit à un ticket. */
    cardId: text('card_id').references(() => cards.id, { onDelete: 'set null' }),
    /** Auteur du téléversement ; les fichiers de ticket se partagent avec le projet. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    /** Déterminé par le contenu, jamais par l'extension fournie par le client. */
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storagePath: text('storage_path').notNull(),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('idx_attachments_conversation').on(t.conversationId), index('idx_attachments_card').on(t.cardId)],
)

/**
 * Abonnements Web Push, un par appareil et par compte.
 *
 * L'`endpoint` fourni par le navigateur identifie l'abonnement de façon unique : c'est
 * la clé primaire naturelle, et deux abonnements au même endpoint désigneraient le même
 * appareil.
 */
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    endpoint: text('endpoint').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Clés de chiffrement du navigateur, requises pour lui adresser un message. */
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').notNull(),
    /**
     * Sujet VAPID de cet abonnement : l'origine https par laquelle l'appareil a joint
     * l'instance au moment de s'abonner. Apple refuse un sujet en `localhost`, et une
     * instance auto-hébergée n'a souvent pas d'autre adresse publique que celle-là.
     * `null` pour une origine locale ou en http, et pour les abonnements d'avant : on
     * retombe alors sur `server.publicUrl`, puis sur un `mailto:` de repli.
     */
    subject: text('subject'),
  },
  (t) => [index('idx_push_user').on(t.userId)],
)

/**
 * Réglages d'instance : ce qui vaut pour tout le monde et que l'administrateur doit
 * pouvoir changer sans éditer `config.toml` ni redémarrer le service, un redémarrage
 * tuant les process CLI enfants.
 *
 * Clé-valeur plutôt que colonnes typées, sinon chaque réglage suivant traînerait sa
 * migration. La valeur est du JSON, et seule la couche d'accès a besoin de le savoir.
 * Une clé absente vaut « pas encore réglé » et laisse le défaut du `config.toml`
 * s'appliquer, qui reste le point d'entrée d'une instance qu'on provisionne.
 */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

export const userSettings = sqliteTable('user_settings', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** JSON : thème, densité, préférences d'affichage. */
  data: text('data').notNull().default(sql`'{}'`),
})

/**
 * Registre des serveurs MCP, partagé par tous les CLI et tous les projets.
 *
 * Déclarés une fois ici, activés conversation par conversation via `mcpServers` de
 * l'`AgentConfig`. Rien n'est écrit dans `~/.claude.json` ni dans le `config.toml` de
 * Codex : Solera transmet ces serveurs en mémoire à chaque lancement de session, et
 * ne devient donc pas copropriétaire de fichiers qu'il n'a pas écrits. Conséquence
 * assumée : une conversation reprise dans un CLI natif n'a pas ces serveurs.
 */
export const mcpServers = sqliteTable('mcp_servers', {
  id: text('id').primaryKey(),
  /**
   * Unique : le nom sert de clé côté CLI, deux serveurs homonymes s'écraseraient
   * l'un l'autre dans la table qu'on lui transmet, en silence.
   */
  name: text('name').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** JSON McpTransport : la forme dépend du transport, la colonne n'a pas à le savoir. */
  transport: text('transport').notNull(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

/**
 * Dépôts git d'où la bibliothèque de skills s'installe.
 *
 * Une installation copie le skill et retient le commit : rien de ce qui arrive ensuite
 * dans le dépôt n'entre dans le contexte des agents sans qu'un admin l'ait relu. Les
 * sources préconfigurées sont insérées par la migration qui crée la table, et non au
 * démarrage, pour qu'une source supprimée ne revienne pas.
 */
export const skillSources = sqliteTable('skill_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Tout ce que `git clone` accepte, dépôts privés compris. */
  url: text('url').notNull(),
  /** Branche ou tag. Null : la branche par défaut du dépôt. */
  ref: text('ref'),
  /** Dossier du dépôt où chercher les skills. Null : tout le dépôt. */
  subpath: text('subpath'),
  builtin: integer('builtin', { mode: 'boolean' }).notNull().default(false),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastCommit: text('last_commit'),
  lastFetchedAt: timestamp('last_fetched_at'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

/**
 * Bibliothèque de skills : ce que Solera livre aux CLI comme des skills natifs.
 *
 * Le contenu vit sur le disque, sous `<data>/skill-library`, et c'est lui qui fait foi :
 * description et corps se relisent dans le `SKILL.md`. Cette table porte ce que le disque
 * ne dit pas, à savoir la portée, l'activation et la provenance. Le dossier se déduit
 * de la ligne, voir `skill-library/layout.ts`.
 */
export const librarySkills = sqliteTable(
  'library_skills',
  {
    id: text('id').primaryKey(),
    scope: text('scope', { enum: ['global', 'project'] }).notNull(),
    /** Null en portée globale. La cascade ne touche pas le disque, la route s'en charge. */
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    /**
     * Nom du dossier, et `name` du frontmatter. Unique sur l'ensemble « global + un
     * projet », ce qu'aucun index ne sait dire puisque SQLite tient les `NULL` pour
     * distincts : le contrôle est dans le service.
     */
    name: text('name').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    sourceId: text('source_id').references(() => skillSources.id, { onDelete: 'set null' }),
    sourcePath: text('source_path'),
    sourceCommit: text('source_commit'),
    /**
     * Empreinte du skill tel que la source le portait à l'installation. Comparée au
     * catalogue, elle dit si une mise à jour existe ; elle diffère de `installedHash`
     * quand le skill a été renommé en entrant, son frontmatter réécrit.
     */
    sourceHash: text('source_hash'),
    /** Empreinte du contenu à l'installation, pour reconnaître une modification locale. */
    installedHash: text('installed_hash'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [index('idx_library_skills_project').on(t.projectId)],
)

/**
 * Dépôt de secrets de l'instance, chiffré au repos.
 *
 * Le nom est la clé primaire : c'est lui qu'on écrit dans `{{secret.NOM}}`, et deux
 * secrets homonymes n'auraient aucun moyen d'être départagés. La valeur est chiffrée
 * en AES-256-GCM avec la clé du dossier de données ; `iv` et `authTag` appartiennent
 * au chiffré et n'ont pas à être secrets, mais doivent être conservés avec lui.
 */
export const secrets = sqliteTable('secrets', {
  name: text('name').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  iv: text('iv').notNull(),
  authTag: text('auth_tag').notNull(),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
})

/**
 * Credentials git par utilisateur et par hôte, chiffrées comme les secrets.
 *
 * Table distincte de `secrets`, et non une convention de nommage dedans : les secrets
 * sont réservés aux administrateurs et alimentent le namespace `{{secret.NOM}}` des
 * serveurs MCP. Les fusionner ferait apparaître un jeton GitHub dans le sélecteur de
 * secrets MCP et interdirait à un compte non administrateur de cloner un dépôt privé.
 *
 * `username` existe parce que les forges n'attendent pas la même chose : GitHub ignore
 * la valeur pour un jeton personnel mais impose `x-access-token` pour un jeton
 * d'installation, GitLab veut `oauth2`. Le stocker évite de coder en dur une table de
 * correspondance par forge.
 */
export const gitCredentials = sqliteTable(
  'git_credentials',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Hôte seul, sans schéma ni port : `github.com`, `gitlab.example.org`. */
    host: text('host').notNull(),
    username: text('username').notNull(),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  // Une seule credential par hôte et par compte : deux jetons pour github.com n'auraient
  // aucun moyen d'être départagés au moment où git en réclame un.
  (t) => [uniqueIndex('idx_git_credentials_owner_host').on(t.ownerId, t.host)],
)

/**
 * Comptes Claude supplémentaires, par utilisateur : un jeton OAuth longue durée de
 * `claude setup-token` chacun, chiffré comme les credentials git.
 *
 * Par utilisateur et non par instance, pour la même raison que les credentials git :
 * c'est l'abonnement de quelqu'un, et un administrateur n'a pas à emprunter celui d'un
 * autre. Le libellé est ce que le sélecteur de compte affiche : un jeton ne porte ni
 * courriel ni nom d'organisation lisibles sans dépenser un tour.
 */
export const claudeAccounts = sqliteTable(
  'claude_accounts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /**
     * Ce qu'est le secret : un jeton OAuth de `claude setup-token` (abonnement, passé
     * dans `CLAUDE_CODE_OAUTH_TOKEN`) ou une clé API Console (facturée à l'usage, passée
     * dans `ANTHROPIC_API_KEY`). Déduit du préfixe à l'écriture, retenu pour que le
     * lancement n'ait pas à déchiffrer pour le savoir.
     */
    kind: text('kind').$type<'oauth' | 'apiKey'>().notNull().default('oauth'),
    ciphertext: text('ciphertext').notNull(),
    iv: text('iv').notNull(),
    authTag: text('auth_tag').notNull(),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  // Deux comptes du même nom seraient indiscernables dans le sélecteur.
  (t) => [uniqueIndex('idx_claude_accounts_owner_label').on(t.ownerId, t.label)],
)

/**
 * Comptes Codex supplémentaires, par utilisateur.
 *
 * Aucun secret ici, contrairement aux comptes Claude : la connexion vit dans l'`auth.json`
 * du home que Solera donne au compte (`<données>/codex-accounts/<id>`), écrit et
 * rafraîchi par Codex lui-même. La ligne ne porte que le libellé et ce que Codex a dit
 * du compte à la dernière connexion, pour que la liste se lise sans lancer d'app-server.
 */
export const codexAccounts = sqliteTable(
  'codex_accounts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** `chatgpt` ou `apiKey` une fois connecté, NULL tant que le home est vide. */
    authMode: text('auth_mode').$type<'chatgpt' | 'apiKey'>(),
    email: text('email'),
    planType: text('plan_type'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [uniqueIndex('idx_codex_accounts_owner_label').on(t.ownerId, t.label)],
)

/**
 * Comptes Grok Build supplémentaires, par utilisateur.
 *
 * Même parti que les comptes Codex : aucun secret ici. La connexion vit dans l'`auth.json`
 * du `GROK_HOME` que Solera donne au compte (`<données>/grok-accounts/<id>`), écrit et
 * rafraîchi par Grok. La ligne retient le libellé et ce que Grok a dit du compte, pour
 * que la liste se lise sans lancer de process.
 */
export const grokAccounts = sqliteTable(
  'grok_accounts',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    /** `grok` (abonnement, connexion grok.com) ou `apiKey` une fois connecté, NULL avant. */
    authMode: text('auth_mode').$type<'grok' | 'apiKey'>(),
    email: text('email'),
    /** Formule annoncée par la facturation de Grok (« X Premium », « SuperGrok »…). */
    plan: text('plan'),
    createdAt: timestamp('created_at').notNull(),
    updatedAt: timestamp('updated_at').notNull(),
  },
  (t) => [uniqueIndex('idx_grok_accounts_owner_label').on(t.ownerId, t.label)],
)

/**
 * Jetons d'API, porteurs d'identité des clients machine.
 *
 * Même stockage que les sessions : seul le SHA-256 du secret est retenu, le jeton en
 * clair n'existe que dans la réponse à sa création. Une révocation garde la ligne, pour
 * que le libellé reste lisible dans l'audit des conversations qu'il a lancées.
 */
export const apiTokens = sqliteTable(
  'api_tokens',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    /** Premiers caractères du secret, pour reconnaître une ligne sans la révéler. */
    hint: text('hint').notNull(),
    label: text('label').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** JSON ApiScope[]. */
    scopes: text('scopes').notNull(),
    /** JSON string[] d'identifiants de projets ; vide signifie « tous ceux qu'il voit ». */
    projectIds: text('project_ids').notNull(),
    agent: text('agent').$type<AgentKind>().notNull(),
    /** JSON AgentConfig : avec quoi les tâches de ce jeton travaillent par défaut. */
    config: text('config').notNull(),
    /** URL appelée sur les événements de tâche ; NULL quand le jeton n'en veut pas. */
    webhookUrl: text('webhook_url'),
    /**
     * Secret HMAC des livraisons, en clair : le serveur doit pouvoir signer, donc le
     * chiffrer avec une clé posée à côté de la base ne protégerait de rien. Il ne donne
     * aucun accès à Solera, seulement la capacité de forger des livraisons vers
     * l'endpoint du consommateur, qui exige aussi de connaître l'URL.
     */
    webhookSecret: text('webhook_secret'),
    createdAt: timestamp('created_at').notNull(),
    lastUsedAt: timestamp('last_used_at'),
    expiresAt: timestamp('expires_at'),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [index('idx_api_tokens_user').on(t.userId)],
)

/**
 * Réglages propres aux tâches lancées par l'API : surcharge de webhook, échéance de
 * réponse. Table à part plutôt que des colonnes sur `conversations`, qui appartient au
 * noyau et n'a pas à porter les préoccupations d'un appelant machine.
 */
export const apiTaskOptions = sqliteTable('api_task_options', {
  conversationId: text('conversation_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  webhookUrl: text('webhook_url'),
  /** 0 signifie « pas d'échéance », choisi explicitement par l'appelant. */
  replyDeadlineSec: integer('reply_deadline_sec').notNull(),
})

/**
 * Livraisons de webhook, persistées avant le premier essai.
 *
 * Un redémarrage du service ne doit pas avaler la seule notification qu'attendait
 * l'appelant : la reprise relit ce qui n'a pas été livré et reprend le barème là où
 * il en était. `nextAttemptAt` NULL marque l'abandon après épuisement des essais.
 */
export const webhookDeliveries = sqliteTable(
  'webhook_deliveries',
  {
    id: text('id').primaryKey(),
    tokenId: text('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    conversationId: text('conversation_id').notNull(),
    url: text('url').notNull(),
    type: text('type').notNull(),
    /** JSON WebhookPayload. */
    payload: text('payload').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at'),
    deliveredAt: timestamp('delivered_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [index('idx_webhook_deliveries_due').on(t.deliveredAt, t.nextAttemptAt)],
)

/**
 * Clés d'idempotence des créations de tâche.
 *
 * La déduplication des envois vit en mémoire sur cinq minutes, ce qui convient à un
 * renvoi réseau mais pas à un agent qui réessaie dix minutes plus tard : sans cette
 * table, il ouvrirait une seconde conversation.
 *
 * La clé se réserve avant la création, d'où un `conversation_id` nullable : entre les
 * deux, une requête concurrente doit voir la réservation et attendre plutôt que de
 * lancer un second tour. Sans référence non plus, pour que la réservation puisse
 * exister avant sa conversation ; la conversation supprimée laisse une clé orpheline,
 * que la purge finit par emporter.
 */
export const apiIdempotency = sqliteTable(
  'api_idempotency',
  {
    tokenId: text('token_id')
      .notNull()
      .references(() => apiTokens.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    conversationId: text('conversation_id'),
    createdAt: timestamp('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.tokenId, t.key] })],
)


/**
 * L'index du vault, niveau 1 — les faits du texte.
 *
 * Trois tables **dérivées** : les fichiers du vault sont la vérité, celles-ci n'en sont
 * qu'une lecture. Elles se vident et se refont en une passe, et c'est exactement ce qui
 * autorise à ne rien prévoir pour les réparer.
 *
 * Elles vivent dans `solera.db`, donc hors du vault, et c'est une règle : un index
 * posé dans le vault serait versionné par git, créerait un conflit à chaque
 * synchronisation entre deux machines, et finirait par apparaître dans l'historique
 * d'un fichier qu'on relit.
 *
 * Aucune clé étrangère vers `projects` ni `users` : le vault n'est pas un répertoire de
 * travail, c'est une ressource de l'instance, comme un service.
 */
export const vaultNotes = sqliteTable(
  'vault_notes',
  {
    /** Chemin relatif à la racine du vault, séparateur `/`. C'est l'identité d'une note. */
    path: text('path').primaryKey(),
    /**
     * Dossier parent, `''` pour une **ébauche**.
     *
     * Pas de dossier, donc pas de droit à hériter, donc aucun agent ne la voit : la
     * colonne porte seule cette conséquence, qu'il faut assumer et qui est bonne.
     */
    folder: text('folder').notNull(),
    /** Le `title` du frontmatter, sinon le premier titre de niveau 1, sinon le nom du fichier. */
    title: text('title').notNull(),
    words: integer('words').notNull(),
    bytes: integer('bytes').notNull(),
    /** JSON string[] : les tags du frontmatter. */
    tags: text('tags').notNull(),
    modifiedAt: timestamp('modified_at').notNull(),
  },
  (t) => [index('idx_vault_notes_folder').on(t.folder)],
)

/**
 * Les liens `[[cible]]` d'une note, un par occurrence.
 *
 * Une ligne par occurrence et non par paire : la même cible citée trois fois dans une
 * note se lit trois fois dans son historique, et le panneau montre la ligne où chaque
 * citation se trouve.
 *
 * `targetPath` est la **résolution** de `target`, recalculée après chaque passe
 * d'indexation : NULL signifie lien cassé. Elle n'est pas une clé étrangère, parce
 * qu'une note supprimée ne doit pas effacer les liens qui la citaient — ils deviennent
 * cassés, ce qui est précisément le fait à montrer.
 */
export const vaultLinks = sqliteTable(
  'vault_links',
  {
    sourcePath: text('source_path').notNull(),
    /** La cible telle qu'elle est écrite entre les crochets, sans alias ni ancre. */
    target: text('target').notNull(),
    /** La cible normalisée, sur quoi la résolution s'appuie. */
    targetKey: text('target_key').notNull(),
    /** NULL = lien cassé. */
    targetPath: text('target_path'),
    anchor: text('anchor'),
    alias: text('alias'),
    /** Ligne de l'occurrence, à partir de 1. */
    line: integer('line').notNull(),
  },
  (t) => [
    index('idx_vault_links_source').on(t.sourcePath),
    index('idx_vault_links_target').on(t.targetPath),
  ],
)

/**
 * Ce que l'index reflète. Une seule ligne, `id = 1`.
 *
 * `commitSha` est la pièce qui empêche l'index de mentir : sans lui, rien ne garantit
 * qu'un vault modifié depuis un autre éditeur — ou depuis le téléphone, Solera éteint
 * trois semaines — soit rattrapé. Avec lui, un `git diff` jusqu'à `HEAD` dit exactement
 * ce qui a bougé, et le rattrapage est borné.
 *
 * `path` est stocké à côté : le chemin du vault changé, l'index entier parle d'autre
 * chose et se refait, sans qu'on ait à s'en souvenir ailleurs.
 */
export const vaultIndexState = sqliteTable('vault_index_state', {
  id: integer('id').primaryKey(),
  path: text('path').notNull(),
  /** NULL hors dépôt git : le rattrapage se fait alors par une passe complète. */
  commitSha: text('commit_sha'),
  indexedAt: timestamp('indexed_at').notNull(),
})

export type UserRow = typeof users.$inferSelect
export type ApiTokenRow = typeof apiTokens.$inferSelect
export type ProjectRow = typeof projects.$inferSelect
export type InstructionsRow = typeof instructions.$inferSelect
export type ConversationRow = typeof conversations.$inferSelect
export type ScheduledTaskRow = typeof scheduledTasks.$inferSelect
export type ScheduledRunRow = typeof scheduledRuns.$inferSelect
export type ProjectActionRow = typeof projectActions.$inferSelect
export type ConversationReadRow = typeof conversationReads.$inferSelect
export type EventRow = typeof events.$inferSelect
export type WorktreeRow = typeof worktrees.$inferSelect
export type CardRow = typeof cards.$inferSelect
export type CardNoteRow = typeof cardNotes.$inferSelect
export type CardMoveRow = typeof cardMoves.$inferSelect
export type CardReviewRow = typeof cardReviews.$inferSelect
export type SessionMessageRow = typeof sessionMessages.$inferSelect
export type AgentRequestRow = typeof agentRequests.$inferSelect
export type SessionWatchRow = typeof sessionWatches.$inferSelect
export type PermissionRequestRow = typeof permissionRequests.$inferSelect
export type McpServerRow = typeof mcpServers.$inferSelect
export type SkillSourceRow = typeof skillSources.$inferSelect
export type LibrarySkillRow = typeof librarySkills.$inferSelect
export type SecretRow = typeof secrets.$inferSelect
export type GitCredentialRow = typeof gitCredentials.$inferSelect
export type ClaudeAccountRow = typeof claudeAccounts.$inferSelect
export type CodexAccountRow = typeof codexAccounts.$inferSelect
export type GrokAccountRow = typeof grokAccounts.$inferSelect
export type WebhookDeliveryRow = typeof webhookDeliveries.$inferSelect
export type VaultNoteRow = typeof vaultNotes.$inferSelect
export type VaultLinkRow = typeof vaultLinks.$inferSelect
export type VaultIndexStateRow = typeof vaultIndexState.$inferSelect

/**
 * Le fil replié d'une conversation, jetable : le journal reste la seule source. Ici
 * l'état scalaire du fold et le curseur jusqu'où il a été replié ; les collections
 * vivent dans `thread_projection_rows`.
 */
export const threadProjections = sqliteTable('thread_projections', {
  conversationId: text('conversation_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  cursor: integer('cursor').notNull(),
  state: text('state').notNull(),
})

/**
 * Les collections du fil projeté, une ligne par élément, tâche, tour d'édition ou
 * point de reprise : rebâtir ou paginer ne garde jamais le fil entier en mémoire.
 */
export const threadProjectionRows = sqliteTable(
  'thread_projection_rows',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    position: integer('position').notNull(),
    entryKey: text('entry_key').notNull(),
    itemKind: text('item_kind').notNull(),
    related: text('related'),
    live: integer('live').notNull(),
    updatedSeq: integer('updated_seq').notNull(),
    bytes: integer('bytes').notNull(),
    payload: text('payload').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.category, t.position] }),
    index('idx_thread_projection_key').on(t.conversationId, t.category, t.entryKey),
    index('idx_thread_projection_live').on(t.conversationId, t.live),
    index('idx_thread_projection_updated').on(t.conversationId, t.updatedSeq),
    index('idx_thread_projection_related').on(t.conversationId, t.related),
    index('idx_thread_projection_kind').on(t.conversationId, t.itemKind, t.position),
  ],
)
