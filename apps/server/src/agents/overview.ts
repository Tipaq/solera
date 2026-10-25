import { and, count, desc, eq, gt, isNull, ne, or, sql } from 'drizzle-orm'
import { cardReviews, cards, conversations, projectImages, projects, worktrees, type Db } from '@solera/db'
import { sessionReference } from '@solera/protocol'
import { parentBranchOf } from '../cards/parent-branch.js'

/**
 * Ce qui se passe sur le projet, injecté au démarrage d'une session.
 *
 * Un CLI arrive sans rien savoir de ce que les autres ont fait, et rien ne le pousse à
 * aller le demander : les outils du serveur MCP répondent quand on les interroge, encore
 * faut-il y penser. Cet aperçu est le seul élément qui arrive sans initiative de l'agent,
 * et c'est ce qui le justifie malgré son coût en jetons.
 *
 * Calculé et non stocké. Une note écrite quelque part et jamais relue vieillit et finit
 * par tromper avec l'autorité d'une note ; recalculer à chaque démarrage coûte une
 * requête et ne peut pas mentir. Les consignes durables ont leur place à part, dans
 * SOLERA.md (`instructions/store.ts`), que l'utilisateur relit et taille lui-même.
 *
 * Le projet entier et non le seul worktree, contrairement à `find_file_edits` : ici on
 * cherche à savoir quels chantiers sont ouverts, et un chantier sur une autre branche
 * en est un. Le worktree est dit ligne par ligne, pour que l'agent fasse la part des
 * choses lui-même.
 */

/** Au-delà, l'aperçu pèse plus qu'il n'oriente. */
const MAX_SESSIONS = 6

/**
 * Fenêtre des sessions dites « récentes ».
 *
 * Trois jours plutôt qu'une journée : un chantier ouvert vendredi est toujours le
 * chantier en cours le lundi, et l'ignorer ferait repartir de zéro sur un sujet déjà
 * traité. Les sessions qui travaillent en ce moment sortent de toute façon, quelle que
 * soit leur ancienneté.
 */
const RECENT_MS = 3 * 24 * 60 * 60 * 1000

interface OverviewInput {
  projectId: string
  conversationId: string
  /** L'agent a-t-il les outils du serveur MCP de Solera sous la main. */
  soleraMcp: boolean
  /**
   * La famille `cardFiling` est-elle accordée, c'est-à-dire `request_card_change` listé.
   *
   * Change une phrase et une seule, celle du briefing de carte. Les gestes du socle sur
   * sa carte (`move_card`, `edit_subtasks`, `append_card_description`) y sont dits dans
   * les deux cas ; sans la portée, les verdicts et les champs d'une personne « se posent
   * dans l'interface et jamais par toi » ; avec elle, l'agent peut en *proposer* le
   * changement, et celui de toute autre carte. Lui dire le contraire de ce que son catalogue d'outils
   * lui montre est la pire des deux erreurs.
   */
  cardFiling: boolean
  /**
   * Le dossier des prototypes du projet sur son design system, null sans DS lié. Le
   * rappel du DS y ajoute alors la manière de prototyper (carte #63).
   */
  prototypesDir?: string | null
}

interface Row {
  id: string
  title: string
  agent: string
  status: string
  background: number
  loops: number
  createdAt: number
  updatedAt: number
  tokens: number
  worktree: string | null
}

/** Ancienneté en clair, l'horodatage absolu obligeant le modèle à faire la soustraction. */
function ago(ts: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - ts) / 60_000))
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `il y a ${hours} h` : `il y a ${Math.round(hours / 24)} j`
}

/** Taille du chantier, arrondie : ce qui compte est l'ordre de grandeur. */
function size(tokens: number): string {
  if (tokens < 1000) return 'quelques échanges'
  return `~${Math.round(tokens / 1000)} k jetons`
}

function describe(row: Row, now: number): string {
  const working = row.status === 'running' || row.background > 0 || row.loops > 0
  const state = working
    ? row.status === 'running'
      ? 'en cours'
      : `travail de fond en cours`
    : row.status === 'awaiting_input'
      ? 'attend une réponse'
      : row.status === 'interrupted'
        ? 'interrompue'
        : 'terminée'

  const where = row.worktree ? `worktree ${row.worktree}` : 'racine du projet'
  return `- ${row.title} | ${sessionReference(row.id)}\n  ${row.agent}, ${state}, ${where}, ${size(row.tokens)}, ouverte ${ago(row.createdAt, now)}, dernier échange ${ago(row.updatedAt, now)}`
}

