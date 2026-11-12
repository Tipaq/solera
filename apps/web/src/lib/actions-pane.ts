import type { ActionSuggestion } from '@solera/protocol'
import type { EditorSeed } from './action-editor'
import type { ActionPanel } from './action-panel'
import { ACTIONS_VIEWS, type ActionsView } from './actions-tab'
import type { Automation, CommandKind, Section } from './automations'
import type { PanelTab } from './panel'
import type { SignalKind } from './signals'

/**
 * L'onglet Actions du panneau d'une conversation (`actions.md` §1.K, PACT-*) : ce que sa
 * Liste range, quand sa ligne d'outils montre la recherche, quand l'éditeur demande plus
 * de place, ce que propose son état vide. Pur : `components/panel/ActionsPane.tsx` le
 * rend, les tests le lisent seul. Le Lanceur reprend les groupes de l'onglet du projet
 * (`launcherGroupsOf`).
 */

/**
 * La vue retenue par projet (PACT-1) — Lanceur, Liste ou Agenda, les mêmes que l'onglet
 * du projet —, lue de `useStoredPref` : dans le navigateur et non dans l'adresse, qui
 * est celle de la conversation. Ce qui ne se lit pas retombe sur le Lanceur.
 */
export function readPaneView(raw: string | null): ActionsView {
  try {
    const value: unknown = raw === null ? null : JSON.parse(raw)
    return ACTIONS_VIEWS.find((view) => view === value) ?? ACTIONS_VIEWS[0]
  } catch {
    return ACTIONS_VIEWS[0]
  }
}

/** La Liste du panneau (PACT-4), sous les commandes lancées ici et les processus des sessions. */
export const PANE_SECTIONS: readonly Section[] = ['live', 'review', 'scheduled', 'demand']

/**
 * La seule section d'une action dans la Liste du panneau. Une commande qui tourne dans un
 * terminal n'est pas redite « en marche » : les commandes lancées ici la montrent déjà en
 * tête, et lancée ailleurs, elle reste à sa place, sa phrase d'état disant qu'elle tourne.
 */
export function paneSectionOf(item: Automation): Section {
  if (item.live && item.live.kind !== 'terminal') return 'live'
  if (item.review) return 'review'
  return item.schedule ? 'scheduled' : 'demand'
}

export function paneSectionsOf(items: readonly Automation[]): Record<Section, Automation[]> {
  const sections = Object.fromEntries(PANE_SECTIONS.map((key) => [key, [] as Automation[]])) as Record<Section, Automation[]>
  for (const item of items) sections[paneSectionOf(item)].push(item)
  return sections
}

/** En deçà, toutes les actions tiennent sous les yeux : la recherche serait un outil de trop. */
export const PANE_SEARCH_FROM = 8

export const paneShowsSearch = (count: number): boolean => count > PANE_SEARCH_FROM

/** En dessous, l'éditeur (cartes, phrase de planification, mini-calendrier) est à l'étroit. */
export const PANE_EDIT_MIN_WIDTH = 360

/**
 * « Agrandir le panneau » (PACT-9) : pendant une édition ou un choix, quand le panneau,
 * mesuré, fait moins de 360 px, et seulement s'il peut encore s'agrandir.
 */
export function paneOffersExpand(panel: ActionPanel | null, width: number, canExpand: boolean): boolean {
  if (!panel || panel.mode === 'detail' || panel.mode === 'run') return false
  return canExpand && width > 0 && width < PANE_EDIT_MIN_WIDTH
}

/** L'état vide (PACT-6) : trois suggestions du dépôt, pas une de plus. */
export const PANE_SUGGESTIONS = 3

export const paneSuggestions = (suggestions: readonly ActionSuggestion[] | undefined): ActionSuggestion[] =>
  (suggestions ?? []).slice(0, PANE_SUGGESTIONS)

/** Ce qu'une suggestion remplit, tel que `suggestionDraft` (`lib/actions.ts`) le traduit. */
export interface SuggestionDraft {
  label: string
  kind: CommandKind
  command: string
  subdir: string
  url: string
}

/** L'éditeur pré-rempli par une suggestion : sa nature, son libellé, sa commande, son dossier, son lien. */
export function suggestionSeed(draft: SuggestionDraft): EditorSeed {
  return {
    preset: { what: 'command', kind: draft.kind },
    prefill: { label: draft.label, command: draft.command, subdir: draft.subdir, url: draft.url },
  }
}

/** Les signaux du fil qui mènent au panneau ouvrent l'onglet qui les tient (PACT-10). */
export function signalTab(kind: SignalKind): PanelTab {
  return kind === 'background' ? 'actions' : 'agents'
}
