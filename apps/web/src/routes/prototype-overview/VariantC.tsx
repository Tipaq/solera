/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Variante C — « Carte du code » : le dépôt au centre de la page. La branche par défaut
 * est un tronc, chaque worktree une branche qui en part, avec ses sessions dessus et sa
 * PR au bout — la PR étant ce qui ramène la branche au tronc. Les demandes et le
 * reste tiennent dans un bandeau au-dessus ; le graphe du jalon prend le bas.
 */
import { cardDestination } from '../prototype-milestones/destination'
import { CalendarClock, CheckCircle2, Flag, GitMerge } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { PrBadge } from '../../components/project/PrBadge'
import { elapsed, relativeDate } from '../../lib/dates'
import { formatDateTime } from '../../lib/schedules'
import type { CodeLine, OverviewData } from './data'
import { ASK_ICON } from './VariantA'
import { COLUMN_DOT, DriftFigures, MilestoneBar, MilestoneGraph, SessionDot } from './widgets'

function Branch({ projectId, line, last }: { projectId: string; line: CodeLine; last: boolean }) {
  const busy = line.sessions.some((row) => row.marker === 'working')
  return (
    <li className="relative grid grid-cols-[2.5rem_minmax(0,1fr)]">
      {/* Le tronc continue sous chaque branche, sauf après la dernière ; le coude la relie. */}
      <span aria-hidden className={cx('absolute top-0 left-[0.6875rem] w-0.5 bg-accent/60', last ? 'h-6' : 'h-full')} />
      <span aria-hidden className="absolute top-6 left-[0.6875rem] h-0.5 w-7 bg-line-strong" />
      <span aria-hidden className={cx('absolute top-[1.1875rem] left-8 size-3 rounded-full border-2 bg-canvas', busy ? 'border-accent' : 'border-line-strong')} />
      <span />
      <div className={cx('mb-2 ml-3 flex min-w-0 flex-col gap-2 rounded-xl border px-3.5 py-2.5', busy ? 'border-accent/50' : 'border-line')}>
        <div className="flex min-w-0 items-center gap-2.5">
          <Link to={line.to} className="min-w-0 truncate font-mono text-sm hover:text-accent">{line.branch}</Link>
          <DriftFigures line={line} />
          <span className="flex-1" />
          {line.pr ? (
            <span className="flex items-center gap-1.5">
              <GitMerge size={13} className="text-ink-faint" />
              <PrBadge pr={line.pr} />
            </span>
          ) : (
            <span className="text-xs text-ink-faint">pas de PR</span>
          )}
        </div>
        {line.card ? (
          <Link to={cardDestination(projectId, line.card)} className="flex min-w-0 items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
            <span className={cx('size-1.5 shrink-0 rounded-full', COLUMN_DOT[line.card.column])} />
            <span className="text-xs tabular-nums text-ink-faint">#{line.card.number}</span>
            <span className="truncate">{line.card.title}</span>
          </Link>
        ) : null}
        {line.sessions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {line.sessions.map((row) => (
              <Link
                key={row.entry.conversation.id}
                to={`/p/${projectId}/c/${row.entry.conversation.id}`}
                className="flex max-w-72 min-w-0 items-center gap-1.5 rounded-full bg-sunken px-2 py-0.5 text-xs hover:bg-surface-high"
              >
                <SessionDot marker={row.marker} />
                <AgentIcon agent={row.entry.conversation.agent} size={11} />
                <span className="truncate">{row.entry.conversation.title}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-xs text-ink-faint">Au repos{line.lastActivityAt ? ` depuis ${elapsed(line.lastActivityAt)}` : ''}</p>
        )}
      </div>
    </li>
  )
}

export function VariantC({ data }: { data: OverviewData }) {
  const { projectId, asks, code, milestone, nextTask } = data
  const root = code.find((line) => line.root)
  const branches = code.filter((line) => !line.root)

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="flex flex-col gap-6">
        {/* Le bandeau : demandes en pastilles, puis jalon et tâche en une ligne chacun. */}
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-sm font-semibold">À toi</span>
            {asks.length === 0 ? (
              <span className="flex items-center gap-1.5 text-sm text-ink-faint">
                <CheckCircle2 size={14} className="text-positive" /> rien
              </span>
            ) : (
              asks.map((ask) => (
                <Link
                  key={ask.key}
                  to={ask.to}
                  title={ask.detail}
                  className="flex max-w-80 min-w-0 items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-xs hover:border-ink-faint"
                >
                  {ASK_ICON[ask.kind]}
                  <span className="truncate">{ask.title}</span>
                  <span className="shrink-0 text-ink-faint">{ask.since ? elapsed(ask.since) : ''}</span>
                </Link>
              ))
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-2.5 text-sm">
            {milestone ? (
              <Link to={`/p/${projectId}/timeline/${milestone.card.number}`} className="flex min-w-0 items-center gap-2 hover:text-accent">
                <Flag size={14} className="text-ink-faint" />
                <span className="truncate font-medium">{milestone.card.title}</span>
                <MilestoneBar milestone={milestone} className="w-24" />
                <span className="shrink-0 text-xs text-ink-faint">
                  {milestone.done}/{milestone.cards.length} · {milestone.card.dueAt ? relativeDate(milestone.card.dueAt) : 'sans date'}
                </span>
              </Link>
            ) : (
              <span className="text-ink-faint">Aucun jalon</span>
            )}
            <Link to={`/p/${projectId}/schedules`} className="flex min-w-0 items-center gap-2 text-ink-soft hover:text-ink">
              <CalendarClock size={14} className="text-ink-faint" />
              {nextTask ? <><span className="truncate">{nextTask.name}</span><span className="text-xs text-ink-faint">{formatDateTime(nextTask.nextRunAt!)}</span></> : 'Aucune tâche à venir'}
            </Link>
          </div>
        </div>

        <section className="flex flex-col gap-1">
          <h2 className="mb-2 text-sm font-semibold">Le code en cours</h2>
          {root ? (
            <div className="relative grid grid-cols-[2.5rem_minmax(0,1fr)] items-center">
              <span aria-hidden className="absolute top-1/2 left-[0.6875rem] h-1/2 w-0.5 bg-accent/60" />
              <span aria-hidden className="relative z-10 ml-1 size-4 rounded-full border-2 border-accent bg-accent/20" />
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-mono text-base font-semibold">{root.branch}</span>
                <DriftFigures line={root} />
                {root.dirty > 0 ? <span className="text-xs text-caution">{root.dirty} fichiers non commités à la racine</span> : <span className="text-xs text-ink-faint">propre</span>}
                {root.sessions.map((row) => (
                  <Link key={row.entry.conversation.id} to={`/p/${projectId}/c/${row.entry.conversation.id}`} className="flex max-w-60 min-w-0 items-center gap-1.5 rounded-full bg-sunken px-2 py-0.5 text-xs hover:bg-surface-high">
                    <SessionDot marker={row.marker} />
                    <span className="truncate">{row.entry.conversation.title}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-ink-faint">Ce projet n'est pas un dépôt git.</p>
          )}
          <ul className="flex flex-col">
            {branches.map((line, index) => (
              <Branch key={line.key} projectId={projectId} line={line} last={index === branches.length - 1} />
            ))}
          </ul>
          {data.settledTrees > 0 ? (
            <Link to={`/p/${projectId}/activity?groupe=worktree`} className="ml-12 text-xs text-ink-faint hover:text-ink">
              + {data.settledTrees} arbres fusionnés ou vides, à nettoyer
            </Link>
          ) : null}
        </section>

        {milestone ? (
          <section className="flex flex-col gap-3 border-t border-line pt-5">
            <div className="flex items-baseline gap-3">
              <h2 className="text-sm font-semibold">Graphe du jalon</h2>
              <span className="text-xs text-ink-faint">#{milestone.card.number} {milestone.card.title}</span>
            </div>
            <MilestoneGraph projectId={projectId} milestone={milestone} size="lg" />
          </section>
        ) : null}
      </div>
    </div>
  )
}
