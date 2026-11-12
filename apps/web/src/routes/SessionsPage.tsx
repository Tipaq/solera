import { ChevronDown, Columns3, FolderTree, List, MessageSquare, Plus } from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { AgentKind } from '@solera/protocol'
import { Button, IconButton, SegmentedControl, cx } from '@solera/ui'
import { AGENT_LABELS, AgentIcon } from '../components/AgentIcon'
import { AskInbox } from '../components/inbox/AskInbox'
import { PlaceBand } from '../components/places/PlaceShell'
import { ProjectGroupHeader, ProjectPip } from '../components/places/ProjectPip'
import { SectionTitle } from '../components/places/SectionTitle'
import { STATE_WORD, SessionLine, SessionStateDot } from '../components/sessions/SessionLine'
import { DrawerLayer } from '../components/shell/Drawer'
import { FilterChip, OneLineToolbar, ToolbarSearch } from '../components/toolbar/OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, MenuSegment, type ViewOption } from '../components/toolbar/ToolbarMenus'
import { DetailSurfaceContext } from '../lib/detail-surface'
import { toggled } from '../lib/filters'
import { useTranslate, type MessageKey } from '../lib/i18n'
import {
  NO_FILTERS,
  NO_PROJECT,
  SESSION_STATES,
  activeFilterCount,
  byDay,
  byProject,
  byState,
  filterSessions,
  inScope,
  readSessionQuery,
  sortSessions,
  writeSessionQuery,
  type SessionFilters,
  type SessionPeriod,
  type SessionQuery,
  type SessionRow,
  type SessionScope,
  type SessionSort,
  type StateColumn,
} from '../lib/sessions-view'
import { useInbox } from '../lib/use-inbox'
import { useSessionRows } from '../lib/use-session-rows'
import { useView } from '../lib/use-view'

type View = 'liste' | 'etat' | 'projet'
const VIEW_KEYS = ['liste', 'etat', 'projet'] as const

const PERIODS: { key: SessionPeriod; label: MessageKey }[] = [
  { key: 'all', label: 'sessionsPage.period.all' },
  { key: 'day', label: 'sessionsPage.period.day' },
  { key: 'week', label: 'sessionsPage.period.week' },
  { key: 'month', label: 'sessionsPage.period.month' },
]
const PERIOD_CHIP: Record<Exclude<SessionPeriod, 'all'>, MessageKey> = {
  day: 'sessionsPage.period.chip.day',
  week: 'sessionsPage.period.chip.week',
  month: 'sessionsPage.period.chip.month',
}
const SORTS: { key: SessionSort; label: MessageKey }[] = [
  { key: 'recent', label: 'sessionsPage.sort.recent' },
  { key: 'attente', label: 'sessionsPage.sort.waiting' },
  { key: 'nom', label: 'sessionsPage.sort.name' },
]
const BUCKET: Record<'pinned' | 'today' | 'yesterday' | 'week' | 'older', MessageKey> = {
  pinned: 'sessionsPage.bucket.pinned',
  today: 'sessionsPage.bucket.today',
  yesterday: 'sessionsPage.bucket.yesterday',
  week: 'sessionsPage.bucket.week',
  older: 'sessionsPage.bucket.older',
}
const COLUMN: Record<StateColumn, MessageKey> = {
  waiting: 'sessionsPage.column.waiting',
  running: 'sessionsPage.column.running',
  review: 'sessionsPage.column.review',
  done: 'sessionsPage.column.done',
}
/** Les lignes d'une colonne de « Par état » avant « N de plus ». */
const COLUMN_LIMIT = 30

/**
 * « Sessions » (#232) : toutes les conversations, de tous les projets et sans projet —
 * ce que le lieu *Fils* de la sidebar ne donne pas, lui qui s'arrête aux plus récentes.
 *
 * Une page de lieu sans rangée d'onglets : la bande seule, puis la barre sur une ligne
 * (recherche, Filtrer ▾, portée, Affichage ▾). L'adresse porte la recherche, les filtres,
 * la portée et le tri (`lib/sessions-view.ts`) ; la vue suit la mémoire de vue.
 */
