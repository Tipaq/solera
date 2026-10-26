import { ChevronDown, ChevronRight, Layers, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { EmptyState, cx } from '@solera/ui'
import { Marker, SessionRow, type SessionMarker } from '../components/project/SessionRow'
import {
  ACTIVITY_GROUPS,
  isActiveFilter,
  matchesActivity,
  parseActivityFilter,
  type ActivityGroup,
} from '../lib/activity-groups'
import { useActivityRows } from '../lib/activity-rows'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { useProjects } from '../lib/projects'

/** Lignes montrées des terminées avant « … N de plus » : la planche B1 en plie au-delà. */
const DONE_SHOWN = 3

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
 * aussi.
 *
 * Le regroupement par worktree (B3) est la carte #111 : la bascule « Grouper par » viendra
 * avec elle, et c'est pourquoi la barre ne la montre pas encore.
 */
export function ProjectActivityPage() {
  const { projectId } = useParams()
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState<ReadonlySet<ActivityGroup>>(() => new Set())
  const [allDone, setAllDone] = useState(false)

  const { data: projects, isPending } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const rows = useActivityRows(projectId, project)

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

  // Les compteurs disent tout le projet, pas ce que le filtre laisse : ils répondent à
  // « où en est-on », le filtre à « où est-ce ».
  const counts = Object.fromEntries(
    ACTIVITY_GROUPS.map((group) => [group, rows.filter((row) => row.group === group).length]),
  ) as Record<ActivityGroup, number>

  const toggle = (group: ActivityGroup) =>
    setFolded((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })

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
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState icon={<Layers size={20} />} title={t('projectActivity.empty')} description={t('projectActivity.emptyHint')} />
        ) : shown.length === 0 ? (
          <EmptyState title={t('projectActivity.noMatch')} />
        ) : (
          ACTIVITY_GROUPS.map((group) => {
            const members = shown.filter((row) => row.group === group)
            if (members.length === 0) return null
            const open = !folded.has(group)
            // Un filtre actif montre tout ce qu'il a trouvé : plier ce qu'on cherche
            // le cacherait une seconde fois.
            const capped = group === 'done' && !allDone && !isActiveFilter(filter)
            const visible = capped ? members.slice(0, DONE_SHOWN) : members
            const rest = members.length - visible.length
            const headingId = `activity-${group}`
            return (
              <section key={group} aria-labelledby={headingId}>
                <h2 id={headingId} className="sticky top-0 z-10 border-y border-line bg-sunken first:border-t-0">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => toggle(group)}
                    className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-sm text-ink-soft hover:text-ink"
                  >
                    {open ? (
                      <ChevronDown size={14} aria-hidden className="shrink-0 text-ink-faint" />
                    ) : (
                      <ChevronRight size={14} aria-hidden className="shrink-0 text-ink-faint" />
                    )}
                    <Marker marker={GROUP_MARKER[group]} decorative />
                    {t(GROUP_LABEL[group])}
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
          })
        )}
      </div>
    </div>
  )
}
