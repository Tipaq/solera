import { eq } from 'drizzle-orm'
import { userSettings, type Db } from '@solera/db'
import {
  DEFAULT_CONFIGS,
  DEFAULT_ONBOARDING,
  layerWithFullConfig,
  patchConfigLayer,
  storedUserSettingsSchema,
  type AgentConfig,
  type ConfigLayerPatch,
  type AgentKind,
  type AppearancePrefs,
  type BoardOrder,
  type NotificationPrefs,
  type OnboardingState,
  type ProjectDefaults,
  type UserSettingsDto,
} from '@solera/protocol'

export type UserSettings = UserSettingsDto

/**
 * Les réglages d'un compte, défauts du protocole compris.
 *
 * Une seule ligne par compte, la charge étant un objet JSON : ces réglages n'ont ni
 * requête à filtrer ni jointure à faire, et une colonne par réglage ajouté imposerait
 * une migration à chaque nouvelle case à cocher.
 *
 * Relu à chaque appel, comme les réglages d'instance : on y passe à l'ouverture d'un
 * écran ou à la création d'une conversation, jamais dans un chemin chaud.
 */
export function readUserSettings(db: Db, userId: string): UserSettings {
  const row = db.select().from(userSettings).where(eq(userSettings.userId, userId)).get()
  return storedUserSettingsSchema.parse(parseData(row?.data))
}

/**
 * Écrit la charge d'un compte.
 *
 * `agentDefaults` est un calcul de la lecture (le protocole sous `agentLayer`), jamais
 * stocké : l'écrire figerait une copie que la lecture suivante ignorerait de toute façon.
 */
function save(db: Db, userId: string, settings: UserSettings): void {
  const { agentDefaults: _computed, ...stored } = settings
  const data = JSON.stringify(stored)
  db.insert(userSettings)
    .values({ userId, data })
    .onConflictDoUpdate({ target: userSettings.userId, set: { data } })
    .run()
}

/**
 * Change le niveau du compte, champ par champ (#120).
 *
 * Les répertoires supplémentaires n'y entrent pas : ils désignent des dossiers d'un projet
 * précis, et les figer au compte les emmènerait dans des conversations qui n'ont rien à
 * voir. Leur place est le niveau du projet.
 */
export function writeUserAgentLayer(db: Db, userId: string, patch: ConfigLayerPatch): void {
  const current = readUserSettings(db, userId)
  const set = { ...patch.set }
  delete set.additionalDirectories
  save(db, userId, { ...current, agentLayer: patchConfigLayer(current.agentLayer, { ...patch, set }) })
}

/**
 * Range au niveau du compte la configuration entière d'un CLI, telle que l'envoient les
 * écrans d'avant l'héritage : seuls ses écarts aux défauts du protocole sont retenus.
 */
export function writeUserAgentDefault(db: Db, userId: string, config: AgentConfig): void {
  const current = readUserSettings(db, userId)
  const agentLayer = layerWithFullConfig(
    current.agentLayer,
    { ...config, additionalDirectories: [] } as AgentConfig,
    DEFAULT_CONFIGS[config.agent],
  )
  save(db, userId, { ...current, agentLayer })
}

/**
 * Les projets repliés dans la sidebar, remplacés en bloc.
 *
 * La liste entière et non un identifiant à basculer : c'est un état d'affichage que le
 * client connaît déjà en entier, et une bascule côté serveur ferait dépendre le résultat
 * de l'ordre d'arrivée de deux onglets ouverts sur la même sidebar.
 */
export function writeCollapsedProjects(db: Db, userId: string, projectIds: string[]): void {
  const current = readUserSettings(db, userId)
  save(db, userId, { ...current, collapsedProjects: [...new Set(projectIds)] })
}

/** Les CLI masqués tant qu'ils manquent, remplacés en bloc comme les projets repliés. */
export function writeHiddenAgents(db: Db, userId: string, agents: AgentKind[]): void {
  const current = readUserSettings(db, userId)
  save(db, userId, { ...current, hiddenAgents: [...new Set(agents)] })
}

/** L'ordre du board d'un projet, sans toucher à celui des autres. */
export function writeBoardOrder(db: Db, userId: string, projectId: string, order: BoardOrder): void {
  const current = readUserSettings(db, userId)
  const boardOrder = { ...current.boardOrder }
  // Le manuel est le défaut : l'écrire ne ferait que grossir la charge.
  if (order === 'manual') delete boardOrder[projectId]
  else boardOrder[projectId] = order
  save(db, userId, { ...current, boardOrder })
}

/** Le dossier parent proposé à la prochaine création de projet, ou `null` pour l'oublier. */
export function writeProjectsDir(db: Db, userId: string, projectsDir: string | null): void {
  const current = readUserSettings(db, userId)
  save(db, userId, { ...current, projectsDir })
}

/** Thème et curseurs, remplacés en bloc : l'interface envoie toujours l'état complet. */
export function writeAppearance(db: Db, userId: string, appearance: AppearancePrefs): void {
  const current = readUserSettings(db, userId)
  save(db, userId, { ...current, appearance })
}

/** Les sortes de notifications voulues, remplacées en bloc comme l'apparence. */
export function writeNotificationPrefs(db: Db, userId: string, notifications: NotificationPrefs): void {
  const current = readUserSettings(db, userId)
  save(db, userId, { ...current, notifications })
}

function parseData(data: string | undefined): unknown {
  if (!data) return {}

  try {
    return JSON.parse(data)
  } catch {
    // Une charge illisible vaut absente : les défauts reprennent la main, et la
    // prochaine écriture depuis l'interface la remplacera.
    return {}
  }
}

/**
 * L'état de la visite, remplacé en bloc.
 *
 * Appelé aussi à la création d'un compte, pour l'armer : c'est la seule façon pour un
 * compte d'avoir la visite due, les comptes d'avant la visite ne la voyant jamais.
 */
export function writeOnboarding(db: Db, userId: string, onboarding: OnboardingState): void {
  const current = readUserSettings(db, userId)
  save(db, userId, { ...current, onboarding })
}

/** La visite due, à sa première étape : ce qu'un compte reçoit en naissant. */
export function armOnboarding(db: Db, userId: string): void {
  writeOnboarding(db, userId, { ...DEFAULT_ONBOARDING, pending: true })
}

/** Les défauts des projets à venir, remplacés en bloc. */
export function writeProjectDefaults(db: Db, userId: string, projectDefaults: ProjectDefaults): void {
  const current = readUserSettings(db, userId)
  save(db, userId, { ...current, projectDefaults })
}
