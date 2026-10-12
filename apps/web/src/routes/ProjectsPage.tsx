import { CalendarClock, FolderOpen, FolderPlus, GitBranch, MessageCircleQuestion, Pencil, SquareKanban } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CardDto, ConversationDto, ProjectDto, ScheduledTaskDto } from '@solera/protocol'
import { HeaderBand } from '../components/HeaderBand'
import { ProjectAvatar } from '../components/ProjectAvatar'
import { DemandTile } from '../components/places/DemandTile'
import { Button, EmptyState, cx } from '@solera/ui'
import { useLiveConversations, type LiveConversation } from '../lib/activity'
import { api } from '../lib/api'
import { useAllConversations } from '../lib/conversations'
import { relativeDate } from '../lib/dates'
import { locale, useTranslate } from '../lib/i18n'
import { useProjects } from '../lib/projects'
import { useSchedules } from '../lib/schedules'
import { useQueries } from '@tanstack/react-query'

/** Ce qu'une ligne de projet doit dire, une fois tout recoupé. */
interface Row {
  project: ProjectDto
  awaiting: LiveConversation[]
  running: LiveConversation[]
  review: CardDto[]
  /** La prochaine tâche à partir, toutes cadences confondues. */
  next: ScheduledTaskDto | null
  /** Dernière écriture dans une de ses conversations, zéro s'il n'en a aucune. */
  lastActivity: number
}

/**
 * La page Projets : une ligne par projet, pas une grille de cartes.
 *
 * On compare mieux huit projets sur une colonne alignée que sur une grille : l'œil
 * descend une colonne et lit huit branches, là où une grille lui fait refaire le
 * chemin dans chaque carte. Chaque ligne dit ce qui réclame, l'état du dépôt, la
 * prochaine tâche et la dernière activité — le bandeau du haut n'en est que la somme.
 */
