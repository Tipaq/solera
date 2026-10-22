import { useSyncExternalStore } from 'react'

/**
 * Onglets ouverts dans l'éditeur, par conversation.
 *
 * Hors de React parce que l'explorateur ouvre un onglet que l'éditeur affiche, et que
 * les deux sont dans des onglets de panneau distincts : passer par le parent ferait
 * remonter l'état à chaque frappe dans l'arborescence.
 *
 * Volontairement non persisté : un onglet renvoie à un fichier qui peut avoir disparu
 * entre deux sessions, et rouvrir une liste d'erreurs au démarrage vaut moins que de
 * repartir vide.
 */

interface Tabs {
  paths: string[]
  active: string | null
  /**
   * Onglet d'aperçu, celui qu'un clic simple vient d'ouvrir.
   *
   * Il n'y en a qu'un, et le prochain clic simple le remplace au lieu de s'ajouter :
   * sans lui, parcourir dix fichiers de l'arborescence laisse dix onglets derrière soi.
   * Il devient un onglet ordinaire dès qu'on montre qu'on le garde, en le double
   * cliquant ou en y écrivant.
   */
  preview: string | null
}

const EMPTY: Tabs = { paths: [], active: null, preview: null }

const byConversation = new Map<string, Tabs>()

/**
 * Les derniers onglets fermés, du plus ancien au plus récent.
 *
 * Fermer est le geste qu'on regrette : un `⌘W` de trop, ou un « tout fermer » lancé
 * sur la mauvaise barre. La pile est bornée parce qu'au-delà de quelques pas, on ne
 * sait plus ce qu'on rouvre — et parce qu'un chemin mémorisé peut désigner un fichier
 * que l'agent a supprimé entre-temps.
 */
const RECENTLY_CLOSED = 10
const closedByConversation = new Map<string, string[]>()

