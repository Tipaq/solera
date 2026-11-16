import {
  PROJECT_CAP_MAX,
  environmentKey,
  type ConfinedServices,
  type ExecutionEnvironment,
  type ProjectDevcontainerDto,
  type ProjectDto,
  type ProjectEnvironmentsDto,
  type ProjectVisibility,
} from '@solera/protocol'

/**
 * Le brouillon des réglages d'un projet (page projet v2, R-3) : les réglages simples se
 * modifient sans rien écrire, se comptent dans la barre du bas, et partent ensemble en
 * un seul `PATCH /api/projects/:id`.
 *
 * Le brouillon ne garde que les **modifications**, posées par-dessus l'enregistré : un
 * rafraîchissement du projet ne les écrase pas, et revenir à la valeur enregistrée
 * efface la modification d'elle-même.
 */
export interface ProjectSettingsFields {
  name: string
  workspacePath: string
  visibility: ProjectVisibility
  /** Le cap, vide quand il n'y en a pas : le champ ne connaît pas `null`. */
  cap: string
  color: string | null
  turnCheckpoints: boolean
  environment: ExecutionEnvironment
  autonomousConfined: boolean
  confinedServices: ConfinedServices
}

export type SettingsField = keyof ProjectSettingsFields

/**
 * L'enregistré. Les champs qui viennent d'une requête à part (environnements, dev
 * container) n'y sont qu'une fois arrivés ; les services des sessions confinées, que
 * pour un dev container docker-compose, le seul où ils ont un objet.
 */
export type SettingsBase = Partial<ProjectSettingsFields>
export type SettingsEdits = Partial<ProjectSettingsFields>

export function settingsBaseOf(
  project: Pick<ProjectDto, 'name' | 'workspacePath' | 'visibility' | 'color' | 'cap' | 'turnCheckpoints'>,
  environments?: ProjectEnvironmentsDto,
  devcontainer?: ProjectDevcontainerDto,
): SettingsBase {
  return {
    name: project.name,
    workspacePath: project.workspacePath,
    visibility: project.visibility,
    color: project.color,
    cap: project.cap ?? '',
    turnCheckpoints: project.turnCheckpoints,
    ...(environments ? { environment: environments.default, autonomousConfined: environments.autonomousConfined } : {}),
    ...(devcontainer?.compose ? { confinedServices: devcontainer.confinedServices } : {}),
  }
}

/** La forme qu'une valeur prend une fois enregistrée : c'est elle qu'on compare. */
function stored<K extends SettingsField>(field: K, value: ProjectSettingsFields[K]): unknown {
  if (field === 'environment') return environmentKey(value as ExecutionEnvironment)
  if (field === 'name' || field === 'cap') return (value as string).trim()
  return value
}

/** Les champs dont le brouillon diffère de l'enregistré, dans l'ordre de leur saisie. */
export function changedFields(base: SettingsBase, edits: SettingsEdits): SettingsField[] {
  return (Object.keys(edits) as SettingsField[]).filter((field) => {
    const value = edits[field]
    if (value === undefined || !(field in base)) return false
    return stored(field, value) !== stored(field, base[field]!)
  })
}

export function draftOf(base: SettingsBase, edits: SettingsEdits): SettingsBase {
  return { ...base, ...edits }
}

/** Le corps du `PATCH` : les seuls champs modifiés, sous la forme que le serveur attend. */
export function settingsPatchOf(base: SettingsBase, edits: SettingsEdits): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const field of changedFields(base, edits)) {
    const value = edits[field]!
    if (field === 'name') patch.name = (value as string).trim()
    else if (field === 'cap') patch.cap = (value as string).trim() || null
    else patch[field] = value
  }
  return patch
}

export type DraftProblem = 'nameEmpty' | 'pathEmpty' | 'capTooLong'

/** Ce qui empêche d'enregistrer le brouillon tel qu'il est, avant que le serveur le dise. */
export function draftProblem(draft: SettingsBase): DraftProblem | null {
  if (draft.name !== undefined && !draft.name.trim()) return 'nameEmpty'
  if (draft.workspacePath !== undefined && !draft.workspacePath.trim()) return 'pathEmpty'
  if (draft.cap !== undefined && draft.cap.trim().length > PROJECT_CAP_MAX) return 'capTooLong'
  return null
}
