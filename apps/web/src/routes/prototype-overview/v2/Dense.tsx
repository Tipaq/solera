/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Variante `dense`, façon Linear : des lignes et non des cartes, presque aucun cadre.
 * La hiérarchie tient à la typographie (un titre, un intitulé de section, un corps, une
 * méta) et à l'alignement en colonnes ; une seule couleur d'accent.
 */
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { elapsed, relativeDate } from '../../../lib/dates'
import { useTranslate } from '../../../lib/i18n'
import { JOURNAL_KIND_LABELS } from '../../../lib/journal'
import { JOURNAL_KIND_ICONS, journalIconTone } from '../../../components/journal/JournalView'
import { useProtoHref } from '../../prototype-milestones/model'
import type { V2Data, V2Milestone } from './data'
import { ASK_DOT, Bar, Calm, ClickRow, Drift, Go, MaturityTag, PrTag, SessionStack, WaveStrip } from './parts'

export function Dense({ data }: { data: V2Data }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-10 px-4 py-6 md:px-8">
        <Asks data={data} />
        <Milestones data={data} />
        <div className="grid gap-10 lg:grid-cols-2">
          <Code data={data} />
          <Events data={data} />
        </div>
      </div>
    </div>
  )
}

/** L'intitulé d'une section : petit, gris, et c'est l'écart au-dessus qui sépare. */
function Heading({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex h-6 items-center gap-3">
      <h2 className="text-xs font-medium text-ink-faint">{children}</h2>
      {right ? <span className="ml-auto">{right}</span> : null}
    </div>
  )
}

function More({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
      {children}
      <ArrowUpRight size={12} />
    </Link>
  )
}

const ROW = '-mx-2 rounded-md px-2 transition-colors hover:bg-surface-high'

/* ------------------------------------------------------------------ ce qui t'attend */

