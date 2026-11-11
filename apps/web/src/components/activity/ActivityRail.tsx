import { ChevronDown, Diamond } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { JOURNAL_FAMILY_OF, type AgentKind, type JournalEntryDto, type JournalFamily, type MilestoneRunDto } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { MilestoneTag } from '../code/MilestoneChip'
import { AskInbox } from '../inbox/AskInbox'
import { JOURNAL_KIND_ICONS } from '../journal/JournalView'
import { MilestoneBanner } from '../project/MilestoneBanner'
import { SessionRow } from '../project/SessionRow'
import type { ActivityRow } from '../../lib/activity-rows'
import { locale, useTranslate } from '../../lib/i18n'
import type { InboxItem } from '../../lib/inbox'
import { JOURNAL_KIND_LABELS, type JournalDay } from '../../lib/journal'
import { clustersOf, type Cluster, type MilestoneRef } from '../../lib/travail-model'

/** Ce que le fil montre, déjà filtré par la page qui le pose. */
export interface RailModel {
  projectId: string
  /** Les sessions vivantes, sans les terminées ; celles qui t'attendent sont dans `inbox`. */
  live: ActivityRow[]
  inbox: InboxItem[]
  /** Les jalons lancés : leur bandeau ouvre « Maintenant ». */
  runs: MilestoneRunDto[]
  /** L'historique, par jour, du plus récent au plus ancien. */
  days: JournalDay[]
  /** La fenêtre du journal, en jours. */
  journalDays: number
  /** Une recherche ou un filtre restreint le fil : un vide se dit « ne correspond ». */
  narrowed: boolean
  older: { can: boolean; loading: boolean; load: () => void }
  milestoneOfRow: (row: ActivityRow) => MilestoneRef | null
  milestoneOfEntry: (entry: JournalEntryDto) => MilestoneRef | null
  /** Une carte-jalon : sa fermeture est un jalon livré. */
  isMilestone: (cardNumber: number | null) => boolean
  agentOf: (entry: JournalEntryDto) => AgentKind | null
  entryHref: (entry: JournalEntryDto) => string | null
}

/**
 * La géométrie du rail : la colonne de l'heure (`w-12`, 3 rem), un écart `gap-3`
 * (0,75 rem), la pastille (`w-5`, 1,25 rem). L'axe du rail passe au milieu de la
 * pastille (3 + 0,75 + 0,625 = 4,375 rem), le contenu de « Maintenant » s'aligne sur le
 * texte des lignes (3 + 0,75 + 1,25 + 0,75 = 5,75 rem). Changer l'un change les autres.
 */
const TIME_W = 'w-12'
const RAIL_X = 'left-[4.375rem]'
const INDENT = 'pl-[5.75rem]'
/** L'heure d'une ligne, dans sa colonne. */
const TIME_CELL = cx(TIME_W, 'shrink-0 text-right text-ink-faint tabular-nums')

/**
 * Le fil d'un projet, « Par moment » (`projet.md` T-5) : le vivant, puis l'historique
 * par jour, sur un rail.
 *
 * - **Maintenant** : le bandeau des jalons lancés, « Ce qui t'attend » quand il y a des
 *   demandes, puis les sessions qui travaillent, encadrées, avec leur jalon et leur repère.
 * - **Les jours** : l'heure à gauche, une pastille par nature sur le rail, teintée par
 *   famille ; un jalon livré est un losange ; les événements rapprochés d'une même
 *   session ou carte se replient en un groupe (`clustersOf`).
 * - **En bas**, « Plus ancien » élargit la fenêtre du journal, au défilement ou au clic.
 *
 * Sans barre propre : la page porte la sienne, et les jours se collent tout en haut de
 * la zone qui défile. `before` se pose avant le rail, pleine largeur ; `entryAside` et
 * `rowAside` ajoutent un repère (la puce d'arbre) à une ligne.
 */
