import type { Automation } from './automations'

/** Un service en marche qui sert un arbre : « ⚡ :5173 ». */
export interface ServedMark {
  /** L'identifiant de l'onglet Actions (`a-<id>`), pour ouvrir son détail. */
  automationId: string
  label: string
  /** Le premier port écouté ; null tant qu'il n'en écoute aucun. */
  port: number | null
}

/**
 * Les services en marche, rangés par l'arbre qu'ils servent (`projet.md` T-4.3, T-11.1).
 * Le serveur lit le dossier d'un service et le rattache à l'arbre le plus profond qui le
 * contient (`ActionServedVersion`) : un worktree de Solera par son id, la racine par son
 * drapeau, un arbre créé au shell par son chemin.
 */
export function servedByTree(
  items: readonly Automation[],
  trees: readonly { key: string; root: boolean; id: string | null; path: string }[],
): Map<string, ServedMark[]> {
  const out = new Map<string, ServedMark[]>()
  for (const item of items) {
    if (item.live?.kind !== 'service' || item.source.kind !== 'action') continue
    const served = item.source.action.service?.served
    if (!served) continue
    const tree = served.worktreeId
      ? trees.find((entry) => entry.id === served.worktreeId)
      : served.root
        ? trees.find((entry) => entry.root)
        : trees.find((entry) => !entry.root && entry.path === served.path)
    if (!tree) continue
    const mark = { automationId: item.id, label: item.label, port: item.live.ports[0] ?? null }
    out.set(tree.key, [...(out.get(tree.key) ?? []), mark])
  }
  return out
}
