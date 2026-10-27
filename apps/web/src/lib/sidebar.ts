import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * État de la navigation latérale, partagé hors de React.
 *
 * Le repli est lu par la coque, qui le referme, et par les vues qui ont un en-tête :
 * le bouton de réaffichage se pose par-dessus leur coin haut-gauche, et sans place
 * réservée il recouvrirait leur contenu. Un magasin plutôt qu'un contexte, comme pour
 * le thème : ces vues ne sont pas dans la même branche que la sidebar.
 */

const HIDDEN_KEY = 'solera.sidebarHidden'
const WIDTH_KEY = 'solera.sidebarWidth'

/**
 * En deçà, un titre de conversation ne tient plus sur une ligne utile ; au-delà, la
 * navigation prend plus de place que ce qu'elle sert à atteindre.
 */
const MIN_WIDTH = 200
const MAX_WIDTH = 480

let hidden = localStorage.getItem(HIDDEN_KEY) === '1'
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSidebarHidden(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => hidden,
    () => false,
  )
}

export function setSidebarHidden(next: boolean): void {
  if (next === hidden) return
  hidden = next
  localStorage.setItem(HIDDEN_KEY, next ? '1' : '0')
  for (const listener of listeners) listener()
}

/**
 * Largeur sur grand écran, publiée en variable CSS plutôt que remontée en état React.
 *
 * Le glissement émet un événement par image : re-rendre la coque et toute la liste des
 * conversations à chacun rendrait la poignée pâteuse. `persist` n'est vrai qu'en fin de
 * geste, une écriture par image dans `localStorage` étant synchrone.
 *
 * Posée sur la sidebar elle-même et non sur `:root` : elle seule la lit (sa largeur et
 * la marge de son repli). Une variable réécrite à la racine fait recalculer les styles
 * du document entier, fil compris, à chaque image du glissement.
 *
 * Renvoie la largeur réellement retenue, bornes appliquées.
 */
export function setSidebarWidth(sidebar: HTMLElement, px: number, persist: boolean): number {
  const width = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, px)))
  sidebar.style.setProperty('--sidebar-desktop-width', `${width}px`)
  if (persist) localStorage.setItem(WIDTH_KEY, String(width))
  return width
}

/**
 * Rétablit la largeur choisie. Sans valeur enregistrée, rien n'est écrit : la largeur
 * par défaut reste celle de la feuille de style, au lieu d'en exister une seconde ici.
 */
export function restoreSidebarWidth(sidebar: HTMLElement): void {
  const stored = Number(localStorage.getItem(WIDTH_KEY))
  if (Number.isFinite(stored) && stored > 0) setSidebarWidth(sidebar, stored, false)
}

/**
 * Les lieux de la colonne : Fils, Projets, Savoir, Planifiées.
 *
 * Une liste verticale et non une rangée d'onglets — trois tiennent dans 17 rem, pas
 * quatre, et il en viendra d'autres (`Planifiées` n'existait pas au premier tour).
 */
export const PLACES = ['threads', 'projects', 'knowledge', 'planned'] as const
export type Place = (typeof PLACES)[number]

/**
 * Le lieu dont relève une adresse, ou `null` si elle ne tranche pas.
 *
 * `null` pour les réglages, les services, l'accueil : ce sont des passages, pas des
 * lieux, et y aller ne doit pas défaire la colonne qu'on retrouvera en revenant.
 */
export function placeOfPath(pathname: string): Place | null {
  if (pathname.startsWith('/vault')) return 'knowledge'
  if (pathname.startsWith('/schedules')) return 'planned'
  if (pathname.startsWith('/p/') || pathname.startsWith('/projects')) return 'projects'
  if (pathname.startsWith('/c/')) return 'threads'
  return null
}

/**
 * Le lieu affiché, **dérivé de ce qui est ouvert au centre**.
 *
 * C'est l'inverse de la règle du quinzième tour, qui en faisait un réglage retenu par
 * le compte et indépendant de l'adresse. Elle tenait tant qu'on entrait dans une
 * conversation par la colonne ; elle casse dès qu'on y entre autrement — par
 * l'activité, par la recherche, par une session qu'un agent vient de lancer. On se
 * retrouvait alors à lire une conversation de projet avec la colonne restée sur
 * *Savoir*, sans son projet déplié ni sa ligne désignée. Deux états disaient où l'on
 * est ; il n'en reste qu'un.
 *
 * L'exception reste possible, et ne survit pas à la navigation suivante :
 *
 * - `override` est posé en cliquant un lieu. Il sert surtout à *Fils*, le seul lieu
 *   sans page : sans lui, le clic serait défait dans la foulée par la dérivation.
 * - Il est effacé au premier changement d'adresse — autrement dit dès qu'on ouvre autre
 *   chose. Ce qu'on regarde commande à nouveau.
 */
let anchor = window.location.pathname
let derived: Place = placeOfPath(anchor) ?? 'threads'
let override: Place | null = null

/** Appelé par la colonne à chaque navigation ; c'est la seule écriture de `anchor`. */
function followRoute(pathname: string): void {
  if (pathname === anchor) return
  anchor = pathname
  override = null
  const next = placeOfPath(pathname)
  if (next) derived = next
  for (const listener of listeners) listener()
}

export function useSidebarPlace(): Place {
  const { pathname } = useLocation()
  // Dans un effet et non pendant le rendu : la dérivation prévient des abonnés hors de
  // React, et une notification émise en plein rendu est une écriture pendant le rendu.
  // Le décalage ne dure qu'une image, celle de la navigation elle-même.
  useEffect(() => followRoute(pathname), [pathname])
  return useSyncExternalStore(
    subscribe,
    () => override ?? derived,
    () => 'threads' as Place,
  )
}

/**
 * Le clic sur un lieu. Sans effet si l'adresse dit déjà ce lieu — le choix n'aurait
 * rien à corriger, et un `override` posé pour rien survivrait à la navigation d'après.
 */
export function setSidebarPlace(next: Place): void {
  const value = next === derived ? null : next
  if (value === override) return
  override = value
  for (const listener of listeners) listener()
}
