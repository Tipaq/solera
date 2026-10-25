import { FolderX, GitBranch, Info, SquareKanban } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { sessionReference, type ConversationDto } from '@solera/protocol'
import { Popover, cx } from '@solera/ui'
import { useLiveBackground, useLiveStatus } from '../../lib/conversation-status'
import { conversationPath } from '../../lib/conversation-route'
import { relativeDate } from '../../lib/dates'
import { useTranslate } from '../../lib/i18n'
import { threadState } from '../../lib/signals'
import { useWorktrees } from '../../lib/worktrees'
import { AGENT_LABELS, AgentIcon } from '../AgentIcon'
import { STATE_LABEL, StateDot } from './Signals'

/** Le temps de survol avant l'aperçu, comme pour les cartes : le pointeur qui passe n'en ouvre pas. */
const HOVER_DELAY_MS = 250
const WIDTH_PX = 300
/** Hauteur supposée de l'aperçu, pour décider s'il tient sous la référence. */
const ROOM_PX = 180

/**
 * Ce qu'on sait d'une session citée sans ouvrir son fil : son CLI et son état, où elle
 * travaille, la carte qu'elle traite, son dernier échange. Les mêmes sources que la
 * ligne de la sidebar, aucune requête de plus sauf la liste des worktrees du projet.
 */
function SessionDetails({ conversation }: { conversation: ConversationDto }) {
  const t = useTranslate()
  const status = useLiveStatus(conversation.id) ?? conversation.status
  const background = useLiveBackground(conversation.id)
  const state = threadState({ status, busy: background > 0, unread: false })
  const { data: worktrees } = useWorktrees(conversation.worktreeId ? (conversation.projectId ?? undefined) : undefined)
  const worktree = worktrees?.find((tree) => tree.id === conversation.worktreeId)
  const place = conversation.worktreeId
    ? (worktree?.git?.branch ?? worktree?.name ?? null)
    : t('sessionRef.projectRoot')

  return (
    <div className="flex flex-col gap-2 text-left">
      <div className="flex items-center gap-2 text-meta text-ink-faint">
        <AgentIcon agent={conversation.agent} decorative />
        <span>{AGENT_LABELS[conversation.agent]}</span>
        {state ? (
          <span className="flex items-center gap-1.5">
            <StateDot state={state} labelled={false} />
            {t(STATE_LABEL[state])}
          </span>
        ) : null}
        {conversation.archivedAt !== null ? <span className="ml-auto">{t('sessionRef.archived')}</span> : null}
      </div>
      <p className="text-sm font-semibold leading-snug text-ink">{conversation.title}</p>
      {place ? (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
          {conversation.worktreeGone ? (
            <FolderX size={12} className="shrink-0 text-caution" aria-label={t('conversation.worktreeGone.marker')} />
          ) : (
            <GitBranch size={12} className="shrink-0 text-ink-faint" />
          )}
          <span className="truncate">{place}</span>
        </span>
      ) : null}
      {conversation.card ? (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
          <SquareKanban size={12} className="shrink-0 text-ink-faint" />
          <span className="shrink-0 text-ink-faint">#{conversation.card.number}</span>
          <span className="truncate">{conversation.card.title}</span>
        </span>
      ) : null}
      <span className="text-meta text-ink-faint">
        {t('sessionRef.lastActivity', { when: relativeDate(conversation.updatedAt) })}
      </span>
    </div>
  )
}

/** L'aperçu au survol : il se lit, il ne s'utilise pas, d'où l'absence de pointeur. */
function HoverPreview({ anchor, children }: { anchor: DOMRect; children: ReactNode }) {
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH_PX - 8))
  const below = anchor.bottom + ROOM_PX < window.innerHeight
  const position = below ? { top: anchor.bottom + 6 } : { bottom: window.innerHeight - anchor.top + 6 }
  return createPortal(
    <div
      role="tooltip"
      style={{ left, width: WIDTH_PX, ...position }}
      className="surface pointer-events-none fixed z-50 rounded-lg border border-line p-3 shadow-pop"
    >
      {children}
    </div>,
    document.body,
  )
}

