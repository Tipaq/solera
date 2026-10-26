import { ChevronDown, ChevronRight, Layers, Search } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { EmptyState, SegmentedControl, cx } from '@solera/ui'
import { MilestoneBanner } from '../components/project/MilestoneBanner'
import { Marker, SessionRow, type SessionMarker } from '../components/project/SessionRow'
import { WorktreeGroups } from '../components/project/WorktreeGroups'
import {
  ACTIVITY_GROUPS,
  isActiveFilter,
  matchesActivity,
  parseActivityFilter,
  type ActivityGroup,
} from '../lib/activity-groups'
import { useActivityRows, type ActivityRow } from '../lib/activity-rows'
import { useAllConversations } from '../lib/conversations'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { milestoneCardIndex } from '../lib/milestone-view'
import { useActiveMilestones } from '../lib/milestones'
import { useProjects } from '../lib/projects'
import { useWorktreeStatuses } from '../lib/worktrees'

/** Lignes montrées des terminées avant « … N de plus » : la planche B1 en plie au-delà. */
const DONE_SHOWN = 3

/** Le regroupement de la liste, porté par l'adresse : les réglages y renvoient. */
type Grouping = 'state' | 'worktree'
const GROUPING_PARAM = 'groupe'

const GROUP_LABEL: Record<ActivityGroup, MessageKey> = {
  asking: 'projectActivity.group.asking',
  review: 'projectActivity.group.review',
  running: 'projectActivity.group.running',
  done: 'projectActivity.group.done',
}

/** Le point d'en-tête d'un groupe : celui de ses lignes les plus ordinaires. */
const GROUP_MARKER: Record<ActivityGroup, SessionMarker> = {
  asking: 'awaiting',
  review: 'review',
  running: 'working',
  done: 'quiet',
}

/**
 * L'onglet **Activité** d'un projet : ses sessions, groupées par ce qu'elles attendent
 * de toi (planches B1, B4 et E1 de `docs/audits/2026-10-21-page-projet/final/`).
 *
 * Quatre groupes, dans l'ordre du geste qu'ils réclament : ce qui te demande quelque
 * chose — une question, une permission ou une erreur —, ce qui est prêt à relire, ce qui
 * travaille, ce qui est fini. Les terminées se plient après trois lignes.
 *
 * Les lignes viennent de `useActivityRows`, que le bloc « En ce moment » de l'Aperçu lit
 * aussi. Une ligne qui te demande quelque chose se déplie en place, avec de quoi
 * répondre sans ouvrir le fil (planche B2, #112).
 *
 * **Un jalon lancé** (planche C1, #116) pose son bandeau en tête de la liste, et les
 * sessions de ses cartes forment un groupe à elles, avant les groupes d'état. Leurs
 * lignes n'y sont plus redites : le groupe du jalon dit déjà où elles en sont, par leur
 * point. Sans jalon lancé, ni bandeau ni groupe.
 *
 * La bascule « Grouper par » range les mêmes lignes sous leur arbre (planche B3, voir
 * `WorktreeGroups`). Elle n'a de sens que dans un dépôt git : ailleurs, elle n'est pas
 * montrée.
 */
