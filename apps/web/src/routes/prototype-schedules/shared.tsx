/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import type { ScheduledRunDto, ScheduledTaskDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { formatDateTime, type ScheduleState } from '../../lib/schedules'
import { DemoToggle } from '../prototype-milestones/HorizonVariant'
import { formatCost, formatDuration, durationOf, type ScheduleProto } from './data'

/** Aucune écriture depuis le proto : chaque geste le dit. */
export function stub(label: string) {
  window.alert(`Simulé : « ${label} » ne fait rien dans le prototype.`)
}

export const STATE_WORD: Record<ScheduleState, string> = {
  running: 'tourne',
  approval: 'à valider',
  paused: 'en pause',
  failed: 'en échec',
  done: 'terminée',
  waiting: 'prête',
}

export const STATE_DOT: Record<ScheduleState, string> = {
  running: 'bg-accent animate-pulse',
  approval: 'bg-caution',
  paused: 'bg-line-strong',
  failed: 'bg-critical',
  done: 'bg-line-strong',
  waiting: 'bg-positive',
}

export const STATE_TEXT: Record<ScheduleState, string> = {
  running: 'text-accent',
  approval: 'text-caution',
  paused: 'text-ink-faint',
  failed: 'text-critical',
  done: 'text-ink-faint',
  waiting: 'text-ink-soft',
}

/** La couleur d'un tir, pleine pour la pastille, lavée pour un bloc d'agenda. */
export const RUN_FILL: Record<ScheduledRunDto['status'], string> = {
  checking: 'bg-accent',
  running: 'bg-accent',
  succeeded: 'bg-positive',
  failed: 'bg-critical',
  timed_out: 'bg-caution',
  skipped: 'bg-line-strong',
}

export const RUN_BLOCK: Record<ScheduledRunDto['status'], string> = {
  checking: 'border-accent/60 bg-accent/15 text-accent',
  running: 'border-accent/60 bg-accent/15 text-accent',
  succeeded: 'border-positive/50 bg-positive/12 text-ink',
  failed: 'border-critical/60 bg-critical/12 text-ink',
  timed_out: 'border-caution/60 bg-caution/12 text-ink',
  skipped: 'border-line bg-surface-high/60 text-ink-faint',
}

export const RUN_WORD: Record<ScheduledRunDto['status'], string> = {
  checking: 'vérifie',
  running: 'en cours',
  succeeded: 'réussi',
  failed: 'échoué',
  timed_out: 'trop long',
  skipped: 'sauté',
}

/** Les dix derniers tirs en pastilles, le plus récent à droite. */
export function RunPips({ runs, costOf }: { runs: ScheduledRunDto[]; costOf: ScheduleProto['costOf'] }) {
  const shown = runs.slice(0, 10).reverse()
  return (
    <span className="flex items-center gap-0.5" aria-label={`${shown.length} derniers tirs`}>
      {Array.from({ length: 10 - shown.length }, (_, index) => (
        <span key={`empty-${index}`} className="h-3 w-1.5 rounded-sm bg-surface-high" />
      ))}
      {shown.map((run) => (
        <span
          key={run.id}
          title={`${formatDateTime(run.startedAt)} · ${RUN_WORD[run.status]}${run.finishedAt ? ` · ${formatDuration(durationOf(run))}` : ''} · ${formatCost(costOf(run))}`}
          className={cx('h-3 w-1.5 rounded-sm', RUN_FILL[run.status], run.status === 'running' && 'animate-pulse')}
        />
      ))}
    </span>
  )
}

export function StateMark({ state }: { state: ScheduleState }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs', STATE_TEXT[state])}>
      <span aria-hidden className={cx('size-1.5 rounded-full', STATE_DOT[state])} />
      {STATE_WORD[state]}
    </span>
  )
}

/** La ligne de tête commune : le bilan en mots, et la bascule de démo. */
export function Summary({ proto, children }: { proto: ScheduleProto; children?: React.ReactNode }) {
  const active = proto.tasks.filter((task) => task.enabled).length
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="text-sm text-ink-soft">
        <span className="font-medium text-ink">{proto.tasks.length}</span> tâche{proto.tasks.length > 1 ? 's' : ''}
        <span className="text-ink-faint"> · {active} active{active > 1 ? 's' : ''}</span>
      </p>
      <span className="ml-auto flex items-center gap-2">
        {children}
        <DemoToggle demo={proto.demo} />
      </span>
    </div>
  )
}

export function EmptyTasks() {
  return (
    <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-faint">
      Aucune tâche planifiée. <span className="text-ink-soft">+ Tâche</span> dans la rangée, ou « Données de démo » pour juger la vue.
    </p>
  )
}

export type Task = ScheduledTaskDto
