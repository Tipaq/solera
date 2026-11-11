/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Variante `tuiles`, façon Vercel : quelques grandes tuiles bien espacées, sans bordure
 * (le fond suffit à les détacher), un chiffre ou un état fort par tuile et beaucoup
 * d'air autour.
 */
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, cx } from '@solera/ui'
import { elapsed, relativeDate } from '../../../lib/dates'
import { useTranslate } from '../../../lib/i18n'
import { JOURNAL_KIND_LABELS } from '../../../lib/journal'
import { JOURNAL_KIND_ICONS, journalIconTone } from '../../../components/journal/JournalView'
import { useProtoHref } from '../../prototype-milestones/model'
import type { V2Data, V2Milestone } from './data'
import { AskInbox } from '../../../components/prototype/AskInbox'
import { CodeGraph } from './CodeGraph'
import { MaturityTag, Ring, SessionStack, WaveStrip, WaitingMark } from './parts'

export function Tiles({ data }: { data: V2Data }) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="flex flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
        <Asks data={data} />
        <Milestones data={data} />
        <div className="grid gap-6 lg:grid-cols-2">
          <Code data={data} />
          <Events data={data} />
        </div>
      </div>
    </div>
  )
}

function Tile({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('flex min-w-0 flex-col gap-5 rounded-2xl bg-surface p-6', className)}>{children}</section>
}

function TileHead({ label, to, more }: { label: string; to?: string; more?: string }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-xs font-medium text-ink-faint">{label}</h2>
      {to ? (
        <Link to={to} className="ml-auto inline-flex items-center gap-1 text-xs text-ink-faint hover:text-ink">
          {more ?? 'Tout voir'}
          <ArrowUpRight size={12} />
        </Link>
      ) : null}
    </div>
  )
}

/** Le chiffre d'une tuile, et ce qu'il compte. */
function Figure({ value, unit, tone }: { value: ReactNode; unit: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={cx('text-lg font-semibold tabular-nums', tone ?? 'text-ink')}>{value}</span>
      <span className="text-sm text-ink-faint">{unit}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ ce qui t'attend */

function Asks({ data }: { data: V2Data }) {
  // Pas de tuile : la liste pèse moins que le jalon phare. Un point ambre par ligne suffit.
  return <AskInbox items={data.inbox} className="px-2" />
}

/* ------------------------------------------------------------------ jalons */

function Milestones({ data }: { data: V2Data }) {
  const href = useProtoHref()
  const timeline = href(`/p/${data.projectId}/timeline`)
  if (!data.current) {
    return (
      <Tile>
        <TileHead label="Jalons" to={timeline} />
        <p className="text-sm text-ink-faint">Aucun jalon ouvert. Lance une idée dans une conversation : « idée : … ».</p>
      </Tile>
    )
  }
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Hero milestone={data.current} timeline={timeline} />
      <div className="flex flex-col gap-6">
        <QueueTile label="Ensuite" items={data.next} />
        <QueueTile label="Plus tard" items={data.later} />
        <Tile className="gap-1 py-5">
          <Figure value={data.delivered} unit={data.delivered > 1 ? 'jalons livrés' : 'jalon livré'} />
        </Tile>
      </div>
    </div>
  )
}

function Hero({ milestone, timeline }: { milestone: V2Milestone; timeline: string }) {
  const navigate = useNavigate()
  const { entry, waves, sessions, action, progress, to, waiting } = milestone
  return (
    <Tile className="gap-6 lg:col-span-2">
      <TileHead label="Jalon en cours" to={timeline} more="Tous les jalons" />
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <Ring value={progress} size={112} stroke={8}>
          <span className="flex flex-col items-center">
            <span className="text-lg font-semibold tabular-nums">{Math.round(progress * 100)}%</span>
            <span className="text-meta text-ink-faint tabular-nums">{entry.done}/{entry.cards.length}</span>
          </span>
        </Ring>
        <div className="flex min-w-0 flex-col gap-2">
          <MaturityTag maturity={entry.maturity} />
          <Link to={to} className="text-lg font-semibold tracking-tight text-ink hover:text-accent">
            {entry.card.title}
          </Link>
          <p className="text-sm text-ink-faint">
            {entry.card.dueAt ? `Échéance ${relativeDate(entry.card.dueAt)}` : 'Sans échéance'}
            {entry.addedSinceLaunch.length ? ` · +${entry.addedSinceLaunch.length} depuis le lancement` : ''}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-2">
          <span className="text-xs text-ink-faint">Vagues</span>
          <WaveStrip waves={waves} size="md" />
        </div>
        {sessions.length ? (
          <div className="flex flex-col items-end gap-2">
            <span className="text-xs text-ink-faint">{sessions.length} session{sessions.length > 1 ? 's' : ''}</span>
            <SessionStack sessions={sessions} max={5} />
          </div>
        ) : null}
      </div>
      {waiting ? (
        <div className="flex flex-wrap items-center gap-4">
          <WaitingMark waiting={waiting} />
          <span className="min-w-0 flex-1 text-sm text-ink-faint">Réponds depuis « Ce qui t'attend » : le jalon reprend dès que c'est fait.</span>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-canvas px-4 py-3">
          <span className="min-w-0 flex-1 text-sm text-ink-soft">{action.detail}</span>
          <Button size="sm" icon={<ArrowRight size={14} />} onClick={() => navigate(to)}>
            {action.label}
          </Button>
        </div>
      )}
    </Tile>
  )
}

function QueueTile({ label, items }: { label: string; items: V2Milestone[] }) {
  return (
    <Tile className="gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium text-ink-faint">{label}</h2>
        <span className="text-lg font-semibold tabular-nums text-ink">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-ink-faint">Rien pour l’instant.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.slice(0, 3).map((item) => (
            <li key={item.entry.card.id}>
              <Link to={item.to} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-surface-high">
                <span className="min-w-0 flex-1 truncate">{item.entry.card.title}</span>
                {item.waiting ? <span aria-label={`${item.waiting.count} t'attend`} title={`${item.waiting.count} t'attend : voir « Ce qui t'attend »`} className="size-1.5 shrink-0 rounded-full bg-caution" /> : null}
                <MaturityTag maturity={item.entry.maturity} />
              </Link>
            </li>
          ))}
          {items.length > 3 ? <li className="text-xs text-ink-faint">+{items.length - 3} autres</li> : null}
        </ul>
      )}
    </Tile>
  )
}

