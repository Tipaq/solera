/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ArrowRight, CalendarClock, Flag, Info, Play, SquareKanban } from 'lucide-react'
import { useMemo, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { parseSubtasks, type CardConversationDto, type CardDto, type CardLinkDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { Markdown } from '../../components/chat/Markdown'
import { AskInbox, type InboxItem } from '../../components/prototype/AskInbox'
import { Drawer, DrawerHeader } from '../../components/prototype/Drawer'
import { useLiveConversations } from '../../lib/activity'
import { useCardNotes, useToggleSubtask } from '../../lib/cards'
import { useAllConversations } from '../../lib/conversations'
import { elapsed, relativeDate } from '../../lib/dates'
import { useSessionRequests } from '../../lib/session-requests'
import { answerCardSession, toggleDemoSubtask } from './demo-store'
import { isFlaggedMilestone, setMilestoneFlag, useMilestoneFlagsVersion } from './flags'
import { STATE_DOT, STATE_LABEL, isLate, stateOf, useProtoData, useProtoHref } from './model'

/**
 * La fiche d'une carte **sur place**, hors du board (décidé le 2026-11-10, refaite le
 * 2026-11-11) : une icône ℹ, un événement ou une carte qui t'attend l'ouvrent par-dessus
 * la vue, sans la quitter.
 *
 * Dans l'ordre de ce qu'on vient y faire : répondre à la session qui attend, voir où en
 * sont ses sessions, cocher, suivre les dépendances, lire. Les gestes de fond (ouvrir
 * la session, le board) sont en pied.
 *
 * L'état est dans l'adresse (`?fiche=<numéro>`), comme `?carte=` au board : un lien
 * partagé rouvre la fiche. Monter `<CardDrawerHost />` au niveau de la page.
 */
export const DRAWER_PARAM = 'fiche'

/** L'icône ℹ à poser sur une carte cliquable. Elle n'ouvre pas la session. */
export function CardInfoButton({ card, className }: { card: Pick<CardDto, 'number' | 'title'>; className?: string }) {
  const [, setParams] = useSearchParams()
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setParams((current) => {
      current.set(DRAWER_PARAM, String(card.number))
      return current
    })
  }
  /* Un `span` qui joue le bouton, et non un `button` : l'icône se pose dans des liens et
     des boutons (la carte entière mène à sa session), où un bouton imbriqué est invalide. */
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={`Détail de la carte #${card.number}`}
      title="Détail de la carte"
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') open(event)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className={cx(
        'inline-flex size-5 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-surface-high hover:text-ink',
        className,
      )}
    >
      <Info size={13} />
    </span>
  )
}

export function CardDrawerHost() {
  const { projectId } = useParams()
  const [params, setParams] = useSearchParams()
  const data = useProtoData(projectId)
  useMilestoneFlagsVersion()
  const wanted = Number(params.get(DRAWER_PARAM))
  const card = wanted ? data.cards.find((entry) => entry.number === wanted) : undefined

  const close = () =>
    setParams((current) => {
      current.delete(DRAWER_PARAM)
      return current
    })

  if (!projectId || !card) return null
  return (
    <Drawer open onClose={close} label={`Carte #${card.number}`}>
      <Fiche
        key={card.id}
        card={card}
        cards={data.cards}
        projectId={projectId}
        demo={data.demo}
        question={Object.values(data.runs).find((run) => run.blocked?.cardId === card.id)?.blocked?.question ?? null}
        onClose={close}
        onSelect={(number) =>
          setParams((current) => {
            current.set(DRAWER_PARAM, String(number))
            return current
          })
        }
      />
    </Drawer>
  )
}

/* ------------------------------------------------------------------ la fiche */

const SESSION_WORD: Record<CardConversationDto['status'], { label: string; tone: string }> = {
  awaiting_input: { label: 't’attend', tone: 'text-caution' },
  running: { label: 'tourne', tone: 'text-accent' },
  error: { label: 'en erreur', tone: 'text-critical' },
  interrupted: { label: 'interrompue', tone: 'text-ink-faint' },
  idle: { label: 'au repos', tone: 'text-ink-faint' },
}

/** Une ligne de case à cocher, à retirer du texte rendu : la section Sous-tâches la montre. */
const TASK_LINE = /^\s*[-*+]\s+\[( |x|X)\]/

