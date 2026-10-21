import { useQuery } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type { WebPageDto } from '@solera/protocol'
import { api } from './api'
import { setPanelOpen, setPanelTab } from './panel'

/**
 * La vue *Web* du panneau : la page ouverte, son historique et son mode, par portée.
 *
 * Deux modes, parce qu'aucun ne suffit seul. *Lecture* : le serveur lit la page et en
 * rend le texte — ça marche sur presque tout, mais pas sur une application. *Direct* :
 * un cadre — la vraie page, mais la plupart des sites refusent d'y être affichés. Les
 * aperçus locaux, eux, l'acceptent et n'ont rien d'un article : ils partent en direct.
 *
 * Hors de React comme les onglets de l'éditeur : c'est le fil qui ouvre une page, et le
 * panneau qui la montre. Non persisté, pour la même raison qu'eux.
 */

export type WebMode = 'reader' | 'live'

interface WebState {
  history: string[]
  index: number
  mode: WebMode
}

const byScope = new Map<string, WebState>()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Un aperçu qui tourne sur la machine : c'est une application, pas un article. */
export function isLocal(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1'
      || hostname === '[::1]' || hostname.endsWith('.ts.net') || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(hostname)
  } catch {
    return false
  }
}

/** Un Storybook de design system, relayé par Solera sous `/ds/<jeton>/` (carte #63). */
export function isRelayed(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/ds/')
  } catch {
    return false
  }
}

/** Ce que l'on tape dans la barre devient une adresse : le schéma manquant est https. */
export function normalizeAddress(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `${isLocal(`http://${value}`) ? 'http' : 'https'}://${value}`
  try {
    const url = new URL(withScheme)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function useWebPane(scope: string): WebState | null {
  return useSyncExternalStore(subscribe, () => byScope.get(scope) ?? null, () => null)
}

/**
 * Va à une adresse dans la vue : l'historique en avant est oublié, comme ailleurs.
 *
 * Le mode suit qui navigue. Un lien suivi dans la vue garde celui qu'on y a choisi —
 * lire un article puis basculer en direct à son premier lien serait une surprise.
 * Une page ouverte depuis le fil (`fresh`) le choisit d'après son adresse.
 */
export function navigateWeb(scope: string, url: string, fresh = false): void {
  const current = byScope.get(scope)
  const history = current ? [...current.history.slice(0, current.index + 1), url] : [url]
  byScope.set(scope, {
    history,
    index: history.length - 1,
    mode: fresh || !current ? (isLocal(url) || isRelayed(url) ? 'live' : 'reader') : current.mode,
  })
  emit()
}

/** Ouvre une page dans le panneau, depuis le fil ou une carte d'outil. */
export function openWebPage(scope: string, url: string): void {
  navigateWeb(scope, url, true)
  setPanelTab('web')
  setPanelOpen(true)
}

export function stepWeb(scope: string, delta: -1 | 1): void {
  const current = byScope.get(scope)
  if (!current) return
  const index = current.index + delta
  if (index < 0 || index >= current.history.length) return
  byScope.set(scope, { ...current, index })
  emit()
}

export function setWebMode(scope: string, mode: WebMode): void {
  const current = byScope.get(scope)
  if (!current || current.mode === mode) return
  byScope.set(scope, { ...current, mode })
  emit()
}

/** Ferme la page : l'onglet disparaît avec elle. */
export function closeWeb(scope: string): void {
  if (!byScope.delete(scope)) return
  setPanelTab('files')
  emit()
}

/**
 * La page ouverte, lue par le serveur. En *Direct*, seuls ses en-têtes : le cadre veut
 * savoir s'il s'affichera, et l'extraction de l'article coûterait pour rien.
 */
export function useWebPage(url: string | null, mode: WebMode) {
  const frame = mode === 'live'
  return useQuery({
    queryKey: ['web-page', url, frame ? 'frame' : 'reader'],
    queryFn: () => api.get<WebPageDto>(`/api/web/read?url=${encodeURIComponent(url ?? '')}${frame ? '&frame=1' : ''}`),
    // Un Storybook relayé est encadrable par construction, et le serveur ne saurait
    // pas joindre l'origine publique de Solera pour le vérifier.
    enabled: url !== null && !(frame && isRelayed(url)),
    staleTime: 5 * 60_000,
    retry: false,
  })
}
