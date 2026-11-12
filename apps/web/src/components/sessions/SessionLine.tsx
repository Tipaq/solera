import { Pin } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import type { ReactNode } from 'react'
import { relativeDate, shortAge } from '../../lib/dates'
import { useTranslate, type MessageKey } from '../../lib/i18n'
import type { SessionRow, SessionState } from '../../lib/sessions-view'
import { AgentIcon } from '../AgentIcon'
import { ProjectPip } from '../places/ProjectPip'
import { CheckBox } from '../toolbar/ToolbarMenus'

export const STATE_WORD: Record<SessionState, MessageKey> = {
  awaiting: 'sessionsPage.state.awaiting',
  error: 'sessionsPage.state.error',
  review: 'sessionsPage.state.review',
  running: 'sessionsPage.state.running',
  done: 'sessionsPage.state.done',
}

const STATE_DOT: Record<SessionState, string> = {
  awaiting: 'bg-caution',
  error: 'bg-critical',
  review: 'bg-accent/60',
  running: 'bg-accent animate-pulse',
  done: 'bg-line-strong',
}

/** Le point d'un état, seul : dans le filtre, à côté de son mot. */
export function SessionStateDot({ state, className }: { state: SessionState; className?: string }) {
  return <span aria-hidden className={cx('size-2 shrink-0 rounded-full', STATE_DOT[state], className)} />
}

/**
 * Une session dans la liste de `/sessions` : l'agent et son point d'état, le titre, le
 * mot d'état quand il réclame, puis dès `lg` le projet, la branche et la carte, et la
 * date à droite. Toute la ligne mène au fil.
 *
 * `compact` pour les colonnes de « Par état », où la colonne dit déjà l'état et où la
 * place manque pour la méta et pour une date en toutes lettres ; `hideProject` quand le groupe nomme déjà le projet.
 *
 * En mode sélection (`onToggle`), la ligne devient une case à cocher : la case en tête,
 * le fond accent pâle quand elle est cochée, et le clic coche au lieu d'ouvrir le fil.
 */
export function SessionLine({
  row,
  compact = false,
  hideProject = false,
  selected = false,
  onToggle,
}: {
  row: SessionRow
  compact?: boolean
  hideProject?: boolean
  selected?: boolean
  /** Le mode sélection : la ligne coche au lieu de mener au fil. */
  onToggle?: (id: string) => void
}) {
  const className = cx(
    'flex min-h-11 w-full min-w-0 items-center gap-3 px-1 text-left text-sm transition-colors hover:bg-surface-high/50 md:min-h-10 pointer-coarse:min-h-11',
    selected && 'bg-accent/10 hover:bg-accent/15',
  )
  return (
    <li>
      {onToggle ? (
        <button type="button" role="checkbox" aria-checked={selected} data-session={row.id} className={className} onClick={() => onToggle(row.id)}>
          <CheckBox checked={selected} />
          <LineBody row={row} compact={compact} hideProject={hideProject} />
        </button>
      ) : (
        <Link to={row.path} data-session={row.id} className={className}>
          <LineBody row={row} compact={compact} hideProject={hideProject} />
        </Link>
      )}
    </li>
  )
}

/** Ce que la ligne montre, qu'elle mène au fil ou qu'elle se coche. */
function LineBody({ row, compact, hideProject }: { row: SessionRow; compact: boolean; hideProject: boolean }): ReactNode {
  const t = useTranslate()
  const word = t(STATE_WORD[row.state])
  const calls = row.state === 'awaiting' || row.state === 'error'
  return (
    <>
        <span className="relative shrink-0 text-ink-soft" title={word}>
          <AgentIcon agent={row.agent} size={15} />
          <SessionStateDot state={row.state} className="absolute -right-0.5 -bottom-0.5 ring-2 ring-canvas" />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cx('truncate text-ink', calls && 'font-medium')}>{row.title}</span>
          {row.pinned ? <Pin size={12} className="shrink-0 text-ink-faint" aria-label={t('sessionsPage.pinned')} /> : null}
          {!compact && (calls || row.state === 'review') ? (
            <span className={cx('shrink-0 text-xs', row.state === 'error' ? 'text-critical' : row.state === 'awaiting' ? 'text-caution' : 'text-ink-faint')}>
              {word}
            </span>
          ) : null}
        </span>
        {!compact ? (
          <span className="hidden min-w-0 shrink items-center gap-2 text-xs text-ink-faint lg:flex">
            {!hideProject && row.project ? <ProjectPip project={row.project} plain /> : null}
            {row.branch ? <span className="max-w-48 truncate font-mono">{row.branch}</span> : null}
            {row.cardNumber !== null ? <span className="shrink-0 tabular-nums">#{row.cardNumber}</span> : null}
          </span>
        ) : null}
        {/* Sur une ligne : « il y a 2 secondes » repliée en deux grandissait la rangée.
            Au téléphone et dans une colonne étroite, l'ancienneté courte laisse la place
            au titre. */}
        <span className={cx('shrink-0 text-right text-xs whitespace-nowrap tabular-nums text-ink-faint', compact ? 'min-w-10' : 'min-w-10 sm:min-w-20')}>
          {compact ? (
            shortAge(row.at)
          ) : (
            <>
              <span className="sm:hidden">{shortAge(row.at)}</span>
              <span className="hidden sm:inline">{relativeDate(row.at)}</span>
            </>
          )}
        </span>
    </>
  )
}