/**
 * La carte que cette conversation traite, et ce qui l'a précédée dessus.
 *
 * C'est la partie de l'aperçu qui parle du travail demandé plutôt que de son voisinage,
 * et la seule qui manquait vraiment : un agent qui reprend un chantier à la quatrième
 * session repartait de zéro sans savoir qu'il y en avait eu trois.
 */
function cardBriefing(db: Db, input: OverviewInput): string | null {
  const card = db
    .select({
      number: cards.number,
      title: cards.title,
      column: cards.column,
      id: cards.id,
      toClarifySince: cards.toClarifySince,
    })
    .from(cards)
    .innerJoin(conversations, eq(conversations.cardId, cards.id))
    .where(eq(conversations.id, input.conversationId))
    .get()
  if (!card) return null

  const [before] = db
    .select({ total: count() })
    .from(conversations)
    .where(and(eq(conversations.cardId, card.id), ne(conversations.id, input.conversationId)))
    .all()

  const previous = before?.total ?? 0
  const clarifying = card.column === 'todo' && card.toClarifySince !== null
  const lines = [
    `Cette conversation traite la carte #${card.number} « ${card.title} », ${clarifying ? 'à préciser' : COLUMN_WORDS[card.column]}.`,
  ]

  if (previous > 0) {
    lines.push(
      `${previous} autre(s) session(s) ont déjà travaillé dessus : ce n'est pas un sujet neuf.`,
    )
  }

  if (input.soleraMcp) {
    lines.push(
      `\`read_card\` avec le numéro ${card.number} rend sa description entière, les chemins locaux de ses pièces jointes à consulter avec tes outils de lecture, les notes des sessions précédentes et les cartes qui la citent ; \`add_card_note\` laisse à la suivante ce qu'elle ne pourra pas redécouvrir seule, et c'est à faire avant de terminer. ${
        OWN_CARD_GESTURES
      } ${
        input.cardFiling
          ? "Terminé, abandonné, l'échéance, la parente ou les blocages d'une carte, et les autres cartes, se proposent avec `request_card_change`, en disant pourquoi, et c'est un clic qui tranche."
          : "Terminé, abandonné, l'échéance, la parente et les blocages, eux, se posent dans l'interface et jamais par toi."
      }`,
    )
    if (clarifying) lines.push(RESUME_CLARIFICATION)
    else if (OPEN_COLUMNS.has(card.column)) lines.push(CLARIFY_FIRST)
  }

  return lines.join(' ')
}

/**
 * Comment le travail d'une carte se livre (#68) : par une PR, relue par une session que
 * Solera lance, jamais fusionnée par la session qui l'a écrite.
 *
 * À part de `cardBriefing`, et pour les seules sessions auteures : la relectrice reçoit
 * sa propre mission, et lui dire d'ouvrir une PR la ferait livrer la revue elle-même.
 */
