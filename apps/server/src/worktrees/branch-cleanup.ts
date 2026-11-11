import type { BranchCleanupResultDto } from '@solera/protocol'
import type { LooseBranch } from './assess.js'

/** Ce que le serveur sait des branches au moment de supprimer. */
export interface JudgedBranches {
  base: string | null
  checkedOut: ReadonlySet<string>
  branches: readonly LooseBranch[]
}

/**
 * Trie une demande de suppression en lot : les branches fusionnées partent, les autres
 * restent avec leur raison, dans l'ordre de la demande. La base passe avant « sortie
 * dans un arbre » : l'arbre principal l'a souvent extraite, et c'est d'être la base
 * qui la protège.
 */
export function triageBranchCleanup(
  names: readonly string[],
  judged: JudgedBranches,
): { deletable: string[]; refused: BranchCleanupResultDto['refused'] } {
  const merged = new Map(judged.branches.map((branch) => [branch.name, branch.merged]))
  const deletable: string[] = []
  const refused: BranchCleanupResultDto['refused'] = []
  for (const name of new Set(names)) {
    if (name === judged.base) refused.push({ name, reason: 'base' })
    else if (judged.checkedOut.has(name)) refused.push({ name, reason: 'checked_out' })
    else if (!merged.has(name)) refused.push({ name, reason: 'not_found' })
    else if (!merged.get(name)) refused.push({ name, reason: 'not_merged' })
    else deletable.push(name)
  }
  return { deletable, refused }
}
