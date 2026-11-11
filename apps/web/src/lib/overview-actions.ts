import { ago, liveText, primaryGestureOf, reviewReason, sectionOf, type Automation, type Translate } from './automations'

/**
 * Le bloc « Actions » de l'Aperçu (`projet.md` A-5) : ce qui **tourne** ou **attend**
 * seulement — services en marche, commandes en cours dans un terminal, passages d'agent,
 * actions à relire. Le reste est compté « au repos » : l'onglet Actions tient tout.
 *
 * Pur : le texte passe par le `t` de l'appelant, l'heure par `now`.
 */

/** L'onglet Actions du projet, ou le détail d'une action (`?action=`, AO-7). */
export function actionsTabPath(projectId: string, automationId?: string): string {
  const base = `/p/${projectId}/actions`
  return automationId ? `${base}?action=${encodeURIComponent(automationId)}` : base
}

export interface ActionsDigest {
  /** Ce qui tourne d'abord, puis ce qui attend une relecture : l'ordre de l'onglet. */
  shown: Automation[]
  /** Les autres, au repos. */
  idle: number
  total: number
}

export function overviewActionsOf(items: readonly Automation[]): ActionsDigest {
  const live = items.filter((item) => sectionOf(item) === 'live')
  const review = items.filter((item) => sectionOf(item) === 'review')
  const shown = [...live, ...review]
  return { shown, idle: items.length - shown.length, total: items.length }
}

/** Le geste au bout d'une ligne : où il mène. */
export type OverviewGesture =
  /** « Ouvrir ↗ » : l'adresse du service, dans un nouvel onglet. */
  | { kind: 'open'; href: string }
  /** « Relire » : le détail de l'action, dans l'onglet Actions. */
  | { kind: 'review'; to: string }
  /** « Panneau » : le terminal où la commande tourne. */
  | { kind: 'terminal'; terminalId: string }
  /** « Session ↗ » : la session d'un passage d'agent. */
  | { kind: 'session'; conversationId: string }
  /** « Voir » : le détail, faute de mieux. */
  | { kind: 'detail'; to: string }

export interface OverviewLine {
  /** Le point : vert qui pulse, ou ambre à relire. */
  tone: 'live' | 'review'
  detail: string
  gesture: OverviewGesture
}

/**
 * Une ligne du bloc : son point, ce qui tourne ou pourquoi relire, et son geste (A-5.2).
 * Le geste suit le geste principal de l'action (`primaryGestureOf`, LAN-7), en lien : un
 * service mène à son adresse, une commande à son terminal, un passage à sa session.
 */
export function overviewLine(item: Automation, projectId: string, now: number, t: Translate): OverviewLine {
  const detailPath = actionsTabPath(projectId, item.id)
  const { live } = item
  switch (primaryGestureOf(item)) {
    case 'review':
      return {
        tone: 'review',
        detail: t('project.overview.actions.review', { reason: reviewReason(item.review!, t) }),
        gesture: { kind: 'review', to: detailPath },
      }
    case 'terminal':
      if (live?.kind === 'terminal') {
        return {
          tone: 'live',
          detail: t('project.overview.actions.terminal', { ago: ago(live.since, now, t) }),
          gesture: { kind: 'terminal', terminalId: live.terminalId },
        }
      }
      break
    case 'switch':
      if (live?.kind === 'service' && live.href) {
        return { tone: 'live', detail: liveText(item, now, t) ?? '', gesture: { kind: 'open', href: live.href } }
      }
      break
    case 'session':
      if (live?.kind === 'run' && live.conversationId) {
        return { tone: 'live', detail: liveText(item, now, t) ?? '', gesture: { kind: 'session', conversationId: live.conversationId } }
      }
      break
    case 'launch':
      break
  }
  return { tone: 'live', detail: liveText(item, now, t) ?? '', gesture: { kind: 'detail', to: detailPath } }
}
