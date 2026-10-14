import { isVaultNotePath, noteBasename } from './notes.js'

/**
 * Résoudre une cible `[[...]]` vers un chemin de note, ou constater qu'elle est cassée.
 *
 * Deux écritures circulent dans un vault et il faut accepter les deux : le **nom** seul
 * (`[[Solera]]`), qui est l'usage courant, et le **chemin** (`[[Produit/Solera]]`),
 * qu'on écrit quand deux notes portent le même nom. L'extension est facultative.
 *
 * La comparaison est insensible à la casse et normalisée en NFC : un vault se transporte
 * entre WSL et un téléphone, et `Idée` tapé sur l'un ne doit pas casser le lien écrit
 * sur l'autre.
 */

/** La forme sur quoi la résolution compare. Stockée avec le lien, pour que la passe de résolution n'ait pas à re-parser. */
export function targetKey(target: string): string {
  const cleaned = target
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .trim()
    .normalize('NFC')
    .toLowerCase()

  return isVaultNotePath(cleaned) ? cleaned.slice(0, cleaned.lastIndexOf('.')) : cleaned
}

export interface VaultResolver {
  /** `null` quand aucune note ne répond : le lien est cassé, et c'est un fait à montrer. */
  resolve(key: string): string | null
}

/**
 * Construit le résolveur depuis l'ensemble des chemins de notes du vault.
 *
 * Deux notes peuvent porter le même nom dans deux dossiers. Obsidian choisit alors la
 * plus proche de la note qui cite ; ici le choix est **le chemin le plus court, puis le
 * premier dans l'ordre alphabétique**. Deux raisons : la règle ne dépend pas de qui
 * cite, donc un lien ambigu se résout de la même façon partout — ce qui se raconte en
 * une phrase à l'utilisateur ; et la résolution reste une fonction de l'ensemble des
 * notes, donc recalculable d'un coup après chaque passe.
 */
export function buildResolver(paths: Iterable<string>): VaultResolver {
  const byPath = new Map<string, string>()
  const byName = new Map<string, string>()

  const keep = (map: Map<string, string>, key: string, path: string): void => {
    const held = map.get(key)
    if (held === undefined || betterTarget(path, held)) map.set(key, path)
  }

  for (const path of paths) {
    const normalized = path.normalize('NFC').toLowerCase()
    const withoutExtension = isVaultNotePath(normalized)
      ? normalized.slice(0, normalized.lastIndexOf('.'))
      : normalized

    keep(byPath, withoutExtension, path)
    keep(byName, noteBasename(normalized), path)
  }

  return {
    resolve(key) {
      // Le chemin d'abord : une cible qui en porte un a été écrite exprès pour lever
      // une ambiguïté, et le nom ne doit pas la ramener.
      return byPath.get(key) ?? byName.get(key) ?? null
    },
  }
}

const betterTarget = (candidate: string, held: string): boolean =>
  candidate.length < held.length || (candidate.length === held.length && candidate < held)
