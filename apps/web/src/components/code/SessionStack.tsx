import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import type { SessionTone, TreeSession } from '../../lib/code-model'
import { useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'

export const SESSION_DOT: Record<SessionTone, string> = {
  running: 'bg-accent animate-pulse',
  awaiting: 'bg-caution',
  broken: 'bg-critical',
}

/** Les sessions vivantes d'un arbre : l'agent, avec le point de son état en exposant. */
export function SessionStack({ projectId, sessions, max = 3 }: { projectId: string; sessions: TreeSession[]; max?: number }) {
  const t = useTranslate()
  if (sessions.length === 0) return null
  return (
    <span className="inline-flex items-center gap-1">
      {sessions.slice(0, max).map((session) => (
        <Link
          key={session.id}
          to={`/p/${projectId}/c/${session.id}`}
          title={t('code.session.title', { title: session.title, state: t(`code.session.${session.tone}`) })}
          onClick={(event) => event.stopPropagation()}
          className="relative inline-flex size-6 items-center justify-center rounded-full bg-surface-high hover:bg-line"
        >
          <AgentIcon agent={session.agent} size={13} decorative />
          <span aria-hidden className={cx('absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-canvas', SESSION_DOT[session.tone])} />
        </Link>
      ))}
      {sessions.length > max ? <span className="text-meta text-ink-faint">{t('code.sessions.more', { count: sessions.length - max })}</span> : null}
    </span>
  )
}
