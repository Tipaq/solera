import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { agentKindSchema, type AgentKind, type CardColumn, type CardDto } from '@solera/protocol'
import { Button, EmptyState } from '@solera/ui'
import { AGENT_LABELS, AgentIcon } from '../components/AgentIcon'
import { CardPanel } from '../components/board/CardPanel'
import { KanbanView } from '../components/board/KanbanView'
import { NewCardDialog } from '../components/board/NewCardDialog'
import { columnLabel } from '../components/board/columns'
import { tintDot } from '../components/board/tints'
import { CardSheetHost } from '../components/cards/CardSheetHost'
import { PanelHost } from '../components/shell/PanelHost'
import { FilterChip, OneLineToolbar, ToolbarSearch } from '../components/toolbar/OneLineToolbar'
import { DisplayMenu, FilterMenu, MenuCheck, MenuHeading, MenuSegment } from '../components/toolbar/ToolbarMenus'
import { useBoardData } from '../lib/board-data'
import {
  BOARD_SORTS,
  NO_FILTERS,
  activeFilters,
  matches,
  passes,
  readDisplay,
  shortTitle,
  type BoardFilters,
} from '../lib/board-model'
import { withSheet } from '../lib/card-sheet'
import { isOpen } from '../lib/card-state'
import { CardRefContext } from '../lib/card-refs'
import { useMoveCard } from '../lib/cards'
import { useTranslate } from '../lib/i18n'
import { PANEL_TRANSITION_MS } from '../lib/panel'
import { NEW_PARAM } from '../lib/place'
import { useProjects } from '../lib/projects'
import { useStoredPref } from '../lib/use-view'
import { viewStorageKey } from '../lib/view-pref'

/** L'éditeur complet d'une carte, ouvert par les liens d'ailleurs (palette, journal, fiche). */
const EDITOR_PARAM = 'carte'

/**
 * Un clic dans le vide du tableau, qui referme l'éditeur d'une carte. Pas sur une tuile,
 * qui ouvre sa fiche, ni sur un contrôle, qui a sa propre action.
 */
function isEmptyBoardClick(target: EventTarget): boolean {
  return target instanceof Element && !target.closest('button, a, input, textarea, select, label, [data-card-tile], [role="menu"]')
}

/**
 * Le Tableau d'un projet (#180, spec page projet v2 B-1 à B-4, B-7, B-8) : la barre sur
 * une ligne, puis le Kanban de ses feuilles. Un clic sur une tuile ouvre sa fiche sur
 * place (`?fiche=`) ; l'éditeur complet (`?carte=`) reste celui des liens qui y mènent
 * d'ailleurs, et de la carte qu'on vient de créer.
 */
