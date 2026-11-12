import { AlarmClock, ArrowUpRight, MoreHorizontal, Play } from 'lucide-react'
import { Link } from 'react-router-dom'
import { IconButton, Menu, MenuItem, MenuSeparator, cx } from '@solera/ui'
import { cadenceWords, natureOf, type Automation } from '../../lib/automations'
import { conversationPath } from '../../lib/conversation-route'
import { locale, useTranslate } from '../../lib/i18n'
import { launchWhere, plannedGestureOf, plannedState, type PlannedItem } from '../../lib/planned'
import { quietGestureClass, ReviewButton } from '../automations/ActionGestures'
import { STATE_TEXT, StateIcon } from '../automations/ActionMarks'
import { TILE_BOX } from '../automations/LauncherGroup'
import { ScopePip } from './ScopeMarks'

/** Ce qu'une tuile ou une ligne de la page Planifiées sait faire d'une tâche. */
export interface PlannedHandlers {
  onOpen: (item: Automation, review?: boolean) => void
  onEdit: (item: PlannedItem) => void
  onLaunch: (item: PlannedItem) => void
  onPause: (item: PlannedItem, paused: boolean) => void
  onDuplicate: (item: PlannedItem) => void
  onDelete: (item: PlannedItem) => void
}

/** Le geste d'une tuile, de la forme de « Lancer » de l'onglet Actions. */
const TILE_ACTION =
  'inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 text-xs font-medium text-ink transition-colors hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent md:h-9 pointer-coarse:h-11'

/**
 * La tuile d'une tâche planifiée (PLF-5), au gabarit du Lanceur de l'onglet Actions : la
 * même boîte, la même hauteur. En-tête (nature et point d'état, libellé estompé en pause,
 * ce qui vient puis ce qui s'est passé, ⋯), la cadence et la **pastille de portée**, et un
 * seul geste en bas : Relire, Session ↗, Reprendre ou Lancer maintenant.
 */
export function PlannedTile({ item, handlers }: { item: PlannedItem; handlers: PlannedHandlers }) {
  const t = useTranslate()
  const state = plannedState(item, Date.now(), t)
  const paused = item.schedule?.enabled === false
  const cadence = item.schedule ? cadenceWords(item.schedule.cadence, t, locale()) : t('automation.when.demand')

  return (
    <article
      data-planned-tile={item.id}
      className={cx(
        TILE_BOX,
        'gap-2 transition-colors',
        item.live && !item.review ? 'border-accent/40 bg-accent/5' : item.review ? 'border-caution/40' : 'border-line hover:border-line-strong',
      )}
    >
      <header className="flex min-w-0 items-start gap-2.5">
        <StateIcon nature={natureOf(item)} tone={state.tone} />
        <button
          type="button"
          onClick={() => handlers.onOpen(item)}
          className="flex min-w-0 flex-1 flex-col items-start text-left focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className={cx('w-full truncate text-sm font-medium hover:underline', paused ? 'text-ink-soft' : 'text-ink')}>{item.label}</span>
          <span className={cx('w-full truncate text-xs', STATE_TEXT[state.tone])}>{state.text}</span>
        </button>
        <PlannedMenu item={item} handlers={handlers} />
      </header>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-[2.625rem] text-xs text-ink-faint">
        <span className="inline-flex min-w-0 shrink items-center gap-1">
          <AlarmClock size={11} className="shrink-0" aria-hidden /> <span className="truncate">{cadence}</span>
        </span>
        <span className="flex max-w-[50%] min-w-0 shrink-0 items-center">
          <ScopePip scope={item.scope} />
        </span>
      </div>

      <footer className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <PlannedGesture item={item} handlers={handlers} />
      </footer>
    </article>
  )
}

function PlannedGesture({ item, handlers }: { item: PlannedItem; handlers: PlannedHandlers }) {
  const t = useTranslate()
  const { live } = item
  switch (plannedGestureOf(item)) {
    case 'review':
      return <ReviewButton label={item.label} onReview={() => handlers.onOpen(item, true)} />
    case 'session':
      return live?.kind === 'run' && live.conversationId ? (
        <Link to={conversationPath({ id: live.conversationId, projectId: item.projectId })} className={quietGestureClass()}>
          {t('launcher.gesture.session')} <ArrowUpRight size={12} aria-hidden />
        </Link>
      ) : null
    case 'resume':
      return (
        <button type="button" aria-label={t('planned.tile.resumeNamed', { label: item.label })} onClick={() => handlers.onPause(item, false)} className={TILE_ACTION}>
          <Play size={12} aria-hidden /> {t('planned.tile.resume')}
        </button>
      )
    case 'launch': {
      const named = t('planned.tile.launchNamed', { label: item.label, where: launchWhere(item.scope, t) })
      return (
        <button type="button" aria-label={named} title={named} onClick={() => handlers.onLaunch(item)} className={TILE_ACTION}>
          <Play size={12} aria-hidden /> {t('planned.tile.launch')}
        </button>
      )
    }
  }
}

/** ⋯ : Voir le détail, Modifier (sauf à relire), Mettre en pause / Reprendre, Dupliquer, Supprimer. */
function PlannedMenu({ item, handlers }: { item: PlannedItem; handlers: PlannedHandlers }) {
  const t = useTranslate()
  return (
    <Menu
      trigger={
        <IconButton size="sm" label={t('launcher.menu.more', { label: item.label })} className="-mt-0.5 -mr-1">
          <MoreHorizontal size={15} />
        </IconButton>
      }
    >
      <MenuItem onSelect={() => handlers.onOpen(item)}>{t('launcher.menu.detail')}</MenuItem>
      {item.review ? null : <MenuItem onSelect={() => handlers.onEdit(item)}>{t('launcher.menu.edit')}</MenuItem>}
      {item.schedule ? (
        <MenuItem onSelect={() => handlers.onPause(item, item.schedule!.enabled)}>
          {t(item.schedule.enabled ? 'planned.menu.pause' : 'planned.menu.resume')}
        </MenuItem>
      ) : null}
      <MenuItem onSelect={() => handlers.onDuplicate(item)}>{t('launcher.menu.duplicate')}</MenuItem>
      <MenuSeparator />
      <MenuItem tone="critical" onSelect={() => handlers.onDelete(item)}>{t('launcher.menu.delete')}</MenuItem>
    </Menu>
  )
}