export function ProjectActivityPage() {
  const { projectId } = useParams()
  const t = useTranslate()
  const [query, setQuery] = useState('')
  // Les groupes pliés : un groupe d'état par son nom, celui d'un jalon par sa parente.
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  const [allDone, setAllDone] = useState(false)
  const [params, setParams] = useSearchParams()
  // Les aperçus dépliés (planche B2) : plusieurs à la fois, ↑ et ↓ n'en referment aucun.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const rows = useActivityRows(projectId, project)
  const { data: runs } = useActiveMilestones(projectId)
  const runCards = useMemo(() => milestoneCardIndex(runs), [runs])
  // Les mêmes requêtes que celles des lignes, partagées par React Query : le regroupement
  // par worktree lit aussi les arbres sans session et la date de leur dernière session.
  const { data: trees } = useWorktreeStatuses(project?.git ? projectId : undefined)
  const { data: conversations } = useAllConversations()
  const mine = useMemo(
    () => (conversations ?? []).filter((entry) => entry.projectId === projectId),
    [conversations, projectId],
  )

  const filter = useMemo(() => parseActivityFilter(query), [query])
  const shown = useMemo(
    () =>
      rows.filter((row) =>
        matchesActivity(filter, {
          group: row.group,
          title: row.entry.conversation.title,
          branch: row.place.branch,
          card: row.entry.conversation.card,
        }),
      ),
    [rows, filter],
  )

  if (isPending) return null
  if (!projectId || !project) return <EmptyState title={t('project.notFound')} />

  const grouping: Grouping = project.git && params.get(GROUPING_PARAM) === 'worktree' ? 'worktree' : 'state'
  const setGrouping = (next: Grouping) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === 'worktree') updated.set(GROUPING_PARAM, 'worktree')
        else updated.delete(GROUPING_PARAM)
        return updated
      },
      { replace: true },
    )

  // Les compteurs disent tout le projet, pas ce que le filtre laisse : ils répondent à
  // « où en est-on », le filtre à « où est-ce ».
  const counts = Object.fromEntries(
    ACTIVITY_GROUPS.map((group) => [group, rows.filter((row) => row.group === group).length]),
  ) as Record<ActivityGroup, number>

  const toggleRow = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** ↑ et ↓ passent d'une ligne à l'autre, à travers les groupes, sans rien replier. */
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-session-row')) return
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-session-row]')]
    const next = rows[rows.indexOf(event.target) + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  const toggle = (group: string) =>
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })

  function renderSection(key: string, label: string, marker: SessionMarker, members: ActivityRow[], capped: boolean) {
    if (members.length === 0) return null
    const open = !folded.has(key)
    const visible = capped ? members.slice(0, DONE_SHOWN) : members
    const rest = members.length - visible.length
    const headingId = `activity-${key}`
    return (
      <section key={key} aria-labelledby={headingId}>
        <h2 id={headingId} className="sticky top-0 z-10 border-y border-line bg-sunken first:border-t-0">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => toggle(key)}
            className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm text-ink-soft hover:text-ink"
          >
            {open ? (
              <ChevronDown size={14} aria-hidden className="shrink-0 text-ink-faint" />
            ) : (
              <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-faint" />
            )}
            <Marker marker={marker} decorative />
            {label}
            <span className="text-xs text-ink-faint tabular-nums">{members.length}</span>
          </button>
        </h2>
        {open ? (
          <ul className="divide-y divide-line">
            {visible.map((row) => (
              <SessionRow
                key={row.entry.conversation.id}
                conversation={row.entry.conversation}
                marker={row.marker}
                summary={row.summary}
                place={row.place}
                pr={row.pr}
                request={row.request}
                expanded={expanded.has(row.entry.conversation.id)}
                onToggle={() => toggleRow(row.entry.conversation.id)}
              />
            ))}
            {rest > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={() => setAllDone(true)}
                  className="w-full px-4 py-2 text-left text-sm text-ink-faint hover:text-ink md:pl-[3.375rem]"
                >
                  {t('projectActivity.more', { count: rest })}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-ink-soft">
          {ACTIVITY_GROUPS.map((group, index) => {
            const count = counts[group]
            if (count === 0) return null
            const first = ACTIVITY_GROUPS.slice(0, index).every((other) => counts[other] === 0)
            return (
              <span
                key={group}
                // Au téléphone, seuls restent ce qui réclame et ce qui tourne (E1).
                className={cx(
                  'items-center gap-1.5',
                  group === 'review' || group === 'done' ? 'hidden sm:flex' : 'flex',
                  group === 'asking' && 'text-caution',
                )}
              >
                {first ? null : <span aria-hidden className="text-ink-faint">·</span>}
                {t(`projectActivity.count.${group}.${count > 1 ? 'many' : 'one'}`, { count })}
              </span>
            )
          })}
        </p>
        <div className="ml-auto hidden min-w-0 flex-1 items-center gap-2 rounded-lg border border-line bg-sunken px-3 sm:flex sm:max-w-sm">
          <Search size={16} aria-hidden className="shrink-0 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t('projectActivity.filter.label')}
            placeholder={t('projectActivity.filter.placeholder')}
            className="min-h-9 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
        </div>
        {project.git ? (
          <div className="hidden items-center gap-2 sm:flex">
            <span aria-hidden className="text-sm text-ink-faint">
              {t('projectActivity.groupBy.label')}
            </span>
            <SegmentedControl<Grouping>
              label={t('projectActivity.groupBy.label')}
              value={grouping}
              onChange={setGrouping}
              segments={[
                { value: 'state', label: t('projectActivity.groupBy.state') },
                { value: 'worktree', label: t('projectActivity.groupBy.worktree') },
              ]}
            />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={moveFocus}>
        {(runs ?? []).map((run) => (
          <div key={run.id} className="border-b border-line px-4 py-3">
            <MilestoneBanner projectId={projectId} run={run} />
          </div>
        ))}
        {grouping === 'worktree' ? (
          <WorktreeGroups
            projectId={projectId}
            rows={shown}
            status={trees}
            rootGit={project.git}
            conversations={mine}
            filtering={isActiveFilter(filter)}
            words={filter.words}
            expanded={expanded}
            onToggle={toggleRow}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Layers size={20} />} title={t('projectActivity.empty')} description={t('projectActivity.emptyHint')} />
        ) : shown.length === 0 ? (
          <EmptyState title={t('projectActivity.noMatch')} />
        ) : (
          <>
            {(runs ?? []).map((run) => {
              const members = shown
                .filter((row) => runCards.get(row.entry.conversation.card?.id ?? '')?.run.id === run.id)
                // Dans l'ordre des groupes d'état, puis du plus récent : ce qui te
                // demande quelque chose d'abord, comme partout ailleurs.
                .sort((a, b) => ACTIVITY_GROUPS.indexOf(a.group) - ACTIVITY_GROUPS.indexOf(b.group))
              return renderSection(
                `milestone-${run.cardId}`,
                t('projectActivity.group.milestone', { number: run.cardNumber }),
                // Le point de sa ligne la plus pressante : l'ambre si une session attend.
                GROUP_MARKER[members[0]?.group ?? 'running'],
                members,
                false,
              )
            })}
            {ACTIVITY_GROUPS.map((group) =>
              renderSection(
                group,
                t(GROUP_LABEL[group]),
                GROUP_MARKER[group],
                shown.filter((row) => row.group === group && !runCards.has(row.entry.conversation.card?.id ?? '')),
                // Un filtre actif montre tout ce qu'il a trouvé : plier ce qu'on cherche
                // le cacherait une seconde fois.
                group === 'done' && !allDone && !isActiveFilter(filter),
              ),
            )}
          </>
        )}
      </div>
    </div>
  )
}
