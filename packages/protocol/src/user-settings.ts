import { z } from 'zod'
import { agentKindSchema, type AgentKind } from './events.js'
import { projectInstructionsModeSchema, type ProjectInstructionsMode } from './instructions.js'
import { DEFAULT_NOTIFICATION_PREFS, notificationPrefsSchema, type NotificationPrefs } from './notifications.js'
import {
  agentConfigSchema,
  claudeConfigSchema,
  codexConfigSchema,
  opencodeConfigSchema,
  grokConfigSchema,
  DEFAULT_CLAUDE_CONFIG,
  DEFAULT_CODEX_CONFIG,
  DEFAULT_OPENCODE_CONFIG,
  DEFAULT_GROK_CONFIG,
  type ClaudeConfig,
  type CodexConfig,
  type OpencodeConfig,
  type GrokConfig,
} from './agent-config.js'

/**
 * Ordre des cartes d'une colonne : `manual` suit le glisser-déposer, `recent` met en tête
 * la dernière arrivée dans la colonne, `oldest` la plus ancienne (une file d'attente).
 */
export const boardOrderSchema = z.enum(['manual', 'recent', 'oldest'])
export type BoardOrder = z.infer<typeof boardOrderSchema>

/**
 * Réglages propres à un compte, par opposition à ceux de l'instance.
 *
 * Ils ne décrivent pas un comportement du serveur mais un point de départ : avec quoi
 * une conversation s'ouvre quand personne n'a rien dit d'autre. Deux personnes du même
 * projet peuvent donc ne pas travailler avec les mêmes garde-fous, ce qui est le but :
 * le mode de permission engage celui qui lit les réponses, pas l'instance.
 */
export interface UserSettingsDto {
  agentDefaults: AgentDefaults
  /**
   * Projets repliés dans la sidebar.
   *
   * Les repliés et non les dépliés : un projet qui vient d'être créé doit s'ouvrir
   * déplié, comme tous les autres, sans que personne ait à l'ajouter à une liste.
   *
   * Au compte plutôt qu'au navigateur, à la différence de la largeur ou de l'écran
   * d'accueil d'un projet : on referme un projet parce qu'on n'y travaille pas en ce
   * moment, ce qui reste vrai en changeant de poste ou en ouvrant l'application sur
   * son téléphone.
   */
  collapsedProjects: string[]
  /**
   * Ordre des cartes dans les colonnes du board, par projet : manuel (glisser-déposer)
   * ou par arrivée dans la colonne, récentes ou anciennes en tête. Absent vaut manuel.
   * Au compte et non au projet : c'est une façon de lire le board, pas une règle qu'un
   * membre impose aux autres.
   */
  boardOrder: Record<string, BoardOrder>
  /**
   * CLI dont on ne veut plus entendre parler tant qu'ils ne sont pas installés.
   *
   * Qui n'utilise que Claude Code n'a pas à voir trois boutons « Installer » à chaque
   * nouvelle session. Masquer n'est pas désactiver : un CLI masqué qui finit par être
   * installé réapparaît de lui-même, et la liste se rouvre d'un clic. Au compte, comme
   * les projets repliés : le choix vaut sur tous ses appareils.
   */
  hiddenAgents: AgentKind[]
  /**
   * Dossier parent proposé à la création d'un projet, `null` tant qu'aucun projet n'a
   * été créé ainsi.
   *
   * Mémorisé à chaque création plutôt que réglé dans un écran à part : on range ses
   * projets toujours au même endroit, et la première création suffit à le dire.
   */
  projectsDir: string | null
  /**
   * Thème et réglages d'apparence, `null` tant que ce compte n'en a jamais enregistré.
   *
   * Au compte pour la même raison que les projets repliés : on retrouve ses couleurs
   * en changeant de poste. Le navigateur en garde une copie, lue avant l'hydratation
   * pour éviter un flash, mais c'est celle-ci qui fait foi.
   *
   * `null` et non des défauts : c'est ce qui permet au premier chargement de pousser
   * les réglages déjà choisis dans ce navigateur au lieu de les écraser.
   */
  appearance: AppearancePrefs | null
  /**
   * Les sortes de notifications que ce compte veut recevoir, sur tous ses appareils.
   * Au compte et non à l'appareil : couper les fins de tour sur le téléphone et les
   * garder sur l'ordinateur n'a pas été demandé, et doublerait l'écran.
   */
  notifications: NotificationPrefs
  /**
   * Ce qu'un projet reçoit à sa création quand le formulaire ne dit rien. Posé par la
   * visite, repris par l'écran Nouveau projet.
   */
  projectDefaults: ProjectDefaults
  /**
   * La visite de première ouverture, et où elle en est.
   *
   * Au compte et non au navigateur : la visite règle le compte (agents, autorisations,
   * consignes), et la reprendre sur un autre appareil doit repartir de la bonne étape.
   */
  onboarding: OnboardingState
}

