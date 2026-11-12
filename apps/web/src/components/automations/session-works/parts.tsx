import { ArrowUpRight, Bot, Radio, SquareTerminal, Waves } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import type { EditorSeed } from '../../../lib/action-editor'
import { conversationPath } from '../../../lib/conversation-route'
import { elapsed } from '../../../lib/dates'
import { useTranslate } from '../../../lib/i18n'
import { humanLabel, loadText, shortCommand, type SessionWork, type WorkFamily } from '../../../lib/session-works'
import { AgentIcon } from '../../AgentIcon'
import { WebLink } from '../../WebLink'

/** Ce que les trois rendus d'un processus savent faire, tenu par la section. */
export interface WorkGestures {
  onMakeAction: (seed: EditorSeed) => void
  onStop: (work: SessionWork) => void
  /** L'id du travail qu'on est en train d'arrêter. */
  stopping: string | null
}

export function FamilyIcon({ family, size = 14 }: { family: WorkFamily; size?: number }) {
  if (family === 'shell') return <SquareTerminal size={size} aria-hidden />
  if (family === 'monitor') return <Radio size={size} aria-hidden />
  if (family === 'subagent') return <Bot size={size} aria-hidden />
  return <Waves size={size} aria-hidden />
}

/** L'icône de famille, avec le point vert de ce qui tourne posé dans son coin (comme `StateIcon`). */
export function WorkIcon({ work, size = 'md' }: { work: SessionWork; size?: 'md' | 'sm' }) {
  return (
    <span className={cx('relative grid shrink-0 place-items-center rounded-md text-ink-soft', size === 'md' ? 'size-8 bg-surface-high/70' : 'size-6')}>
      <FamilyIcon family={work.family} size={size === 'md' ? 15 : 14} />
      <span aria-hidden className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-positive ring-2 ring-canvas motion-safe:animate-pulse" />
    </span>
  )
}

/** Ce qu'on dit d'un processus, partout pareil. */
export function useWorkText(projectId: string, work: SessionWork) {
  const t = useTranslate()
  return {
    name: humanLabel(work, t),
    short: work.command ? shortCommand(work.command) : null,
    load: loadText(work, t),
    since: work.startedAt ? elapsed(work.startedAt) : null,
    sessionHref: conversationPath({ id: work.conversationId, projectId }),
  }
}

/**
 * La session d'origine en pastille : l'icône du CLI et son titre. `narrow` : dans un
 * conteneur de moins de 26 rem, l'icône seule.
 */
export function SessionPill({ work, href, narrow = false, className: extra }: {
  work: SessionWork
  href?: string
  narrow?: boolean
  className?: string
}) {
  const t = useTranslate()
  const className = cx('inline-flex max-w-[45%] min-w-0 shrink items-center gap-1 rounded-full border border-line px-1.5 py-px text-[11px] text-ink-soft', extra)
  const body = (
    <>
      {work.agent ? <AgentIcon agent={work.agent} size={10} decorative /> : null}
      <span className={cx('truncate', narrow && work.agent && 'hidden @min-[26rem]:inline')}>{work.conversationTitle}</span>
    </>
  )
  const title = t('sessionWorks.origin.in', { title: work.conversationTitle })
  return href ? (
    <Link to={href} title={title} className={cx(className, 'hover:border-line-strong hover:text-ink')}>
      {body}
    </Link>
  ) : (
    <span title={title} className={className}>
      {body}
    </span>
  )
}

/**
 * Le port en lien, `localhost` comme les liens d'action : dans une conversation, il
 * s'ouvre dans la vue *Web* du panneau, qui le relaie quand Solera est ouvert à distance.
 */
export function PortLink({ port, className, label }: { port: number; className: string; label?: string }) {
  const t = useTranslate()
  return (
    <WebLink href={`http://localhost:${port}`} title={t('sessionWorks.gesture.openTitle', { port })} className={className}>
      {label ?? `:${port}`} <ArrowUpRight size={11} aria-hidden />
    </WebLink>
  )
}
