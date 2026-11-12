import { ArrowUpRight, MoreHorizontal, Square } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Menu, MenuItem, MenuLabel, MenuSeparator, cx } from '@solera/ui'
import { useTranslate } from '../../../lib/i18n'
import { seedFromWork, type SessionWork } from '../../../lib/session-works'
import { quietGestureClass } from '../ActionGestures'
import { TILE_BOX } from '../LauncherGroup'
import { PortLink, SessionPill, WorkIcon, useWorkText, type WorkGestures } from './parts'

/**
 * La tuile d'un processus dans le Lanceur (PRC-3) : **exactement** le gabarit d'une tuile
 * d'action. En-tête (icône et point, libellé humain, ⋯), une ligne d'état grise, une
 * seule ligne de détail (la commande courte, la session d'origine en pastille), et un
 * seul geste en bas. Le reste passe dans le ⋯ : une tuile de hauteur fixe ne déborde
 * jamais.
 */
export function SessionWorkTile({ projectId, work, gestures }: { projectId: string; work: SessionWork; gestures: WorkGestures }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const { name, short, load, since, sessionHref } = useWorkText(projectId, work)
  const state = [
    t('sessionWorks.state.running'),
    work.port ? `:${work.port}` : null,
    since ? t('sessionWorks.state.since', { duration: since }) : null,
  ].filter(Boolean).join(' · ')
  const tooltip = [work.command, t('sessionWorks.origin.in', { title: work.conversationTitle }), load].filter(Boolean).join('\n')
  const stop = () => gestures.onStop(work)
  const stopping = gestures.stopping === work.id

  return (
    <article data-session-work={work.id} className={cx(TILE_BOX, 'gap-2 border-accent/40 bg-accent/5')}>
      <header className="flex min-w-0 items-start gap-2.5">
        <WorkIcon work={work} />
        <span className="flex min-w-0 flex-1 flex-col" title={tooltip}>
          <span className="truncate text-sm font-medium text-ink">{name}</span>
          <span className="truncate text-xs text-ink-faint">{state}</span>
        </span>
        <Menu
          trigger={
            <button
              type="button"
              aria-label={t('sessionWorks.gesture.more', { name })}
              className="-mt-0.5 -mr-1 grid size-7 shrink-0 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink"
            >
              <MoreHorizontal size={15} aria-hidden />
            </button>
          }
        >
          <MenuItem onSelect={() => gestures.onMakeAction(seedFromWork(work, t))}>{t('sessionWorks.gesture.makeAction')}</MenuItem>
          <MenuItem onSelect={() => navigate(sessionHref)}>{t('sessionWorks.gesture.goToSession')}</MenuItem>
          {work.stop ? (
            <>
              <MenuSeparator />
              <MenuItem tone="critical" disabled={stopping} onSelect={stop}>{t('sessionWorks.gesture.stop')}</MenuItem>
            </>
          ) : null}
          {load ? (
            <>
              <MenuSeparator />
              <MenuLabel><span className="tabular-nums">{load}</span></MenuLabel>
            </>
          ) : null}
        </Menu>
      </header>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-[2.625rem] text-xs text-ink-faint">
        {short ? <code className="min-w-0 truncate font-mono text-[11px]" title={work.command ?? undefined}>$ {short}</code> : null}
        <SessionPill work={work} href={sessionHref} />
      </div>

      <footer className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {work.port ? (
          <PortLink port={work.port} label={t('sessionWorks.gesture.open', { port: work.port })} className={cx(quietGestureClass(), 'border border-line text-ink')} />
        ) : work.stop ? (
          <button
            type="button"
            onClick={stop}
            disabled={stopping}
            aria-label={t('sessionWorks.gesture.stopNamed', { name })}
            className={cx(quietGestureClass(), 'border border-line text-ink disabled:pointer-events-none disabled:opacity-45')}
          >
            <Square size={10} fill="currentColor" aria-hidden /> {t('sessionWorks.gesture.stop')}
          </button>
        ) : (
          <Link to={sessionHref} className={quietGestureClass()}>
            {t('launcher.gesture.session')} <ArrowUpRight size={12} aria-hidden />
          </Link>
        )}
      </footer>
    </article>
  )
}