export function Asks({ data }: { data: V2Data }) {
  if (data.asks.length === 0) return <Calm>Rien ne t'attend.</Calm>
  return (
    <section>
      <Heading>
        <span className="text-ink">{data.asks.length}</span> {data.asks.length > 1 ? 'choses t’attendent' : 'chose t’attend'}
      </Heading>
      <ul className="flex flex-col">
        {data.asks.map((ask) => (
          <li key={ask.key}>
            <Go to={ask.to} external={ask.external} className={cx(ROW, 'grid h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-sm')}>
              <span aria-hidden className={cx('size-1.5 rounded-full', ASK_DOT[ask.kind])} />
              <span className="flex min-w-0 items-baseline gap-3">
                <span className="truncate text-ink">{ask.title}</span>
                <span className="hidden truncate text-xs text-ink-faint sm:inline">{ask.detail}</span>
              </span>
              <span className="text-xs text-ink-faint tabular-nums">{ask.since ? elapsed(ask.since) : ''}</span>
            </Go>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ jalons */

function Milestones({ data }: { data: V2Data }) {
  const href = useProtoHref()
  const timeline = href(`/p/${data.projectId}/timeline`)
  if (!data.current) {
    return (
      <section>
        <Heading right={<More to={timeline}>Jalons</More>}>Jalons</Heading>
        <p className="text-sm text-ink-faint">Aucun jalon ouvert. Lance une idée dans une conversation : « idée : … ».</p>
      </section>
    )
  }
  return (
    <section>
      <Heading right={<More to={timeline}>Tous les jalons{data.delivered ? ` · ${data.delivered} livrés` : ''}</More>}>Jalon en cours</Heading>
      <Current milestone={data.current} />
      {data.next.length || data.later.length ? (
        <div className="mt-8 grid gap-8 md:grid-cols-2">
          <Queue title="Ensuite" items={data.next} />
          <Queue title="Plus tard" items={data.later} />
        </div>
      ) : null}
    </section>
  )
}

function Current({ milestone }: { milestone: V2Milestone }) {
  const { entry, waves, sessions, action, progress, to } = milestone
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <MaturityTag maturity={entry.maturity} />
          <span className="text-xs text-ink-faint tabular-nums">#{entry.card.number}</span>
        </div>
        <Link to={to} className="text-lg font-semibold tracking-tight text-ink hover:text-accent">
          {entry.card.title}
        </Link>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
          <span className="tabular-nums">
            <span className="text-ink">{entry.done}</span>/{entry.cards.length} cartes
          </span>
          <span className="tabular-nums">{Math.round(progress * 100)} %</span>
          {entry.card.dueAt ? <span>échéance {relativeDate(entry.card.dueAt)}</span> : <span>sans échéance</span>}
          {entry.addedSinceLaunch.length ? <span>+{entry.addedSinceLaunch.length} depuis le lancement</span> : null}
          {sessions.length ? (
            <span className="ml-auto inline-flex items-center gap-2">
              <SessionStack sessions={sessions} max={4} />
            </span>
          ) : null}
        </div>
        <Bar value={progress} />
      </div>

      <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <WaveStrip waves={waves} size="sm" />
        <Link to={to} className="group inline-flex items-baseline gap-2 text-sm">
          <span className="font-medium text-accent">{action.label}</span>
          <span className="text-xs text-ink-faint group-hover:text-ink-soft">{action.detail}</span>
          <ArrowRight size={13} className="self-center text-accent" />
        </Link>
      </div>
    </div>
  )
}

function Queue({ title, items }: { title: string; items: V2Milestone[] }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium text-ink-faint">{title}</h3>
      {items.length === 0 ? (
        <p className="py-2 text-sm text-ink-faint">Rien pour l’instant.</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.entry.card.id}>
              <Link to={item.to} className={cx(ROW, 'grid h-9 grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 text-sm')}>
                <MaturityTag maturity={item.entry.maturity} />
                <span className="truncate text-ink">{item.entry.card.title}</span>
                <span className="text-xs text-ink-faint">{item.action.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ code */

export function Code({ data }: { data: V2Data }) {
  const href = useProtoHref()
  return (
    <section>
      <Heading right={<More to={href(`/p/${data.projectId}/activity?groupe=worktree`)}>Par arbre{data.settledTrees ? ` · ${data.settledTrees} à nettoyer` : ''}</More>}>
        Code en cours
      </Heading>
      {data.code.length === 0 ? (
        <p className="text-sm text-ink-faint">Pas de dépôt git, ou rien en cours.</p>
      ) : (
        <ul className="flex flex-col">
          {data.code.map((line) => (
            <li key={line.key}>
              <ClickRow to={line.to} className={cx(ROW, 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2')}>
                <span className="flex min-w-0 flex-col">
                  <span className={cx('truncate font-mono text-code', line.root ? 'text-ink' : 'text-ink-soft')}>{line.branch}</span>
                  <span className="truncate text-xs text-ink-faint">
                    {line.card ? `#${line.card.number} ${line.card.title}` : line.root ? 'branche par défaut' : 'aucune carte'}
                  </span>
                </span>
                <span className="flex items-center gap-4 text-xs text-ink-faint">
                  {line.root ? null : <PrTag pr={line.pr} />}
                  <Drift ahead={line.ahead} behind={line.behind} dirty={line.dirty} conflicts={line.conflicts} />
                  <span className="hidden w-[4.5rem] justify-end sm:flex">
                    <SessionStack sessions={line.sessions} />
                  </span>
                  <span className="w-8 text-right tabular-nums">{line.at ? elapsed(line.at) : ''}</span>
                </span>
              </ClickRow>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ événements */

export function Events({ data }: { data: V2Data }) {
  const t = useTranslate()
  const href = useProtoHref()
  return (
    <section>
      <Heading right={<More to={href(`/p/${data.projectId}/journal`)}>Journal</More>}>Derniers événements</Heading>
      {data.events.length === 0 ? (
        <p className="text-sm text-ink-faint">Rien ces quinze derniers jours.</p>
      ) : (
        <ul className="flex flex-col">
          {data.events.map(({ entry, to }) => {
            const body = (
              <>
                <span aria-hidden className={cx('flex', journalIconTone(entry))}>{JOURNAL_KIND_ICONS[entry.kind]}</span>
                <span className="flex min-w-0 items-baseline gap-3">
                  <span className="truncate text-ink">{entry.title}</span>
                  <span className="hidden shrink-0 text-xs text-ink-faint sm:inline">{t(JOURNAL_KIND_LABELS[entry.kind])}</span>
                </span>
                <span className="text-xs text-ink-faint tabular-nums">{elapsed(entry.at)}</span>
              </>
            )
            const shape = 'grid h-9 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 text-sm'
            return (
              <li key={entry.id}>
                {to ? <Link to={to} className={cx(ROW, shape)}>{body}</Link> : <div className={cx('-mx-2 px-2', shape)}>{body}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
