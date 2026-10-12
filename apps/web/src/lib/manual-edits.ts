import { useSyncExternalStore } from 'react'

/**
 * Les fichiers que *tu* as enregistrés toi-même, et quand.
 *
 * Sert à une seule chose : la section « Ses écritures » du panneau marque les fichiers
 * que l'agent a écrits puis que l'utilisateur a repris à la main. Sans cette marque,
 * la liste laisse croire que le dernier état du fichier est celui de l'agent, alors
 * qu'il a été corrigé derrière lui — c'est exactement le cas où revenir sur la liste
 * sert à quelque chose.
 *
 * En mémoire et non journalisé : une écriture de l'éditeur n'est pas un événement de
 * conversation (invariant I2), et la marque n'a de sens que tant qu'on regarde les
 * écritures du tour qu'on vient de vivre. Elle disparaît au rechargement, comme la
 * raison de la regarder.
 */
const saved = new Map<string, number>()
/** Un compteur et non la taille de la carte : réenregistrer un fichier déjà listé ne
 *  la fait pas grandir, et l'instantané ne changerait donc pas. */
let version = 0
const listeners = new Set<() => void>()

function keyOf(scope: string, path: string): string {
  return `${scope}\u0000${path}`
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Appelé par l'éditeur à chaque enregistrement réussi, et nulle part ailleurs. */
export function recordManualSave(scope: string, path: string): void {
  saved.set(keyOf(scope, path), Date.now())
  version += 1
  for (const listener of listeners) listener()
}

/**
 * Date du dernier enregistrement à la main, ou `null`.
 *
 * Rend un nombre et non un booléen : c'est la comparaison avec la dernière passe de
 * l'agent qui dit « réécrit **après** lui », et une reprise antérieure n'apprend rien.
 */
export function useManualSaves(scope: string): (path: string) => number | null {
  // L'instantané ne sert qu'à redemander un rendu : la fonction lit la carte à l'appel.
  void useSyncExternalStore(
    subscribe,
    () => version,
    () => 0,
  )
  return (path) => saved.get(keyOf(scope, path)) ?? null
}