export function ActivityRail({
  model,
  before,
  entryAside,
  rowAside,
}: {
  model: RailModel
  before?: ReactNode
  entryAside?: (entry: JournalEntryDto) => ReactNode
  rowAside?: (row: ActivityRow) => ReactNode
}) {
  const t = useTranslate()
  const working = model.live.filter((row) => row.group !== 'asking')
  const pulse = model.live.length > 0 || model.inbox.length > 0

  return (
    <div className="px-4 pt-2 pb-28 md:px-6">
      {before ? <div className="flex flex-col gap-6 pt-2 pb-6">{before}</div> : null}
      <ol className="relative flex flex-col">
        {/* Le rail, derrière les pastilles : au milieu de la colonne de 1,25 rem qui suit l'heure. */}
        <span aria-hidden className={cx('absolute top-3 bottom-0 w-px -translate-x-1/2 bg-line', RAIL_X)} />

        <li className="relative flex flex-col gap-3 pb-6">
          <RailHead label={t('activityRail.now')} pulse={pulse} />
          {model.runs.map((run) => (
            <div key={run.id} className={INDENT}>
              <MilestoneBanner projectId={model.projectId} run={run} />
            </div>
          ))}
          {model.inbox.length > 0 ? (
            <div className={INDENT}>
              <AskInbox items={model.inbox} />
            </div>
          ) : null}
          {working.length > 0 ? (
            <section className={cx('flex flex-col gap-1.5', INDENT)}>
              <h3 className="text-xs font-medium text-ink-faint">
                {t('activityRail.working')} <span className="tabular-nums opacity-70">{working.length}</span>
              </h3>
              <div className="divide-y divide-line overflow-hidden rounded-lg ring-1 ring-line">
                {working.map((row) => {
                  const milestone = model.milestoneOfRow(row)
                  const aside = rowAside?.(row)
                  return (
                    <div key={row.entry.conversation.id}>
                      <ul>
                        <SessionRow conversation={row.entry.conversation} marker={row.marker} summary={row.summary} place={row.place} pr={row.pr} />
                      </ul>
                      {milestone || aside ? (
                        <div className="-mt-1.5 flex flex-wrap items-center gap-2 px-3 pb-1.5">
                          {milestone ? <MilestoneTag milestone={milestone} to={`/p/${model.projectId}/timeline/${milestone.number}`} /> : null}
                          {aside}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>
          ) : model.narrowed && model.inbox.length === 0 ? (
            <Quiet className={INDENT}>{t('activityRail.noLive')}</Quiet>
          ) : null}
        </li>

        {model.days.length === 0 ? (
          <li className="relative pb-6">
            <RailHead label={t('activityRail.before')} />
            <Quiet className={cx('pt-2', INDENT)}>
              {model.narrowed ? t('activityRail.noHistory') : t('activityRail.quiet', { count: model.journalDays })}
            </Quiet>
          </li>
        ) : (
          model.days.map((day) => (
            <li key={day.at} className="relative flex flex-col pb-4">
              <RailHead label={dayLabel(day.at, t)} />
              <ol className="flex flex-col">
                {clustersOf(day.entries).map((cluster) =>
                  cluster.entries.length === 1 ? (
                    <RailEntry key={cluster.key} entry={cluster.entries[0]!} model={model} aside={entryAside?.(cluster.entries[0]!)} />
                  ) : (
                    <RailCluster key={cluster.key} cluster={cluster} model={model} aside={entryAside?.(cluster.entries[0]!)} />
                  ),
                )}
              </ol>
            </li>
          ))
        )}
      </ol>

      <Older model={model} />
    </div>
  )
}

/* ------------------------------------------------------------------ rail */

type Translate = ReturnType<typeof useTranslate>

/** « Aujourd'hui », « Hier », puis le jour en toutes lettres dans la langue de l'interface. */
function dayLabel(at: number, t: Translate): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const gap = Math.round((today.getTime() - at) / 86_400_000)
  if (gap === 0) return t('activityRail.today')
  if (gap === 1) return t('activityRail.yesterday')
  return new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(at)
}

function timeOf(at: number): string {
  return new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit' }).format(at)
}

/** L'en-tête d'un tronçon du fil, collé en haut de la zone qui défile. */
function RailHead({ label, pulse = false }: { label: string; pulse?: boolean }) {
  return (
    <div className="sticky top-0 z-10 -mx-4 flex items-center gap-3 bg-canvas/95 px-4 py-1.5 backdrop-blur md:-mx-6 md:px-6">
      <span aria-hidden className={cx(TIME_W, 'shrink-0')} />
      <span aria-hidden className="flex w-5 shrink-0 justify-center">
        <span className={cx('relative size-2 rounded-full ring-4 ring-canvas', pulse ? 'bg-accent' : 'bg-ink-faint')}>
          {pulse ? <span className="absolute inset-0 animate-ping rounded-full bg-accent/60 motion-reduce:hidden" /> : null}
        </span>
      </span>
      <h2 className="text-xs font-semibold text-ink-soft first-letter:uppercase">{label}</h2>
    </div>
  )
}

function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-sm text-ink-faint', className)}>{children}</p>
}

/**
 * La teinte d'une famille, discrète : la pastille et son anneau, pas la ligne. Une
 * session en accent, une carte fermée en positif, un échec en ambre, le reste gris.
 */
const FAMILY_TONE: Record<JournalFamily, string> = {
  sessions: 'text-accent ring-accent/35 bg-accent-wash/40',
  cards: 'text-ink-soft ring-line bg-canvas',
  notes: 'text-ink ring-ink-faint/40 bg-sunken',
  repo: 'text-ink-soft ring-line bg-sunken',
}

function toneOf(entry: JournalEntryDto): string {
  if (entry.status === 'failed' || entry.status === 'timed_out') return 'text-caution ring-caution/40 bg-caution/10'
  if (entry.kind === 'cardClosed') return 'text-positive ring-positive/35 bg-positive/10'
  return FAMILY_TONE[JOURNAL_FAMILY_OF[entry.kind]]
}

function Pip({ entry, model, size = 'md' }: { entry: JournalEntryDto; model: RailModel; size?: 'md' | 'sm' }) {
  // Un jalon livré : la carte fermée est une carte-jalon. Un losange, plein, à part.
  if (entry.kind === 'cardClosed' && model.isMilestone(entry.cardNumber)) {
    return (
      <span aria-hidden className="relative z-[1] flex size-5 shrink-0 items-center justify-center">
        <Diamond size={16} className="fill-positive text-positive" />
      </span>
    )
  }
  const agent = entry.kind === 'session' ? model.agentOf(entry) : null
  return (
    <span
      aria-hidden
      className={cx('relative z-[1] flex shrink-0 items-center justify-center rounded-full ring-1', size === 'md' ? 'size-5' : 'size-4', toneOf(entry))}
    >
      {agent ? <AgentIcon agent={agent} size={10} decorative /> : <span className="scale-[0.7]">{JOURNAL_KIND_ICONS[entry.kind]}</span>}
    </span>
  )
}

/* ------------------------------------------------------------------ lignes */

/**
 * Toute la ligne mène où l'événement mène, par un lien étiré sur son titre : les repères
 * qu'elle porte (jalon, puce d'arbre) restent des gestes à part, au-dessus de lui, et
 * aucun lien ne se retrouve dans un autre.
 */
const ROW = 'group relative flex items-start gap-3 rounded-md py-1.5 pr-2'
const STRETCH = 'outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:outline-2 focus-visible:after:outline-accent'

function RailEntry({ entry, model, aside }: { entry: JournalEntryDto; model: RailModel; aside?: ReactNode }) {
  const to = model.entryHref(entry)
  return (
    <li className={cx(ROW, to && 'transition-colors hover:bg-sunken/60')}>
      <span className={cx(TIME_CELL, 'pt-0.5 text-xs')}>{timeOf(entry.at)}</span>
      <Pip entry={entry} model={model} />
      <EntryText entry={entry} model={model} to={to} aside={aside} />
    </li>
  )
}

function EntryText({ entry, model, to, compact = false, aside }: { entry: JournalEntryDto; model: RailModel; to: string | null; compact?: boolean; aside?: ReactNode }) {
  const t = useTranslate()
  const milestone = model.milestoneOfEntry(entry)
  const delivered = entry.kind === 'cardClosed' && model.isMilestone(entry.cardNumber)
  const title = (
    <>
      {delivered ? t('activityRail.delivered') : null}
      {entry.title}
    </>
  )
  const titleClass = cx('min-w-0 truncate text-sm', delivered ? 'font-medium text-positive' : 'text-ink', to && 'group-hover:text-accent')
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      {to ? (
        <Link to={to} className={cx(titleClass, STRETCH)}>
          {title}
        </Link>
      ) : (
        <span className={titleClass}>{title}</span>
      )}
      {compact ? null : (
        <span className="flex min-w-0 items-center gap-x-2 text-xs text-ink-faint">
          <span className="shrink-0">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
          {entry.cardNumber !== null ? <span className="shrink-0 tabular-nums">#{entry.cardNumber}</span> : null}
          {entry.source ? <span className="min-w-0 truncate">{entry.source}</span> : null}
          {milestone && !delivered ? (
            <span className="relative z-[1] -ml-1 flex min-w-0 shrink">
              <MilestoneTag milestone={milestone} to={`/p/${model.projectId}/timeline/${milestone.number}`} />
            </span>
          ) : null}
          {aside ? <span className="relative z-[1] flex min-w-0 shrink">{aside}</span> : null}
        </span>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ groupes */

/** Un groupe replié : « [N] titre · #n · N événements depuis HH:MM ⌄ » ; déplié, tout. */
function RailCluster({ cluster, model, aside }: { cluster: Cluster; model: RailModel; aside?: ReactNode }) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const head = cluster.entries[0]!
  const oldest = cluster.entries[cluster.entries.length - 1]!
  const label =
    cluster.subject?.kind === 'card' ? `#${cluster.subject.number}` : cluster.subject?.kind === 'session' ? (cluster.subject.source ?? t('activityRail.session')) : ''
  return (
    <li>
      <div className={cx(ROW, 'transition-colors hover:bg-sunken/60')}>
        <span className={cx(TIME_CELL, 'pt-0.5 text-xs')}>{timeOf(head.at)}</span>
        <span className="relative z-[1] flex size-5 shrink-0 items-center justify-center rounded-full bg-canvas text-micro font-semibold text-ink-soft tabular-nums ring-1 ring-line">
          {cluster.entries.length}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={cx('min-w-0 truncate text-left text-sm text-ink', STRETCH)}>
            {head.title}
          </button>
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
            <span className="shrink-0 tabular-nums">{label}</span>
            <span className="min-w-0 truncate">· {t('activityRail.cluster', { count: cluster.entries.length, time: timeOf(oldest.at) })}</span>
            <ChevronDown size={12} aria-hidden className={cx('shrink-0 transition-transform', !open && '-rotate-90')} />
            {aside ? <span className="relative z-[1] flex min-w-0 shrink">{aside}</span> : null}
          </span>
        </span>
      </div>
      {open ? (
        <ol className="flex flex-col pb-1">
          {cluster.entries.map((entry) => {
            const to = model.entryHref(entry)
            return (
              <li key={entry.id} className={cx('group relative flex items-center gap-3 rounded-md py-1 pr-2', to && 'transition-colors hover:bg-sunken/60')}>
                <span className={cx(TIME_CELL, 'text-micro')}>{timeOf(entry.at)}</span>
                <span className="flex w-5 shrink-0 justify-center">
                  <Pip entry={entry} model={model} size="sm" />
                </span>
                <EntryText entry={entry} model={model} to={to} compact />
              </li>
            )
          })}
        </ol>
      ) : null}
    </li>
  )
}

/* ------------------------------------------------------------------ plus ancien */

/** Au bas du fil : élargit la fenêtre quand on l'atteint, ou au clic. */
function Older({ model }: { model: RailModel }) {
  const t = useTranslate()
  const sentinel = useRef<HTMLDivElement>(null)
  const { can, load, loading } = model.older
  useEffect(() => {
    const element = sentinel.current
    if (!element || !can || loading) return
    // Seulement après qu'on a défilé : un fil court ne doit pas, à l'ouverture, aller
    // chercher un an de `git log` de lui-même.
    const scroller = element.closest('.overflow-y-auto')
    const observer = new IntersectionObserver((entries) => {
      if ((scroller?.scrollTop ?? 0) > 0 && entries.some((entry) => entry.isIntersecting)) load()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [can, load, loading])

  let content: ReactNode
  if (loading) content = <span className="text-xs text-ink-faint">{t('activityRail.loading')}</span>
  else if (!can) content = <span className="text-xs text-ink-faint">{t('activityRail.start')}</span>
  else
    content = (
      <Button variant="ghost" size="sm" onClick={load}>
        {t('activityRail.older', { count: model.journalDays })}
      </Button>
    )

  return (
    <div ref={sentinel} className={cx('flex pt-2', INDENT)}>
      {content}
    </div>
  )
}