function deliveryBriefing(db: Db, input: OverviewInput): string | null {
  if (!input.soleraMcp) return null
  const card = db
    .select({ id: cards.id, parentId: cards.parentId })
    .from(cards)
    .innerJoin(conversations, eq(conversations.cardId, cards.id))
    .where(eq(conversations.id, input.conversationId))
    .get()
  if (!card) return null
  const parent = card.parentId
    ? db
        .select({ number: cards.number, title: cards.title, branch: cards.branch })
        .from(cards)
        .where(eq(cards.id, card.parentId))
        .get()
    : undefined
  const reviewing = db
    .select({ id: cardReviews.id })
    .from(cardReviews)
    .where(eq(cardReviews.reviewerConversationId, input.conversationId))
    .get()
  if (reviewing) {
    return "Tu es la revue d'une PR de cette carte, pas son auteure : tu relis dans son arbre sans y écrire, et tu rends ton verdict avec `submit_review`. N'ouvre pas de PR et ne fusionne rien."
  }
  // La branche d'une parente est poussée par Solera avant que la PR n'en ait besoin
  // (`cards/parent-branch.ts`) : son nom suffit ici.
  const target = parent
    ? `vers \`${parentBranchOf(parent)}\`, la branche de la carte parente #${parent.number}, avec \`gh pr create --base ${parentBranchOf(parent)}\``
    : 'vers la branche par défaut du dépôt avec `gh pr create`'
  const end = parent
    ? 'Au vert, Solera la fusionne lui-même dans la branche de la parente et termine la carte : ne fusionne jamais la PR toi-même.'
    : 'Ne fusionne jamais la PR toi-même.'
  // La clôture (#69) passe par la famille `cardFiling` : sans elle, l'agent n'a pas l'outil.
  const close = input.cardFiling
    ? " Une fois la PR fusionnée et le résultat vérifié, propose de clore la carte avec `request_card_change` et `close: true`, en disant ce que tu as vérifié : le clic archive ses conversations, la tienne comprise, et retire ton worktree."
    : ''
  return `Si tu livres du code pour cette carte, livre-le par une PR : commite dans ta branche, pousse-la, ouvre la PR ${target}, puis appelle \`request_review\` avec son numéro. Une session de revue la relit dans ton arbre ; tant qu'elle relit, n'y écris rien. Son verdict t'arrive en message : corrige, pousse et rappelle \`request_review\` jusqu'au vert. ${end}${close}`
}

/** Ce qu'un agent fait seul sur sa carte (#66), dit dans les deux cas du briefing. */
const OWN_CARD_GESTURES =
  "Tu ranges toi-même ta carte avec `move_card` : « à préciser » quand tu attends des réponses, « en cours » quand tu travailles, « à vérifier » quand ton travail attend une relecture. Coche ses sous-tâches à mesure avec `edit_subtasks`, et promeus en carte sœur avec `promote_subtask` celle qui se révèle trop grosse pour ta session. Si le cahier des charges change en route, complète sa description avec `append_card_description`, sans réécrire ce qui précède."

/**
 * La clarification avant le code (#67).
 *
 * Une carte écrite vite laisse des trous que l'agent comble par des suppositions, et on
 * ne le découvre qu'à la relecture, quand le code est écrit. Lire le code avant de
 * questionner est ce qui distingue une question utile (« ce champ existe déjà dans tel
 * fichier, on l'étend ? ») d'une question générique. Finir son tour sans coder est la
 * moitié de la consigne : un modèle pose ses questions puis enchaîne sur ses propres
 * hypothèses si on ne lui dit pas d'attendre.
 *
 * Pas dite sur une carte en relecture ou fermée : ce qu'il y reste à faire n'est plus
 * de cadrer le travail.
 */
const CLARIFY_FIRST =
  "Avant d'écrire du code, lis la carte puis le code qu'elle concerne, pour juger si elle dit assez pour travailler et pour poser des questions précises plutôt que génériques. Si elle suffit, travaille. Sinon, mets-la « à préciser » avec `move_card`, pose tes questions dans ta réponse, laisse-les aussi en note avec `add_card_note` pour qu'on les voie depuis le board, et termine ton tour sans écrire de code : la réponse viendra dans ce fil. Avec elle, ramène la carte « en cours », et si le cahier des charges a changé, complète sa description avec `append_card_description`."

/**
 * La reprise d'une carte laissée « à préciser » : une session précédente a posé des
 * questions, et la réponse est peut-être dans le premier message de celle-ci. Le
 * lancement ne la fait pas passer « en cours » (`advanceCardOnLaunch`), pour que ce
 * soit dit ici.
 */
const RESUME_CLARIFICATION =
  "Elle est « à préciser » : une session précédente a posé des questions, qui sont dans ses notes (`read_card`). Relis-les avec les réponses de l'utilisateur avant d'écrire du code. Si elles suffisent, ramène la carte « en cours » avec `move_card`, et complète sa description avec `append_card_description` si le cahier des charges a changé ; sinon, pose ce qui reste et termine ton tour."

/** Les colonnes où le travail n'est pas encore cadré, et où la clarification se dit. */
const OPEN_COLUMNS = new Set(['todo', 'in_progress'])

