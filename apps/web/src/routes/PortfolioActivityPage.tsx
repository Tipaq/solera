import { ChevronDown, ChevronRight, Layers, Search } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, SegmentedControl, cx } from '@solera/ui'
import { ProjectAvatar } from '../components/ProjectAvatar'
import { CardActivityRow } from '../components/project/CardActivityRow'
import { Marker, SessionRow, type SessionMarker } from '../components/project/SessionRow'
import {
  ACTIVITY_GROUPS,
  isActiveFilter,
  matchesActivity,
  parseActivityFilter,
  type ActivityGroup,
} from '../lib/activity-groups'
import { useTranslate, type MessageKey } from '../lib/i18n'
import { usePortfolioActivityRows, type PortfolioRow } from '../lib/portfolio'

/** Lignes montrées des terminées avant « … N de plus », comme dans un projet. */
const DONE_SHOWN = 3

/**
 * Le regroupement, porté par l'adresse comme dans un projet. Pas de worktree ici : un
 * arbre n'a de sens que dans son projet.
 */
type Grouping = 'state' | 'project'
const GROUPING_PARAM = 'groupe'

const GROUP_LABEL: Record<ActivityGroup, MessageKey> = {
  asking: 'projectActivity.group.asking',
  review: 'projectActivity.group.review',
  running: 'projectActivity.group.running',
  done: 'projectActivity.group.done',
}

const GROUP_MARKER: Record<ActivityGroup, SessionMarker> = {
  asking: 'awaiting',
  review: 'review',
  running: 'working',
  done: 'quiet',
}

/** Dans l'ordre des groupes d'état, puis du plus récent : ce qui te demande quelque chose d'abord. */
const byUrgency = (a: PortfolioRow, b: PortfolioRow) =>
  ACTIVITY_GROUPS.indexOf(a.group) - ACTIVITY_GROUPS.indexOf(b.group) || b.updatedAt - a.updatedAt

/**
 * L'onglet **Activité** du portefeuille (planche D1 de
 * `docs/audits/2026-10-21-page-projet/final/`, #117) : toutes les sessions de tous les
 * projets, dans la même liste et la même ligne que l'Activité d'un projet, avec une
 * colonne Projet en plus.
 *
 * Il **remplace Travail**, qui s'y fond : une carte qui réclame quelqu'un sans
 * qu'aucune session ne la porte entre comme une ligne de carte, dans le groupe de ce
 * qu'elle demande — *À vérifier* donne « Prête à relire », « à préciser » « Te demande
 * quelque chose ».
 *
 * La bascule propose « État | Projet ». Les jalons lancés restent dans l'Activité de
 * leur projet : leur bandeau dit l'avancement d'un projet, pas du portefeuille.
 */
