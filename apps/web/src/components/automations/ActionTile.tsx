import { AlarmClock, MoreHorizontal } from 'lucide-react'
import { IconButton, Menu, MenuItem, MenuSeparator, cx } from '@solera/ui'
import { actionState, cadenceText, isService, natureOf, type Automation } from '../../lib/automations'
import { locale, useTranslate } from '../../lib/i18n'
import type { ServedVersion } from '../../lib/served'
import { ActionGesture, quietGestureClass } from './ActionGestures'
import { STATE_TEXT, StateIcon } from './ActionMarks'
import { TILE_BOX } from './LauncherGroup'
import { ServedLine } from './served/ServedLine'
import { ServeIcon, ServeMenu } from './served/ServeMenu'
import type { ActionHandlers, ActionServing } from './useActionGestures'

/**
 * La tuile d'une action dans le Lanceur (LAN-4 à LAN-8) : toutes de la même taille, et
 * la même forme. En-tête (icône de nature et point d'état, libellé qui ouvre le détail,
 * phrase d'état, ⋯), le contexte (ce qu'un service sert, sinon la commande ou le prompt,
 * puis la cadence), et **un seul geste principal, en bas à gauche**. Une tuile qui tourne
 * prend un liseré d'accent ; à relire, une bordure ambre.
 */
export function ActionTile({
  item,
  served,
  serving,
  handlers,
}: {
  item: Automation
  /** Ce que sert le service en marche ; null sinon. */
  served: ServedVersion | null
  serving: ActionServing | null
  handlers: ActionHandlers
}) {
  const t = useTranslate()
  const state = actionState(item, Date.now(), t)
  const cadence = cadenceText(item, t, locale())
  const running = item.live !== null && !item.review
  const context = item.what === 'agent' ? item.prompt : item.command

  return (
    <article
      data-action-tile={item.id}
      className={cx(
        TILE_BOX,
        'gap-2 transition-colors',
        running ? 'border-accent/40 bg-accent/5' : item.review ? 'border-caution/40' : 'border-line hover:border-line-strong',
      )}
    >
      <header className="flex min-w-0 items-start gap-2.5">
        <StateIcon nature={natureOf(item)} tone={state.tone} />
        <button
          type="button"
          onClick={() => handlers.onOpen(item)}
          className="flex min-w-0 flex-1 flex-col items-start text-left focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className="w-full truncate text-sm font-medium text-ink hover:underline">{item.label}</span>
          <span className={cx('w-full truncate text-xs', STATE_TEXT[state.tone])}>{state.text}</span>
        </button>
        <TileMenu item={item} handlers={handlers} />
      </header>

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 overflow-hidden pl-[2.625rem] text-xs text-ink-faint">
        {served ? (
          <ServedLine served={served} />
        ) : context ? (
          item.what === 'agent' ? (
            <span className="truncate">{context}</span>
          ) : (
            <code className="truncate font-mono text-meta">$ {context}</code>
          )
        ) : null}
        {cadence ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <AlarmClock size={11} className="shrink-0" aria-hidden /> <span className="truncate">{cadence}</span>
          </span>
        ) : null}
      </div>

      <footer className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <ActionGesture
          item={item}
          onReview={() => handlers.onOpen(item, true)}
          onToggleService={(on) => handlers.onToggle(item, on)}
          onTerminal={() => item.live?.kind === 'terminal' && handlers.onTerminal(item, item.live.terminalId)}
          onLaunch={(worktreeId) => handlers.onLaunch(item, worktreeId)}
          serve={
            serving ? (
              <ServeMenu
                targets={serving.targets}
                onSwitch={serving.onSwitch}
                trigger={
                  <button type="button" aria-label={t('served.serveNamed', { label: item.label })} title={t('served.serveNamed', { label: item.label })} className={quietGestureClass()}>
                    <ServeIcon />
                    <span className="hidden @min-[19rem]/tile:inline">{t('served.serve')}</span>
                  </button>
                }
              />
            ) : null
          }
        />
      </footer>
    </article>
  )
}

/**
 * ⋯ : les gestes rares, hors de la tuile (LAN-8). Une action à relire ne se modifie ni
 * ne se planifie avant sa relecture ; un service en marche se redémarre et montre son
 * journal (Q1) ; une tâche d'agent dont le script est validé se lance sans lui.
 */
function TileMenu({ item, handlers }: { item: Automation; handlers: ActionHandlers }) {
  const t = useTranslate()
  const serviceOn = isService(item) && item.live?.kind === 'service'
  return (
    <Menu
      trigger={
        <IconButton size="sm" label={t('launcher.menu.more', { label: item.label })} className="-mt-0.5 -mr-1">
          <MoreHorizontal size={15} />
        </IconButton>
      }
    >
      <MenuItem onSelect={() => handlers.onOpen(item)}>{t('launcher.menu.detail')}</MenuItem>
      {item.review ? null : (
        <>
          <MenuItem onSelect={() => handlers.onEdit({ from: item })}>{t('launcher.menu.edit')}</MenuItem>
          <MenuItem onSelect={() => handlers.onEdit({ from: item, schedule: true })}>
            {t(item.schedule ? 'launcher.menu.editSchedule' : 'launcher.menu.schedule')}
          </MenuItem>
        </>
      )}
      {runsUnchecked(item) ? (
        <MenuItem onSelect={() => handlers.onLaunchUnchecked(item)}>{t('launcher.menu.runUnchecked')}</MenuItem>
      ) : null}
      {serviceOn ? (
        <>
          <MenuItem onSelect={() => handlers.onService(item, 'restart')}>{t('launcher.menu.restart')}</MenuItem>
          <MenuItem onSelect={() => handlers.onService(item, 'logs')}>{t('launcher.menu.logs')}</MenuItem>
        </>
      ) : null}
      <MenuItem onSelect={() => handlers.onDuplicate(item)}>{t('launcher.menu.duplicate')}</MenuItem>
      <MenuSeparator />
      <MenuItem tone="critical" onSelect={() => handlers.onDelete(item)}>{t('launcher.menu.delete')}</MenuItem>
    </Menu>
  )
}

/** Une tâche d'agent au script de vérification validé : « Lancer sans vérifier » a un sens. */
const runsUnchecked = (item: Automation): boolean =>
  item.source.kind === 'task' && item.source.task.check?.approved === true && item.review === null