export function SessionsPage() {
  const t = useTranslate()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = useMemo(() => readSessionQuery(params), [params])
  const [view, setView] = useView<View>('sessions', null, VIEW_KEYS)
  const { rows, projects, pending } = useSessionRows()
  const inbox = useInbox({ sessions: true })
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set())

  /**
   * Une retouche de la page, réécrite dans l'adresse sans entrée d'historique.
   *
   * Elle part de l'adresse courante et non de celle du dernier rendu, que garde aussi
   * la forme fonctionnelle de `setParams` : deux coches d'affilée, avant que la page ait
   * suivi la première, l'effaceraient sinon.
   */
  const change = (edit: (current: SessionQuery) => Partial<SessionQuery>) => {
    const latest = new URLSearchParams(window.location.search)
    const current = readSessionQuery(latest)
    setParams(writeSessionQuery(latest, { ...current, ...edit(current) }), { replace: true })
  }
  const update = (patch: Partial<SessionQuery>) => change(() => patch)
  const filter = (edit: (current: SessionFilters) => Partial<SessionFilters>) =>
    change((current) => ({ filters: { ...current.filters, ...edit(current.filters) } }))
  const { filters } = query
  const [search, setSearch] = useSearchDraft(query.search, (next) => update({ search: next }))

  const scoped = useMemo(() => rows.filter((row) => inScope(row, query.scope)), [rows, query.scope])
  const agents = useMemo(() => [...new Set(scoped.map((row) => row.agent))], [scoped])
  const hasLoose = scoped.some((row) => row.project === null)
  const shown = useMemo(() => sortSessions(filterSessions(rows, query, Date.now()), query.sort), [rows, query])
  const counted = (keep: (row: SessionRow) => boolean) => scoped.filter(keep).length
  const scopeCount = (scope: SessionScope) => rows.filter((row) => inScope(row, scope)).length
  const filtered = activeFilterCount(filters)

  const chips = [
    ...[...filters.projects].map((id) => (
      <FilterChip key={`p-${id}`} onClear={() => filter((current) => ({ projects: toggled(current.projects, id) }))}>
        {id === NO_PROJECT ? t('sessionsPage.chip.noProject') : (projects.find((project) => project.id === id)?.name ?? id)}
      </FilterChip>
    )),
    ...[...filters.states].map((state) => (
      <FilterChip key={`s-${state}`} onClear={() => filter((current) => ({ states: toggled(current.states, state) }))}>{t(STATE_WORD[state])}</FilterChip>
    )),
    ...[...filters.agents].map((agent) => (
      <FilterChip key={`a-${agent}`} onClear={() => filter((current) => ({ agents: toggled(current.agents, agent) }))}>{AGENT_LABELS[agent]}</FilterChip>
    )),
    filters.period !== 'all' ? (
      <FilterChip key="period" onClear={() => filter(() => ({ period: 'all' }))}>{t(PERIOD_CHIP[filters.period])}</FilterChip>
    ) : null,
    filters.pinned ? <FilterChip key="pinned" onClear={() => filter(() => ({ pinned: false }))}>{t('sessionsPage.chip.pinned')}</FilterChip> : null,
  ]

  const scopeSegments = (['actives', 'archivees'] as const).map((key) => ({
    value: key,
    label: t(key === 'actives' ? 'sessionsPage.scope.active' : 'sessionsPage.scope.archived'),
    count: scopeCount(key),
  }))

  const filterMenu = (
    <FilterMenu active={filtered} onClearAll={() => update({ filters: NO_FILTERS })}>
      {/* Au téléphone la portée n'a pas la place dans la barre : elle passe ici, en tête. */}
      <div className="md:hidden">
        <MenuHeading>{t('sessionsPage.filter.scope')}</MenuHeading>
        <MenuSegment<SessionScope> label={t('sessionsPage.filter.scope')} segments={scopeSegments} value={query.scope} onChange={(scope) => update({ scope })} />
      </div>
      <MenuHeading>{t('sessionsPage.filter.project')}</MenuHeading>
      {projects.map((project) => (
        <MenuCheck
          key={project.id}
          checked={filters.projects.has(project.id)}
          onChange={() => filter((current) => ({ projects: toggled(current.projects, project.id) }))}
          aside={counted((row) => row.project?.id === project.id)}
        >
          <ProjectPip project={project} plain />
        </MenuCheck>
      ))}
      {hasLoose || filters.projects.has(NO_PROJECT) ? (
        <MenuCheck
          checked={filters.projects.has(NO_PROJECT)}
          onChange={() => filter((current) => ({ projects: toggled(current.projects, NO_PROJECT) }))}
          aside={counted((row) => row.project === null)}
        >
          {t('sessionsPage.filter.noProject')}
        </MenuCheck>
      ) : null}
      <MenuHeading>{t('sessionsPage.filter.state')}</MenuHeading>
      {SESSION_STATES.map((state) => (
        <MenuCheck
          key={state}
          checked={filters.states.has(state)}
          onChange={() => filter((current) => ({ states: toggled(current.states, state) }))}
          aside={counted((row) => row.state === state)}
        >
          <span className="inline-flex items-center gap-1.5">
            <SessionStateDot state={state} />
            {t(STATE_WORD[state])}
          </span>
        </MenuCheck>
      ))}
      {agents.length > 1 || filters.agents.size > 0 ? (
        <>
          <MenuHeading>{t('sessionsPage.filter.agent')}</MenuHeading>
          {agents.map((agent: AgentKind) => (
            <MenuCheck key={agent} checked={filters.agents.has(agent)} onChange={() => filter((current) => ({ agents: toggled(current.agents, agent) }))}>
              <span className="inline-flex items-center gap-1.5">
                <AgentIcon agent={agent} size={13} decorative />
                {AGENT_LABELS[agent]}
              </span>
            </MenuCheck>
          ))}
        </>
      ) : null}
      <MenuHeading>{t('sessionsPage.filter.period')}</MenuHeading>
      <MenuSegment<SessionPeriod>
        label={t('sessionsPage.filter.period')}
        segments={PERIODS.map((period) => ({ value: period.key, label: t(period.label) }))}
        value={filters.period}
        onChange={(period) => filter(() => ({ period }))}
      />
      <div className="pt-2">
        <MenuCheck checked={filters.pinned} onChange={(pinned) => filter(() => ({ pinned }))}>
          {t('sessionsPage.filter.pinnedOnly')}
        </MenuCheck>
      </div>
    </FilterMenu>
  )

  const views: ViewOption<View>[] = [
    { key: 'liste', label: t('sessionsPage.view.list'), icon: <List size={14} /> },
    { key: 'etat', label: t('sessionsPage.view.byState'), icon: <Columns3 size={14} /> },
    { key: 'projet', label: t('sessionsPage.view.byProject'), icon: <FolderTree size={14} /> },
  ]
  const displayMenu = (
    <DisplayMenu views={views} value={view} onChange={setView}>
      <MenuHeading>{t('toolbar.sort')}</MenuHeading>
      <MenuSegment<SessionSort>
        label={t('toolbar.sort')}
        segments={SORTS.map((sort) => ({ value: sort.key, label: t(sort.label) }))}
        value={query.sort}
        onChange={(sort) => update({ sort })}
      />
    </DisplayMenu>
  )

  const empty = pending
    ? t('sessionsPage.empty.loading')
    : filtered > 0 || query.search.trim()
      ? t('sessionsPage.empty.noMatch')
      : query.scope === 'archivees'
        ? t('sessionsPage.empty.noArchived')
        : t('sessionsPage.empty.none')

  const fold = (key: string) => setFolded((current) => toggled(current, key))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlaceBand
        icon={<MessageSquare size={16} className="text-ink-faint" />}
        title={t('sessionsPage.title')}
        actions={
          <Button size="sm" icon={<Plus size={16} />} aria-label={t('sessionsPage.newConversation.label')} onClick={() => navigate('/c/new')}>
            <span className="hidden sm:inline">{t('sessionsPage.newConversation')}</span>
          </Button>
        }
      />
      <OneLineToolbar
        search={
          <ToolbarSearch value={search} onChange={setSearch} placeholder={t('sessionsPage.search')} />
        }
        filter={filterMenu}
        chips={chips}
        extra={
          <span className="hidden shrink-0 md:block">
            <SegmentedControl label={t('sessionsPage.filter.scope')} segments={scopeSegments} value={query.scope} onChange={(scope) => update({ scope })} />
          </span>
        }
        display={displayMenu}
      />

      {/* `relative` : le calque des tiroirs s'y pose sous la barre, et ne défile pas
          avec la liste. */}
      <div data-place-content className="relative min-h-0 min-w-0 flex-1 overflow-clip">
        <DetailSurfaceContext.Provider value="drawer">
          <div className="h-full overflow-y-auto">
            <div className="flex flex-col gap-6 p-4 md:p-6">
              {view === 'liste' && query.scope === 'actives' ? <AskInbox items={inbox} /> : null}
              {shown.length === 0 ? (
                <p className="text-sm text-ink-faint">{empty}</p>
              ) : view === 'etat' ? (
                <StateColumns rows={shown} />
              ) : view === 'projet' ? (
                <div className="flex flex-col gap-5">
                  {byProject(shown).map((group) => {
                    const name = group.project?.name ?? t('sessionsPage.filter.noProject')
                    const open = !folded.has(group.key)
                    const toggle = (
                      <IconButton
                        size="sm"
                        label={t(open ? 'sessionsPage.group.fold' : 'sessionsPage.group.unfold', { name })}
                        aria-expanded={open}
                        onClick={() => fold(group.key)}
                      >
                        <ChevronDown size={14} className={cx('transition-transform', !open && '-rotate-90')} />
                      </IconButton>
                    )
                    return (
                      <Group key={group.key} rows={open ? group.rows : []} hideProject>
                        {group.project ? (
                          <ProjectGroupHeader project={group.project} count={group.rows.length} aside={toggle} />
                        ) : (
                          <SectionTitle size="group" count={group.rows.length} aside={toggle}>{name}</SectionTitle>
                        )}
                      </Group>
                    )
                  })}
                </div>
              ) : (
                <div className="flex flex-col gap-5">
                  {byDay(shown, query.sort, Date.now()).map((group) => (
                    <Group key={group.key} rows={group.rows}>
                      {group.key === 'all' ? null : <SectionTitle size="group" count={group.rows.length}>{t(BUCKET[group.key])}</SectionTitle>}
                    </Group>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DetailSurfaceContext.Provider>
        <DrawerLayer />
      </div>
    </div>
  )
}

/**
 * Le texte du champ de recherche, tenu à côté de l'adresse qui en reste la source.
 *
 * L'adresse se rend sous transition : lié à elle seule, le champ reprendrait l'ancienne
 * valeur après chaque frappe et perdrait les lettres tapées vite. Il garde donc ce qu'on
 * tape, et ne se recale sur l'adresse que lorsqu'elle change d'ailleurs — un lien de la
 * sidebar, la palette, Retour. Les valeurs qu'il a lui-même écrites, quand elles
 * reviennent, ne le recalent pas.
 */
function useSearchDraft(fromUrl: string, write: (next: string) => void): [string, (next: string) => void] {
  const [draft, setDraft] = useState(fromUrl)
  const [seen, setSeen] = useState(fromUrl)
  const pending = useRef<string[]>([])
  if (fromUrl !== seen) {
    setSeen(fromUrl)
    const ours = pending.current.indexOf(fromUrl)
    if (ours === -1) setDraft(fromUrl)
    pending.current = ours === -1 ? [] : pending.current.slice(ours + 1)
  }
  const change = (next: string) => {
    setDraft(next)
    pending.current.push(next)
    write(next)
  }
  return [draft, change]
}

/** Un groupe de la Liste ou de « Par projet » : son en-tête, puis ses lignes entre deux filets. */
function Group({ rows, hideProject = false, children }: { rows: SessionRow[]; hideProject?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      {children}
      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {rows.map((row) => <SessionLine key={row.id} row={row} hideProject={hideProject} />)}
        </ul>
      ) : null}
    </section>
  )
}

/** Par état : quatre colonnes, une puis deux puis quatre selon la largeur. */
function StateColumns({ rows }: { rows: SessionRow[] }) {
  const t = useTranslate()
  const [unfolded, setUnfolded] = useState<ReadonlySet<StateColumn>>(() => new Set())
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {byState(rows).map((column) => {
        const all = unfolded.has(column.key)
        const extra = column.rows.length - COLUMN_LIMIT
        return (
          <section key={column.key} className="flex min-w-0 flex-col">
            <SectionTitle size="group" count={column.rows.length}>{t(COLUMN[column.key])}</SectionTitle>
            {column.rows.length === 0 ? (
              <p className="py-2 text-xs text-ink-faint">{t('sessionsPage.empty.column')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line border-y border-line">
                {(all ? column.rows : column.rows.slice(0, COLUMN_LIMIT)).map((row) => <SessionLine key={row.id} row={row} compact />)}
              </ul>
            )}
            {extra > 0 ? (
              <Button variant="ghost" size="sm" className="mt-1 self-start" onClick={() => setUnfolded((current) => toggled(current, column.key))}>
                {all ? t('sessionsPage.less') : t('sessionsPage.more', { count: extra })}
              </Button>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
