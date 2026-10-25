import { useSyncExternalStore } from 'react'
import type { MessageKey } from './i18n'

/**
 * La présentation des outils dans le fil, choisie dans Apparence.
 *
 * Six façons de lire la même suite d'appels, toutes à la même densité : une origine
 * MCP ou un appel en cours n'ajoute jamais de ligne. `inline`, le défaut, garde des
 * lignes discrètes ; les autres mettent en avant la chronologie (`timeline`), ce que
 * fait chaque appel (`intent`), un aperçu de la sortie (`cards`), une lecture de
 * terminal (`console`), ou l'encadré d'avant (`classic`).
 */
export const TOOL_STYLES = ['inline', 'timeline', 'intent', 'cards', 'console', 'classic'] as const
export type ToolStyle = (typeof TOOL_STYLES)[number]
export const DEFAULT_TOOL_STYLE: ToolStyle = 'inline'

export const TOOL_STYLE_LABELS: Record<ToolStyle, MessageKey> = {
  inline: 'toolStyle.inline',
  timeline: 'toolStyle.timeline',
  intent: 'toolStyle.intent',
  cards: 'toolStyle.cards',
  console: 'toolStyle.console',
  classic: 'toolStyle.classic',
}

export const TOOL_STYLE_HINTS: Record<ToolStyle, MessageKey> = {
  inline: 'toolStyle.inline.hint',
  timeline: 'toolStyle.timeline.hint',
  intent: 'toolStyle.intent.hint',
  cards: 'toolStyle.cards.hint',
  console: 'toolStyle.console.hint',
  classic: 'toolStyle.classic.hint',
}

const STORAGE_KEY = 'solera.toolStyle'

/** Une valeur inconnue, d'un compte plus ancien ou d'un style retiré, retrouve le défaut. */
export function resolveToolStyle(value: unknown): ToolStyle {
  return TOOL_STYLES.includes(value as ToolStyle) ? (value as ToolStyle) : DEFAULT_TOOL_STYLE
}

let current = resolveToolStyle(typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY))
const listeners = new Set<() => void>()

export function currentToolStyle(): ToolStyle {
  return current
}

export function subscribeToolStyle(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function applyToolStyle(next: ToolStyle): void {
  if (next === DEFAULT_TOOL_STYLE) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, next)
  current = next
  for (const listener of listeners) listener()
}

export function useToolStyle(): [ToolStyle, (next: ToolStyle) => void] {
  return [useSyncExternalStore(subscribeToolStyle, currentToolStyle, () => DEFAULT_TOOL_STYLE), applyToolStyle]
}
