import { ArrowRight, ArrowUpRight, Check } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { AgentKind } from '@solera/protocol'
import { Button, ProgressRing, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { STATE_DOT } from '../gantt/tones'
import { WaitingMark } from '../inbox/WaitingMark'
import { MaturityTag } from '../milestones/MaturityTag'
import { cardDestinationHref } from '../../lib/card-destination'
import { loadedStatus, type StatusOf } from '../../lib/card-state'
import { pluralOf } from '../../lib/code-model'
import { relativeDate } from '../../lib/dates'
import { locale, useTranslate } from '../../lib/i18n'
import { waitingByMilestone, type InboxItem, type MilestoneWaiting } from '../../lib/inbox'
import {
  beaconOf,
  beaconProgress,
  beaconSessions,
  beaconWaves,
  concurrencyOf,
  currentWave,
  type BeaconSession,
  type BeaconWave,
} from '../../lib/milestone-beacon'
import { nextAction, nextActionText, type MilestoneEntry } from '../../lib/milestone-model'
import { useAllConversations } from '../../lib/conversations'
import { useMilestones } from '../../lib/milestones'

/** Ce qui attend dans chaque jalon, par numéro : le repère « N t'attend » et la demande qu'il ouvre. */
type Waiting = ReadonlyMap<number, MilestoneWaiting>

const NO_AGENTS: ReadonlyMap<string, AgentKind> = new Map()

/** Sessions montrées sous le titre avant « +N ». */
const SESSIONS_SHOWN = 6
/** Lignes de chaque file avant « +N autres ». */
const QUEUE_SHOWN = 4

const milestoneHref = (projectId: string, number: number) => `/p/${projectId}/timeline/${number}`

/**
 * Le **phare des jalons** de l'Aperçu (#174, `projet.md` A-3) : la seule surface teintée
 * de la page. Le jalon courant en grand — anneau, maturité, sessions, vagues, le geste
 * suivant —, à sa droite la file de ce qui vient ensuite et plus tard.
 *
 * `inbox` est la liste de « Ce qui t'attend » posée au-dessus : le phare n'en montre que
 * le repère, la demande vit là-haut, une seule fois.
 */
export function MilestoneBeacon({ projectId, inbox }: { projectId: string; inbox: InboxItem[] }) {
  const { entries, statusOf, isPending } = useMilestones(projectId)
  const waiting = useMemo(() => waitingByMilestone(inbox), [inbox])
  // Le CLI d'une session d'affinage, que la carte ne porte pas.
  const { data: conversations } = useAllConversations()
  const agents = useMemo(
    () => new Map((conversations ?? []).map((conversation) => [conversation.id, conversation.agent])),
    [conversations],
  )
  if (isPending) return null
  return <MilestoneBeaconView projectId={projectId} entries={entries} waiting={waiting} statusOf={statusOf} agents={agents} />
}

export function MilestoneBeaconView({
  projectId,
  entries,
  waiting,
  statusOf = loadedStatus,
  agents = NO_AGENTS,
}: {
  projectId: string
  entries: MilestoneEntry[]
  waiting: Waiting
  statusOf?: StatusOf
  /** Le CLI de chaque conversation, pour la session d'affinage. */
  agents?: ReadonlyMap<string, AgentKind>
}) {
  const t = useTranslate()
  const { current, next, later, delivered } = useMemo(() => beaconOf(entries), [entries])

  if (!current) {
    return (
      <section aria-label={t('project.overview.beacon.label')} className="rounded-xl bg-surface p-6">
        <p className="text-sm text-ink-faint">{t('project.overview.beacon.empty')}</p>
      </section>
    )
  }
  return (
    <section
      aria-label={t('project.overview.beacon.label')}
      className="grid gap-8 rounded-xl bg-surface p-6 lg:grid-cols-[minmax(0,1fr)_17rem]"
    >
      <Current
        projectId={projectId}
        entry={current}
        waiting={waiting.get(current.card.number) ?? null}
        statusOf={statusOf}
        agents={agents}
      />
      <aside className="flex min-w-0 flex-col gap-6 lg:border-l lg:border-line lg:pl-8">
        <Queue projectId={projectId} title={t('project.overview.beacon.next')} entries={next} waiting={waiting} />
        <Queue projectId={projectId} title={t('project.overview.beacon.later')} entries={later} waiting={waiting} />
        <Link
          to={`/p/${projectId}/timeline`}
          className="mt-auto inline-flex items-center gap-1 self-start rounded text-xs text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:min-h-11"
        >
          {t('project.overview.beacon.all')}
          {delivered
            ? `${t('project.overview.beacon.joiner')}${t(`project.overview.beacon.delivered.${pluralOf(delivered)}`, { count: delivered })}`
            : null}
          <ArrowUpRight size={12} aria-hidden />
        </Link>
      </aside>
    </section>
  )
}

function Current({
  projectId,
  entry,
  waiting,
  statusOf,
  agents,
}: {
  projectId: string
  entry: MilestoneEntry
  waiting: MilestoneWaiting | null
  statusOf: StatusOf
  agents: ReadonlyMap<string, AgentKind>
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const to = milestoneHref(projectId, entry.card.number)
  const { done, total, share } = beaconProgress(entry)
  const next = nextAction(entry)
  // La question d'une session bloquée vit dans « Ce qui t'attend » : le phare ne la redit
  // pas, même quand le repère manque le temps que la liste suive (A-3.8).
  const action = nextActionText(next.kind === 'answerBlock' ? { ...next, request: null } : next, t)
  const joiner = t('project.overview.beacon.joiner')
  const facts = [
    t('project.overview.beacon.number', { number: entry.card.number }),
    entry.card.dueAt === null
      ? t('project.overview.beacon.noDue')
      : t('project.overview.beacon.due', { when: relativeDate(entry.card.dueAt) }),
    entry.addedSinceLaunch.length ? t('project.overview.beacon.added', { count: entry.addedSinceLaunch.length }) : null,
  ]

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* L'identité du jalon : l'anneau, puis ce qu'il est, où il en est, et qui y travaille. */}
      <div className="flex items-start gap-5">
        <ProgressRing value={share} size={88} stroke={8} label={t('project.overview.beacon.ring', { done, total })}>
          <span aria-hidden className="flex flex-col items-center">
            <span className="text-heading font-semibold tabular-nums">
              {new Intl.NumberFormat(locale(), { style: 'percent' }).format(share)}
            </span>
            <span className="text-meta text-ink-faint tabular-nums">
              {t('project.overview.beacon.ring.count', { done, total })}
            </span>
          </span>
        </ProgressRing>
        <div className="flex min-w-0 flex-col gap-1.5 pt-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-xs font-medium text-ink-faint">{t('project.overview.beacon.current')}</span>
            <MaturityTag maturity={entry.maturity} />
          </span>
          <Link
            to={to}
            className="truncate rounded text-lg font-semibold tracking-tight hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            {entry.card.title}
          </Link>
          <span className="text-xs text-ink-faint">{facts.filter(Boolean).join(joiner)}</span>
          <Sessions projectId={projectId} sessions={beaconSessions(entry, statusOf, agents)} />
        </div>
      </div>

      <Waves projectId={projectId} waves={beaconWaves(entry)} concurrency={concurrencyOf(entry)} statusOf={statusOf} />

      {/* Le geste suivant. Une demande en attente ne se redit pas ici : le repère y mène (A-3.8). */}
      {waiting ? (
        <div className="flex flex-wrap items-center gap-3">
          <WaitingMark waiting={waiting} />
          <span className="text-sm text-ink-soft">{t('project.overview.beacon.resumes')}</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" icon={<ArrowRight size={14} />} onClick={() => navigate(to)}>
            {action.label}
          </Button>
          <span className="min-w-0 text-sm text-ink-faint">{action.detail}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Les sessions vivantes du jalon, groupées sous son titre (A-3.6) : « 2 sessions · 1
 * t'attend », puis chaque agent avec le point de son état et le titre de sa carte.
 */
function Sessions({ projectId, sessions }: { projectId: string; sessions: BeaconSession[] }) {
  const t = useTranslate()
  if (sessions.length === 0) return <span className="text-xs text-ink-faint">{t('project.overview.beacon.sessions.none')}</span>
  const awaiting = sessions.filter((session) => session.tone === 'awaiting').length
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
      <span>
        {t(`project.overview.beacon.sessions.${pluralOf(sessions.length)}`, { count: sessions.length })}
        {awaiting ? (
          <span className="text-caution">
            {t('project.overview.beacon.joiner')}
            {t(`project.overview.beacon.sessions.waiting.${pluralOf(awaiting)}`, { count: awaiting })}
          </span>
        ) : null}
      </span>
      <span className="flex flex-wrap items-center gap-1">
        {sessions.slice(0, SESSIONS_SHOWN).map((session) => (
          <Link
            key={session.id}
            to={`/p/${projectId}/c/${session.id}`}
            title={t(`project.overview.beacon.session.${session.tone}`, { title: session.title })}
            className="inline-flex h-6 items-center gap-1.5 rounded-full bg-canvas px-2 ring-1 ring-line hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-accent"
          >
            <AgentIcon agent={session.agent} size={12} decorative />
            <span
              aria-hidden
              className={cx(
                'size-1.5 rounded-full',
                session.tone === 'awaiting' ? 'bg-caution' : 'bg-accent motion-safe:animate-pulse',
              )}
            />
            <span className="max-w-[9rem] truncate">{session.title}</span>
          </Link>
        ))}
        {sessions.length > SESSIONS_SHOWN ? (
          <span className="text-ink-faint">{t('project.overview.beacon.sessions.more', { count: sessions.length - SESSIONS_SHOWN })}</span>
        ) : null}
      </span>
    </span>
  )
}

/**
 * Les vagues du jalon, nommées et comptées (A-3.7) : « Vague 2 · 1/3 », ses cartes en
 * pastilles de la couleur de leur état, le numéro au survol. La vague en cours — la
 * première qui a encore du travail — est cerclée d'accent ; les finies s'effacent.
 */
function Waves({
  projectId,
  waves,
  concurrency,
  statusOf,
}: {
  projectId: string
  waves: BeaconWave[]
  concurrency: number
  statusOf: StatusOf
}) {
  const t = useTranslate()
  const [search] = useSearchParams()
  if (waves.length === 0) return <p className="text-sm text-ink-faint">{t('project.overview.beacon.waves.empty')}</p>
  const current = currentWave(waves)
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-ink-faint">
        {t(`project.overview.beacon.waves.${pluralOf(waves.length)}`, { count: waves.length })}
        {t('project.overview.beacon.joiner')}
        {t(`project.overview.beacon.concurrency.${pluralOf(concurrency)}`, { count: concurrency })}
      </span>
      <ol className="flex flex-wrap items-stretch gap-2">
        {waves.map((wave, index) => {
          const isCurrent = index === current
          const finished = wave.open === 0
          return (
            <li key={index} className="flex items-center gap-2">
              <div
                className={cx(
                  'flex min-w-[7.5rem] flex-col gap-2 rounded-lg px-3 py-2.5',
                  isCurrent ? 'bg-canvas ring-1 ring-accent/50' : 'ring-1 ring-line',
                  finished && 'opacity-60',
                )}
              >
                <span className={cx('flex items-center gap-1.5 text-xs', isCurrent ? 'font-medium text-ink' : 'text-ink-faint')}>
                  {finished ? <Check size={12} aria-hidden className="text-positive" /> : null}
                  {t('project.overview.beacon.wave', { n: index + 1 })}
                  <span className="text-ink-faint tabular-nums">
                    {t('project.overview.beacon.wave.progress', { done: wave.done, total: wave.cards.length })}
                  </span>
                  {isCurrent ? <span className="text-accent">{t('project.overview.beacon.wave.current')}</span> : null}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {wave.cards.map(({ card, state }) => {
                    const label = t('project.overview.beacon.wave.card', {
                      number: card.number,
                      title: card.title,
                      state: t(`card.state.${state}`),
                    })
                    return (
                      <Link
                        key={card.id}
                        to={cardDestinationHref(projectId, card, { statusOf, search })}
                        title={label}
                        aria-label={label}
                        className={cx(
                          'size-3.5 rounded-full ring-2 ring-transparent transition-transform hover:scale-125 hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-accent',
                          STATE_DOT[state],
                          state === 'running' && 'motion-safe:animate-pulse',
                        )}
                      />
                    )
                  })}
                </span>
              </div>
              {index < waves.length - 1 ? <ArrowRight aria-hidden size={14} className="shrink-0 text-ink-faint" /> : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Une file à droite du jalon courant (A-3.9) : quatre lignes, puis « +N autres ». */
function Queue({
  projectId,
  title,
  entries,
  waiting,
}: {
  projectId: string
  title: string
  entries: MilestoneEntry[]
  waiting: Waiting
}) {
  const t = useTranslate()
  const hidden = entries.length - QUEUE_SHOWN
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium text-ink-faint tabular-nums">
        {t('project.overview.beacon.queue.count', { title, count: entries.length })}
      </h3>
      {entries.length === 0 ? (
        <p className="py-1 text-sm text-ink-faint">{t('project.overview.beacon.queue.empty')}</p>
      ) : (
        <ul className="flex flex-col">
          {entries.slice(0, QUEUE_SHOWN).map((entry) => {
            const mine = waiting.get(entry.card.number)
            const hint = mine ? t(`project.overview.beacon.queue.waiting.${pluralOf(mine.count)}`, { count: mine.count }) : null
            return (
              <li key={entry.card.id}>
                <Link
                  to={milestoneHref(projectId, entry.card.number)}
                  className="-mx-2 flex h-8 items-center gap-3 rounded-md px-2 text-sm hover:bg-surface-high focus-visible:outline-2 focus-visible:outline-accent pointer-coarse:h-11"
                >
                  <span className="min-w-0 flex-1 truncate">{entry.card.title}</span>
                  {hint ? <span role="img" aria-label={hint} title={hint} className="size-1.5 shrink-0 rounded-full bg-caution" /> : null}
                  <MaturityTag maturity={entry.maturity} />
                </Link>
              </li>
            )
          })}
          {hidden > 0 ? (
            <li className="pt-1 text-xs text-ink-faint">
              {t(`project.overview.beacon.queue.more.${pluralOf(hidden)}`, { count: hidden })}
            </li>
          ) : null}
        </ul>
      )}
    </div>
  )
}
