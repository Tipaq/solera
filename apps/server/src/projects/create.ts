import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { max } from 'drizzle-orm'
import { projects, type ProjectRow } from '@solera/db'
import type { InstructionsMode } from '@solera/protocol'
import { badRequest } from '../http/errors.js'
import type { AppContext } from '../http/context.js'
import { repoInstructionFiles } from '../instructions/store.js'

/**
 * Déclarer un projet : une ligne qui pointe sur un dossier existant.
 *
 * Hors des routes parce que le daemon en a besoin aussi, `create_project` déposant la
 * même ligne qu'un clic dans l'interface — motif de `conversations/create.ts`. Solera
 * ne crée jamais le dossier ici : la route de création de projet le fait pour un projet
 * parti de zéro, et c'est son exception à elle, pas une capacité de ce module.
 */

export async function assertUsableWorkspace(path: string): Promise<string> {
  if (!isAbsolute(path)) {
    throw badRequest('workspace_not_absolute', 'The workspace path must be absolute.')
  }

  const resolved = resolve(path)
  let info
  try {
    info = await stat(resolved)
  } catch {
    throw badRequest('workspace_missing', 'Directory {path} does not exist.', { path: resolved })
  }

  if (!info.isDirectory()) {
    throw badRequest('workspace_not_a_directory', '{path} is not a directory.', { path: resolved })
  }

  return resolved
}

export interface ProjectFields {
  name: string
  workspacePath: string
  visibility: 'private' | 'shared'
  color: string | null
  instructionsMode: InstructionsMode | undefined
}

/**
 * En fin de liste : s'insérer au milieu déplacerait visuellement des projets que
 * l'utilisateur avait rangés lui-même.
 */
export async function insertProject(
  ctx: AppContext,
  ownerId: string,
  fields: ProjectFields,
): Promise<ProjectRow> {
  const [highest] = await ctx.db.select({ max: max(projects.position) }).from(projects)

  const row: ProjectRow = {
    id: randomUUID(),
    ...fields,
    // Fixé dès la création, faute de choix d'après ce que le dossier porte déjà : un
    // mode résolu à chaque lancement basculerait le jour où un agent crée un AGENTS.md.
    instructionsMode:
      fields.instructionsMode ??
      (repoInstructionFiles(fields.workspacePath).length > 0 ? 'repo' : 'solera'),
    ownerId,
    defaultConfig: null,
    position: (highest?.max ?? 0) + 1,
    archivedAt: null,
    createdAt: Date.now(),
  }
  await ctx.db.insert(projects).values(row)
  return row
}
