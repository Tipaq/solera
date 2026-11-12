import type { WorktreeState } from '@solera/protocol'
import type { Automation, Translate } from './automations'

/**
 * « Ce qu'il sert » (`actions.md` §1.H) : la version qu'un service en marche sert, et
 * l'arbre du projet qui la porte. Pur : les arbres viennent de `useCodeData`, le texte du
 * `t` de l'appelant ; `lib/served-query.ts` l'alimente.
 *
 * Le serveur lit le dossier d'un service et le rattache à l'arbre le plus profond qui le
 * contient (`ActionServedVersion`) : un worktree de Solera par son id, la racine par son
 * drapeau, un arbre créé au shell par son chemin. Ce module retrouve cet arbre parmi ceux
 * de la page.
 */

/** Ce qu'il faut d'un arbre pour le reconnaître. */
export interface TreeRef {
  key: string
  root: boolean
  /** Le worktree Solera ; null pour la racine et les arbres créés au shell. */
  id: string | null
  path: string
}

/** Ce qu'il faut d'un arbre pour le proposer en bascule et compléter ce qu'il sert. */
export interface ServedTree extends TreeRef {
  name: string
  branch: string | null
  state: WorktreeState | 'root'
  ahead: number
  behind: number
  uncommitted: number
}

/** Ce qu'un service en marche sert : l'arbre de travail, fichiers non commités compris. */
export interface ServedVersion<T extends TreeRef = TreeRef> {
  /** L'identifiant de l'onglet Actions (`a-<id>`). */
  automationId: string
  /** L'identifiant de l'action, pour la relancer ailleurs. */
  actionId: string
  label: string
  ports: number[]
  href: string | null
  /** Le dossier de l'unité, sous-dossier compris ; null quand systemd ne l'a pas dit. */
  cwd: string | null
  /** L'arbre qui le contient ; null hors du projet ou s'il n'est plus listé. */
  tree: T | null
  root: boolean
  branch: string | null
  /** Le commit court ; null hors d'un dépôt. */
  commit: string | null
  /** Sur la base. Null quand ni le serveur ni l'arbre ne le savent. */
  ahead: number | null
  behind: number | null
  uncommitted: number | null
  /** Seul un service qui suit son lancement (`follow`) se bascule d'un arbre à l'autre. */
  switchable: boolean
}

/** Un service en marche ailleurs : ce qui sert à dire lequel et à ouvrir celui qui tourne. */
export interface RunningElsewhere {
  cwd: string
  worktreeId: string | null
  root: boolean
  branch: string | null
  ports: number[]
  href: string | null
}

/** Un service en marche qui sert un arbre : « ⚡ :5173 ». */
export interface ServedMark {
  /** L'identifiant de l'onglet Actions (`a-<id>`), pour ouvrir son détail. */
  automationId: string
  label: string
  /** Le premier port écouté ; null tant qu'il n'en écoute aucun. */
  port: number | null
}

export interface ServedIndex<T extends TreeRef = TreeRef> {
  byAutomation: Map<string, ServedVersion<T>>
  /** Les services qui servent un arbre, par clé d'arbre. */
  byTree: Map<string, ServedVersion<T>[]>
}

/** Les mesures d'un arbre complet, quand on les a. */
const measured = (tree: TreeRef | null): Partial<ServedTree> => (tree ?? {}) as Partial<ServedTree>

/** Ce que sert un service en marche ; null s'il est arrêté ou n'est pas un service. */
export function servedOf<T extends TreeRef>(item: Automation, trees: readonly T[]): ServedVersion<T> | null {
  if (item.live?.kind !== 'service' || item.source.kind !== 'action') return null
  const { action } = item.source
  const version = action.service?.served
  if (!version) return null
  const tree =
    (version.worktreeId
      ? trees.find((entry) => entry.id === version.worktreeId)
      : version.root
        ? trees.find((entry) => entry.root)
        : version.path
          ? trees.find((entry) => !entry.root && entry.path === version.path)
          : undefined) ?? null
  const known = measured(tree)
  return {
    automationId: item.id,
    actionId: action.id,
    label: item.label,
    ports: item.live.ports,
    href: item.live.href,
    cwd: action.service?.cwd ?? null,
    tree,
    root: version.root,
    branch: version.branch ?? known.branch ?? null,
    commit: version.head,
    // Le serveur mesure le dossier servi ; l'arbre de la page, à défaut.
    ahead: version.ahead ?? known.ahead ?? null,
    behind: version.behind ?? known.behind ?? null,
    uncommitted: version.dirtyFiles ?? known.uncommitted ?? null,
    switchable: action.placement === 'follow',
  }
}

