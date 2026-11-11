import { ArrowRight, CalendarClock, Flag, Play, SquareKanban } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { parseSubtasks, type CardDto, type CardLinkDto, type ConversationStatus } from '@solera/protocol'
import { Tooltip, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { Markdown } from '../chat/Markdown'
import { STATE_DOT } from '../gantt/tones'
import { AskInbox } from '../inbox/AskInbox'
import { Detail } from '../shell/Detail'
import { useLiveConversations } from '../../lib/activity'
import {
  descriptionProse,
  leadSession,
  milestoneFlag,
  recentNotes,
  sheetSessions,
  waitingSession,
  type StatusOf,
} from '../../lib/card-sheet'
import { cardState, isLate, isOpen } from '../../lib/card-state'
import { useCardNotes, useToggleSubtask, useUpdateCard } from '../../lib/cards'
import { useAllConversations } from '../../lib/conversations'
import { elapsed, relativeDate } from '../../lib/dates'
import { buildInbox } from '../../lib/inbox'
import { useTranslate } from '../../lib/i18n'
import { useSessionRequests } from '../../lib/session-requests'

const NO_PROJECTS = new Map()

/** L'état d'une session en mots colorés (FCH-5). */
const SESSION_TONE: Record<ConversationStatus, string> = {
  awaiting_input: 'text-caution',
  running: 'text-accent',
  error: 'text-critical',
  interrupted: 'text-ink-faint',
  idle: 'text-ink-faint',
}

/** Les gestes du pied, à la hauteur d'un `Button` `sm`. */
const FOOT_LINK = 'inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-sm whitespace-nowrap md:h-9 pointer-coarse:h-11'

export interface CardSheetProps {
  open: boolean
  projectId: string
  card: CardDto
  /** Le nom de l'onglet du panneau où l'on revient, quand la fiche s'ouvre en pile. */
  back?: string
  onClose: () => void
  /** Une carte liée cliquée : la fiche passe à elle. */
  onSelect: (number: number) => void
}

/**
 * La fiche d'une carte **sur place**, hors du board (#199, spec jalons FCH-3..9) : elle
 * s'ouvre par-dessus la vue, sans la quitter, là où `Detail` la pose — le tiroir commun
 * sur une page de lieu, en pile dans le panneau d'une conversation.
 *
 * Dans l'ordre de ce qu'on vient y faire : répondre à la session qui attend, voir où en
 * sont ses sessions, cocher, suivre les dépendances, lire. Les gestes de fond — ouvrir
 * la session, le board, le drapeau « jalon » — sont en pied. La fiche du board
 * (`CardDetail`, `?carte=`) reste celle où l'on édite.
 */
export function CardSheet({ open, projectId, card, back, onClose, onSelect }: CardSheetProps) {
  const t = useTranslate()
  const sessions = sheetSessions(card)

  /* L'état vivant des sessions : celui du socket, pas celui du chargement des cartes ;
     et la demande de celle qui attend, pour y répondre ici. */
  const { data: all } = useAllConversations()
  const mine = useMemo(
    () => (all ?? []).filter((entry) => card.conversations.some((session) => session.id === entry.id)),
    [all, card.conversations],
  )
  const live = useLiveConversations(mine)
  const requests = useSessionRequests(projectId, live)
  const statusOf: StatusOf = (session) => live.find((entry) => entry.conversation.id === session.id)?.status ?? session.status
  const inbox = useMemo(
    () =>
      buildInbox({ live, requests, projects: NO_PROJECTS, prefixProject: false }).filter(
        (item) => item.kind === 'session' && item.tone === 'awaiting',
      ),
    [live, requests],
  )
  const waiting = inbox.length > 0 || waitingSession(sessions, statusOf) !== undefined

  const state = cardState(card)
  const late = isLate(card)
  const subtitle = (
    <>
      <span className="tabular-nums">#{card.number}</span>
      <span className="inline-flex items-center gap-1.5 text-ink-soft">
        <span aria-hidden className={cx('size-2 rounded-full', waiting ? 'bg-caution' : STATE_DOT[state])} />
        {waiting ? t('cardSheet.awaiting') : t(`card.state.${state}`)}
      </span>
      {card.parent ? (
        <Link
          to={`/p/${projectId}/timeline/${card.parent.number}`}
          className="inline-flex min-w-0 items-center gap-1 rounded-full bg-surface-high px-2 py-0.5 text-ink-soft hover:bg-line hover:text-ink"
        >
          <Flag size={10} aria-hidden className="shrink-0" />
          <span className="truncate">{t('cardSheet.parent', { number: card.parent.number, title: card.parent.title })}</span>
        </Link>
      ) : null}
      {card.dueAt !== null ? (
        <span className={cx('inline-flex items-center gap-1', late && 'font-medium text-critical')}>
          <CalendarClock size={11} aria-hidden />
          {relativeDate(card.dueAt)}
        </span>
      ) : null}
    </>
  )

  const lead = leadSession(sessions, statusOf)

  return (
    <Detail
      open={open}
      onClose={onClose}
      label={t('cardSheet.label', { number: card.number })}
      title={card.title}
      subtitle={subtitle}
      back={back ?? t('cardSheet.back')}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-5 py-5">
        {inbox.length ? <AskInbox items={inbox} bare /> : null}

        <Section title={t('cardSheet.sessions')} aside={sessions.length ? String(sessions.length) : undefined}>
          {sessions.length === 0 ? (
            <p className="text-sm text-ink-faint">{t('cardSheet.sessions.empty')}</p>
          ) : (
            <ul className="flex flex-col">
              {sessions.map((session) => {
                const status = statusOf(session)
                return (
                  <li key={session.id}>
                    <Link
                      to={`/p/${projectId}/c/${session.id}`}
                      className="-mx-2 flex min-h-10 items-center gap-2.5 rounded-lg px-2 hover:bg-surface pointer-coarse:min-h-11"
                    >
                      <AgentIcon agent={session.agent} size={14} />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{session.title}</span>
                      {session.worktreeName ? (
                        <span className="hidden max-w-[12rem] truncate font-mono text-xs text-ink-faint sm:block">{session.worktreeName}</span>
                      ) : null}
                      <span className={cx('shrink-0 text-xs', SESSION_TONE[status])}>{t(`cardSheet.session.${status}`)}</span>
                      <ArrowRight size={13} aria-hidden className="shrink-0 text-ink-faint" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Subtasks projectId={projectId} card={card} />

        {card.blockedBy.length || card.blocks.length || card.children.length ? (
          <Section title={t('cardSheet.links')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Links title={t('cardSheet.links.blockedBy')} entries={card.blockedBy} onSelect={onSelect} />
              <Links title={t('cardSheet.links.blocks')} entries={card.blocks} onSelect={onSelect} />
              <Links title={t('cardSheet.links.children')} entries={card.children} onSelect={onSelect} />
            </div>
          </Section>
        ) : null}

        <Description text={card.description} />

        <Notes cardId={card.id} />
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        {lead ? (
          <Link to={`/p/${projectId}/c/${lead.id}`} className={cx(FOOT_LINK, 'bg-accent font-medium text-accent-ink hover:bg-accent-hover')}>
            {t('cardSheet.openSession')}
            <ArrowRight size={14} aria-hidden />
          </Link>
        ) : (
          <Link to={`/p/${projectId}/c/new?card=${card.id}`} className={cx(FOOT_LINK, 'bg-accent font-medium text-accent-ink hover:bg-accent-hover')}>
            <Play size={14} aria-hidden />
            {t('cardSheet.launchSession')}
          </Link>
        )}
        <Link
          to={`/p/${projectId}/board?carte=${card.number}`}
          className={cx(FOOT_LINK, 'border border-line text-ink-soft hover:border-line-strong hover:text-ink')}
        >
          <SquareKanban size={14} aria-hidden />
          {t('cardSheet.board')}
        </Link>
        <MilestoneFlag projectId={projectId} card={card} />
      </footer>
    </Detail>
  )
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2 text-xs font-medium text-ink-faint">
        {title}
        {aside ? <span className="tabular-nums">{aside}</span> : null}
      </h3>
      {children}
    </section>
  )
}

/** Les cases de la description, cochables d'ici (FCH-6), par la route du board. */
function Subtasks({ projectId, card }: { projectId: string; card: CardDto }) {
  const t = useTranslate()
  const toggle = useToggleSubtask(projectId, card.id)
  /* Pendant l'écriture, la case dit déjà ce qu'on a demandé, posé dans le même rendu que
     le clic : la mutation n'est en cours qu'un tour plus tard, et une case contrôlée
     reviendrait d'ici là. Oublié une fois la liste relue, réussite ou échec. */
  const [asked, setAsked] = useState<{ index: number; checked: boolean } | null>(null)
  const subtasks = parseSubtasks(card.description).map((task) =>
    asked?.index === task.index ? { ...task, checked: asked.checked } : task,
  )
  if (subtasks.length === 0) return null
  const done = subtasks.filter((task) => task.checked).length
  return (
    <Section title={t('board.card.subtasks')} aside={t('cardSheet.subtasks.count', { done, total: subtasks.length })}>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={subtasks.length}
        aria-valuenow={done}
        aria-label={t('board.card.subtasks')}
        className="mb-1 h-1 overflow-hidden rounded-full bg-surface-high"
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(done / subtasks.length) * 100}%` }} />
      </div>
      <ul className="flex flex-col">
        {subtasks.map((task) => (
          <li key={task.index}>
            <label className="-mx-2 flex min-h-9 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface pointer-coarse:min-h-11">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                checked={task.checked}
                disabled={toggle.isPending}
                onChange={(event) => {
                  const checked = event.target.checked
                  setAsked({ index: task.index, checked })
                  toggle.mutate({ index: task.index, checked, label: task.label }, { onSettled: () => setAsked(null) })
                }}
              />
              <span className={cx('text-sm', task.checked ? 'text-ink-faint line-through' : 'text-ink')}>{task.label}</span>
            </label>
          </li>
        ))}
      </ul>
      {toggle.isError ? (
        <p role="alert" className="text-sm text-critical">
          {t('board.card.subtasks.error')}
        </p>
      ) : null}
    </Section>
  )
}

function Links({ title, entries, onSelect }: { title: string; entries: CardLinkDto[]; onSelect: (number: number) => void }) {
  if (entries.length === 0) return null
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-ink-faint">{title}</span>
      {entries.map((entry) => {
        const closed = !isOpen(entry)
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry.number)}
            className="-mx-2 flex min-h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface pointer-coarse:min-h-11"
          >
            <span
              aria-hidden
              className={cx('size-2 shrink-0 rounded-full', closed ? 'bg-positive' : entry.column === 'in_progress' ? 'bg-accent' : 'bg-line-strong')}
            />
            <span className="shrink-0 text-xs text-ink-faint tabular-nums">#{entry.number}</span>
            <span className={cx('min-w-0 truncate', closed ? 'text-ink-faint' : 'text-ink')}>{entry.title}</span>
          </button>
        )
      })}
    </div>
  )
}

function Description({ text }: { text: string }) {
  const t = useTranslate()
  const prose = descriptionProse(text)
  return (
    <Section title={t('cardSheet.description')}>
      {prose ? <Markdown text={prose} /> : <p className="text-sm text-ink-faint">{t('cardSheet.description.empty')}</p>}
    </Section>
  )
}

function Notes({ cardId }: { cardId: string }) {
  const t = useTranslate()
  const { data } = useCardNotes(cardId)
  const { shown, total } = recentNotes(data)
  if (shown.length === 0) return null
  return (
    <Section
      title={t('cardSheet.notes')}
      aside={total > shown.length ? t('cardSheet.notes.count', { shown: shown.length, total }) : undefined}
    >
      <ul className="flex flex-col gap-4">
        {shown.map((note) => (
          <li key={note.id} className="flex flex-col gap-1">
            <span className="flex min-w-0 items-center gap-2 text-xs text-ink-faint">
              {note.author.kind === 'agent' ? <AgentIcon agent={note.author.agent} size={12} decorative /> : null}
              <span className="min-w-0 truncate">{note.author.kind === 'agent' ? note.author.conversationTitle : note.author.name}</span>
              <span className="shrink-0">· {elapsed(note.createdAt)}</span>
            </span>
            <div className="line-clamp-6 text-sm">
              <Markdown text={note.body} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

/**
 * La case « C'est un jalon » (FLG-1) : cochée et grisée d'office quand la carte a des
 * enfants, grisée quand elle est rangée dans un jalon, libre sinon.
 */
function MilestoneFlag({ projectId, card }: { projectId: string; card: CardDto }) {
  const t = useTranslate()
  const update = useUpdateCard(projectId)
  const flag = milestoneFlag(card)
  // Pendant l'écriture, la case dit déjà ce qu'on a demandé : voir `Subtasks`.
  const [asked, setAsked] = useState<boolean | null>(null)
  const checked = asked ?? flag.checked
  const tip =
    flag.reason === 'children'
      ? t(card.children.length > 1 ? 'cardSheet.milestone.forced.many' : 'cardSheet.milestone.forced.one', { count: card.children.length })
      : flag.reason === 'parent'
        ? t('cardSheet.milestone.child')
        : t('cardSheet.milestone.free')
  return (
    <div className="ml-auto flex flex-col items-end gap-1">
      <Tooltip label={tip}>
        <label
          className={cx(
            'inline-flex min-h-9 items-center gap-2 text-sm pointer-coarse:min-h-11',
            flag.disabled ? 'text-ink-faint' : 'cursor-pointer text-ink-soft hover:text-ink',
          )}
        >
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-accent)]"
            checked={checked}
            disabled={flag.disabled || update.isPending}
            onChange={(event) => {
              setAsked(event.target.checked)
              update.mutate({ id: card.id, milestone: event.target.checked }, { onSettled: () => setAsked(null) })
            }}
          />
          {t('cardSheet.milestone')}
        </label>
      </Tooltip>
      {update.isError ? (
        <p role="alert" className="text-xs text-critical">
          {t('cardSheet.milestone.error')}
        </p>
      ) : null}
    </div>
  )
}