function remember(conversationId: string, paths: string[]): void {
  if (paths.length === 0) return
  const kept = [...(closedByConversation.get(conversationId) ?? []).filter((path) => !paths.includes(path)), ...paths]
  closedByConversation.set(conversationId, kept.slice(-RECENTLY_CLOSED))
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useEditorTabs(conversationId: string): Tabs {
  return useSyncExternalStore(
    subscribe,
    () => byConversation.get(conversationId) ?? EMPTY,
    () => EMPTY,
  )
}

/**
 * Ouvre un fichier, ou l'active s'il est déjà là.
 *
 * `preview` désigne une ouverture de parcours, celle du clic simple dans
 * l'arborescence. Une ouverture demandée explicitement, elle, garde sa place.
 */
export function openTab(
  conversationId: string,
  path: string,
  { preview = false }: { preview?: boolean } = {},
): void {
  const current = byConversation.get(conversationId) ?? EMPTY

  if (current.paths.includes(path)) {
    byConversation.set(conversationId, {
      ...current,
      active: path,
      // Rouvrir explicitement ce qui n'était qu'un aperçu, c'est décider de le garder.
      preview: !preview && current.preview === path ? null : current.preview,
    })
    emit()
    return
  }

  // L'aperçu se remplace à sa place plutôt qu'en fin de barre : les onglets ouverts
  // avant lui ne doivent pas se déplacer à chaque fichier survolé.
  const replacing = preview && current.preview !== null ? current.paths.indexOf(current.preview) : -1
  const paths = [...current.paths]
  if (replacing === -1) paths.push(path)
  else paths[replacing] = path

  byConversation.set(conversationId, {
    paths,
    active: path,
    preview: preview ? path : current.preview,
  })
  emit()
}

/** Fait d'un aperçu un onglet ordinaire : le suivant ne le remplacera plus. */
export function pinTab(conversationId: string, path: string): void {
  const current = byConversation.get(conversationId) ?? EMPTY
  if (current.preview !== path) return
  byConversation.set(conversationId, { ...current, preview: null })
  emit()
}

export function activateTab(conversationId: string, path: string): void {
  const current = byConversation.get(conversationId) ?? EMPTY
  if (current.active === path) return
  byConversation.set(conversationId, { ...current, active: path })
  emit()
}

/**
 * Déplace un onglet à une position donnée.
 *
 * L'ordre est celui d'ouverture par défaut, ce qui ne dit rien de l'usage : on
 * regroupe volontiers ce qui va ensemble.
 */
export function reorderTabs(conversationId: string, from: string, toIndex: number): void {
  const current = byConversation.get(conversationId) ?? EMPTY
  const fromIndex = current.paths.indexOf(from)
  if (fromIndex === -1 || fromIndex === toIndex) return

  const paths = current.paths.filter((entry) => entry !== from)
  paths.splice(Math.max(0, Math.min(toIndex, paths.length)), 0, from)
  byConversation.set(conversationId, { ...current, paths })
  emit()
}

/** Ferme tout sauf le chemin donné, ou tout si aucun n'est donné. */
export function closeOtherTabs(conversationId: string, keep: string | null): void {
  const current = byConversation.get(conversationId) ?? EMPTY
  const paths = keep === null ? [] : [keep]
  remember(conversationId, current.paths.filter((path) => path !== keep))
  byConversation.set(conversationId, {
    paths,
    active: keep,
    preview: current.preview === keep ? keep : null,
  })
  emit()
}

export function closeTab(conversationId: string, path: string): void {
  const current = byConversation.get(conversationId) ?? EMPTY
  const index = current.paths.indexOf(path)
  if (index === -1) return

  remember(conversationId, [path])
  const paths = current.paths.filter((entry) => entry !== path)
  byConversation.set(conversationId, {
    paths,
    // Fermer l'onglet actif passe au voisin de droite, puis de gauche : c'est ce que
    // fait un navigateur, et revenir au premier onglet perdrait le fil de la lecture.
    active:
      current.active === path ? (paths[index] ?? paths[index - 1] ?? null) : current.active,
    preview: current.preview === path ? null : current.preview,
  })
  emit()
}

/**
 * Ferme les onglets qui n'ont rien à perdre.
 *
 * Les brouillons restent : ce sont les seuls dont la fermeture coûte quelque chose, et
 * c'est exactement la raison pour laquelle on lance ce geste plutôt que « tout
 * fermer ». L'éditeur passe la liste parce que les brouillons vivent dans son magasin,
 * par utilisateur, et que celui-ci n'en sait rien.
 */
export function closeSavedTabs(conversationId: string, dirtyPaths: string[]): void {
  const current = byConversation.get(conversationId) ?? EMPTY
  const paths = current.paths.filter((path) => dirtyPaths.includes(path))
  if (paths.length === current.paths.length) return

  remember(conversationId, current.paths.filter((path) => !dirtyPaths.includes(path)))
  byConversation.set(conversationId, {
    paths,
    active: current.active && paths.includes(current.active) ? current.active : (paths[0] ?? null),
    preview: current.preview && paths.includes(current.preview) ? current.preview : null,
  })
  emit()
}

/** Rouvre le dernier onglet fermé, et rend son chemin. */
export function reopenLastClosedTab(conversationId: string): string | null {
  const closed = closedByConversation.get(conversationId) ?? []
  const path = closed.at(-1)
  if (!path) return null

  closedByConversation.set(conversationId, closed.slice(0, -1))
  openTab(conversationId, path)
  return path
}

/** Vrai s'il reste quelque chose à rouvrir : l'entrée de menu se grise sinon. */
export function useHasClosedTabs(conversationId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (closedByConversation.get(conversationId) ?? []).length > 0,
    () => false,
  )
}

/**
 * Reporte un renommage ou un déplacement fait dans l'explorateur : l'onglet suit son
 * fichier, dossier parent compris, au lieu de rester sur un chemin qui n'existe plus.
 */
export function moveTabs(conversationId: string, from: string, to: string): void {
  const current = byConversation.get(conversationId)
  const move = (path: string) =>
    path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
  if (!current?.paths.some((path) => move(path) !== path)) return

  byConversation.set(conversationId, {
    paths: current.paths.map(move),
    active: current.active === null ? null : move(current.active),
    preview: current.preview === null ? null : move(current.preview),
  })
  emit()
}