/** Les services en marche, par action et par arbre servi. */
export function servedIndex<T extends TreeRef>(items: readonly Automation[], trees: readonly T[]): ServedIndex<T> {
  const byAutomation = new Map<string, ServedVersion<T>>()
  const byTree = new Map<string, ServedVersion<T>[]>()
  for (const item of items) {
    const served = servedOf(item, trees)
    if (!served) continue
    byAutomation.set(item.id, served)
    if (served.tree) byTree.set(served.tree.key, [...(byTree.get(served.tree.key) ?? []), served])
  }
  return { byAutomation, byTree }
}

/**
 * Les services en marche, rangés par l'arbre qu'ils servent (`projet.md` T-4.3, T-11.1) :
 * la marque « ⚡ :5173 » de Travail.
 */
export function servedByTree(items: readonly Automation[], trees: readonly TreeRef[]): Map<string, ServedMark[]> {
  const out = new Map<string, ServedMark[]>()
  for (const [key, list] of servedIndex(items, trees).byTree) {
    out.set(key, list.map((served) => ({ automationId: served.automationId, label: served.label, port: served.ports[0] ?? null })))
  }
  return out
}

/** Au-delà, le menu « Basculer sur » devient une liste à parcourir. */
const MAX_SWITCH_TARGETS = 8

/**
 * Où basculer un service (SRV-3) : les autres arbres, ni disparus ni fusionnés, dans
 * l'ordre de la page. Un lancement ne vise que la racine ou un worktree de Solera : un
 * arbre créé au shell n'est pas proposé.
 */
export function switchTargets<T extends ServedTree>(trees: readonly T[], served: Pick<ServedVersion, 'tree'>): T[] {
  return trees
    .filter((tree) => tree.key !== served.tree?.key && (tree.root || tree.id !== null) && tree.state !== 'missing' && tree.state !== 'merged')
    .slice(0, MAX_SWITCH_TARGETS)
}

/**
 * Le refus d'un service qui tourne depuis un autre arbre (409 `service_running_elsewhere`),
 * lu dans les paramètres de l'erreur ; null pour toute autre erreur.
 */
export function runningElsewhereOf(error: unknown): RunningElsewhere | null {
  if (!error || typeof error !== 'object') return null
  const { code, params } = error as { code?: unknown; params?: Record<string, string | number> }
  if (code !== 'service_running_elsewhere' || !params) return null
  // Des chaînes, comme tout `params` : vide quand le serveur ne savait pas.
  const text = (key: string) => (params[key] === undefined || params[key] === '' ? null : String(params[key]))
  return {
    cwd: text('cwd') ?? '',
    worktreeId: text('worktreeId'),
    root: text('root') === 'true',
    branch: text('branch'),
    ports: (text('ports') ?? '')
      .split(/\s+/)
      .map((entry) => Number(entry.replace(/^:/, '')))
      .filter((port) => Number.isInteger(port) && port > 0),
    href: text('href'),
  }
}

/** L'erreur à montrer : aucune quand c'est un service en marche ailleurs, que le dialogue dit. */
export function unlessElsewhere<E>(error: E | null): E | null {
  return error && !runningElsewhereOf(error) ? error : null
}

/** Une branche tient sur une ligne de tuile : 28 caractères au plus. */
export function shortBranch(branch: string): string {
  return branch.length > 28 ? `${branch.slice(0, 27)}…` : branch
}

/** « la racine (main) », la branche, ou « un dossier inconnu ». */
export function servedName(t: Translate, where: { root: boolean; branch: string | null }): string {
  if (where.root) return t('served.root', { branch: where.branch ?? '?' })
  return where.branch ?? t('served.unknown')
}
