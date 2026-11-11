import { posix } from 'node:path'
import { eq } from 'drizzle-orm'
import { appSettings, type Db } from '@solera/db'
import { HttpError } from '../http/errors.js'
import { parseVersion } from '../update/version.js'
import type { SkillSources } from './sources.js'
import type { SkillLibrary } from './store.js'

/**
 * Les skills écrits pour Solera, livrés par le dossier `skills/` de son dépôt et posés
 * en source préconfigurée par la migration 0080.
 */
export const SOLERA_SKILLS_SOURCE_ID = 'builtin:solera-skills'

/** Posé une fois l'installation d'office faite, pour qu'un skill désinstallé ne revienne pas. */
const MARKER = 'solera_skills_installed'

/** Un skill du même nom dans la bibliothèque : celui de l'instance reste. */
const NAME_CONFLICTS = new Set(['skill_name_taken', 'skill_directory_exists'])

/**
 * Le tag d'où lire les skills de Solera : celui de la version installée, pour qu'un skill
 * ne cite pas un outil MCP que la release qui tourne n'a pas encore. Une version
 * construite hors tag (`0.20.0-3-g1a2b3c4`) lit le tag dont elle part. Null pour une
 * version qui n'en a pas (`dev`) : la branche par défaut.
 */
export function versionRef(version: string): string | null {
  const parsed = parseVersion(version)
  return parsed ? `v${parsed.join('.')}` : null
}

/**
 * Installation d'office des skills de Solera dans la bibliothèque globale, au premier
 * démarrage qui connaît leur source. Rend les noms installés.
 *
 * Une seule fois : ensuite, ils se désinstallent comme les autres et ne reviennent pas.
 * Seuls les skills rangés directement sous le dossier de la source sont installés ; ceux
 * d'un sous-dossier (`skills/extras/<nom>`) restent proposés dans le catalogue. Un clone
 * raté ne pose pas la marque : le démarrage suivant réessaie.
 */
export async function installSoleraSkills(db: Db, sources: SkillSources, library: SkillLibrary): Promise<string[]> {
  if (db.select().from(appSettings).where(eq(appSettings.key, MARKER)).get()) return []

  const installed: string[] = []
  const source = sources.list().find((row) => row.id === SOLERA_SKILLS_SOURCE_ID)
  if (source?.enabled) {
    // Le dépôt est public : aucun identifiant git à prêter.
    const row = await sources.refresh(source, {})
    for (const entry of sources.entries(row)) {
      if (entry.problem || posix.dirname(entry.path) !== (row.subpath ?? '.')) continue
      try {
        library.install(sources.files(row, entry.path), { scope: 'global', projectId: null }, null, {
          sourceId: row.id,
          path: entry.path,
          commit: row.lastCommit!,
          hash: entry.hash,
        })
        installed.push(entry.name)
      } catch (err) {
        if (!(err instanceof HttpError && NAME_CONFLICTS.has(err.code))) throw err
      }
    }
  }
  db.insert(appSettings).values({ key: MARKER, value: '1', updatedAt: Date.now() }).run()
  return installed
}