export function BoardPage() {
  const { projectId } = useParams()
  const [params, setParams] = useSearchParams()
  const t = useTranslate()

  const { data: projects } = useProjects()
  const { cards, all, milestones, isPending, isError, refetch } = useBoardData(projectId)
  const move = useMoveCard()

  const [query, setQuery] = useState('')
  /* Les filtres sont un état de la page, non retenus (B-1.6) ; ils tiennent au projet. */
  const [filterState, setFilterState] = useState<{ projectId?: string; filters: BoardFilters }>({ projectId, filters: NO_FILTERS })
  const filters = filterState.projectId === projectId ? filterState.filters : NO_FILTERS
  const setFilters = (next: BoardFilters) => setFilterState({ projectId, filters: next })
  const set = (patch: Partial<BoardFilters>) => setFilters({ ...filters, ...patch })
  const [display, setDisplay] = useStoredPref(viewStorageKey('tableau.affichage', projectId ?? null), readDisplay)

  const visible = useMemo(() => cards.filter((entry) => matches(entry, query) && passes(entry, filters)), [cards, query, filters])

  const project = projects?.find((entry) => entry.id === projectId)

  /* L'éditeur complet reste monté le temps de sortir de l'écran. */
  const editorNumber = Number(params.get(EDITOR_PARAM))
  const editorCard: CardDto | null = all.find((card) => card.number === editorNumber) ?? null
  const [lingering, setLingering] = useState<CardDto | null>(editorCard)
  useEffect(() => {
    if (editorCard) {
      setLingering(editorCard)
      return
    }
    const timer = setTimeout(() => setLingering(null), PANEL_TRANSITION_MS)
    return () => clearTimeout(timer)
  }, [editorCard])

  const writeParams = (edit: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(params)
    edit(next)
    setParams(next, { replace: true })
  }
  const showEditor = (number: number | null) =>
    writeParams((next) => (number === null ? next.delete(EDITOR_PARAM) : next.set(EDITOR_PARAM, String(number))))
  const openSheet = (number: number) => setParams((current) => withSheet(current, number))
  /* « + Carte » écrit `?nouvelle=1`, comme un lien d'ailleurs : un seul chemin vers le dialogue. */
  const creating = params.get(NEW_PARAM) === '1'
  const setCreating = (open: boolean) => writeParams((next) => (open ? next.set(NEW_PARAM, '1') : next.delete(NEW_PARAM)))

  if (!projectId) return null
  if (isPending) return <p className="p-6 text-sm text-ink-faint">{t('board.loading')}</p>
  if (isError)
    return (
      <div role="alert" className="p-6">
        <p>{t('board.loadError')}</p>
        <Button onClick={refetch}>{t('agent.install.retry')}</Button>
      </div>
    )
  if (!project) return <EmptyState title={t('project.notFound')} />

  const openMilestones = milestones.filter((milestone) => milestone.done < milestone.leaves.length)
  const loose = cards.filter((entry) => entry.milestone === null && isOpen(entry.card)).length
  const agents = agentKindSchema.options.filter((agent) => cards.some((entry) => entry.card.conversations.some((session) => session.agent === agent)))
  const toggleIn = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value])
  const agentName = (agent: AgentKind) => AGENT_LABELS[agent]

  /* Les puces des filtres posés, sur la même ligne (B-1.3). */
  const chips = [
    ...filters.milestones.map((id) => {
      const milestone = milestones.find((entry) => entry.card.id === id)
      return (
        <FilterChip
          key={`m-${id}`}
          title={milestone ? t('board.tile.milestone', { number: milestone.card.number, title: milestone.card.title }) : undefined}
          onClear={() => set({ milestones: filters.milestones.filter((item) => item !== id) })}
        >
          {milestone ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden style={tintDot(milestone.tint)} className="size-1.5 shrink-0 rounded-full" />#{milestone.card.number} {shortTitle(milestone.card.title, 18)}
            </span>
          ) : (
            t('board.filter.noMilestone')
          )}
        </FilterChip>
      )
    }),
    filters.waiting ? <FilterChip key="waiting" onClear={() => set({ waiting: false })}>{t('board.tile.waiting')}</FilterChip> : null,
    filters.clarify ? <FilterChip key="clarify" onClear={() => set({ clarify: false })}>{t('board.card.toClarify')}</FilterChip> : null,
    filters.accept ? <FilterChip key="accept" onClear={() => set({ accept: false })}>{t('board.tile.accept')}</FilterChip> : null,
    filters.due ? (
      <FilterChip key="due" onClear={() => set({ due: null })}>
        {t(filters.due === 'late' ? 'board.chip.late' : 'board.chip.week')}
      </FilterChip>
    ) : null,
    ...filters.agents.map((agent) => (
      <FilterChip key={`a-${agent}`} onClear={() => set({ agents: filters.agents.filter((item) => item !== agent) })}>
        {agentName(agent)}
      </FilterChip>
    )),
    filters.column ? (
      <FilterChip key="column" onClear={() => set({ column: null })}>
        {t('board.chip.column', { column: columnLabel(filters.column) })}
      </FilterChip>
    ) : null,
  ].filter(Boolean)

  const filterMenu = (
    <FilterMenu active={activeFilters(filters)} onClearAll={() => setFilters(NO_FILTERS)}>
      {openMilestones.length > 0 || loose > 0 ? <MenuHeading>{t('board.filter.milestone')}</MenuHeading> : null}
      {openMilestones.map((milestone) => (
        <MenuCheck
          key={milestone.card.id}
          checked={filters.milestones.includes(milestone.card.id)}
          onChange={() => set({ milestones: toggleIn(filters.milestones, milestone.card.id) })}
          aside={`${milestone.done}/${milestone.leaves.length}`}
        >
          <span className="flex min-w-0 items-center gap-1.5" title={milestone.card.title}>
            <span aria-hidden style={tintDot(milestone.tint)} className="size-2 shrink-0 rounded-full" />
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{milestone.card.number}</span>
            <span className="truncate">{shortTitle(milestone.card.title, 30)}</span>
          </span>
        </MenuCheck>
      ))}
      {loose > 0 ? (
        <MenuCheck checked={filters.milestones.includes('none')} onChange={() => set({ milestones: toggleIn(filters.milestones, 'none') })} aside={loose}>
          {t('board.filter.noMilestone')}
        </MenuCheck>
      ) : null}

      <MenuHeading>{t('board.filter.state')}</MenuHeading>
      <MenuCheck checked={filters.waiting} onChange={(waiting) => set({ waiting })}>{t('board.filter.waiting')}</MenuCheck>
      <MenuCheck checked={filters.clarify} onChange={(clarify) => set({ clarify })}>{t('board.filter.clarify')}</MenuCheck>
      <MenuCheck checked={filters.accept} onChange={(accept) => set({ accept })}>{t('board.filter.accept')}</MenuCheck>

      <MenuHeading>{t('board.filter.due')}</MenuHeading>
      <MenuCheck checked={filters.due === 'late'} onChange={(on) => set({ due: on ? 'late' : null })}>{t('board.filter.late')}</MenuCheck>
      <MenuCheck checked={filters.due === 'week'} onChange={(on) => set({ due: on ? 'week' : null })}>{t('board.filter.week')}</MenuCheck>

      {agents.length > 0 ? (
        <>
          <MenuHeading>{t('board.filter.agent')}</MenuHeading>
          {agents.map((agent) => (
            <MenuCheck key={agent} checked={filters.agents.includes(agent)} onChange={() => set({ agents: toggleIn(filters.agents, agent) })}>
              <span className="inline-flex items-center gap-1.5">
                <AgentIcon agent={agent} size={13} decorative /> {agentName(agent)}
              </span>
            </MenuCheck>
          ))}
        </>
      ) : null}
    </FilterMenu>
  )

  /* « Affichage ▾ » : le Kanban seul pour l'instant ; Liste et Par geste viennent avec #181. */
  const displayMenu = (
    <DisplayMenu>
      <MenuHeading>{t('board.display.grouping')}</MenuHeading>
      <MenuSegment
        label={t('board.display.grouping')}
        segments={[
          { value: 'none', label: t('board.display.grouping.none') },
          { value: 'lanes', label: t('board.display.grouping.lanes') },
        ]}
        value={display.lanes ? 'lanes' : 'none'}
        onChange={(next) => setDisplay({ ...display, lanes: next === 'lanes' })}
      />
      <MenuHeading>{columnLabel('done')}</MenuHeading>
      <MenuSegment
        label={columnLabel('done')}
        segments={[
          { value: 'recent', label: t('board.display.done.recent') },
          { value: 'all', label: t('board.display.done.all') },
          { value: 'hidden', label: t('board.display.done.hidden') },
        ]}
        value={display.done}
        onChange={(done) => setDisplay({ ...display, done })}
      />
      <MenuCheck checked={display.abandoned} onChange={(abandoned) => setDisplay({ ...display, abandoned })}>
        {t('board.display.abandoned')}
      </MenuCheck>
      {/* Quatre tris ne tiennent pas dans un segment : un choix unique en liste. */}
      <MenuHeading>{t('board.display.sort')}</MenuHeading>
      <div role="radiogroup" aria-label={t('board.display.sort')}>
        {BOARD_SORTS.map((sort) => (
          <MenuCheck key={sort} exclusive checked={display.sort === sort} onChange={() => setDisplay({ ...display, sort })}>
            {t(`board.sort.${sort}`)}
          </MenuCheck>
        ))}
      </div>
    </DisplayMenu>
  )

  const narrowed = Boolean(query.trim()) || activeFilters(filters) > 0

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-clip">
      <OneLineToolbar
        search={<ToolbarSearch value={query} onChange={setQuery} placeholder={t('board.search.short')} label={t('board.search')} />}
        filter={filterMenu}
        chips={chips}
        extra={move.isError ? <p role="alert" className="truncate text-xs text-critical">{t('board.move.error')}</p> : null}
        display={displayMenu}
        action={
          <Button size="sm" icon={<Plus size={15} />} aria-label={t('project.action.newCard')} onClick={() => setCreating(true)}>
            <span className="hidden sm:inline">{t('project.action.newCard')}</span>
          </Button>
        }
      />
      {narrowed && visible.length === 0 ? (
        <p role="status" className="px-4 pt-4 text-sm text-ink-faint md:px-6">
          {t('board.noResults')}
        </p>
      ) : null}
      <div
        className="min-h-0 flex-1"
        // L'éditeur se referme d'un clic à côté, comme une fenêtre qu'on quitte.
        onClick={(event) => {
          if (editorCard && isEmptyBoardClick(event.target)) showEditor(null)
        }}
      >
        <KanbanView
          entries={visible}
          milestones={milestones}
          display={display}
          projectId={projectId}
          onOpen={openSheet}
          onMove={(entry, column: CardColumn) => move.mutate({ id: entry.card.id, projectId, column })}
          // En attendant la Liste (#181), « Tout voir » déplie Fait sur place.
          onSeeAllDone={() => setDisplay({ ...display, done: 'all' })}
        />
      </div>

      <NewCardDialog
        projectId={projectId}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(card) => {
          setQuery('')
          // Un seul écrit : fermer le dialogue puis ouvrir l'éditeur partent du même `params`.
          writeParams((next) => {
            next.delete(NEW_PARAM)
            next.set(EDITOR_PARAM, String(card.number))
          })
        }}
      />
      {lingering ? (
        <CardRefContext.Provider value={projectId}>
          <CardPanel
            key={lingering.id}
            card={lingering}
            projectId={projectId}
            open={editorCard !== null}
            onClose={() => showEditor(null)}
            onSelectCard={showEditor}
          />
        </CardRefContext.Provider>
      ) : null}
      <CardSheetHost projectId={projectId} />
      {/* Le panneau à portée projet, sans bouton : la palette l'appelle pour ouvrir un
          fichier ou lancer une action hors d'une conversation, tant que Travail n'en
          monte pas. */}
      <PanelHost projectId={projectId} />
    </div>
  )
}
