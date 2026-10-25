import { useEffect, useRef } from 'react'
import type { ConversationDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { AgentIcon } from '../AgentIcon'

/**
 * Liste des sessions proposées après un `@@`.
 *
 * Posée au-dessus de la zone de saisie, comme celles des fichiers et des cartes. Une
 * session archivée y figure quand la recherche la trouve : c'est souvent elle qu'on
 * veut citer, une fois le travail rangé.
 */
export function SessionPicker({
  sessions,
  active,
  loading,
  onPick,
  onHover,
}: {
  sessions: ConversationDto[]
  active: number
  loading: boolean
  onPick: (session: ConversationDto) => void
  onHover: (index: number) => void
}) {
  const t = useTranslate()
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    list.current?.children[active]?.scrollIntoView({ block: 'nearest' })
  }, [active])

  if (sessions.length === 0) {
    return (
      <div role="status" className="surface mb-1.5 rounded-lg border border-line p-2.5 text-xs text-ink-faint shadow-float">
        {t(loading ? 'sessionRef.loading' : 'sessionRef.empty')}
      </div>
    )
  }

  return (
    <ul
      ref={list}
      role="listbox"
      aria-label={t('sessionRef.picker')}
      className="surface mb-1.5 max-h-56 overflow-y-auto rounded-lg border border-line p-1 shadow-float"
    >
      {sessions.map((session, index) => (
        <li key={session.id}>
          <button
            type="button"
            role="option"
            aria-selected={index === active}
            // `onMouseDown` : un `onClick` laisserait d'abord le champ perdre le focus,
            // ce qui referme la liste avant que la sélection soit prise en compte.
            onMouseDown={(event) => {
              event.preventDefault()
              onPick(session)
            }}
            onMouseEnter={() => onHover(index)}
            className={cx(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
              index === active ? 'bg-accent-wash text-ink' : 'text-ink-soft',
            )}
          >
            <span className="shrink-0 text-ink-faint"><AgentIcon agent={session.agent} /></span>
            <span className="min-w-0 flex-1 truncate">{session.title}</span>
            <span className="shrink-0 text-meta text-ink-faint">
              {session.archivedAt !== null ? `${t('sessionRef.archived')} · ` : ''}
              {relativeDate(session.updatedAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
