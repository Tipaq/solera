import { ArrowUpRight, ShieldQuestion, SquareTerminal } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import type { Automation } from '../../lib/automations'
import { useAutomations } from '../../lib/automations-query'
import { conversationPath } from '../../lib/conversation-route'
import { useTranslate } from '../../lib/i18n'
import { actionsTabPath, overviewActionsOf, overviewLine, type OverviewGesture } from '../../lib/overview-actions'
import { showTerminal } from '../../lib/panel'
import { STATE_DOT } from '../automations/ActionMarks'
import { WebLink } from '../WebLink'
import { MoreLink, OverviewSection } from './OverviewSection'

/**
 * Le bloc « Actions » de l'Aperçu (`projet.md` A-5) : ce qui tourne ou attend seulement —
 * services en marche avec leur port et « Ouvrir », commandes en cours dans un terminal,
 * passages d'agent, actions à relire. Le reste est compté au repos, et tout renvoie à
 * l'onglet Actions : le lanceur ⚡ de la bande n'est plus (décision du 2026-11-11).
 */
export function OverviewActions({ projectId }: { projectId: string }) {
  const { items, isPending } = useAutomations({ projectId })
  // Rien tant que les actions chargent (A-1.4) : « Aucune action » serait un mensonge.
  if (isPending) return null
  return <OverviewActionsView projectId={projectId} items={items} now={Date.now()} />
}

/** Le bloc sans ses requêtes, pour sa story. */
export function OverviewActionsView({ projectId, items, now }: { projectId: string; items: Automation[]; now: number }) {
  const t = useTranslate()
  const { shown, idle, total } = overviewActionsOf(items)
  return (
    <OverviewSection title={t('project.overview.actions.title')} caps>
      {shown.length === 0 ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-faint">
          <span>{t(total === 0 ? 'project.overview.actions.empty' : 'project.overview.actions.quiet')}</span>
          <MoreLink to={actionsTabPath(projectId)}>{t('project.overview.actions.tab')}</MoreLink>
        </p>
      ) : (
        <ul className="flex flex-col">
          {shown.map((item) => {
            const line = overviewLine(item, projectId, now, t)
            return (
              <li key={item.id} className="flex min-h-9 min-w-0 items-center gap-2 text-sm pointer-coarse:min-h-11">
                <span
                  aria-hidden
                  className={cx(
                    'size-2 shrink-0 rounded-full',
                    STATE_DOT[line.tone],
                    line.tone === 'live' && 'motion-safe:animate-pulse',
                  )}
                />
                {/* Le nom d'abord : c'est le détail qui cède la place, pas lui. */}
                <span className="max-w-[60%] shrink-0 truncate">{item.label}</span>
                <span className="min-w-0 truncate text-xs text-ink-faint">{line.detail}</span>
                <Gesture gesture={line.gesture} projectId={projectId} />
              </li>
            )
          })}
        </ul>
      )}
      {shown.length > 0 && idle > 0 ? (
        <p className="mt-1">
          <MoreLink to={actionsTabPath(projectId)}>
            {t(idle === 1 ? 'project.overview.actions.idle.one' : 'project.overview.actions.idle.other', { count: idle })}
          </MoreLink>
        </p>
      ) : null}
    </OverviewSection>
  )
}

/**
 * Un geste discret au bout de la ligne, à la hauteur des gestes `row` d'une action
 * (`ActionGestures.tsx` : 32 px, 44 au doigt), sa couleur posée par chaque cas.
 */
const GESTURE =
  'ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded text-xs focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:h-11'

/** Le geste au bout de la ligne : un lien discret, de la couleur de ce qu'il fait. */
function Gesture({ gesture, projectId }: { gesture: OverviewGesture; projectId: string }) {
  const t = useTranslate()
  switch (gesture.kind) {
    case 'open':
      return (
        <WebLink href={gesture.href} className={cx(GESTURE, 'gap-0.5 text-accent hover:underline')}>
          {t('launcher.gesture.open')} <ArrowUpRight size={12} aria-hidden />
        </WebLink>
      )
    case 'review':
      return (
        <Link to={gesture.to} className={cx(GESTURE, 'text-caution hover:underline')}>
          <ShieldQuestion size={12} aria-hidden /> {t('launcher.review.button')}
        </Link>
      )
    case 'terminal':
      return (
        <button
          type="button"
          onClick={() => showTerminal(gesture.terminalId)}
          className={cx(GESTURE, 'text-ink-faint hover:text-ink')}
        >
          <SquareTerminal size={12} aria-hidden /> {t('project.overview.actions.panel')}
        </button>
      )
    case 'session':
      return (
        <Link to={conversationPath({ id: gesture.conversationId, projectId })} className={cx(GESTURE, 'gap-0.5 text-ink-faint hover:text-ink')}>
          {t('launcher.gesture.session')} <ArrowUpRight size={12} aria-hidden />
        </Link>
      )
    case 'detail':
      return (
        <Link to={gesture.to} className={cx(GESTURE, 'gap-0.5 text-ink-faint hover:text-ink')}>
          {t('project.overview.actions.detail')} <ArrowUpRight size={12} aria-hidden />
        </Link>
      )
  }
}