/* ------------------------------------------------------------------ code */

function Code({ data }: { data: V2Data }) {
  const href = useProtoHref()
  const active = data.code.filter((line) => !line.root)
  const working = data.code.reduce((sum, line) => sum + line.sessions.filter((session) => session.tone !== 'quiet').length, 0)
  return (
    <Tile>
      <TileHead label="Code en cours" to={href(`/p/${data.projectId}/activity?groupe=worktree`)} more="Par arbre" />
      <div className="flex gap-10">
        <Figure value={active.length} unit={active.length > 1 ? 'arbres' : 'arbre'} />
        <Figure value={working} unit={working > 1 ? 'sessions' : 'session'} />
      </div>
      <CodeGraph data={data} />
    </Tile>
  )
}

/* ------------------------------------------------------------------ événements */

function Events({ data }: { data: V2Data }) {
  const t = useTranslate()
  const href = useProtoHref()
  return (
    <Tile>
      <TileHead label="Derniers événements" to={href(`/p/${data.projectId}/journal`)} more="Journal" />
      {data.events.length === 0 ? (
        <p className="text-sm text-ink-faint">Rien ces quinze derniers jours.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {data.events.map(({ entry, to }) => {
            const body = (
              <>
                <span aria-hidden className={cx('flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas', journalIconTone(entry))}>
                  {JOURNAL_KIND_ICONS[entry.kind]}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm text-ink">{entry.title}</span>
                  <span className="text-xs text-ink-faint">
                    {t(JOURNAL_KIND_LABELS[entry.kind])} · {elapsed(entry.at)}
                  </span>
                </span>
              </>
            )
            const shape = '-mx-2 flex items-center gap-3 rounded-lg px-2 py-2'
            return (
              <li key={entry.id}>
                {to ? <Link to={to} className={cx(shape, 'hover:bg-surface-high')}>{body}</Link> : <div className={shape}>{body}</div>}
              </li>
            )
          })}
        </ul>
      )}
    </Tile>
  )
}
