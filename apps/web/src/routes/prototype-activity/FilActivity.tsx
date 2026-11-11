/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ChevronDown, Diamond } from 'lucide-react'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ActivityRow } from '../../lib/activity-rows'
import { Link } from 'react-router-dom'
import { JOURNAL_FAMILY_OF, type JournalEntryDto, type JournalFamily, type ProjectDto } from '@solera/protocol'
import { EmptyState, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { AskInbox, type InboxItem } from '../../components/prototype/AskInbox'
import { JOURNAL_KIND_ICONS } from '../../components/journal/JournalView'
import { MilestoneBanner } from '../../components/project/MilestoneBanner'
import { SessionRow } from '../../components/project/SessionRow'
import { useTranslate } from '../../lib/i18n'
import { JOURNAL_KIND_LABELS } from '../../lib/journal'
import { CardDrawerHost } from '../prototype-milestones/CardDrawer'
import { useV2Data } from '../prototype-overview/v2/data'
import {
  KindFilter,
  MilestoneTag,
  Quiet,
  SearchField,
  dayLabel,
  timeOf,
  useActivityModel,
  type ActivityModel,
} from './shared'

/**
 * `fil` — l'Activité en fil chronologique, retenu par Tim (2026-11-11).
 *
 * - **Marges** : celles des autres vues du projet (`px-4 md:px-6`), pleine largeur, bord
 *   gauche aligné sur la rangée d'onglets. Plus de couloir centré.
 * - **Maintenant** : « Ce qui t'attend » est la liste de l'Aperçu, la même (`AskInbox`
 *   nourrie par `useV2Data`) — une seule liste des demandes. Dessous, les sessions qui
 *   travaillent, en lignes, sans leur demande (elle est déjà au-dessus).
 * - **Le rail** : une pastille par nature, teintée par famille ; les événements
 *   rapprochés d'une même session ou carte se replient en un groupe ; un jalon livré
 *   est un losange.
 * - **En haut**, recherche et natures, collées et compactes ; **en bas**, « Plus ancien »
 *   élargit la fenêtre du journal, au défilement ou au clic.
 */
export function FilActivity() {
  const model = useActivityModel()
  const t = useTranslate()
  if (model.isPending) return null
  if (!model.projectId || !model.project) return <EmptyState title={t('project.notFound')} />
  return <FilBody model={model} projectId={model.projectId} project={model.project} />
}

/** La largeur de la colonne de l'heure, et donc l'axe du rail. */
const TIME_W = 'w-12'
/** Décalage du contenu « Maintenant », aligné sur le texte des lignes du fil. */
const INDENT = 'pl-[5.75rem]'

/**
 * Le corps du fil, exporté pour l'onglet Travail (proto) : `inbox` remplace la liste des
 * demandes (filtrée sur un arbre), `top` se pose en tête de « Maintenant ».
 *
 * Pour les variantes sans bascule de Travail : `before` se pose avant le rail, sur toute
 * la largeur ; `showInbox` retire la liste des demandes de « Maintenant » (quand `before`
 * la porte déjà) ; `headerExtra` s'ajoute à la barre collée ; `entryAside` et `rowAside`
 * ajoutent un repère (la puce d'arbre) à une ligne d'historique ou à une session.
 */
export function FilBody({
  model,
  projectId,
  project,
  inbox,
  top,
  before,
  showInbox = true,
  headerExtra,
  entryAside,
  rowAside,
  bare = false,
}: {
  model: ActivityModel
  projectId: string
  project: ProjectDto
  inbox?: InboxItem[]
  top?: ReactNode
  before?: ReactNode
  showInbox?: boolean
  headerExtra?: ReactNode
  entryAside?: (entry: JournalEntryDto) => ReactNode
  rowAside?: (row: ActivityRow) => ReactNode
  /** Sans sa barre de recherche et de natures : la page porte la sienne (Travail `une-ligne`). */
  bare?: boolean
}) {
  const overview = useV2Data(projectId, project)
  const working = model.live.filter((row) => row.group !== 'asking')

  return (
    <BareFil.Provider value={bare}>
    <div className="h-full overflow-y-auto">
      {bare ? null : (<>
      {/* Collé en haut, sur une ligne même au doigt : la recherche rétrécit, les natures
          défilent. La hauteur fixe (h-12) est ce sur quoi les jours se collent dessous. */}
      <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-6">
        <SearchField model={model} className="h-8 w-40 shrink-0 sm:w-64" />
        {headerExtra}
        <KindFilter model={model} className="ml-auto" />
      </header>
      </>)}

      <div className="px-4 pt-2 pb-4 md:px-6 md:pb-6">
        {before ? <div className="flex flex-col gap-6 pt-2 pb-6">{before}</div> : null}
        <ol className="relative flex flex-col">
          {/* Le rail, derrière les pastilles : au milieu de la colonne de 1,25 rem qui suit l'heure. */}
          <span aria-hidden className="absolute top-3 bottom-0 left-[4.375rem] w-px -translate-x-1/2 bg-line" />

          {/* ------------------------------------------------------------ maintenant */}
          <li className="relative flex flex-col gap-3 pb-6">
            <RailHead label="Maintenant" pulse={model.live.length > 0} />
            {top ? <div className={INDENT}>{top}</div> : null}
            {model.runs.map((run) => (
              <div key={run.id} className={INDENT}>
                <MilestoneBanner projectId={projectId} run={run} />
              </div>
            ))}
            {showInbox ? (
              <div className={INDENT}>
                <AskInbox items={inbox ?? overview.inbox} />
              </div>
            ) : null}
            {working.length > 0 ? (
              <section className={cx('flex flex-col gap-1.5', INDENT)}>
                <h3 className="text-xs font-medium text-ink-faint">
                  En cours <span className="tabular-nums opacity-70">{working.length}</span>
                </h3>
                <div className="divide-y divide-line overflow-hidden rounded-lg ring-1 ring-line">
                  {working.map((row) => {
                    const milestone = model.milestoneOfRow(row)
                    const aside = rowAside?.(row)
                    return (
                      <div key={row.entry.conversation.id}>
                        <ul>
                          <SessionRow
                          conversation={row.entry.conversation}
                          marker={row.marker}
                          summary={row.summary}
                          place={row.place}
                            pr={row.pr}
                          />
                        </ul>
                        {milestone || aside ? (
                          <div className="-mt-1.5 flex flex-wrap items-center gap-2 px-3 pb-1.5">
                            {milestone ? <MilestoneTag milestone={milestone} projectId={projectId} /> : null}
                            {aside}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : model.searching ? (
              <Quiet className={INDENT}>Aucune session vivante ne correspond.</Quiet>
            ) : null}
          </li>

          {/* ------------------------------------------------------------- les jours */}
          {model.days.length === 0 ? (
            <li className="relative pb-6">
              <RailHead label="Avant" />
              <Quiet className={cx('pt-2', INDENT)}>
                {model.searching || model.kind !== 'all'
                  ? 'Rien dans l’historique ne correspond.'
                  : `Rien ne s’est passé ces ${model.journalDays} derniers jours.`}
              </Quiet>
            </li>
          ) : (
            model.days.map((day) => (
              <li key={day.at} className="relative flex flex-col pb-4">
                <RailHead label={dayLabel(day.at)} />
                <ol className="flex flex-col">
                  {clustersOf(day.entries).map((cluster) =>
                    cluster.entries.length === 1 ? (
                      <FilEntry key={cluster.key} entry={cluster.entries[0]!} model={model} projectId={projectId} aside={entryAside?.(cluster.entries[0]!)} />
                    ) : (
                      <FilCluster key={cluster.key} cluster={cluster} model={model} projectId={projectId} aside={entryAside?.(cluster.entries[0]!)} />
                    ),
                  )}
                </ol>
              </li>
            ))
          )}
        </ol>

        <Older model={model} />
      </div>
      <CardDrawerHost />
    </div>
    </BareFil.Provider>
  )
}

/* ------------------------------------------------------------------ rail */

/** Vrai quand le fil n'a pas sa barre : ses jours se collent alors tout en haut. */
const BareFil = createContext(false)

/** L'en-tête d'un tronçon du fil : le jour, collé sous la barre de filtres. */
function RailHead({ label, pulse = false }: { label: string; pulse?: boolean }) {
  const bare = useContext(BareFil)
  return (
    <div className={cx('sticky z-10 -mx-4 flex items-center gap-3 bg-canvas/95 px-4 py-1.5 backdrop-blur md:-mx-6 md:px-6', bare ? 'top-0' : 'top-12')}>
      <span aria-hidden className={cx(TIME_W, 'shrink-0')} />
      <span aria-hidden className="flex w-5 shrink-0 justify-center">
        <span className={cx('relative size-2 rounded-full ring-4 ring-canvas', pulse ? 'bg-accent' : 'bg-ink-faint')}>
          {pulse ? <span className="absolute inset-0 animate-ping rounded-full bg-accent/60" /> : null}
        </span>
      </span>
      <span className="text-xs font-semibold text-ink-soft first-letter:uppercase">{label}</span>
    </div>
  )
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

export function Pip({ entry, model, size = 'md' }: { entry: JournalEntryDto; model: ActivityModel; size?: 'md' | 'sm' }) {
  // Un jalon livré : la carte fermée est une carte-jalon. Un losange, plein, à part.
  if (entry.kind === 'cardClosed' && model.isMilestoneCard(entry.cardNumber)) {
    return (
      <span aria-hidden className="relative z-[1] flex size-5 shrink-0 items-center justify-center">
        <Diamond size={16} className="fill-positive text-positive" />
      </span>
    )
  }
  const conversation = model.conversationOf(entry)
  return (
    <span
      aria-hidden
      className={cx(
        'relative z-[1] flex shrink-0 items-center justify-center rounded-full ring-1',
        size === 'md' ? 'size-5' : 'size-4',
        toneOf(entry),
      )}
    >
      {conversation && entry.kind === 'session' ? (
        <AgentIcon agent={conversation.agent} size={10} decorative />
      ) : (
        <span className="scale-[0.7]">{JOURNAL_KIND_ICONS[entry.kind]}</span>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ lignes */

const ROW = 'group flex items-start gap-3 rounded-md py-1.5 pr-2'

/** Un événement : l'heure, sa pastille sur le rail, le texte et ses repères. */
function FilEntry({ entry, model, projectId, aside }: { entry: JournalEntryDto; model: ActivityModel; projectId: string; aside?: ReactNode }) {
  const to = model.entryHref(entry)
  const body = (
    <>
      <span className={cx(TIME_W, 'shrink-0 pt-0.5 text-right text-xs text-ink-faint tabular-nums')}>{timeOf(entry.at)}</span>
      <Pip entry={entry} model={model} />
      <EntryText entry={entry} model={model} projectId={projectId} linked={Boolean(to)} aside={aside} />
    </>
  )
  return (
    <li>
      {to ? (
        <Link to={to} className={cx(ROW, 'transition-colors hover:bg-sunken/60')}>
          {body}
        </Link>
      ) : (
        <div className={ROW}>{body}</div>
      )}
    </li>
  )
}

function EntryText({
  entry,
  model,
  projectId,
  linked,
  compact = false,
  aside,
}: {
  entry: JournalEntryDto
  model: ActivityModel
  projectId: string
  linked: boolean
  compact?: boolean
  aside?: ReactNode
}) {
  const t = useTranslate()
  const milestone = model.milestoneOfEntry(entry)
  const delivered = entry.kind === 'cardClosed' && model.isMilestoneCard(entry.cardNumber)
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={cx('min-w-0 truncate text-sm', delivered ? 'font-medium text-positive' : 'text-ink', linked && 'group-hover:text-accent')}>
        {delivered ? 'Jalon livré · ' : null}
        {entry.title}
      </span>
      {compact ? null : (
        <span className="flex min-w-0 items-center gap-x-2 text-xs text-ink-faint">
          <span className="shrink-0">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
          {entry.cardNumber !== null ? <span className="shrink-0 tabular-nums">#{entry.cardNumber}</span> : null}
          {entry.source ? <span className="min-w-0 truncate">{entry.source}</span> : null}
          {milestone && !delivered ? <MilestoneTag milestone={milestone} projectId={projectId} className="-ml-1 shrink" /> : null}
          {aside}
        </span>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ groupes */

interface Cluster {
  key: string
  /** Ce qui les réunit : une session, ou une carte. */
  label: string
  entries: JournalEntryDto[]
}

/** Trois heures : au-delà, deux lignes d'une même carte racontent deux moments. */
const CLUSTER_GAP_MS = 3 * 3_600_000

/**
 * Les événements consécutifs d'une même session ou d'une même carte, à moins de trois
 * heures l'un de l'autre, se replient ensemble. Les jours arrivent du plus récent au
 * plus ancien, et on ne regroupe que des voisins : l'ordre du fil ne bouge pas.
 */
function clustersOf(entries: JournalEntryDto[]): Cluster[] {
  const out: Cluster[] = []
  const subject = (entry: JournalEntryDto) =>
    entry.conversationId ? `s:${entry.conversationId}` : entry.cardNumber !== null ? `c:${entry.cardNumber}` : null
  for (const entry of entries) {
    const key = subject(entry)
    const last = out[out.length - 1]
    const tail = last?.entries[last.entries.length - 1]
    if (key && last && last.key.startsWith(`${key}|`) && tail && Math.abs(tail.at - entry.at) <= CLUSTER_GAP_MS) {
      last.entries.push(entry)
      continue
    }
    out.push({
      key: `${key ?? 'x'}|${entry.id}`,
      label: entry.cardNumber !== null ? `#${entry.cardNumber}` : (entry.source ?? 'Session'),
      entries: [entry],
    })
  }
  return out
}

/** Un groupe replié : « #906 · 3 événements », la plus récente en titre ; déplié, tout. */
function FilCluster({ cluster, model, projectId, aside }: { cluster: Cluster; model: ActivityModel; projectId: string; aside?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const head = cluster.entries[0]!
  const oldest = cluster.entries[cluster.entries.length - 1]!
  return (
    <li>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={cx(ROW, 'w-full text-left transition-colors hover:bg-sunken/60')}>
        <span className={cx(TIME_W, 'shrink-0 pt-0.5 text-right text-xs text-ink-faint tabular-nums')}>{timeOf(head.at)}</span>
        <span className="relative z-[1] flex size-5 shrink-0 items-center justify-center rounded-full bg-canvas text-[10px] font-semibold text-ink-soft tabular-nums ring-1 ring-line">
          {cluster.entries.length}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 truncate text-sm text-ink">{head.title}</span>
          <span className="flex items-center gap-1.5 text-xs text-ink-faint">
            <span className="tabular-nums">{cluster.label}</span>
            <span>· {cluster.entries.length} événements depuis {timeOf(oldest.at)}</span>
            <ChevronDown size={12} className={cx('transition-transform', !open && '-rotate-90')} />
            {aside}
          </span>
        </span>
      </button>
      {open ? (
        <ol className="flex flex-col pb-1">
          {cluster.entries.map((entry) => {
            const to = model.entryHref(entry)
            const body = (
              <>
                <span className={cx(TIME_W, 'shrink-0 text-right text-[11px] text-ink-faint tabular-nums')}>{timeOf(entry.at)}</span>
                <span className="flex w-5 shrink-0 justify-center">
                  <Pip entry={entry} model={model} size="sm" />
                </span>
                <EntryText entry={entry} model={model} projectId={projectId} linked={Boolean(to)} compact />
              </>
            )
            const shape = 'group flex items-center gap-3 rounded-md py-1 pr-2'
            return (
              <li key={entry.id}>
                {to ? (
                  <Link to={to} className={cx(shape, 'transition-colors hover:bg-sunken/60')}>
                    {body}
                  </Link>
                ) : (
                  <div className={shape}>{body}</div>
                )}
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
function Older({ model }: { model: ActivityModel }) {
  const sentinel = useRef<HTMLDivElement>(null)
  const { canLoadOlder, loadOlder, loadingOlder } = model
  useEffect(() => {
    const element = sentinel.current
    if (!element || !canLoadOlder || loadingOlder) return
    // Seulement après qu'on a défilé : un fil court ne doit pas, à l'ouverture, aller
    // chercher un an de `git log` de lui-même.
    const scroller = element.closest('.overflow-y-auto')
    const observer = new IntersectionObserver((entries) => {
      if ((scroller?.scrollTop ?? 0) > 0 && entries.some((entry) => entry.isIntersecting)) loadOlder()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [canLoadOlder, loadOlder, loadingOlder])

  let content: ReactNode
  if (loadingOlder) content = <span className="text-xs text-ink-faint">Chargement…</span>
  else if (!canLoadOlder) content = <span className="text-xs text-ink-faint">Début du fil : un an d’historique.</span>
  else
    content = (
      <button type="button" onClick={loadOlder} className="rounded-md px-2 py-1 text-xs text-ink-faint hover:bg-sunken hover:text-ink">
        Plus ancien · au-delà de {model.journalDays} jours
      </button>
    )

  return (
    <div ref={sentinel} className={cx('flex pt-2', INDENT)}>
      {content}
    </div>
  )
}