function Fiche({
  card,
  cards,
  projectId,
  demo,
  question,
  onClose,
  onSelect,
}: {
  card: CardDto
  cards: CardDto[]
  projectId: string
  demo: boolean
  question: string | null
  onClose: () => void
  onSelect: (number: number) => void
}) {
  const href = useProtoHref()
  const state = stateOf(card)
  const late = isLate(card)
  const parent = card.parent ? cards.find((entry) => entry.id === card.parent!.id) : undefined
  const sessions = card.conversations.filter((entry) => entry.archivedAt === null).sort((a, b) => b.createdAt - a.createdAt)

  /* L'état vivant des vraies sessions : celui du socket, pas celui du chargement des
     cartes ; et la demande de celle qui attend, pour y répondre ici. */
  const { data: all } = useAllConversations()
  const mine = useMemo(() => (demo ? [] : (all ?? []).filter((entry) => card.conversations.some((session) => session.id === entry.id))), [all, card, demo])
  const live = useLiveConversations(mine)
  const requests = useSessionRequests(demo ? undefined : projectId, live)
  const statusOf = (session: CardConversationDto) => live.find((entry) => entry.conversation.id === session.id)?.status ?? session.status

  const waiting = sessions.find((session) => statusOf(session) === 'awaiting_input')
  const inbox: InboxItem[] = waiting
    ? [
        {
          kind: 'session',
          key: waiting.id,
          title: waiting.title,
          agent: waiting.agent,
          tone: 'awaiting',
          since: null,
          milestone: null,
          cardNumber: null,
          open: href(`/p/${projectId}/c/${waiting.id}`),
          reply: demo
            ? {
                type: 'demo',
                question: question ?? 'Je peux supprimer l’ancien composant, ou faut-il le garder derrière un réglage le temps de la transition ?',
                onAnswer: (text) => answerCardSession(card.id, text),
              }
            : {
                type: 'real',
                conversationId: waiting.id,
                request: requests.get(waiting.id) ?? null,
                canDecide: mine.find((entry) => entry.id === waiting.id)?.isOwner ?? false,
              },
        },
      ]
    : []

  const subtasks = parseSubtasks(card.description)
  const toggle = useToggleSubtask(projectId, card.id)
  const checkTask = (index: number, checked: boolean, label: string) =>
    demo ? toggleDemoSubtask(card.id, index, checked) : toggle.mutate({ index, checked, label })
  const prose = card.description
    .split('\n')
    .filter((line) => !TASK_LINE.test(line))
    .join('\n')
    .trim()

  const lead = sessions.find((session) => statusOf(session) !== 'idle') ?? sessions[0]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* En-tête commun des tiroirs : où l'on est, puis le titre. */}
      <DrawerHeader
        title={card.title}
        onClose={onClose}
        subtitle={
          <>
            <span className="tabular-nums">#{card.number}</span>
            <span className="inline-flex items-center gap-1.5 text-ink-soft">
              <span className={cx('size-2 rounded-full', waiting ? 'bg-caution' : STATE_DOT[state])} />
              {waiting ? 't’attend' : STATE_LABEL[state]}
            </span>
            {parent ? (
              <Link
                to={href(`/p/${projectId}/timeline/${parent.number}?variant=jalon-v2`)}
                className="inline-flex min-w-0 items-center gap-1 rounded-full bg-surface-high px-2 py-0.5 text-ink-soft hover:bg-line hover:text-ink"
              >
                <Flag size={10} className="shrink-0" />
                <span className="truncate">Jalon #{parent.number} {parent.title}</span>
              </Link>
            ) : null}
            {card.dueAt !== null ? (
              <span className={cx('inline-flex items-center gap-1', late ? 'font-medium text-critical' : '')}>
                <CalendarClock size={11} />
                {relativeDate(card.dueAt)}
              </span>
            ) : null}
            {demo ? <span className="text-fuchsia-600 dark:text-fuchsia-300">démo</span> : null}
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-5 py-5">
        {inbox.length ? <AskInbox items={inbox} bare /> : null}

        <Section title="Sessions" aside={sessions.length ? String(sessions.length) : undefined}>
          {sessions.length === 0 ? (
            <p className="text-sm text-ink-faint">Aucune session sur cette carte pour l’instant.</p>
          ) : (
            <ul className="flex flex-col">
              {sessions.map((session) => {
                const word = SESSION_WORD[statusOf(session)]
                return (
                  <li key={session.id}>
                    <Link
                      to={href(`/p/${projectId}/c/${session.id}`)}
                      className="-mx-2 flex min-h-10 items-center gap-2.5 rounded-lg px-2 hover:bg-surface"
                    >
                      <AgentIcon agent={session.agent} size={14} />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{session.title}</span>
                      {session.worktreeName ? <span className="hidden truncate font-mono text-xs text-ink-faint sm:block">{session.worktreeName}</span> : null}
                      <span className={cx('shrink-0 text-xs', word.tone)}>{word.label}</span>
                      <ArrowRight size={13} className="shrink-0 text-ink-faint" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        {subtasks.length ? (
          <Section title="Sous-tâches" aside={`${subtasks.filter((task) => task.checked).length} / ${subtasks.length}`}>
            <div className="mb-1 h-1 overflow-hidden rounded-full bg-surface-high">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${(subtasks.filter((task) => task.checked).length / subtasks.length) * 100}%` }}
              />
            </div>
            <ul className="flex flex-col">
              {subtasks.map((task) => (
                <li key={task.index}>
                  <label className="-mx-2 flex min-h-9 cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
                      checked={task.checked}
                      onChange={(event) => checkTask(task.index, event.target.checked, task.label)}
                    />
                    <span className={cx('text-sm', task.checked ? 'text-ink-faint line-through' : 'text-ink')}>{task.label}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {card.blockedBy.length || card.blocks.length || card.children.length ? (
          <Section title="Liens">
            <div className="grid gap-4 sm:grid-cols-2">
              <Links title="Bloquée par" entries={card.blockedBy} onSelect={onSelect} />
              <Links title="Bloque" entries={card.blocks} onSelect={onSelect} />
              <Links title="Dedans" entries={card.children} onSelect={onSelect} />
            </div>
          </Section>
        ) : null}

        <Section title="Description">
          {prose ? <Markdown text={prose} /> : <p className="text-sm text-ink-faint">Pas de description.</p>}
        </Section>

        {demo ? null : <Notes cardId={card.id} />}
      </div>

      {/* Pied : les gestes de fond. Le drapeau « jalon » y vit, discret. */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
        {lead ? (
          <Link
            to={href(`/p/${projectId}/c/${lead.id}`)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink hover:bg-accent-hover"
          >
            Ouvrir la session
            <ArrowRight size={14} />
          </Link>
        ) : (
          <Link
            to={href(`/p/${projectId}/c/new?card=${card.id}`)}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink hover:bg-accent-hover"
          >
            <Play size={14} />
            Lancer une session
          </Link>
        )}
        <Link
          to={href(`/p/${projectId}/board?carte=${card.number}`)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm text-ink-soft hover:border-line-strong hover:text-ink"
        >
          <SquareKanban size={14} />
          Voir dans le tableau
        </Link>
        <MilestoneFlag card={card} />
      </footer>
    </div>
  )
}

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-baseline gap-2 text-xs font-medium text-ink-faint">
        {title}
        {aside ? <span className="tabular-nums">{aside}</span> : null}
      </h3>
      {children}
    </section>
  )
}

function Links({ title, entries, onSelect }: { title: string; entries: CardLinkDto[]; onSelect: (number: number) => void }) {
  if (entries.length === 0) return null
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-ink-faint">{title}</span>
      {entries.map((entry) => {
        const closed = entry.column === 'done' || entry.column === 'abandoned'
        return (
          <button
            key={entry.id}
            type="button"
            onClick={() => onSelect(entry.number)}
            className="-mx-2 flex min-h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface"
          >
            <span className={cx('size-2 shrink-0 rounded-full', closed ? 'bg-positive' : entry.column === 'in_progress' ? 'bg-accent' : 'bg-line-strong')} />
            <span className="shrink-0 text-xs text-ink-faint tabular-nums">#{entry.number}</span>
            <span className={cx('min-w-0 truncate', closed ? 'text-ink-faint' : 'text-ink')}>{entry.title}</span>
          </button>
        )
      })}
    </div>
  )
}

function Notes({ cardId }: { cardId: string }) {
  const { data } = useCardNotes(cardId)
  const notes = [...(data ?? [])].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)
  if (notes.length === 0) return null
  return (
    <Section title="Notes récentes" aside={data && data.length > 3 ? `3 sur ${data.length}` : undefined}>
      <ul className="flex flex-col gap-4">
        {notes.map((note) => (
          <li key={note.id} className="flex flex-col gap-1">
            <span className="flex items-center gap-2 text-xs text-ink-faint">
              {note.author.kind === 'agent' ? <AgentIcon agent={note.author.agent} size={12} /> : null}
              <span>{note.author.kind === 'agent' ? note.author.conversationTitle : note.author.name}</span>
              <span>· {elapsed(note.createdAt)}</span>
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

/** La case « C'est un jalon » : cochée et grisée d'office quand la carte a des enfants. */
function MilestoneFlag({ card }: { card: CardDto }) {
  const forced = card.children.length > 0
  const flagged = isFlaggedMilestone(card)
  const disabled = forced || card.parent !== null
  return (
    <label
      title={
        forced
          ? `d’office : ${card.children.length} carte(s) dedans`
          : card.parent !== null
            ? 'une carte rangée dans un jalon ne peut pas en être un'
            : 'cochée, la carte devient une idée de jalon, à affiner (simulé)'
      }
      className={cx('ml-auto inline-flex items-center gap-2 text-sm', disabled ? 'text-ink-faint' : 'cursor-pointer text-ink-soft')}
    >
      <input type="checkbox" checked={flagged} disabled={disabled} onChange={(event) => setMilestoneFlag(card.id, event.target.checked)} />
      C’est un jalon
    </label>
  )
}
