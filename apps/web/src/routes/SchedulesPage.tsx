import { CalendarClock, CircleHelp, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ProjectDto, ScheduledTaskDto } from '@solera/protocol'
import { HeaderBand } from '../components/HeaderBand'
import { ProjectAvatar } from '../components/ProjectAvatar'
import { ScheduleDialog } from '../components/schedule/ScheduleDialog'
import { Banner, Button, EmptyState, Menu, MenuItem, Switch, cx } from '@solera/ui'
import { cronToHuman } from '../lib/cron'
import { locale, useTranslate } from '../lib/i18n'
import { useProjects } from '../lib/projects'
import {
  RUN_DOTS,
  RUN_LABELS,
  describeCadence,
  formatDateTime,
  lastRun,
  useSchedules,
  useUpdateSchedule,
} from '../lib/schedules'

/**
 * Toutes les tâches planifiées, tous projets confondus.
 *
 * Une page de lieu et non une vue de projet : une tâche n'a pas besoin d'un projet
 * pour exister — « relire le journal de la veille » travaille le vault — et il faut
 * donc un endroit d'où on les voit toutes. Celles qui ont un projet restent listées
 * dedans, sur `/p/:projectId/schedules` : les deux lisent la même requête.
 *
 * La cible est une colonne à part entière, et c'est elle qui fait la différence avec
 * la page d'un projet : sans elle, deux tâches homonymes de deux dépôts seraient
 * indiscernables.
 */
export function SchedulesPage() {
  const t = useTranslate()
  const navigate = useNavigate()
  const { data: projects } = useProjects()
  const { data: tasks, isPending, isError } = useSchedules()
  const [creatingIn, setCreatingIn] = useState<ProjectDto | null>(null)

  const sorted = useMemo(
    () =>
      [...(tasks ?? [])].sort((a, b) => {
        // Les armées d'abord, dans l'ordre où elles partiront : la question qu'on se
        // pose en arrivant ici est « qu'est-ce qui tombe ensuite ».
        if (a.nextRunAt === null) return b.nextRunAt === null ? a.name.localeCompare(b.name) : 1
        if (b.nextRunAt === null) return -1
        return a.nextRunAt - b.nextRunAt
      }),
    [tasks],
  )
  const open = (projects ?? []).filter((project) => !project.archivedAt)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderBand>
        <CalendarClock size={16} className="shrink-0 text-ink-faint" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{t('place.schedules.title')}</h1>
        <Menu
          trigger={
            <Button size="sm" icon={<Plus size={14} />} disabled={open.length === 0}>
              {t('place.schedule.add')}
            </Button>
          }
        >
          {/* Une tâche se crée dans un projet : le choix est ici parce que la page,
              elle, n'en a pas. */}
          {open.map((project) => (
            <MenuItem
              key={project.id}
              icon={<ProjectAvatar project={project} />}
              onSelect={() => setCreatingIn(project)}
            >
              {project.name}
            </MenuItem>
          ))}
        </Menu>
      </HeaderBand>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          {isError ? <Banner>{t('schedule.loadError')}</Banner> : null}
          {isPending ? (
            <p role="status" className="text-sm text-ink-faint">{t('schedule.loading')}</p>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={<CalendarClock size={22} />}
              title={t('place.schedules.empty')}
              description={t('schedule.emptyHint')}
            />
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-left text-meta font-semibold tracking-wider text-ink-faint uppercase">
                  <th scope="col" className="px-2 pb-2 font-semibold">{t('place.schedules.task')}</th>
                  <th scope="col" className="hidden px-2 pb-2 font-semibold sm:table-cell">{t('place.schedules.target')}</th>
                  <th scope="col" className="hidden px-2 pb-2 font-semibold md:table-cell">{t('place.schedules.frequency')}</th>
                  <th scope="col" className="px-2 pb-2 text-right font-semibold">{t('place.schedules.next')}</th>
                  <th scope="col" className="px-2 pb-2 text-right font-semibold">{t('place.schedules.last')}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    project={projects?.find((entry) => entry.id === task.projectId)}
                    onOpen={
                      task.projectId ? () => navigate(`/p/${task.projectId}/schedules`) : null
                    }
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {creatingIn ? (
        <ScheduleDialog project={creatingIn} onClose={() => setCreatingIn(null)} />
      ) : null}
    </div>
  )
}

function TaskRow({
  task,
  project,
  onOpen,
}: {
  task: ScheduledTaskDto
  project: ProjectDto | undefined
  /** `null` quand la tâche n'a pas de projet : il n'y a alors aucune page où l'ouvrir. */
  onOpen: (() => void) | null
}) {
  const t = useTranslate()
  const update = useUpdateSchedule()
  const run = lastRun(task)

  return (
    <tr className={cx('border-t border-line/60', !task.enabled && 'text-ink-faint')}>
      <td className="min-w-0 p-0">
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className="flex min-h-11 w-full items-center rounded px-2 text-left hover:text-accent focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="min-w-0 truncate">{task.name}</span>
          </button>
        ) : (
          <span className="flex min-h-11 w-full items-center px-2">
            <span className="min-w-0 truncate">{task.name}</span>
          </span>
        )}
      </td>
      <td className="hidden px-2 sm:table-cell">
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-soft">
          <ProjectAvatar project={project} />
          <span className="max-w-32 truncate">
            {project?.name ?? (task.projectId ? t('shell.overview.unknown') : t('destination.none'))}
          </span>
        </span>
      </td>
      <td className="hidden max-w-48 truncate px-2 text-xs text-ink-soft md:table-cell">
        {describeCadence(task.cadence, (expression) => cronToHuman(expression, locale()))}
      </td>
      <td className="px-2 text-right text-xs tabular-nums whitespace-nowrap text-ink-soft">
        {task.nextRunAt ? formatDateTime(task.nextRunAt) : '—'}
      </td>
      <td className="px-2">
        <span className="flex items-center justify-end gap-2.5">
          {run ? (
            <span
              aria-hidden
              title={t(RUN_LABELS[run.status])}
              className={cx('size-2 shrink-0 rounded-full', RUN_DOTS[run.status])}
            />
          ) : (
            <CircleHelp size={13} className="shrink-0 text-ink-faint" aria-hidden />
          )}
          <span className="sr-only">{run ? t(RUN_LABELS[run.status]) : t('schedule.fact.never')}</span>
          <Switch
            checked={task.enabled}
            disabled={update.isPending}
            label={t('place.schedules.toggle', { name: task.name })}
            onCheckedChange={(enabled) => update.mutate({ id: task.id, enabled })}
          />
        </span>
      </td>
    </tr>
  )
}
