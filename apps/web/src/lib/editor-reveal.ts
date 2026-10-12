import { useSyncExternalStore } from 'react'

/**
 * La ligne que l'éditeur doit montrer au prochain affichage d'un fichier.
 *
 * Un magasin plutôt qu'une prop d'`openTab` : la vue *Recherche* désigne une ligne
 * d'un fichier qui peut déjà être ouvert — l'éditeur n'est alors pas remonté, et rien
 * dans le chemin d'ouverture ne se déclencherait. Ici, le changement de jeton suffit à
 * refaire le geste, même deux fois sur la même ligne.
 */
interface Target {
  path: string
  line: number
  /** Incrémenté à chaque demande : cliquer deux fois la même ligne doit y revenir. */
  token: number
}

const byScope = new Map<string, Target>()
const listeners = new Set<() => void>()
let token = 0

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function revealLine(scope: string, path: string, line: number): void {
  token += 1
  byScope.set(scope, { path, line, token })
  for (const listener of listeners) listener()
}

/**
 * Oublie la demande une fois le défilement fait.
 *
 * Consommée par l'éditeur et pas à la lecture : lui seul sait qu'il a pu l'appliquer.
 * Sans ça, relire le fichier du disque ou y revenir par un onglet ramènerait à la
 * ligne d'une recherche qu'on a quittée depuis longtemps.
 */
export function clearReveal(scope: string): void {
  if (!byScope.delete(scope)) return
  for (const listener of listeners) listener()
}

/** La demande en cours pour ce fichier, ou `null`. */
export function useRevealTarget(scope: string, path: string): Target | null {
  const target = useSyncExternalStore(
    subscribe,
    () => byScope.get(scope) ?? null,
    () => null,
  )
  return target?.path === path ? target : null
}
