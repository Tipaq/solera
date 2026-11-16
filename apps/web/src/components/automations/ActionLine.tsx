import { ArrowUpRight, Play, SquareTerminal } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx, panelRowClass } from '@solera/ui'
import { actionState, natureOf, primaryGestureOf, type Automation } from '../../lib/automations'
import { conversationPath } from '../../lib/conversation-route'
import { useTranslate } from '../../lib/i18n'
import { WebLink } from '../WebLink'
import { ReviewButton, ServiceSwitch } from './ActionGestures'
import { STATE_TEXT, StateIcon } from './ActionMarks'
import type { ActionHandlers } from './useActionGestures'

/** Où part un lancement depuis le panneau : l'arbre de la conversation, ou la racine du projet. */
export type LineWhere = 'here' | 'root'

const ICON_GESTURE =
  'grid size-8 shrink-0 place-items-center rounded-md text-ink-soft transition-colors hover:bg-surface-high hover:text-ink pointer-coarse:size-11 focus-visible:outline-2 focus-visible:outline-accent'

/**
 * Une action dans l'onglet Actions du panneau (PACT-3) : une ligne de 36 px, la même
 * forme que celles des autres onglets. L'icône de nature avec son point d'état, le
 * libellé, la phrase d'état en gris (ambre à relire, rouge en échec), et le geste
 * principal en petit à droite. La ligne entière ouvre le détail, en pile.
 *
 * Les gestes : « Relire » ; l'interrupteur d'un service, et ↗ quand il tourne avec un
 * lien ; ▷ d'une commande, qui part sans menu là où dit `where`, ou son terminal quand
 * elle tourne ; ▷ d'une tâche d'agent, qui part dans une nouvelle session, ou ↗ vers
 * celle qui la joue.
 */
export function ActionLine({ item, where, handlers }: { item: Automation; where: LineWhere; handlers: ActionHandlers }) {
  const t = useTranslate()
  const state = actionState(item, Date.now(), t)
  const review = item.review !== null
  const open = () => handlers.onOpen(item, review)
  return (
    <li
      data-action-line={item.id}
      onClick={(event) => {
        // Un geste de la ligne fait le sien, sans ouvrir le détail par-dessus.
        if ((event.target as HTMLElement).closest('a, button, [role="switch"]')) return
        open()
      }}
      className={cx(panelRowClass, 'cursor-pointer')}
    >
      <StateIcon nature={natureOf(item)} tone={state.tone} size="sm" />
      <button type="button" onClick={open} title={state.text} className="flex min-w-0 flex-1 items-baseline gap-2 text-left outline-none focus-visible:underline">
        <span className="min-w-0 shrink truncate text-sm text-ink">{item.label}</span>
        <span className={cx('min-w-0 shrink-[2] truncate text-xs', STATE_TEXT[state.tone])}>{state.text}</span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5">
        <LineGesture item={item} where={where} handlers={handlers} />
      </span>
    </li>
  )
}

function LineGesture({ item, where, handlers }: { item: Automation; where: LineWhere; handlers: ActionHandlers }) {
  const t = useTranslate()
  const { live, label } = item
  switch (primaryGestureOf(item)) {
    case 'review':
      return <ReviewButton label={label} size="row" onReview={() => handlers.onOpen(item, true)} />
    case 'switch': {
      const on = live?.kind === 'service'
      return (
        <>
          {live?.kind === 'service' && live.href ? (
            <WebLink href={live.href} title={t('panel.actions.openService', { label })} className={ICON_GESTURE}>
              <ArrowUpRight size={13} aria-hidden />
              <span className="sr-only">{t('panel.actions.openService', { label })}</span>
            </WebLink>
          ) : null}
          <ServiceSwitch
            on={on}
            label={label}
            withText={false}
            name={on ? undefined : t(where === 'here' ? 'panel.actions.startHere' : 'panel.actions.startRoot', { label })}
            onToggle={(next) => handlers.onToggle(item, next)}
          />
        </>
      )
    }
    case 'terminal':
      return (
        <IconGesture label={t('panel.actions.openTerminal', { label })} onClick={() => live?.kind === 'terminal' && handlers.onTerminal(item, live.terminalId)}>
          <SquareTerminal size={13} aria-hidden />
        </IconGesture>
      )
    case 'session':
      return live?.kind === 'run' && live.conversationId ? (
        <Link
          to={conversationPath({ id: live.conversationId, projectId: item.projectId })}
          aria-label={t('panel.actions.openSession', { label })}
          title={t('panel.actions.openSession', { label })}
          className={ICON_GESTURE}
        >
          <ArrowUpRight size={13} aria-hidden />
        </Link>
      ) : null
    case 'launch': {
      const name =
        item.what === 'agent'
          ? t('panel.actions.launchSession', { label })
          : t(where === 'here' ? 'panel.actions.launchHere' : 'panel.actions.launchRoot', { label })
      return (
        <IconGesture label={name} onClick={() => handlers.onLaunch(item, null)}>
          <Play size={13} aria-hidden />
        </IconGesture>
      )
    }
  }
}

function IconGesture({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className={ICON_GESTURE}>
      {children}
    </button>
  )
}
