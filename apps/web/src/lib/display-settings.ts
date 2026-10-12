import { useSyncExternalStore } from 'react'

/**
 * Le réglage *Affichage* : quels lieux apparaissent dans la colonne, et trois détails
 * de ses lignes.
 *
 * **Ce fichier est un doublon volontaire.** Le vrai vient de la carte #13 (branche
 * `port/reglages-palette`), qui porte la modale des réglages et écrit ces mêmes clés ;
 * il n'existe pas encore dans cette branche, et la colonne ne peut pas importer ce qui
 * n'est pas là. À la fusion, **garder sa version** : l'API est identique, les appelants
 * de la colonne continuent de marcher tels quels.
 *
 * La règle qui justifie des interrupteurs plutôt qu'une colonne figée : ce qu'on retire
 * reste joignable par la palette. *Fils* et *Projets* ne se décrochent pas.
 */
export interface DisplaySettings {
  /** Le lieu *Savoir*. */
  knowledge: boolean
  /** Le lieu *Planifiées*. */
  schedules: boolean
  skills: boolean
  /** L'entrée *Services* du menu du compte. */
  services: boolean
  /** Le bloc d'activité, entre les lieux et la zone basse. */
  activity: boolean
  /** L'ancienneté à droite d'une ligne d'activité. */
  sessionAge: boolean
  /** La puce de couleur du projet sur une ligne de fil. */
  projectDot: boolean
}

const DEFAULTS: DisplaySettings = {
  knowledge: true,
  schedules: true,
  skills: true,
  services: true,
  activity: true,
  sessionAge: true,
  projectDot: true,
}

const KEY = 'solera.display'
const listeners = new Set<() => void>()

let current: DisplaySettings = (() => {
  try {
    const stored = localStorage.getItem(KEY)
    return stored ? { ...DEFAULTS, ...(JSON.parse(stored) as Partial<DisplaySettings>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
})()

export function useDisplaySettings(): DisplaySettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
    () => DEFAULTS,
  )
}

export function setDisplaySettings(patch: Partial<DisplaySettings>): void {
  current = { ...current, ...patch }
  localStorage.setItem(KEY, JSON.stringify(current))
  for (const listener of listeners) listener()
}
