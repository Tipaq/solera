import { CalendarClock, Plus } from 'lucide-react'
import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import type { ProjectDto, ScheduledTaskDto } from '@solera/protocol'
import { useTranslate, type MessageKey, locale } from '../../lib/i18n'
import { useDisplaySettings } from '../../lib/display-settings'
import { SCHEDULE_STATE_LABELS, scheduleState } from '../../lib/schedules'
import { ProjectAvatar } from '../ProjectAvatar'
import { StateDot } from '../chat/Signals'
import { cx } from '@solera/ui'

const DAY = 86_400_000

type Bucket = 'today' | 'week' | 'later' | 'idle'

const BUCKET_LABELS: Record<Bucket, MessageKey> = {
  today: 'shell.planned.today',
  week: 'shell.planned.week',
  later: 'shell.planned.later',
  idle: 'shell.planned.idle',
}

const ORDER: Bucket[] = ['today', 'week', 'later', 'idle']

/**
 * Le lieu *Planifiées* : les tâches de tous les projets, groupées par échéance.
 *
 * C'est le premier lieu qui n'existait pas au premier tour, et la preuve qu'il en
 * viendra d'autres — une tâche n'a pas besoin d'un projet, et celles qui en ont un le
 * portent en puce tout en restant listées dedans.
 */
export function PlacePlanned({ tasks, projects, onNavigate }: {
  tasks: ScheduledTaskDto[]
  projects: ProjectDto[]
  onNavigate: () => void
}) {
  const t = useTranslate()
  const display = useDisplaySettings()

  const groups = useMemo(() => {
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const tomorrow = midnight.getTime() + DAY
    const week = midnight.getTime() + 7 * DAY
    const bucket = (task: ScheduledTaskDto): Bucket => {
      // En pause, ou ponctuelle déjà tirée : plus rien n'est prévu, mais la tâche existe
      // encore et doit rester joignable.
      if (task.nextRunAt === null) return 'idle'
      if (task.nextRunAt < tomorrow) return 'today'
      if (task.nextRunAt < week) return 'week'
      return 'later'
    }
    const sorted = [...tasks].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity))
    return ORDER
      .map((key) => ({ key, entries: sorted.filter((task) => bucket(task) === key) }))
      .filter((group) => group.entries.length > 0)
  }, [tasks])

  return (
    <div className="px-2 pb-4">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="px-2.5 pt-2 pb-1 text-meta font-semibold uppercase tracking-wider text-ink-faint">
            {t(BUCKET_LABELS[group.key])}
          </h2>
          <ul>
            {group.entries.map((task) => (
              <TaskLine
                key={task.id}
                task={task}
                project={display.projectDot ? projects.find((project) => project.id === task.projectId) : undefined}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </section>
      ))}

      {tasks.length === 0 ? (
        <p className="px-2.5 py-2 text-sm text-ink-faint">{t('shell.planned.empty')}</p>
      ) : null}

      {/* Une tâche se planifie dans un projet : la ligne mène à la planification du
          premier d'entre eux plutôt qu'à un formulaire sans répertoire de travail. */}
      {projects[0] ? (
        <NavLink
          to={`/p/${projects[0].id}/schedules`}
          onClick={onNavigate}
          className="flex h-11 items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-faint transition-colors hover:bg-surface-high hover:text-ink md:h-8 pointer-coarse:h-11"
        >
          <Plus size={16} className="shrink-0" />
          {t('shell.planned.new')}
        </NavLink>
      ) : null}
    </div>
  )
}

/**
 * Une tâche en une ligne : nom, puce du projet, et l'heure ou le jour de son prochain
 * tir. L'heure seule pour aujourd'hui, le jour abrégé pour la semaine — à cette largeur
 * une date complète chasserait le nom.
 */
function TaskLine({ task, project, onNavigate }: {
  task: ScheduledTaskDto
  project?: ProjectDto
  onNavigate: () => void
}) {
  const t = useTranslate()
  const state = scheduleState(task)
  // Un script à valider écarte tous les tirs : l'heure du prochain mentirait, c'est la
  // validation qu'on attend.
  const awaiting = state === 'approval'
  const due = useMemo(() => {
    if (task.nextRunAt === null || state === 'approval') return t(SCHEDULE_STATE_LABELS[state])
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    const sameDay = task.nextRunAt < midnight.getTime() + DAY
    return new Intl.DateTimeFormat(locale(), sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { weekday: 'short' }).format(task.nextRunAt)
  }, [task.nextRunAt, state, t])

  return (
    <li>
      {/* Une tâche sans projet se lit sur la page *Planifiées*, qui les porte toutes :
          composer `/p/null/schedules` donnerait une adresse qui se charge et ne trouve
          rien. `scheduled_tasks.project_id` est nullable depuis la migration 0032. */}
      <NavLink
        to={task.projectId ? `/p/${task.projectId}/schedules` : '/schedules'}
        onClick={onNavigate}
        title={`${task.name} · ${t(SCHEDULE_STATE_LABELS[state])}`}
        className={({ isActive }) => cx(
          'flex h-11 items-center gap-2 rounded-md px-2.5 text-sm transition-colors md:h-8 pointer-coarse:h-11',
          isActive ? 'bg-accent-wash text-ink' : 'text-ink-soft hover:bg-surface-high hover:text-ink',
        )}
      >
        <CalendarClock size={14} className="shrink-0 text-ink-faint" />
        <span className="min-w-0 flex-1 truncate">{task.name}</span>
        {project ? <ProjectAvatar project={project} className="size-3" /> : null}
        {awaiting ? <StateDot state="awaiting" labelled={false} /> : null}
        <span className={cx('shrink-0 text-meta tabular-nums', awaiting ? 'text-caution' : 'text-ink-faint')}>{due}</span>
      </NavLink>
    </li>
  )
}
