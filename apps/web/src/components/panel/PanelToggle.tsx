import { PanelRight } from 'lucide-react'
import { IconButton, cx } from '@solera/ui'
import { actionsTabBadge, type ActionsStatus } from '../../lib/actions-tab'
import { useActionsStatus } from '../../lib/automations-query'
import { useTranslate } from '../../lib/i18n'
import { setPanelOpen } from '../../lib/panel'

const DOT = { caution: 'bg-caution', running: 'bg-positive' } as const

/**
 * Le bouton du panneau d'une conversation, tout à droite de sa bande (ACT-3). Il reprend
 * ce que disait le ⚡ retiré : un point ambre quand une action attend sa relecture, sinon
 * vert quand quelque chose tourne dans le projet ; son nom le dit en toutes lettres.
 */
export function PanelToggle({ open, status }: { open: boolean; status: ActionsStatus | null }) {
  const t = useTranslate()
  const badge = status ? actionsTabBadge(status) : null
  const label = open ? t('conversation.panel.close') : t('conversation.panel.open')
  const said = status
    ? [
        status.running > 0 ? t('actionsTab.status.running', { count: status.running }) : null,
        status.toReview > 0 ? t('actionsTab.status.review', { count: status.toReview }) : null,
      ].filter((part) => part !== null)
    : []
  return (
    <span className="relative inline-flex shrink-0">
      <IconButton
        label={said.length > 0 ? t('conversation.panel.withStatus', { label, status: said.join(' · ') }) : label}
        onClick={() => setPanelOpen(!open)}
      >
        <PanelRight size={16} className={cx(open && 'text-accent')} />
      </IconButton>
      {badge ? (
        <span
          aria-hidden
          data-panel-dot={badge.tone}
          className={cx('pointer-events-none absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ring-canvas', DOT[badge.tone])}
        />
      ) : null}
    </span>
  )
}

/** Le même, qui lit l'état des actions de son projet. */
export function ProjectPanelToggle({ projectId, open }: { projectId: string; open: boolean }) {
  return <PanelToggle open={open} status={useActionsStatus(projectId)} />
}