/** Les colonnes en toutes lettres : les valeurs stockées sont des identifiants. */
const COLUMN_WORDS: Record<string, string> = {
  todo: 'à faire',
  in_progress: 'en cours',
  review: 'à vérifier',
  done: 'marquée terminée',
  abandoned: 'marquée abandonnée',
}

/**
 * Le rappel de l'image du projet, tant qu'elle manque ou n'est que provisoire.
 *
 * L'image est ce qui fait reconnaître un projet dans la navigation, et personne ne pense
 * à en mettre une : l'agent, lui, a le dépôt sous les yeux et sait y trouver un logo.
 * Deux temps, parce qu'un projet qui démarre n'a souvent pas encore de logo : l'agent en
 * pose alors une d'attente, déclarée provisoire, et c'est ce drapeau qui garde le rappel
 * en vie jusqu'à ce qu'un vrai logo la remplace. Une image définitive ne fait plus rien
 * dire, pas plus qu'un agent sans l'outil pour agir.
 */
/**
 * Le rappel du design system lié, quand le projet en a un.
 *
 * Les outils seuls ne suffisent pas : un modèle qui sait écrire un bouton en écrit un
 * sans penser à demander s'il en existe déjà, et ce réflexe varie d'un modèle à
 * l'autre. C'est ce rappel qui le tient, par le même canal pour les trois CLI. Il suit
 * la condition des outils : sans le serveur MCP, il nommerait des outils absents.
 */
function designSystemReminder(db: Db, input: OverviewInput): string | null {
  if (!input.soleraMcp) return null

  const path = db
    .select({ path: projects.designSystemPath })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get()?.path
  if (!path) return null

  const consult = `Ce projet est lié à un design system (\`${path}\`). Avant de créer ou de styler un composant d'interface, consulte-le : \`list_components\` pour ce qu'il contient, \`read_component\` pour les props et les exemples d'un composant, \`read_ds_page\` pour ses règles. Réutilise et compose ses composants plutôt que d'en écrire un nouveau ou d'en recopier le style.`
  if (!input.prototypesDir) {
    return `${consult} S'il manque vraiment une brique, construis-la avec ses composants et ses jetons, sans valeur en dur, et signale-le à l'utilisateur.`
  }
  return [
    consult,
    `Pour prototyper un écran ou un composant, écris une story du DS dans \`${input.prototypesDir}\`, hors de tout dépôt, et jamais dans le projet ni dans le DS : un fichier \`<Nom>.stories.tsx\` en CSF 3, sans \`title\`, qui importe les composants par les lignes que donne \`list_components\`. Le Storybook du DS le compile ; ses thèmes, ses décorateurs et ses jetons s'appliquent d'eux-mêmes. Puis appelle \`show_prototype\` avec le chemin du fichier : l'aperçu s'ouvre dans la vue Web de l'utilisateur, et se met à jour à chaque modification.`,
    `Quand le DS n'a pas le composant, dans cet ordre : 1. compose ceux qui existent, car il manque souvent un assemblage et non une brique ; 2. sinon, crée-le dans ce même dossier avec les jetons et les primitives du DS seulement, sans aucune valeur en dur, et donne à sa story le tag \`candidate\` (\`tags: ['candidate']\`) ; 3. dis-le à l'utilisateur : c'est lui qui décide s'il entre dans le DS.`,
  ].join('\n\n')
}

function imageReminder(db: Db, input: OverviewInput): string | null {
  if (!input.soleraMcp) return null

  const image = db
    .select({ provisional: projectImages.provisional })
    .from(projectImages)
    .where(eq(projectImages.projectId, input.projectId))
    .get()

  if (!image) {
    return "Ce projet n'a pas d'image dans Solera, alors que c'est elle qui permet à l'utilisateur de le reconnaître d'un coup d'œil parmi les autres. Sans détourner le travail demandé, par exemple une fois qu'il est fini, donne-lui en une avec `set_project_image`. Cherche d'abord un logo ou une icône dans le dépôt : favicon, `logo.*`, `icon.*`, dossiers `public`, `assets` ou `static`, image en tête du README. S'il n'y en a pas, dessine un SVG simple qui évoque le projet, ou génère une image si tu as un outil pour ça, et pose-la avec `provisional: true` : les sessions suivantes sauront qu'elle attend un vrai logo."
  }

  if (image.provisional) {
    return "L'image de ce projet dans Solera est provisoire : elle a été posée faute de logo. Dès que le projet en a un vrai, et en particulier si c'est toi qui le crées ou l'ajoutes, remplace-la avec `set_project_image`."
  }

  return null
}

