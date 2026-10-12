import { useSyncExternalStore } from 'react'

/**
 * Ce que la colonne de gauche montre : les lieux décrochables, et trois détails.
 *
 * Un magasin local plutôt qu'un réglage de compte, comme l'apparence : c'est une
 * préférence d'écran, et celui qui travaille sur deux postes n'a pas la même place sur
 * les deux. Rien ne se perd en le retirant — tout ce qui quitte la colonne reste
 * joignable par la palette, et c'est la règle écrite en tête de la section *Affichage*.
 *
 * *Fils* et *Projets* n'y sont pas : ils ne se décrochent pas. Un lieu qu'on peut
 * retirer suppose un autre chemin pour y revenir, et ces deux-là sont justement ce vers
 * quoi la palette renvoie.
 */

export type DisplayKey =
  | 'knowledge'
  | 'schedules'
  | 'skills'
  | 'services'
  | 'activity'
  | 'sessionAge'
  | 'projectDot'

/**
 * Tout est allumé au départ : un réglage d'affichage se découvre en retirant ce qu'on
 * ne veut pas, pas en devinant ce qui manque.
 */
const KEYS: Record<DisplayKey, string> = {
  knowledge: 'solera.display.knowledge',
  schedules: 'solera.display.schedules',
  skills: 'solera.display.skills',
  services: 'solera.display.services',
  activity: 'solera.display.activity',
  sessionAge: 'solera.display.sessionAge',
  projectDot: 'solera.display.projectDot',
}

const NAMES = Object.keys(KEYS) as DisplayKey[]

function read(name: DisplayKey): boolean {
  // Seul un « 0 » explicite éteint : une valeur absente vaut allumé, et une valeur
  // abîmée ne doit pas faire disparaître un lieu sans que personne l'ait demandé.
  return localStorage.getItem(KEYS[name]) !== '0'
}

let values = Object.fromEntries(NAMES.map((name) => [name, read(name)])) as Record<
  DisplayKey,
  boolean
>
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function currentDisplay(): Record<DisplayKey, boolean> {
  return values
}

export function setDisplay(name: DisplayKey, value: boolean): void {
  if (values[name] === value) return
  // Le défaut ne laisse rien derrière lui : revenir à l'état d'origine doit rendre le
  // stockage à ce qu'il était, sinon un défaut changé plus tard ne s'appliquerait pas.
  if (value) localStorage.removeItem(KEYS[name])
  else localStorage.setItem(KEYS[name], '0')
  values = { ...values, [name]: value }
  for (const listener of listeners) listener()
}

export function useDisplaySettings(): Record<DisplayKey, boolean> {
  return useSyncExternalStore(subscribe, currentDisplay, currentDisplay)
}
