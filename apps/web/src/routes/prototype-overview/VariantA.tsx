/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Variante A — « Éditoriale » : une seule colonne, quatre étages numérotés et toujours
 * présents, du plus pressant au plus lointain. La hiérarchie vient de la taille des
 * titres et de l'ordre, pas de cadres.
 */
import { cardDestination } from '../prototype-milestones/destination'
import { CalendarClock, CheckCircle2, GitBranch, MessageCircleQuestion, Pencil, TriangleAlert, GitPullRequest } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { PrBadge } from '../../components/project/PrBadge'
import { elapsed, relativeDate } from '../../lib/dates'
import { formatDateTime } from '../../lib/schedules'
import type { AskItem, OverviewData } from './data'
import { COLUMN_DOT, DriftFigures, MilestoneBar, MilestoneGraph, SessionDot } from './widgets'

export const ASK_ICON: Record<AskItem['kind'], ReactNode> = {
  awaiting: <MessageCircleQuestion size={15} className="text-caution" />,
  broken: <TriangleAlert size={15} className="text-critical" />,
  'review-card': <Pencil size={15} className="text-caution" />,
  'review-pr': <GitPullRequest size={15} className="text-positive" />,
}

function Stage({ index, title, aside, children }: { index: number; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-baseline gap-3 border-b border-line pb-2">
        <span className="font-mono text-xs text-ink-faint">0{index}</span>
        <h2 className="flex-1 text-lg font-semibold tracking-tight">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

export function VariantA({ data }: { data: OverviewData }) {
  const { projectId, asks, code, milestone, nextTask } = data
  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="flex max-w-4xl flex-col gap-10">
        <Stage index={1} title="À toi" aside={<span className="text-sm text-ink-faint">{asks.length || ''}</span>}>
          {asks.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-ink-faint">
              <CheckCircle2 size={15} className="text-positive" /> Rien ne t'attend. Les agents travaillent ou se reposent.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {asks.map((ask) => (
                <li key={ask.key}>
                  <Link to={ask.to} className="flex min-h-11 items-center gap-3 rounded-lg px-3 hover:bg-surface-high">
                    {ASK_ICON[ask.kind]}
                    <span className="min-w-0 flex-1 truncate font-medium">{ask.title}</span>
                    <span className="hidden min-w-0 max-w-[40%] truncate text-sm text-ink-soft md:block">{ask.detail}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink-faint">{ask.since ? elapsed(ask.since) : ''}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Stage>

        <Stage
          index={2}
          title="Le code en cours"
          aside={
            <Link to={`/p/${projectId}/activity?groupe=worktree`} className="text-xs text-ink-faint hover:text-ink">
              {data.settledTrees > 0 ? `${data.settledTrees} arbres fusionnés à nettoyer · ` : ''}Tous les arbres
            </Link>
          }
        >
          {code.length === 0 ? (
            <p className="text-sm text-ink-faint">Ce projet n'est pas un dépôt git.</p>
          ) : (
            <ul className="flex flex-col">
              {code.map((line) => (
                <li key={line.key} className={cx('flex flex-col gap-1.5 py-3', !line.root && 'border-t border-line')}>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <GitBranch size={15} className={line.root ? 'text-accent' : 'text-ink-faint'} />
                    <Link to={line.to} className={cx('min-w-0 truncate font-mono text-sm hover:text-accent', line.root && 'font-semibold')}>
                      {line.branch}
                    </Link>
                    {line.root ? <span className="text-xs text-ink-faint">racine</span> : null}
                    {line.pr ? <PrBadge pr={line.pr} /> : null}
                    <span className="flex-1" />
                    <DriftFigures line={line} />
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-sm text-ink-soft">
                    {line.card ? (
                      <Link to={cardDestination(projectId, line.card)} className="flex min-w-0 items-center gap-1.5 hover:text-ink">
                        <span className={cx('size-1.5 rounded-full', COLUMN_DOT[line.card.column])} />
                        <span className="text-xs tabular-nums text-ink-faint">#{line.card.number}</span>
                        <span className="truncate">{line.card.title}</span>
                      </Link>
                    ) : null}
                    {line.sessions.map((row) => (
                      <Link
                        key={row.entry.conversation.id}
                        to={`/p/${projectId}/c/${row.entry.conversation.id}`}
                        className="flex min-w-0 max-w-64 items-center gap-1.5 text-xs hover:text-ink"
                      >
                        <SessionDot marker={row.marker} />
                        <AgentIcon agent={row.entry.conversation.agent} size={12} />
                        <span className="truncate">{row.entry.conversation.title}</span>
                      </Link>
                    ))}
                    {line.sessions.length === 0 && !line.card ? (
                      <span className="text-xs text-ink-faint">
                        Aucune session{line.lastActivityAt ? ` · dernier mouvement ${elapsed(line.lastActivityAt)}` : ''}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Stage>

        <Stage
          index={3}
          title="Le jalon en cours"
          aside={
            <Link to={`/p/${projectId}/timeline`} className="text-xs text-ink-faint hover:text-ink">
              {data.milestoneCount} jalon{data.milestoneCount > 1 ? 's' : ''} · Jalons
            </Link>
          }
        >
          {milestone ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <Link to={`/p/${projectId}/timeline/${milestone.card.number}`} className="text-2xl font-semibold tracking-tight hover:text-accent">
                  {milestone.card.title}
                </Link>
                <span className="text-sm text-ink-faint">
                  {milestone.done}/{milestone.cards.length} · {milestone.card.dueAt ? relativeDate(milestone.card.dueAt) : 'sans échéance'}
                </span>
              </div>
              <MilestoneBar milestone={milestone} />
              <MilestoneGraph projectId={projectId} milestone={milestone} size="md" />
            </div>
          ) : (
            <p className="text-sm text-ink-faint">Aucun jalon. Un jalon est une carte qui en regroupe d'autres.</p>
          )}
        </Stage>

        <footer className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line pt-3 text-sm text-ink-soft">
          <Link to={`/p/${projectId}/schedules`} className="flex items-center gap-1.5 hover:text-ink">
            <CalendarClock size={14} className="text-ink-faint" />
            {nextTask ? (
              <>Prochaine tâche : <span className="font-medium">{nextTask.name}</span> · {formatDateTime(nextTask.nextRunAt!)}</>
            ) : (
              'Aucune tâche planifiée à venir'
            )}
          </Link>
          <Link to={`/p/${projectId}/board`} className="text-ink-faint hover:text-ink">
            {data.openCards} cartes ouvertes
          </Link>
        </footer>
      </div>
    </div>
  )
}
