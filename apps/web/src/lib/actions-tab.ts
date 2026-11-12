import { actionPanelOf, detailPanel, type ActionPanel } from './action-panel'
import {
  LAUNCHER_GROUPS,
  SECTIONS,
  launcherGroupOf,
  matchesState,
  matchesWhen,
  sectionOf,
  showsSessionWorks,
  type Automation,
  type AutomationFilters,
  type LauncherGroup,
  type Section,
  type StateFilter,
  type What,
  type WhenFilter,
} from './automations'
import type { MessageKey } from './i18n'
import { NEW_PARAM } from './place'
import type { SessionWork } from './session-works'

/**
 * L'onglet Actions d'un projet (`actions.md` §1.B) : ce que sa barre compte et filtre, et
 * comment ses vues rangent les actions. Pur : `ProjectActionsPage` le rend, les tests le
 * lisent seul. Ce que dit une action (son état, sa section, son groupe) vient de
 * `lib/automations.ts`.
 */

/** Les vues, dans l'ordre d'« Affichage ▾ » ; la première est celle par défaut. */
export const ACTIONS_VIEWS = ['lanceur', 'liste', 'agenda'] as const
export type ActionsView = (typeof ACTIONS_VIEWS)[number]

/** Les entrées Quoi et Quand de « Filtrer ▾ », dans leur ordre, et leurs libellés : un projet et le portefeuille. */
export const WHAT_FILTERS: readonly What[] = ['command', 'agent']
export const WHEN_FILTERS: readonly WhenFilter[] = ['demand', 'scheduled']
export const WHAT_LABEL: Record<What, MessageKey> = { command: 'actionsTab.filter.what.command', agent: 'actionsTab.filter.what.agent' }
export const WHEN_LABEL: Record<WhenFilter, MessageKey> = { demand: 'actionsTab.filter.when.demand', scheduled: 'actionsTab.filter.when.scheduled' }

/** La méta de la barre (AO-4) : ce qui tourne, et ce qui attend une relecture. */
export interface ActionsStatus {
  running: number
  toReview: number
}

/**
 * Ce qui tourne : les actions en marche (service, commande dans un terminal, passage
 * d'agent) et ce que les sessions ont laissé tourner ; à relire : ce qu'un agent a écrit.
 */
export function actionsStatus(items: readonly Automation[], works: readonly SessionWork[]): ActionsStatus {
  return {
    running: items.filter((item) => item.live !== null).length + works.length,
    toReview: items.filter((item) => item.review !== null).length,
  }
}

/**
 * Le compte de l'onglet Actions, d'un projet comme du portefeuille (ACT-2) : ambre « N à
 * relire » d'abord, car une action à relire t'attend ; sinon vert « N en marche ». Rien
 * quand rien ne tourne ni n'attend. Le titre se dit avec `{ count }`.
 */
export function actionsTabBadge(status: ActionsStatus): { count: number; tone: 'caution' | 'running'; countTitle: MessageKey } | null {
  if (status.toReview > 0) return { count: status.toReview, tone: 'caution', countTitle: 'actionsTab.status.review' }
  if (status.running > 0) return { count: status.running, tone: 'running', countTitle: 'actionsTab.status.running' }
  return null
}

/** Le compte de chaque entrée de « Filtrer ▾ », sur toutes les actions et non les filtrées. */
export interface FilterTally {
  what: Record<What, number>
  when: Record<WhenFilter, number>
  state: Record<StateFilter, number>
}

export function filterTally(items: readonly Automation[]): FilterTally {
  const count = (test: (item: Automation) => boolean) => items.filter(test).length
  return {
    what: { command: count((item) => item.what === 'command'), agent: count((item) => item.what === 'agent') },
    when: { demand: count((item) => matchesWhen(item, 'demand')), scheduled: count((item) => matchesWhen(item, 'scheduled')) },
    state: {
      live: count((item) => matchesState(item, 'live')),
      review: count((item) => matchesState(item, 'review')),
      failing: count((item) => matchesState(item, 'failing')),
    },
  }
}