/**
 * Le mode de consignes d'un projet à naître, quand le formulaire de création ne dit rien.
 *
 * La mémoire n'a pas de défaut ici : elle est la famille `agentMemory`, qui a déjà son
 * défaut de compte dans `agentDefaults`, et un second réglage pour la même chose
 * laisserait l'agent entre deux réponses.
 */
export interface ProjectDefaults {
  instructionsMode: ProjectInstructionsMode
}

export const DEFAULT_PROJECT_DEFAULTS: ProjectDefaults = { instructionsMode: 'auto' }

export const projectDefaultsSchema = z.object({
  instructionsMode: projectInstructionsModeSchema.default('auto').catch('auto'),
})

/**
 * Le réflexe de permission choisi dans la visite, traduit dans le vocabulaire de chaque
 * CLI par l'interface. Gardé pour le récapitulatif.
 */
export const onboardingPermissionSchema = z.enum(['manual', 'auto', 'acceptEdits', 'bypass'])
export type OnboardingPermission = z.infer<typeof onboardingPermissionSchema>

/** Ce que la visite demande en route, et qui décide des étapes suivantes. */
export interface OnboardingAnswers {
  /** Les CLI que l'utilisateur compte employer : l'étape des agents ne montre qu'eux. */
  agents: AgentKind[]
  /**
   * Vrai dès que l'utilisateur a touché à la question des agents. Avant, la liste vide
   * ne veut rien dire, et l'interface y coche d'office les CLI trouvés sur la machine.
   */
  agentsChosen: boolean
  permission: OnboardingPermission
}

export interface OnboardingState {
  /**
   * Vrai tant que la visite est due. Faux par défaut : un compte d'avant la visite ne
   * la voit pas surgir à sa prochaine connexion ; c'est la création du compte qui
   * l'arme, et « Revoir la visite » dans À propos.
   */
  pending: boolean
  /** Index de l'étape courante dans la liste que l'interface calcule. */
  step: number
  answers: OnboardingAnswers
  /** Identifiants des étapes passées avec « Plus tard », pour le récapitulatif. */
  skipped: string[]
  /**
   * Identifiants des étapes déjà traversées, continuées ou passées : on peut y revenir
   * depuis la liste, en arrière comme en avant, sans refaire celles d'entre deux.
   */
  visited: string[]
}

export const DEFAULT_ONBOARDING_ANSWERS: OnboardingAnswers = {
  agents: [],
  agentsChosen: false,
  permission: 'auto',
}

export const DEFAULT_ONBOARDING: OnboardingState = {
  pending: false,
  step: 0,
  answers: DEFAULT_ONBOARDING_ANSWERS,
  skipped: [],
  visited: [],
}

export const onboardingAnswersSchema = z.object({
  agents: z.array(agentKindSchema).max(8).default([]).catch([]),
  agentsChosen: z.boolean().default(false).catch(false),
  permission: onboardingPermissionSchema.default('auto').catch('auto'),
})

export const onboardingStateSchema = z.object({
  pending: z.boolean().default(false).catch(false),
  step: z.number().int().min(0).max(32).default(0).catch(0),
  answers: onboardingAnswersSchema.default(DEFAULT_ONBOARDING_ANSWERS).catch(DEFAULT_ONBOARDING_ANSWERS),
  skipped: z.array(z.string().max(40)).max(32).default([]).catch([]),
  visited: z.array(z.string().max(40)).max(32).default([]).catch([]),
})

/**
 * Le serveur ne connaît ni les thèmes ni les curseurs : il stocke ce que l'interface
 * lui confie, borné en taille. Un nom de thème retiré retombe sur le défaut côté client.
 */
export interface AppearancePrefs {
  theme: string | null
  syntax: string | null
  /** Présentation des outils dans le fil. Absente d'un compte plus ancien : le défaut. */
  toolStyle?: string | null
  /** Valeurs des curseurs, par nom de réglage (`hue`, `tint`, `readingSize`…). */
  values: Record<string, number>
}

/**
 * Un défaut complet par CLI, jamais un défaut commun.
 *
 * Même raison que pour `AgentConfig` : le mode de permission de Claude et le couple
 * approbation/sandbox de Codex ne se traduisent pas l'un dans l'autre, et un réglage
 * unique aurait à inventer cette traduction.
 */
export interface AgentDefaults {
  claude: ClaudeConfig
  codex: CodexConfig
  opencode: OpencodeConfig
  grok: GrokConfig
}

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  claude: DEFAULT_CLAUDE_CONFIG,
  codex: DEFAULT_CODEX_CONFIG,
  opencode: DEFAULT_OPENCODE_CONFIG,
  grok: DEFAULT_GROK_CONFIG,
}

