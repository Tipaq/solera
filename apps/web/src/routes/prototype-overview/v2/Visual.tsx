/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Variante `visuel` : le dessin d'abord, le texte en légende. Une frise des jalons, le
 * jalon en cours en anneau et en vagues, le code en graphe de branches (la branche par
 * défaut en tronc, les arbres qui en partent, leur PR au bout), le journal en fil.
 */
import { ArrowRight, Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { elapsed, relativeDate } from '../../../lib/dates'
import { JOURNAL_KIND_ICONS, journalIconTone } from '../../../components/journal/JournalView'
import { useProtoHref } from '../../prototype-milestones/model'
import { MATURITY_LABEL } from '../../prototype-milestones/maturity'
import type { V2Data, V2Milestone } from './data'
import { AskInbox } from '../../../components/prototype/AskInbox'
import { CodeGraph } from './CodeGraph'
import { MATURITY_DOT, MaturityTag, Ring, SessionStack, WaveStrip, WaitingMark } from './parts'

export function Visual({ data }: { data: V2Data }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-12 px-4 py-6 md:px-8 md:py-8">
        <Asks data={data} />
        <Milestones data={data} />
        <div className="grid gap-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Branches data={data} />
          <Thread data={data} />
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: ReactNode }) {
  return <h2 className="mb-4 text-xs font-medium text-ink-faint">{children}</h2>
}

/* ------------------------------------------------------------------ ce qui t'attend */

function Asks({ data }: { data: V2Data }) {
  return <AskInbox items={data.inbox} />
}

/* ------------------------------------------------------------------ jalons */

function Milestones({ data }: { data: V2Data }) {
  const href = useProtoHref()
  if (!data.current) {
    return (
      <section>
        <Label>Jalons</Label>
        <p className="text-sm text-ink-faint">Aucun jalon ouvert. Lance une idée dans une conversation : « idée : … ».</p>
      </section>
    )
  }
  return (
    <section className="flex flex-col gap-10">
      <Frieze data={data} timeline={href(`/p/${data.projectId}/timeline`)} />
      <Focus milestone={data.current} />
    </section>
  )
}

/**
 * La frise : les livrés en un seul repère à gauche, le jalon en cours en grand, puis la
 * file. L'ordre est celui du travail, pas un axe de dates : le futur n'en a pas.
 */
function Frieze({ data, timeline }: { data: V2Data; timeline: string }) {
  const stops = [...data.next, ...data.later]
  return (
    <div className="relative">
      <div aria-hidden className="absolute top-5 right-0 left-0 h-px bg-line" />
      <ol className="relative flex items-start gap-2 overflow-x-auto pb-1">
        <li className="flex w-24 shrink-0 flex-col items-center gap-2 text-center">
          <Link to={timeline} className="flex size-10 items-center justify-center rounded-full bg-positive/15 text-positive hover:bg-positive/25">
            <Check size={16} />
          </Link>
          <span className="text-xs text-ink-faint tabular-nums">{data.delivered} livré{data.delivered > 1 ? 's' : ''}</span>
        </li>
        <Stop milestone={data.current!} current />
        {stops.map((milestone) => (
          <Stop key={milestone.entry.card.id} milestone={milestone} />
        ))}
      </ol>
    </div>
  )
}

function Stop({ milestone, current = false }: { milestone: V2Milestone; current?: boolean }) {
  const { entry, to } = milestone
  return (
    <li className={cx('flex shrink-0 flex-col items-center gap-2 text-center', current ? 'w-40' : 'w-32')}>
      <Link
        to={to}
        title={`${entry.card.title} — ${MATURITY_LABEL[entry.maturity]}`}
        className={cx(
          'flex items-center justify-center rounded-full ring-4 ring-canvas transition-transform hover:scale-110',
          current ? 'size-10 bg-accent' : 'mt-2.5 size-5',
          !current && (entry.maturity === 'idea' ? 'border-2 border-dashed border-line-strong bg-canvas' : MATURITY_DOT[entry.maturity]),
        )}
      >
        {current ? <span className="size-3 rounded-full bg-canvas" /> : null}
      </Link>
      <span className={cx('line-clamp-2 text-xs', current ? 'font-medium text-ink' : 'text-ink-soft', !current && 'mt-2.5')}>{entry.card.title}</span>
    </li>
  )
}

function Focus({ milestone }: { milestone: V2Milestone }) {
  const { entry, waves, sessions, action, progress, to, waiting } = milestone
  return (
    <div className="grid items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)_auto]">
      <Ring value={progress} size={128} stroke={10}>
        <span className="flex flex-col items-center gap-0.5">
          <span className="text-lg font-semibold tabular-nums">{Math.round(progress * 100)}%</span>
          <span className="text-meta text-ink-faint tabular-nums">{entry.done} / {entry.cards.length}</span>
        </span>
      </Ring>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <MaturityTag maturity={entry.maturity} />
          <Link to={to} className="text-lg font-semibold tracking-tight hover:text-accent">
            {entry.card.title}
          </Link>
          <span className="text-xs text-ink-faint">
            {entry.card.dueAt ? `échéance ${relativeDate(entry.card.dueAt)}` : 'sans échéance'}
            {entry.addedSinceLaunch.length ? ` · +${entry.addedSinceLaunch.length} depuis le lancement` : ''}
          </span>
        </div>
        <WaveStrip waves={waves} size="lg" />
      </div>
      <div className="flex flex-col items-start gap-3 md:items-end">
        <SessionStack sessions={sessions} max={6} />
        {waiting ? (
          <WaitingMark waiting={waiting} />
        ) : (
          <Link to={to} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover">
            {action.label}
            <ArrowRight size={14} />
          </Link>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ branches */

function Branches({ data }: { data: V2Data }) {
  return (
    <section>
      <Label>Code en cours</Label>
      <CodeGraph data={data} />
    </section>
  )
}

/* ------------------------------------------------------------------ fil du journal */

function Thread({ data }: { data: V2Data }) {
  return (
    <section>
      <Label>Derniers événements</Label>
      {data.events.length === 0 ? (
        <p className="text-sm text-ink-faint">Rien ces quinze derniers jours.</p>
      ) : (
        <ol className="relative flex flex-col gap-5 pl-8">
          <span aria-hidden className="absolute top-2 bottom-2 left-[11px] w-px bg-line" />
          {data.events.map(({ entry, to }) => {
            const body = (
              <>
                <span aria-hidden className={cx('absolute -left-8 flex size-6 items-center justify-center rounded-full bg-canvas ring-1 ring-line [&_svg]:size-3', journalIconTone(entry))}>
                  {JOURNAL_KIND_ICONS[entry.kind]}
                </span>
                <span className="block truncate text-sm text-ink">{entry.title}</span>
                <span className="block text-xs text-ink-faint">{elapsed(entry.at)}</span>
              </>
            )
            return (
              <li key={entry.id} className="relative">
                {to ? <Link to={to} className="block hover:[&>span:nth-child(2)]:text-accent">{body}</Link> : <div>{body}</div>}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