/** Coche ou décoche une entrée d'un groupe ; les autres groupes ne bougent pas. */
export function toggleFilter<F extends { [K in keyof F]: readonly string[] }, G extends keyof F>(filters: F, group: G, value: F[G][number]): F {
  const list = filters[group]
  const next = list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]
  return { ...filters, [group]: next }
}

function bucket<K extends string>(keys: readonly K[], items: readonly Automation[], keyOf: (item: Automation) => K): Record<K, Automation[]> {
  const groups = Object.fromEntries(keys.map((key) => [key, [] as Automation[]])) as Record<K, Automation[]>
  for (const item of items) groups[keyOf(item)].push(item)
  return groups
}

/** Le Lanceur (LAN-1) : services, commandes, agents ; chaque groupe existe, même vide. */
export const launcherGroupsOf = (items: readonly Automation[]): Record<LauncherGroup, Automation[]> =>
  bucket(LAUNCHER_GROUPS, items, launcherGroupOf)

/** La Liste (LST-1) : chaque action dans une seule section. */
export const sectionsOf = (items: readonly Automation[]): Record<Section, Automation[]> => bucket(SECTIONS, items, sectionOf)

/**
 * « Lancés par les sessions » sous la recherche et les filtres de l'onglet (AO-1, PRC-6) :
 * la recherche lit leur libellé humain, leur commande et le titre de leur session.
 */
export function worksShown(
  works: readonly SessionWork[],
  filters: AutomationFilters,
  query: string,
  labelOf: (work: SessionWork) => string,
): SessionWork[] {
  if (!showsSessionWorks(filters)) return []
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return [...works]
  return works.filter((work) =>
    [labelOf(work), work.command, work.conversationTitle].some((text) => text?.toLocaleLowerCase().includes(needle)),
  )
}

/* ------------------------------------------------------------------ l'adresse (AO-7) */

/** Le détail d'une action, par son identifiant d'onglet (`a-<id>`, `t-<id>`). */
export const ACTION_PARAM = 'action'

/** Ce que l'adresse dit du tiroir : `?action=` et `?nouvelle=`. */
export interface PanelAddress {
  action: string | null
  nouvelle: string | null
}

/**
 * Le tiroir qu'une adresse ouvre : `?action=` le détail (un lien de l'Aperçu, du
 * portefeuille, d'un `ServiceMark`), `?nouvelle=` l'éditeur pré-réglé ou le choix d'une
 * action à planifier. Le détail l'emporte.
 */
export function panelFromAddress(address: PanelAddress): ActionPanel | null {
  return address.action ? detailPanel(address.action) : actionPanelOf(address.nouvelle)
}

/**
 * L'adresse d'un tiroir, dans les deux sens : le détail écrit `?action=`, et le garde
 * quand on le modifie, le planifie ou suit son passage ; fermer retire les deux. Une
 * création ou un choix garde le `?nouvelle=` qui l'a ouvert, sans en écrire un.
 */
export function panelAddress(panel: ActionPanel | null, nouvelle: string | null): PanelAddress {
  if (panel === null) return { action: null, nouvelle: null }
  switch (panel.mode) {
    case 'detail':
      return { action: panel.id, nouvelle: null }
    case 'run':
      return { action: panel.back, nouvelle: null }
    case 'edit': {
      // L'édition d'une action qui existe la nomme ; une création garde ce qui l'a ouverte.
      const named = panel.back ?? panel.seed.from?.id ?? null
      return named ? { action: named, nouvelle: null } : { action: null, nouvelle }
    }
    case 'pick':
      return { action: null, nouvelle }
  }
}

/** L'adresse avec ces deux paramètres posés ou retirés ; le reste (`?vue=`) ne bouge pas. */
export function withAddress(params: URLSearchParams, address: PanelAddress): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const [key, value] of [[ACTION_PARAM, address.action], [NEW_PARAM, address.nouvelle]] as const) {
    if (value === null) next.delete(key)
    else next.set(key, value)
  }
  return next
}
