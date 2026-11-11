/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Variante B — « Poste de travail » : deux colonnes. À gauche ce qui bouge, dense —
 * une bande ambre de demandes, puis le code en cours en **tableau** à colonnes fixes.
 * À droite un rail « Le projet » qui ne change pas de forme : identité, jalon, tâche.
 */
import { cardDestination } from '../prototype-milestones/destination'
import { ArrowUpRight, CalendarClock, CheckCircle2, Flag, FolderGit2, SquareKanban } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { ProjectAvatar } from '../../components/ProjectAvatar'
import { PrBadge } from '../../components/project/PrBadge'
import { elapsed, relativeDate } from '../../lib/dates'
import { formatDateTime } from '../../lib/schedules'
import type { OverviewData } from './data'
import { ASK_ICON } from './VariantA'
import { COLUMN_DOT, DriftFigures, MilestoneBar, MilestoneGraph, SessionDot } from './widgets'

const GRID = 'grid grid-cols-[minmax(0,1.4fr)_auto_auto_minmax(0,1.6fr)_minmax(0,1.2fr)_3.5rem] items-center gap-x-4'

export function VariantB({ data }: { data: OverviewData }) {
  const { project, projectId, asks, code, milestone, nextTask } = data
  return (
    <div className="h-full overflow-y-auto">
      <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6 p-4 md:p-6">
          {/* La bande des demandes : toujours là, verte quand rien n'attend. */}
          <section
            className={cx(
              'rounded-xl border px-4 py-3',
              asks.length > 0 ? 'border-caution/40 bg-caution/5' : 'border-line bg-surface',
            )}
          >
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              {asks.length > 0 ? `${asks.length} chose${asks.length > 1 ? 's' : ''} t'attendent` : (
                <><CheckCircle2 size={15} className="text-positive" /> Rien ne t'attend</>
              )}
            </h2>
            {asks.length > 0 ? (
              <ul className="flex flex-col">
                {asks.slice(0, 6).map((ask) => (
                  <li key={ask.key}>
                    <Link to={ask.to} className="flex min-h-9 items-center gap-2.5 rounded-md px-1.5 text-sm hover:bg-surface-high">
                      {ASK_ICON[ask.kind]}
                      <span className="min-w-0 flex-1 truncate">{ask.title}</span>
                      <span className="hidden max-w-[45%] truncate text-xs text-ink-faint md:block">{ask.detail}</span>
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums text-ink-faint">{ask.since ? elapsed(ask.since) : ''}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="flex min-w-0 flex-col gap-2">
            <div className="flex items-center gap-2">
              <FolderGit2 size={15} className="text-ink-faint" />
              <h2 className="flex-1 text-sm font-semibold">Le code en cours</h2>
              <span className="text-xs text-ink-faint">
                {code.length - (project.git ? 1 : 0)} arbres actifs
                {data.settledTrees > 0 ? ` · ${data.settledTrees} fusionnés` : ''}
              </span>
            </div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <div className="min-w-[46rem]">
                <div className={cx(GRID, 'border-b border-line bg-sunken px-3 py-1.5 text-meta tracking-wide text-ink-faint uppercase')}>
                  <span>Branche</span>
                  <span>PR</span>
                  <span>↑ ↓ · disque</span>
                  <span>Sessions</span>
                  <span>Carte</span>
                  <span className="text-right">Vu</span>
                </div>
                {code.map((line) => (
                  <div key={line.key} className={cx(GRID, 'min-h-11 border-b border-line px-3 py-1.5 text-sm last:border-b-0 hover:bg-surface-high', line.root && 'bg-surface')}>
                    <Link to={line.to} className={cx('min-w-0 truncate font-mono text-xs', line.root ? 'font-semibold text-ink' : 'text-ink-soft hover:text-ink')}>
                      {line.branch}
                    </Link>
                    <span>{line.pr ? <PrBadge pr={line.pr} /> : <span className="text-xs text-ink-faint">—</span>}</span>
                    <DriftFigures line={line} />
                    <span className="flex min-w-0 items-center gap-1.5">
                      {line.sessions.length === 0 ? <span className="text-xs text-ink-faint">—</span> : null}
                      {line.sessions.slice(0, 1).map((row) => (
                        <Link key={row.entry.conversation.id} to={`/p/${projectId}/c/${row.entry.conversation.id}`} className="flex min-w-0 items-center gap-1.5 text-xs hover:text-ink">
                          <SessionDot marker={row.marker} />
                          <AgentIcon agent={row.entry.conversation.agent} size={12} />
                          <span className="truncate">{row.entry.conversation.title}</span>
                        </Link>
                      ))}
                      {line.sessions.length > 1 ? <span className="shrink-0 text-xs text-ink-faint">+{line.sessions.length - 1}</span> : null}
                    </span>
                    <span className="min-w-0">
                      {line.card ? (
                        <Link to={cardDestination(projectId, line.card)} className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft hover:text-ink">
                          <span className={cx('size-1.5 shrink-0 rounded-full', COLUMN_DOT[line.card.column])} />
                          <span className="tabular-nums text-ink-faint">#{line.card.number}</span>
                          <span className="truncate">{line.card.title}</span>
                        </Link>
                      ) : <span className="text-xs text-ink-faint">—</span>}
                    </span>
                    <span className="text-right text-xs tabular-nums text-ink-faint">{line.lastActivityAt ? elapsed(line.lastActivityAt) : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* Le rail : même ordre, même hauteur de blocs, que le projet soit agité ou calme. */}
        <aside className="flex flex-col gap-5 border-line bg-surface p-4 md:p-6 lg:border-l">
          <div className="flex items-center gap-3">
            <ProjectAvatar project={project} className="size-10" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{project.name}</p>
              <p className="truncate font-mono text-xs text-ink-faint">{project.workspacePath}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="flex items-center gap-1.5 text-meta tracking-wide text-ink-faint uppercase">
              <Flag size={12} /> Jalon en cours
            </p>
            {milestone ? (
              <>
                <Link to={`/p/${projectId}/timeline/${milestone.card.number}`} className="text-base font-semibold hover:text-accent">
                  {milestone.card.title}
                </Link>
                <MilestoneBar milestone={milestone} />
                <p className="text-xs text-ink-faint">
                  {milestone.done}/{milestone.cards.length} terminées · {milestone.card.dueAt ? relativeDate(milestone.card.dueAt) : 'sans échéance'}
                </p>
                <MilestoneGraph projectId={projectId} milestone={milestone} size="sm" />
              </>
            ) : (
              <p className="text-sm text-ink-faint">Aucun jalon.</p>
            )}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-line pt-4">
            <p className="flex items-center gap-1.5 text-meta tracking-wide text-ink-faint uppercase">
              <CalendarClock size={12} /> Prochaine tâche
            </p>
            {nextTask ? (
              <Link to={`/p/${projectId}/schedules`} className="flex items-center gap-2 text-sm hover:text-accent">
                <AgentIcon agent={nextTask.agent} size={13} />
                <span className="min-w-0 flex-1 truncate">{nextTask.name}</span>
                <span className="shrink-0 text-xs text-ink-faint">{formatDateTime(nextTask.nextRunAt!)}</span>
              </Link>
            ) : (
              <p className="text-sm text-ink-faint">Aucune à venir{data.taskCount > 0 ? ` (${data.taskCount} en pause)` : ''}.</p>
            )}
          </div>

          <nav className="flex flex-col border-t border-line pt-3 text-sm">
            <Link to={`/p/${projectId}/board`} className="flex min-h-9 items-center gap-2 rounded-md px-1 text-ink-soft hover:bg-surface-high hover:text-ink">
              <SquareKanban size={14} className="text-ink-faint" />
              <span className="flex-1">{data.openCards} cartes ouvertes</span>
              <ArrowUpRight size={13} className="text-ink-faint" />
            </Link>
            <Link to={`/p/${projectId}/timeline`} className="flex min-h-9 items-center gap-2 rounded-md px-1 text-ink-soft hover:bg-surface-high hover:text-ink">
              <Flag size={14} className="text-ink-faint" />
              <span className="flex-1">{data.milestoneCount} jalons</span>
              <ArrowUpRight size={13} className="text-ink-faint" />
            </Link>
          </nav>
        </aside>
      </div>
    </div>
  )
}
