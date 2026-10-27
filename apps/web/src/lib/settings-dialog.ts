import { useSyncExternalStore } from 'react'
import type { AgentKind } from '@solera/protocol'

/**
 * Ouverture des réglages, partagée hors de React.
 *
 * Les réglages étaient une route avec sa propre colonne de 14 rem, ce qui faisait deux
 * colonnes gauche côte à côte dès qu'on les ouvrait. Ce sont maintenant une modale, et
 * une modale ne s'ouvre pas en naviguant : le menu du compte, un lien dans une phrase
 * d'explication ou la palette la demandent depuis n'importe quelle branche de l'arbre.
 * Un magasin plutôt qu'un contexte, comme pour la sidebar et le thème.
 *
 * Aucune section n'est ouverte quand la modale est fermée : `section` ne vaut que
 * pendant l'ouverture, et rouvrir sans préciser retombe sur la première.
 */

export type SettingsSectionId =
  | 'compte'
  | 'apparence'
  | 'affichage'
  | 'notifications'
  | 'dictee'
  | 'permissions'
  | 'agents'
  | 'mcp'
  | 'consignes'
  | 'skills'
  | 'sessions'
  | 'git'
  | 'secrets'
  | 'api'
  | 'savoir'
  | 'archivage'
  | 'comptes'
  | 'a-propos'

export const FIRST_SECTION: SettingsSectionId = 'compte'

/**
 * Les adresses d'avant : « Défauts des CLI » devenue « Modèles par défaut », les trois
 * pages de comptes réunies en « Abonnements » (#120), puis ces deux sections fondues en
 * une seule, « Agents », un onglet par CLI. Un lien gardé quelque part doit continuer à
 * mener au bon endroit, et au bon onglet quand l'adresse le disait.
 */
export const LEGACY_SETTINGS_SECTIONS: Record<string, { section: SettingsSectionId; agent?: AgentKind }> = {
  cli: { section: 'agents' },
  modeles: { section: 'agents' },
  abonnements: { section: 'agents' },
  'comptes-claude': { section: 'agents', agent: 'claude' },
  'comptes-codex': { section: 'agents', agent: 'codex' },
  'comptes-grok': { section: 'agents', agent: 'grok' },
}

interface State {
  open: boolean
  /** Null au téléphone : la liste est alors la page, et rien n'est encore choisi. */
  section: SettingsSectionId | null
  /** L'onglet d'« Agents » à montrer d'abord, quand l'appelant le dit. */
  agent?: AgentKind
}

let state: State = { open: false, section: null }
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSettingsDialog(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  )
}

/**
 * Sans section, la modale s'ouvre sur sa liste — la première au large. `agent` choisit
 * l'onglet de la section « Agents » : `openSettings('agents', 'codex')`.
 */
export function openSettings(section: SettingsSectionId | null = null, agent?: AgentKind): void {
  state = { open: true, section, agent }
  emit()
}

export function showSettingsSection(section: SettingsSectionId | null): void {
  if (!state.open) return
  state = { ...state, section }
  emit()
}

export function closeSettings(): void {
  if (!state.open) return
  state = { open: false, section: null }
  emit()
}