/**
 * Null quand il n'y a rien à dire, et c'est important : un aperçu vide répété à chaque
 * démarrage apprend au modèle à ne plus le lire, et le jour où il porte quelque chose
 * il passe inaperçu.
 */
export function projectOverview(db: Db, input: OverviewInput): string | null {
  const now = Date.now()
  // La carte d'abord, puis l'image : ce qui est demandé passe avant ce qui est suggéré.
  const briefing = [
    cardBriefing(db, input),
    deliveryBriefing(db, input),
    designSystemReminder(db, input),
    imageReminder(db, input),
  ]
    .filter((part) => part !== null)
    .join('\n\n') || null

  const rows = db
    .select({
      id: conversations.id,
      title: conversations.title,
      agent: conversations.agent,
      status: conversations.status,
      background: conversations.backgroundCount,
      loops: conversations.loopCount,
      createdAt: conversations.createdAt,
      updatedAt: conversations.updatedAt,
      tokens: sql<number>`${conversations.inputTokens} + ${conversations.outputTokens}`,
      worktree: worktrees.name,
    })
    .from(conversations)
    .leftJoin(worktrees, eq(worktrees.id, conversations.worktreeId))
    .where(
      and(
        eq(conversations.projectId, input.projectId),
        ne(conversations.id, input.conversationId),
        isNull(conversations.archivedAt),
        or(
          eq(conversations.status, 'running'),
          gt(conversations.backgroundCount, 0),
          gt(conversations.loopCount, 0),
          gt(conversations.updatedAt, now - RECENT_MS),
        ),
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(MAX_SESSIONS)
    .all() as Row[]

  // La carte parle même quand le projet est calme : elle dit ce qui est demandé, ce que
  // le voisinage ne dit pas.
  if (rows.length === 0) return briefing

  const working = rows.filter(
    (row) => row.status === 'running' || row.background > 0 || row.loops > 0,
  )

  const parts = briefing ? [briefing] : []
  parts.push(
    `Autres sessions Solera sur ce projet, ${working.length > 0 ? `dont ${working.length} en cours` : 'aucune en cours'} :`,
    rows.map((row) => describe(row, now)).join('\n'),
  )

  if (working.length > 0) {
    parts.push(
      "Une session en cours travaille peut-être dans le même arbre : avant de défaire une modification que tu n'as pas faite, regarde d'où elle vient.",
    )
  }

  if (input.soleraMcp) {
    parts.push(
      'Les outils du serveur `solera` donnent la suite : `search_history` et `read_conversation` pour ce qui a été décidé avant, `list_sessions` et `find_file_edits` pour ce que les autres font en ce moment, `send_session_message` pour prévenir l\'une d\'elles ou lui poser une question quand ça ne peut pas attendre l\'utilisateur, `notify_when_done` pour être relancé quand elle aura fini plutôt que de la surveiller, `broadcast_session_message` avant un geste qui touche toutes celles qui travaillent, `list_cards` et `read_card` pour le travail que ce projet s\'est donné, `create_card` pour y noter ce qui sort de ton sujet, `start_session` pour confier un travail à une nouvelle session quand l\'utilisateur le demande, `list_worktrees` et `create_worktree` pour travailler dans un arbre à l\'écart des autres plutôt que par `git worktree add`, que Solera ne verrait pas, `schedule_task` pour planifier un travail récurrent ou différé qui survit à cette session, `list_actions` et `register_action` pour les boutons du projet qui lancent d\'un clic un serveur, des tests ou un script.',
    )
    parts.push(
      "Pour citer une de ces sessions, dans ta réponse comme dans un message, écris `session:<id>` : l'interface en fait un lien qui porte son titre, et `read_conversation` accepte cette forme. La citer ne prévient pas son agent.",
    )
  }

  return parts.join('\n\n')
}
