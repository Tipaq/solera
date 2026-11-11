/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { Pause, Play, ShieldAlert } from 'lucide-react'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { cronToHuman } from '../../lib/cron'
import { locale } from '../../lib/i18n'
import { describeCadence } from '../../lib/schedules'
import { DAY, formatCost, formatDuration, healthOf, inShort, verdictRuns, type ScheduleProto, type TaskHealth } from './data'
import { EmptyTasks, RunPips, StateMark, Summary, stub, type Task } from './shared'

type Group = 'attention' | 'healthy' | 'paused'

const GROUP_TITLE: Record<Group, string> = {
  attention: 'À regarder',
  healthy: 'En bonne santé',
  paused: 'En pause',
}

function groupOf(health: TaskHealth): Group {
  if (health.state === 'paused' || health.state === 'done') return 'paused'
  if (health.state === 'approval' || health.state === 'failed' || health.failStreak > 0 || (health.rate !== null && health.rate < 0.8)) return 'attention'
  return 'healthy'
}

/**
 * `sante` : ce qui échoue d'abord. Un bilan sur trente jours en tête, puis les tâches
 * rangées par ce qu'elles demandent : celles qui cassent ou attendent une relecture,
 * celles qui tournent bien, celles en pause.
 */
export function HealthVariant({ proto }: { proto: ScheduleProto }) {
  const now = Date.now()
  const rows = proto.tasks.map((task) => ({ task, health: healthOf(task, proto.costOf, now) }))
  const judged = proto.tasks.flatMap((task) => verdictRuns(task).filter((run) => run.startedAt > now - 30 * DAY))
  const ok = judged.filter((run) => run.status === 'succeeded').length
  const cost = rows.reduce((sum, row) => sum + row.health.cost30, 0)
  const failures7 = judged.filter((run) => run.startedAt > now - 7 * DAY && (run.status === 'failed' || run.status === 'timed_out')).length
  const next = proto.tasks.filter((task) => task.nextRunAt).sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0]

  const groups = (['attention', 'healthy', 'paused'] as Group[])
    .map((group) => ({
      group,
      rows: rows
        .filter((row) => groupOf(row.health) === group)
        .sort((a, b) => b.health.failStreak - a.health.failStreak || (a.health.rate ?? 1) - (b.health.rate ?? 1)),
    }))
    .filter((entry) => entry.rows.length > 0)

  return (
    <div className="flex flex-col gap-6">
      <Summary proto={proto} />
      {proto.tasks.length === 0 ? (
        <EmptyTasks />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
            <Figure label="Réussite sur 30 jours" value={judged.length ? `${Math.round((ok / judged.length) * 100)} %` : '—'} hint={`${ok} sur ${judged.length} tirs jugés`} tone={judged.length && ok / judged.length < 0.8 ? 'text-caution' : undefined} />
            <Figure label="Échecs sur 7 jours" value={String(failures7)} hint={failures7 ? 'échecs et dépassements' : 'rien n’a cassé'} tone={failures7 ? 'text-critical' : undefined} />
            <Figure label="Coût sur 30 jours" value={formatCost(cost)} hint={proto.demo ? 'simulé en démo' : 'coût des sessions des tirs'} />
            <Figure label="Prochain tir" value={next ? inShort(next.nextRunAt!) : '—'} hint={next?.name ?? 'rien de prévu'} />
          </dl>

          {groups.map(({ group, rows: entries }) => (
            <section key={group} className="flex flex-col gap-2">
              <h2 className={cx('flex items-center gap-2 text-sm font-medium', group === 'attention' ? 'text-ink' : 'text-ink-soft')}>
                {GROUP_TITLE[group]}
                <span className="text-xs font-normal text-ink-faint tabular-nums">{entries.length}</span>
              </h2>
              <ul className={cx('flex flex-col', group === 'attention' ? 'gap-2' : 'divide-y divide-line rounded-xl border border-line')}>
                {entries.map(({ task, health }) =>
                  group === 'attention' ? (
                    <AttentionCard key={task.id} task={task} health={health} proto={proto} />
                  ) : (
                    <QuietRow key={task.id} task={task} health={health} proto={proto} />
                  ),
                )}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function Figure({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-canvas px-4 py-3">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className={cx('text-2xl font-semibold tabular-nums', tone)}>{value}</dd>
      <dd className="truncate text-xs text-ink-faint">{hint}</dd>
    </div>
  )
}

/** Une tâche qui demande quelque chose : la raison en clair, et le geste qui y répond. */
function AttentionCard({ task, health, proto }: { task: Task; health: TaskHealth; proto: ScheduleProto }) {
  const reason =
    health.state === 'approval'
      ? 'Un agent a proposé un script de vérification : aucun tir ne part avant ta relecture.'
      : health.failStreak > 0
        ? `${health.failStreak} échec${health.failStreak > 1 ? 's' : ''} d'affilée${health.lastError ? ` — ${health.lastError}` : ''}`
        : `Réussite à ${Math.round((health.rate ?? 0) * 100)} % sur 30 jours`
  const tone = health.state === 'approval' ? 'border-caution/50' : 'border-critical/50'

  return (
    <li className={cx('flex flex-col gap-3 rounded-xl border bg-surface/40 px-4 py-3', tone)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AgentIcon agent={task.agent} size={15} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.name}</span>
        <StateMark state={health.state} />
      </div>
      <p className={cx('text-sm', health.state === 'approval' ? 'text-caution' : 'text-critical')}>{reason}</p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-faint">
        <RunPips runs={task.runs} costOf={proto.costOf} />
        <span>{describeCadence(task.cadence, (expression) => cronToHuman(expression, locale()))}</span>
        {task.nextRunAt ? <span>prochain {inShort(task.nextRunAt)}</span> : null}
        <span className="ml-auto flex gap-1.5">
          {health.state === 'approval' ? (
            <ActionButton icon={<ShieldAlert size={13} />} label="Relire le script" primary />
          ) : (
            <ActionButton icon={<Play size={13} />} label="Relancer maintenant" primary />
          )}
          <ActionButton icon={<Pause size={13} />} label="Mettre en pause" />
        </span>
      </div>
    </li>
  )
}

function QuietRow({ task, health, proto }: { task: Task; health: TaskHealth; proto: ScheduleProto }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 md:grid-cols-[minmax(0,1.5fr)_8.5rem_5rem_5rem_6rem_auto]">
      <span className="flex min-w-0 items-center gap-2.5">
        <AgentIcon agent={task.agent} size={14} />
        <span className={cx('truncate text-sm', !task.enabled && 'text-ink-faint')}>{task.name}</span>
      </span>
      <span className="hidden md:block"><RunPips runs={task.runs} costOf={proto.costOf} /></span>
      <span className="hidden text-xs tabular-nums text-ink-soft md:block">{health.rate === null ? '—' : `${Math.round(health.rate * 100)} %`}</span>
      <span className="hidden text-xs tabular-nums text-ink-faint md:block">{health.avgDuration === null ? '—' : formatDuration(health.avgDuration)}</span>
      <span className="hidden text-xs tabular-nums text-ink-faint md:block">{formatCost(health.cost30)}</span>
      <span className="flex justify-end">
        {task.enabled ? (
          <span className="text-xs text-ink-faint tabular-nums">{task.nextRunAt ? inShort(task.nextRunAt) : '—'}</span>
        ) : (
          <ActionButton icon={<Play size={13} />} label="Reprendre" />
        )}
      </span>
    </li>
  )
}

function ActionButton({ icon, label, primary }: { icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => stub(label)}
      title={`${label} (simulé)`}
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors',
        primary ? 'bg-accent text-accent-ink hover:opacity-90' : 'border border-line text-ink-soft hover:border-line-strong',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