export function ProjectsPage() {
  const t = useTranslate()
  const { data: projects, isPending } = useProjects()
  const { data: conversations } = useAllConversations()
  const { data: schedules } = useSchedules()

  const visible = useMemo(
    () => (projects ?? []).filter((project) => !project.archivedAt),
    [projects],
  )
  const live = useLiveConversations(conversations ?? [])

  /**
   * Les cartes de chaque projet, une requête par projet.
   *
   * Il n'y a pas de route qui les rende toutes : `/api/projects/:id/cards` est ce que
   * le serveur offre, et la liste des projets est courte. `useQueries` partage le
   * cache avec `useCards`, donc ouvrir un board ensuite ne relit rien.
   */
  const cardQueries = useQueries({
    queries: visible.map((project) => ({
      queryKey: ['cards', project.id],
      queryFn: () => api.get<CardDto[]>(`/api/projects/${project.id}/cards`),
      staleTime: 15_000,
    })),
  })

  const rows = useMemo((): Row[] => {
    return visible.map((project, index) => {
      const mine = live.filter((entry) => entry.conversation.projectId === project.id)
      const tasks = (schedules ?? []).filter(
        (task) => task.projectId === project.id && task.nextRunAt !== null,
      )
      return {
        project,
        awaiting: mine.filter((entry) => entry.awaiting),
        running: mine.filter((entry) => entry.running),
        review: (cardQueries[index]?.data ?? []).filter((card) => card.column === 'review'),
        next: tasks.sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0))[0] ?? null,
        lastActivity: lastActivityOf(conversations ?? [], project.id),
      }
    })
  }, [visible, live, schedules, cardQueries, conversations])

  const awaiting = rows.filter((row) => row.awaiting.length > 0)
  const review = rows.filter((row) => row.review.length > 0)
  const running = rows.filter((row) => row.running.length > 0)
  const count = (rows: Row[], of: (row: Row) => number) => rows.reduce((sum, row) => sum + of(row), 0)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderBand>
        <SquareKanban size={16} className="shrink-0 text-ink-faint" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{t('place.projects.title')}</h1>
      </HeaderBand>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          <header className="flex items-center gap-3">
            <h2 className="min-w-0 flex-1 text-lg font-semibold tracking-tight">
              {t('place.projects.title')}
            </h2>
            <Link to="/projects/new">
              <Button size="sm" icon={<FolderPlus size={16} />}>{t('place.projects.new')}</Button>
            </Link>
          </header>

          {awaiting.length > 0 || review.length > 0 || running.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {awaiting.length > 0 ? (
                <DemandTile
                  to={`/p/${awaiting[0]!.project.id}`}
                  tone="caution"
                  icon={<MessageCircleQuestion size={14} />}
                  label={t('place.projects.awaiting')}
                  count={count(awaiting, (row) => row.awaiting.length)}
                  detail={awaiting.map((row) => row.project.name).join(', ')}
                />
              ) : null}
              {review.length > 0 ? (
                <DemandTile
                  to={`/p/${review[0]!.project.id}/board`}
                  tone="caution"
                  icon={<Pencil size={14} />}
                  label={t('place.demand.review')}
                  count={count(review, (row) => row.review.length)}
                  detail={t(review.length > 1 ? 'place.projects.spreadMany' : 'place.projects.spreadOne', { count: review.length })}
                />
              ) : null}
              {running.length > 0 ? (
                <DemandTile
                  to={`/p/${running[0]!.project.id}`}
                  tone="accent"
                  icon={<span aria-hidden className="block size-1.5 rounded-full bg-accent" />}
                  label={t('place.projects.running')}
                  count={count(running, (row) => row.running.length)}
                  detail={t(running.length > 1 ? 'place.projects.spreadMany' : 'place.projects.spreadOne', { count: running.length })}
                />
              ) : null}
            </div>
          ) : null}

          {isPending ? null : rows.length === 0 ? (
            <EmptyState
              icon={<FolderOpen size={22} />}
              title={t('home.empty.title')}
              description={t('home.empty.description')}
              action={
                <Link to="/projects/new">
                  <Button>{t('home.createProject')}</Button>
                </Link>
              }
            />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {rows.map((row) => (
                <ProjectRow key={row.project.id} row={row} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function lastActivityOf(conversations: ConversationDto[], projectId: string): number {
  let latest = 0
  for (const entry of conversations) {
    if (entry.projectId === projectId && entry.updatedAt > latest) latest = entry.updatedAt
  }
  return latest
}

function ProjectRow({ row }: { row: Row }) {
  const t = useTranslate()
  const { project, awaiting, running, review, next, lastActivity } = row

  return (
    <li>
      <Link
        to={`/p/${project.id}`}
        className={cx(
          'flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-line px-3.5 py-2.5',
          'transition-colors hover:border-line-strong focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        <ProjectAvatar project={project} className="size-5" />
        <span className="min-w-0 truncate font-semibold">{project.name}</span>

        <span className="flex shrink-0 items-center gap-1">
          {awaiting.length > 0 ? (
            <Pill tone="caution" label={t('place.demand.awaiting')} count={awaiting.length}>
              <MessageCircleQuestion size={11} />
            </Pill>
          ) : null}
          {review.length > 0 ? (
            <Pill tone="caution" label={t('place.demand.review')} count={review.length}>
              <Pencil size={11} />
            </Pill>
          ) : null}
          {running.length > 0 ? (
            <Pill tone="accent" label={t('place.demand.running')} count={running.length}>
              <span aria-hidden className="block size-1.5 rounded-full bg-accent" />
            </Pill>
          ) : null}
        </span>

        {/* Ce qui suit est le même en largeur sur chaque ligne : c'est ce qui rend la
            colonne lisible de haut en bas, et c'est la raison d'être des lignes. */}
        <span className="ml-auto flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-faint">
          {project.git ? (
            <span className="flex min-w-0 items-center gap-1.5" title={project.git.branch}>
              <GitBranch size={12} className="shrink-0" />
              <span className="max-w-32 truncate font-mono">{project.git.branch}</span>
              {!project.git.isDirty ? (
                <span className="shrink-0">{t('place.projects.clean')}</span>
              ) : project.git.added + project.git.removed > 0 ? (
                <span className="shrink-0 tabular-nums">
                  <span className="text-positive">+{project.git.added}</span>{' '}
                  <span className="text-critical">−{project.git.removed}</span>
                </span>
              ) : (
                // Un arbre sale sans diff n'a que des fichiers non suivis :
                // `git diff HEAD` ne les voit pas, et « +0 −0 » dirait le contraire
                // de ce que `git status` vient de compter.
                <span className="shrink-0 tabular-nums">
                  {t(project.git.changedFiles > 1 ? 'place.projects.changedMany' : 'place.projects.changedOne', {
                    count: project.git.changedFiles,
                  })}
                </span>
              )}
            </span>
          ) : null}
          {next?.nextRunAt ? (
            <span className="flex min-w-0 items-center gap-1.5" title={next.name}>
              <CalendarClock size={12} className="shrink-0" />
              <span className="max-w-40 truncate">
                {t('place.projects.next', { name: next.name, time: hourOf(next.nextRunAt) })}
              </span>
            </span>
          ) : null}
          {lastActivity > 0 ? (
            <span className="shrink-0">{relativeDate(lastActivity)}</span>
          ) : null}
        </span>
      </Link>
    </li>
  )
}

/** L'heure seule : la ligne dit déjà « prochaine », la date complète la ferait déborder. */
function hourOf(ts: number): string {
  return new Date(ts).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
}

function Pill({
  tone,
  label,
  count,
  children,
}: {
  tone: 'caution' | 'accent'
  label: string
  count: number
  children: ReactNode
}) {
  return (
    <span
      title={`${label} : ${count}`}
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-meta tabular-nums',
        tone === 'caution' ? 'bg-caution/15 text-caution' : 'bg-accent-wash text-accent',
      )}
    >
      {children}
      {count}
      <span className="sr-only">{label}</span>
    </span>
  )
}