export function PortfolioActivityPage() {
  const t = useTranslate()
  const [query, setQuery] = useState('')
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())
  // Les sections dont on a déplié les terminées : une par groupe ou par projet.
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [params, setParams] = useSearchParams()

  const { rows, isPending } = usePortfolioActivityRows()

  const filter = useMemo(() => parseActivityFilter(query), [query])
  const shown = useMemo(
    () =>
      rows.filter((row) =>
        matchesActivity(filter, {
          group: row.group,
          title: row.kind === 'session' ? row.entry.conversation.title : row.card.title,
          branch: row.kind === 'session' ? row.place.branch : null,
          card: row.kind === 'session' ? row.entry.conversation.card : row.card,
          project: row.project.name,
        }),
      ),
    [rows, filter],
  )

  if (isPending) return null

  const grouping: Grouping = params.get(GROUPING_PARAM) === 'project' ? 'project' : 'state'
  const setGrouping = (next: Grouping) =>
    setParams(
      (current) => {
        const updated = new URLSearchParams(current)
        if (next === 'project') updated.set(GROUPING_PARAM, 'project')
        else updated.delete(GROUPING_PARAM)
        return updated
      },
      { replace: true },
    )

  const counts = Object.fromEntries(
    ACTIVITY_GROUPS.map((group) => [group, rows.filter((row) => row.group === group).length]),
  ) as Record<ActivityGroup, number>

  const flip = (set: typeof setFolded) => (key: string) =>
    set((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggle = flip(setFolded)
  const toggleRow = flip(setExpanded)

  /** ↑ et ↓ passent d'une ligne à l'autre, à travers les groupes, sans rien replier. */
  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    if (!(event.target instanceof HTMLElement) || !event.target.hasAttribute('data-session-row')) return
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-session-row]')]
    const next = all[all.indexOf(event.target) + (event.key === 'ArrowDown' ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  function renderRow(row: PortfolioRow) {
    if (row.kind === 'card') {
      return (
        <CardActivityRow
          key={row.key}
          card={row.card}
          project={row.project}
          marker={row.marker}
          summary={row.summary}
          since={row.updatedAt}
        />
      )
    }
    return (
      <SessionRow
        key={row.key}
        conversation={row.entry.conversation}
        marker={row.marker}
        summary={row.summary}
        place={row.place}
        pr={row.pr}
        request={row.request}
        expanded={expanded.has(row.key)}
        onToggle={() => toggleRow(row.key)}
        project={row.project}
      />
    )
  }

  function renderSection(key: string, label: string, badge: ReactNode, members: PortfolioRow[]) {
    if (members.length === 0) return null
    const open = !folded.has(key)
    // Les terminées se plient après trois lignes, sauf quand un filtre cherche : plier
    // ce qu'on cherche le cacherait une seconde fois.
    const capped = !unfolded.has(key) && !isActiveFilter(filter)
    const done = members.filter((row) => row.group === 'done')
    const hidden = new Set(capped ? done.slice(DONE_SHOWN) : [])
    const visible = members.filter((row) => !hidden.has(row))
    const headingId = `portfolio-activity-${key}`
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
            {badge}
            {label}
            <span className="text-xs text-ink-faint tabular-nums">{members.length}</span>
          </button>
        </h2>
        {open ? (
          <ul className="divide-y divide-line">
            {visible.map(renderRow)}
            {hidden.size > 0 ? (
              <li>
                <button
                  type="button"
                  onClick={() => flip(setUnfolded)(key)}
                  className="w-full px-4 py-2 text-left text-sm text-ink-faint hover:text-ink md:pl-[3.375rem]"
                >
                  {t('projectActivity.more', { count: hidden.size })}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
      </section>
    )
  }

  function renderByProject() {
    const byProject = new Map<string, PortfolioRow[]>()
    for (const row of shown) {
      const members = byProject.get(row.project.id) ?? []
      members.push(row)
      byProject.set(row.project.id, members)
    }
    // Le projet qui te demande quelque chose d'abord, puis le plus récemment actif.
    const sections = [...byProject.values()].map((members) => members.sort(byUrgency))
    sections.sort((a, b) => byUrgency(a[0]!, b[0]!))
    return sections.map((members) => {
      const project = members[0]!.project
      return renderSection(`project-${project.id}`, project.name, <ProjectAvatar project={project} className="size-3.5" />, members)
    })
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
              { value: 'project', label: t('portfolioActivity.groupBy.project') },
            ]}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" onKeyDown={moveFocus}>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Layers size={20} />}
            title={t('portfolioActivity.empty')}
            description={t('portfolioActivity.emptyHint')}
          />
        ) : shown.length === 0 ? (
          <EmptyState title={t('projectActivity.noMatch')} />
        ) : grouping === 'project' ? (
          renderByProject()
        ) : (
          ACTIVITY_GROUPS.map((group) =>
            renderSection(
              group,
              t(GROUP_LABEL[group]),
              <Marker marker={GROUP_MARKER[group]} decorative />,
              shown.filter((row) => row.group === group),
            ),
          )
        )}
      </div>
    </div>
  )
}
