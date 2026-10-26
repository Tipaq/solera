import { useSyncExternalStore } from 'react'

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
  | 'modeles'
  | 'abonnements'
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

/** Les CLI qui ont des abonnements à emprunter, l'onglet ouvert dans « Abonnements ». */
export type SubscriptionAgent = 'claude' | 'codex' | 'grok'

/**
 * Les adresses d'avant la refonte des réglages (#120) : « Défauts des CLI » est devenue
 * « Modèles par défaut », et les trois pages de comptes se sont réunies en « Abonnements ».
 * Un lien gardé quelque part doit continuer à mener au bon endroit.
 */
export const LEGACY_SETTINGS_SECTIONS: Record<string, { section: SettingsSectionId; subscription?: SubscriptionAgent }> = {
  cli: { section: 'modeles' },
  'comptes-claude': { section: 'abonnements', subscription: 'claude' },
  'comptes-codex': { section: 'abonnements', subscription: 'codex' },
  'comptes-grok': { section: 'abonnements', subscription: 'grok' },
}

interface State {
  open: boolean
  /** Null au téléphone : la liste est alors la page, et rien n'est encore choisi. */
  section: SettingsSectionId | null
  /** L'onglet d'« Abonnements » à montrer d'abord, quand une adresse le dit. */
  subscription?: SubscriptionAgent
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

/** Sans section, la modale s'ouvre sur sa liste — la première au large. */
export function openSettings(section: SettingsSectionId | null = null, subscription?: SubscriptionAgent): void {
  state = { open: true, section, subscription }
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