/**
 * Relit ce qui est stocké pour un compte.
 *
 * Tolérant à chaque étage : un réglage ajouté depuis l'écriture, une valeur retirée du
 * protocole ou un enregistrement à moitié écrit retombent sur le défaut du CLI plutôt
 * que de rendre l'écran de réglages illisible. C'est un point de départ de
 * conversation, rien ici ne mérite une erreur.
 */
export const agentDefaultsSchema = z.object({
  claude: claudeConfigSchema.catch(DEFAULT_CLAUDE_CONFIG),
  codex: codexConfigSchema.catch(DEFAULT_CODEX_CONFIG),
  // `default` en plus du `catch` : les réglages écrits avant opencode n'ont pas la clé.
  opencode: opencodeConfigSchema.default(DEFAULT_OPENCODE_CONFIG).catch(DEFAULT_OPENCODE_CONFIG),
  grok: grokConfigSchema.default(DEFAULT_GROK_CONFIG).catch(DEFAULT_GROK_CONFIG),
})

export const appearancePrefsSchema = z.object({
  theme: z.string().max(40).nullable(),
  syntax: z.string().max(40).nullable(),
  toolStyle: z.string().max(40).nullable().optional(),
  values: z
    .record(z.string().max(40), z.number().finite())
    .refine((values) => Object.keys(values).length <= 32),
})

export const storedUserSettingsSchema = z
  .object({
    agentDefaults: agentDefaultsSchema.catch(DEFAULT_AGENT_DEFAULTS),
    // Jamais purgée des projets supprimés : une liste d'identifiants inconnus ne coûte
    // rien à qui la lit, et la nettoyer demanderait de toucher ce réglage à chaque
    // suppression, y compris pour les comptes qui ne se connectent plus.
    collapsedProjects: z.array(z.string()).default([]).catch([]),
    boardOrder: z.record(z.string(), boardOrderSchema).default({}).catch({}),
    hiddenAgents: z.array(agentKindSchema).default([]).catch([]),
    projectsDir: z.string().nullable().default(null).catch(null),
    appearance: appearancePrefsSchema.nullable().default(null).catch(null),
    notifications: notificationPrefsSchema.default(DEFAULT_NOTIFICATION_PREFS).catch(DEFAULT_NOTIFICATION_PREFS),
    projectDefaults: projectDefaultsSchema.default(DEFAULT_PROJECT_DEFAULTS).catch(DEFAULT_PROJECT_DEFAULTS),
    onboarding: onboardingStateSchema.default(DEFAULT_ONBOARDING).catch(DEFAULT_ONBOARDING),
  })
  .catch({
    agentDefaults: DEFAULT_AGENT_DEFAULTS,
    collapsedProjects: [],
    boardOrder: {},
    hiddenAgents: [],
    projectsDir: null,
    appearance: null,
    notifications: DEFAULT_NOTIFICATION_PREFS,
    projectDefaults: DEFAULT_PROJECT_DEFAULTS,
    onboarding: DEFAULT_ONBOARDING,
  })

export const updateUserSettingsBodySchema = z.object({
  /**
   * Le défaut d'un seul CLI, le discriminant de la configuration disant lequel. Celui
   * de l'autre CLI garde sa valeur : l'écran n'édite qu'un CLI à la fois, et envoyer
   * les deux écraserait celui qu'un autre onglet vient peut-être de changer.
   */
  agentDefault: agentConfigSchema.optional(),
  /** La liste entière : c'est un état d'affichage, pas un journal d'ouvertures. */
  collapsedProjects: z.array(z.string().uuid()).optional(),
  /** L'ordre d'un seul board ; les autres projets gardent le leur. */
  boardOrder: z.object({ projectId: z.string().uuid(), order: boardOrderSchema }).optional(),
  /** La liste entière, comme les projets repliés. */
  hiddenAgents: z.array(agentKindSchema).optional(),
  /** `null` retire le dossier mémorisé ; absent, il ne bouge pas. */
  projectsDir: z.string().min(1).nullable().optional(),
  /** Remplacée en bloc, comme les projets repliés. */
  appearance: appearancePrefsSchema.optional(),
  /** Remplacées en bloc : l'écran envoie toujours toutes les sortes. */
  notifications: notificationPrefsSchema.optional(),
  /** Remplacés en bloc, comme l'apparence. */
  projectDefaults: projectDefaultsSchema.optional(),
  /** Remplacé en bloc : la visite connaît son état entier à chaque pas. */
  onboarding: onboardingStateSchema.optional(),
})