/**
 * Une session citée dans un message : son CLI et son titre courant, qui mènent à elle.
 *
 * Au pointeur, l'aperçu vient au survol ou au focus, comme pour une carte. Au doigt, où
 * il n'y a pas de survol, le bouton ⓘ l'ouvre dans un panneau, avec de quoi aller à la
 * session : toucher le titre y mène directement, sans détour par l'aperçu.
 */
export function SessionReference({
  id,
  conversation,
  loading,
}: {
  id: string
  conversation: ConversationDto | undefined
  loading: boolean
}) {
  const t = useTranslate()
  const [hovered, setHovered] = useState<DOMRect | null>(null)
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  if (!conversation) {
    // Supprimée, d'un autre projet, ou pas encore chargée : rien de la session ne se montre.
    return (
      <span className="sg-session-missing" title={sessionReference(id)}>
        {t(loading ? 'sessionRef.loading' : 'sessionRef.unavailable')}
      </span>
    )
  }

  const show = (element: HTMLElement, delay: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setHovered(element.getBoundingClientRect()), delay)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setHovered(null)
  }
  const label = t('sessionRef.preview', { title: conversation.title })

  return (
    <span className={cx('sg-session-ref', conversation.archivedAt !== null && 'sg-session-archived')}>
      <Link
        to={conversationPath(conversation)}
        data-session-reference={id}
        className="sg-session-link"
        onMouseEnter={(event) => show(event.currentTarget, HOVER_DELAY_MS)}
        onMouseLeave={hide}
        onFocus={(event) => show(event.currentTarget, 0)}
        onBlur={hide}
        onClick={hide}
      >
        <AgentIcon agent={conversation.agent} size={13} />
        <span className="sg-session-title">{conversation.title}</span>
      </Link>
      <Popover
        open={open}
        onOpenChange={setOpen}
        label={label}
        side="bottom"
        className="w-[min(18.75rem,calc(100vw-1.5rem))] p-3"
        trigger={
          <button type="button" className="sg-session-info" aria-label={label}>
            <Info size={13} />
          </button>
        }
      >
        <SessionDetails conversation={conversation} />
        <Link
          to={conversationPath(conversation)}
          onClick={() => setOpen(false)}
          className="mt-3 flex min-h-11 items-center justify-center rounded-md border border-line text-sm text-ink hover:bg-surface-high"
        >
          {t('sessionRef.open')}
        </Link>
      </Popover>
      {hovered && !open ? (
        <HoverPreview anchor={hovered}>
          <SessionDetails conversation={conversation} />
        </HoverPreview>
      ) : null}
    </span>
  )
}

/**
 * Les puces des sessions citées dans un texte rendu.
 *
 * Le HTML appartient à markdown-it, qui n'y laisse que des emplacements vides
 * (`data-sg-session-ref`) ; React y monte la puce par un portail. Elle garde ainsi un
 * vrai lien, l'icône du CLI et le panneau du design system, jusque dans une cellule de
 * tableau, et suit un renommage sans que le texte soit analysé de nouveau.
 */
export function useSessionReferencePortals({
  root,
  segments,
  sessions,
  loading,
}: {
  root: RefObject<HTMLDivElement | null>
  /** Ce qui change le HTML, donc les emplacements : on les recherche à chaque fois. */
  segments: unknown
  sessions: Map<string, ConversationDto>
  loading: boolean
}): ReactNode[] {
  const [slots, setSlots] = useState<HTMLElement[]>([])
  useLayoutEffect(() => {
    const found = Array.from(root.current?.querySelectorAll<HTMLElement>('[data-sg-session-ref]') ?? [])
    setSlots((previous) =>
      previous.length === found.length && previous.every((slot, index) => slot === found[index]) ? previous : found,
    )
  }, [root, segments])
  return slots.map((slot, index) => {
    const id = slot.dataset.sgSessionRef ?? ''
    return createPortal(
      <SessionReference id={id} conversation={sessions.get(id)} loading={loading} />,
      slot,
      `${id}-${index}`,
    )
  })
}
