/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ArrowUpRight, ChevronRight, Pause, Pencil, Play, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { conversationPath } from '../../lib/conversation-route'
import { cronToHuman } from '../../lib/cron'
import { relativeDate } from '../../lib/dates'
import { locale } from '../../lib/i18n'
import { describeCadence, formatDateTime } from '../../lib/schedules'
import { durationOf, formatCost, formatDuration, healthOf, inShort, type ScheduleProto } from './data'
import { EmptyTasks, RUN_FILL, RUN_WORD, RunPips, StateMark, Summary, stub, type Task } from './shared'

/**
 * `liste` : une ligne par tâche, ce qui se lit d'un coup d'œil — qui, quoi, quand, et
 * comment ça s'est passé les dix dernières fois. Le reste (prompt, script, historique
 * détaillé) se déplie sur place.
 */
export function ListVariant({ proto }: { proto: ScheduleProto }) {
  const [open, setOpen] = useState<string | null>(null)
  const cadenceOf = (task: Task) => describeCadence(task.cadence, (expression) => cronToHuman(expression, locale()))

  return (
    <div className="flex flex-col gap-4">
      <Summary proto={proto} />
      {proto.tasks.length === 0 ? (
        <EmptyTasks />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line">
          {/* En-tête de colonnes : la même grille que les lignes, au large seulement. */}
          <div className="hidden grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7rem_7.5rem_8.5rem_auto] items-center gap-4 border-b border-line bg-surface/60 px-4 py-2 text-meta font-medium tracking-wide text-ink-faint uppercase md:grid">
            <span>Tâche</span>
            <span>Cadence</span>
            <span>Prochaine</span>
            <span>Dernier tir</span>
            <span>10 derniers</span>
            <span className="w-24" />
          </div>
          <ul className="divide-y divide-line">
            {proto.tasks.map((task) => {
              const health = healthOf(task, proto.costOf)
              const last = task.runs[0]
              const expanded = open === task.id
              return (
                <li key={task.id} className={cx(expanded && 'bg-surface/40')}>
                  <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_7rem_7.5rem_8.5rem_auto]">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? null : task.id)}
                      className="flex min-w-0 items-center gap-2.5 text-left"
                    >
                      <ChevronRight size={14} className={cx('shrink-0 text-ink-faint transition-transform', expanded && 'rotate-90')} />
                      <AgentIcon agent={task.agent} size={15} />
                      <span className="flex min-w-0 flex-col">
                        <span className={cx('truncate text-sm font-medium', !task.enabled && 'text-ink-faint')}>{task.name}</span>
                        <StateMark state={health.state} />
                      </span>
                    </button>

                    <span className="hidden min-w-0 truncate text-sm text-ink-soft md:block" title={cadenceOf(task)}>{cadenceOf(task)}</span>

                    <span className="hidden text-sm tabular-nums md:block" title={task.nextRunAt ? formatDateTime(task.nextRunAt) : undefined}>
                      {task.nextRunAt ? inShort(task.nextRunAt) : <span className="text-ink-faint">—</span>}
                    </span>

                    <span className="hidden min-w-0 flex-col text-xs md:flex">
                      {last ? (
                        <>
                          <span className="flex items-center gap-1.5">
                            <span className={cx('size-1.5 rounded-full', RUN_FILL[last.status])} />
                            <span className="text-ink-soft">{RUN_WORD[last.status]}</span>
                          </span>
                          <span className="text-ink-faint tabular-nums">
                            {last.finishedAt ? formatDuration(durationOf(last)) : relativeDate(last.startedAt)} · {formatCost(proto.costOf(last))}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-faint">jamais</span>
                      )}
                    </span>

                    <span className="hidden md:block"><RunPips runs={task.runs} costOf={proto.costOf} /></span>

                    <span className="flex items-center justify-end gap-0.5 md:w-36">
                      {/* Un mot et non une icône : ⚡ est celle des actions du projet, et ▶ dirait « reprendre ». */}
                      <button type="button" title="Lancer maintenant (simulé)" onClick={() => stub(`Lancer maintenant ${task.name}`)} className="h-8 rounded-md px-2 text-xs text-ink-soft transition-colors hover:bg-surface-high hover:text-ink">
                        Lancer
                      </button>
                      <IconAction label={task.enabled ? 'Mettre en pause' : 'Reprendre'} onClick={() => stub(task.enabled ? 'Mettre en pause' : 'Reprendre')}>
                        {task.enabled ? <Pause size={14} /> : <Play size={14} />}
                      </IconAction>
                      <IconAction label="Modifier" onClick={() => stub(`Modifier ${task.name}`)}><Pencil size={14} /></IconAction>
                    </span>

                    {/* Au téléphone, la deuxième ligne porte ce que les colonnes portaient. */}
                    <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-[3.25rem] text-xs text-ink-faint md:hidden">
                      <span>{cadenceOf(task)}</span>
                      {task.nextRunAt ? <span>prochaine {inShort(task.nextRunAt)}</span> : null}
                      <RunPips runs={task.runs} costOf={proto.costOf} />
                    </span>
                  </div>

                  {health.state === 'approval' ? (
                    <div className="mx-4 mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-caution/10 px-3 py-2 text-xs text-caution">
                      <ShieldAlert size={14} />
                      Un agent a proposé un script de vérification : les tirs attendent que tu le relises.
                      <Button size="sm" variant="secondary" className="ml-auto" onClick={() => stub('Relire le script')}>Relire</Button>
                    </div>
                  ) : health.failStreak >= 2 ? (
                    <p className="mx-4 mb-3 rounded-lg bg-critical/8 px-3 py-2 text-xs text-critical">
                      {health.failStreak} échecs d'affilée — {health.lastError}
                    </p>
                  ) : null}

                  {expanded ? <Details task={task} proto={proto} /> : null}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={`${label} (simulé)`}
      aria-label={label}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-md text-ink-faint transition-colors hover:bg-surface-high hover:text-ink"
    >
      {children}
    </button>
  )
}

function Details({ task, proto }: { task: Task; proto: ScheduleProto }) {
  const health = healthOf(task, proto.costOf)
  return (
    <div className="grid gap-4 border-t border-line px-4 py-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:pl-[3.25rem]">
      <div className="flex min-w-0 flex-col gap-3">
        <Section title="Consigne">
          <p className="rounded-lg bg-sunken px-3 py-2 text-sm whitespace-pre-wrap text-ink-soft">{task.prompt}</p>
        </Section>
        {task.check ? (
          <Section title={task.check.approved ? 'Vérification avant chaque tir' : 'Vérification proposée, à relire'}>
            <pre className="overflow-x-auto rounded-lg bg-sunken px-3 py-2 font-mono text-xs text-ink-soft">{task.check.script}</pre>
          </Section>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <Fact label="Durée max">{task.maxDurationMinutes} min</Fact>
          <Fact label="Chevauchement">{task.overlapPolicy === 'skip' ? 'sauter le tir' : 'attendre'}</Fact>
          <Fact label="Confinement">{task.confined === null ? 'celui du projet' : task.confined ? 'confinée' : 'non confinée'}</Fact>
          <Fact label="Réussite (30 j)">{health.rate === null ? '—' : `${Math.round(health.rate * 100)} % sur ${health.judged}`}</Fact>
          <Fact label="Durée moyenne">{health.avgDuration === null ? '—' : formatDuration(health.avgDuration)}</Fact>
          <Fact label="Coût (30 j)">{formatCost(health.cost30)}</Fact>
        </dl>
      </div>

      <Section title={`Historique · ${task.runs.length} tir${task.runs.length > 1 ? 's' : ''}`}>
        {task.runs.length === 0 ? (
          <p className="text-xs text-ink-faint">Pas encore de tir.</p>
        ) : (
          <ul className="flex flex-col">
            {task.runs.map((run) => {
              const body = (
                <>
                  <span className={cx('size-1.5 shrink-0 rounded-full', RUN_FILL[run.status], run.status === 'running' && 'animate-pulse')} />
                  <span className="w-28 shrink-0 tabular-nums text-ink-soft">{formatDateTime(run.startedAt)}</span>
                  <span className="w-16 shrink-0">{RUN_WORD[run.status]}</span>
                  <span className="w-14 shrink-0 tabular-nums">{run.finishedAt ? formatDuration(durationOf(run)) : '…'}</span>
                  <span className="w-14 shrink-0 tabular-nums">{formatCost(proto.costOf(run))}</span>
                  <span className="min-w-0 flex-1 truncate" title={run.error ?? run.check?.stdout}>
                    {run.trigger === 'manual' ? 'à la main · ' : ''}
                    {run.error ?? (run.status === 'skipped' && run.check ? `écarté par la vérification${run.check.stdout ? ` : ${run.check.stdout}` : ''}` : '')}
                  </span>
                </>
              )
              const shape = 'flex min-h-8 min-w-0 items-center gap-2 rounded-md px-2 text-xs text-ink-faint'
              return (
                <li key={run.id}>
                  {run.conversationId && !proto.demo ? (
                    <Link to={conversationPath({ id: run.conversationId, projectId: task.projectId })} className={cx(shape, 'hover:bg-surface-high hover:text-ink')}>
                      {body}
                      <ArrowUpRight size={13} className="shrink-0" />
                    </Link>
                  ) : (
                    <div className={shape}>{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <h3 className="text-meta font-medium tracking-wide text-ink-faint uppercase">{title}</h3>
      {children}
    </section>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-ink-soft">{children}</dd>
    </div>
  )
}
