/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Le Tableau du portefeuille : les cartes de tous les projets, avec la barre `une-ligne`
 * du Tableau d'un projet. Kanban ou Liste ; couloirs par projet ou par jalon. Chaque
 * tuile porte la pastille de son projet. Un clic ouvre la session de la carte (ou un
 * brouillon), comme partout hors du tableau d'un projet.
 */
import { Columns3, List, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseSubtasks, type CardColumn, type ProjectDto } from '@solera/protocol'
import { Button, cx } from '@solera/ui'
import { FilterChip, MenuCheck, MenuHeading, MenuSegment, useView, type ViewOption } from '../../components/prototype/ViewSwitch'
import { COLUMN_WORD, NO_TINT, type BoardCard, type BoardMilestone, type Tint } from '../prototype-board/data'
import { Tile } from '../prototype-board/parts'
import { cardDestination } from '../prototype-milestones/destination'
import { awaitsMe, isLate, liveSessions } from '../prototype-milestones/model'
import { inProjects, usePortfolioV2, type PCard } from './data'
import { PortfolioToolbar, ProjectGroupHeader, ProjectPip, useNotice } from './parts'

type View = 'kanban' | 'liste'
const VIEWS: ViewOption<View>[] = [
  { key: 'kanban', label: 'Kanban', icon: <Columns3 size={14} /> },
  { key: 'liste', label: 'Liste', icon: <List size={14} /> },
]
type Lanes = 'aucun' | 'projet' | 'jalon'
const COLUMNS: CardColumn[] = ['todo', 'in_progress', 'review', 'done']
const TINTS: Tint[] = [
  { dot: 'bg-sky-500', text: 'text-sky-700 dark:text-sky-300', wash: 'bg-sky-500/10' },
  { dot: 'bg-violet-500', text: 'text-violet-700 dark:text-violet-300', wash: 'bg-violet-500/10' },
  { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', wash: 'bg-emerald-500/10' },
  { dot: 'bg-rose-500', text: 'text-rose-700 dark:text-rose-300', wash: 'bg-rose-500/10' },
]

type Entry = BoardCard & { project: ProjectDto }

export function PortfolioBoard() {
  const data = usePortfolioV2()
  const navigate = useNavigate()
  const [notice, simulate] = useNotice()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [waiting, setWaiting] = useState(false)
  const [late, setLate] = useState(false)
  const [view, setView] = useView<View>('portfolio-tableau', 'all', ['kanban', 'liste'])
  const [lanes, setLanes] = useState<Lanes>('projet')
  const [doneShown, setDoneShown] = useState(5)

  const { entries, milestones } = useMemo(() => {
    const byId = new Map(data.cards.map((card) => [card.id, card]))
    const leavesOf = (id: string): PCard[] => {
      const card = byId.get(id)
      if (!card) return []
      return card.children.length === 0 ? [card] : card.children.flatMap((child) => leavesOf(child.id))
    }
    const milestones: (BoardMilestone & { project: ProjectDto })[] = data.cards
      .filter((card) => card.children.length > 0 && card.parent === null)
      .map((card, index) => {
        const leaves = leavesOf(card.id)
        return { card, project: card.project, tint: TINTS[index % TINTS.length] ?? NO_TINT, leaves, done: leaves.filter((leaf) => ['done', 'abandoned'].includes(leaf.column)).length }
      })
    const milestoneOf = new Map<string, BoardMilestone & { project: ProjectDto }>()
    for (const milestone of milestones) for (const leaf of milestone.leaves) milestoneOf.set(leaf.id, milestone)
    const entries: Entry[] = data.cards
      .filter((card) => card.children.length === 0 && card.column !== 'abandoned')
      .map((card) => {
        const subtasks = parseSubtasks(card.description)
        return {
          card,
          project: card.project,
          column: card.column,
          milestone: milestoneOf.get(card.id) ?? null,
          subtasks: { done: subtasks.filter((task) => task.checked).length, total: subtasks.length },
          waiting: awaitsMe(card),
          live: liveSessions(card).length,
          late: isLate(card),
          moved: false,
        }
      })
    return { entries, milestones }
  }, [data.cards])

  const query = search.trim().toLocaleLowerCase()
  const shown = entries.filter(
    (entry) =>
      inProjects(selected, entry.project.id) &&
      (!waiting || entry.waiting) &&
      (!late || entry.late) &&
      (!query || `${entry.card.title} #${entry.card.number} ${entry.project.name}`.toLocaleLowerCase().includes(query)),
  )
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of entries) if (entry.column !== 'done') map.set(entry.project.id, (map.get(entry.project.id) ?? 0) + 1)
    return map
  }, [entries])

  const open = (entry: Entry) => {
    if (data.demo) return simulate(`ouvrirait la session de #${entry.card.number} (${entry.project.name})`)
    navigate(cardDestination(entry.project.id, entry.card))
  }

  const lanesOf = (): { key: string; header: React.ReactNode; items: Entry[] }[] => {
    if (lanes === 'projet') {
      return data.projects
        .filter((project) => inProjects(selected, project.id))
        .map((project) => ({ key: project.id, header: <ProjectGroupHeader project={project} count={shown.filter((entry) => entry.project.id === project.id && entry.column !== 'done').length} />, items: shown.filter((entry) => entry.project.id === project.id) }))
        .filter((lane) => lane.items.length > 0)
    }
    if (lanes === 'jalon') {
      const list = milestones
        .filter((milestone) => inProjects(selected, milestone.project.id))
        .map((milestone) => ({
          key: milestone.card.id,
          header: (
            <div className="flex items-center gap-2 py-1">
              <span aria-hidden className={cx('size-2 rounded-full', milestone.tint.dot)} />
              <span className="text-sm font-medium">#{milestone.card.number} {milestone.card.title}</span>
              <ProjectPip project={milestone.project} />
              <span className="text-xs tabular-nums text-ink-faint">{milestone.done}/{milestone.leaves.length}</span>
            </div>
          ),
          items: shown.filter((entry) => entry.milestone?.card.id === milestone.card.id),
        }))
        .filter((lane) => lane.items.length > 0)
      const loose = shown.filter((entry) => !entry.milestone)
      return loose.length ? [...list, { key: 'none', header: <div className="py-1 text-sm font-medium text-ink-soft">Sans jalon</div>, items: loose }] : list
    }
    return [{ key: 'all', header: null, items: shown }]
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PortfolioToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Chercher, ou #12"
        projects={data.projects}
        selected={selected}
        onSelected={setSelected}
        counts={counts}
        filterExtra={
          <>
            <MenuHeading>État</MenuHeading>
            <MenuCheck checked={waiting} onChange={setWaiting}>T'attend</MenuCheck>
            <MenuCheck checked={late} onChange={setLate}>En retard</MenuCheck>
          </>
        }
        extraActive={(waiting ? 1 : 0) + (late ? 1 : 0)}
        onClearExtra={() => { setWaiting(false); setLate(false) }}
        extraChips={
          <>
            {waiting ? <FilterChip onClear={() => setWaiting(false)}>T'attend</FilterChip> : null}
            {late ? <FilterChip onClear={() => setLate(false)}>En retard</FilterChip> : null}
          </>
        }
        views={VIEWS}
        view={view}
        onView={setView}
        displayExtra={
          <>
            <MenuHeading>Couloirs</MenuHeading>
            <div className="px-3">
              <MenuSegment<Lanes> options={[{ key: 'aucun', label: 'Aucun' }, { key: 'projet', label: 'Par projet' }, { key: 'jalon', label: 'Par jalon' }]} value={lanes} onChange={setLanes} />
            </div>
          </>
        }
        demo={data.demo}
        action={
          <Button size="sm" icon={<Plus size={15} />} onClick={() => simulate('la carte se crée dans un projet : son Tableau, ou « idée : » dans une conversation.')}>
            Carte
          </Button>
        }
      />
      {notice}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex flex-col gap-6 p-4 md:p-6">
          {lanesOf().map((lane) => (
            <section key={lane.key} className="flex flex-col gap-2">
              {lane.header}
              {view === 'kanban' ? (
                <div className="grid grid-cols-[repeat(3,minmax(16rem,1fr))_minmax(14rem,0.8fr)] gap-3">
                  {COLUMNS.map((column) => {
                    const items = lane.items.filter((entry) => entry.column === column)
                    const capped = column === 'done' ? items.sort((a, b) => b.card.columnSince - a.card.columnSince).slice(0, doneShown) : items
                    return (
                      <div key={column} className="flex min-w-0 flex-col gap-2 rounded-xl bg-surface/40 p-2">
                        <div className="flex items-center gap-2 px-1 text-xs font-medium text-ink-soft">
                          {COLUMN_WORD[column]} <span className="tabular-nums text-ink-faint">{items.length}</span>
                        </div>
                        {capped.length === 0 ? <p className="px-1 py-2 text-xs text-ink-faint">Vide</p> : null}
                        {capped.map((entry) => (
                          <div key={entry.card.id} className="flex flex-col gap-1">
                            {lanes !== 'projet' ? <ProjectPip project={entry.project} className="px-1" /> : null}
                            <Tile entry={entry} onOpen={() => open(entry)} draggable={false} showMilestone={lanes !== 'jalon'} />
                          </div>
                        ))}
                        {column === 'done' && items.length > capped.length ? (
                          <button type="button" onClick={() => setDoneShown(items.length)} className="px-1 text-left text-xs text-ink-faint hover:text-ink">Tout voir ({items.length})</button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {lane.items
                    .filter((entry) => entry.column !== 'done')
                    .map((entry) => (
                      <li key={entry.card.id}>
                        <button type="button" onClick={() => open(entry)} className="grid w-full grid-cols-[6rem_9rem_minmax(0,1fr)_10rem] items-center gap-4 px-3 py-2 text-left hover:bg-surface-high/40">
                          <span className={cx('text-xs', entry.waiting ? 'text-caution' : 'text-ink-faint')}>{entry.waiting ? 't’attend' : COLUMN_WORD[entry.column]}</span>
                          <ProjectPip project={entry.project} plain />
                          <span className="min-w-0 truncate text-sm"><span className="text-xs tabular-nums text-ink-faint">#{entry.card.number}</span> {entry.card.title}</span>
                          <span className="truncate text-xs text-ink-faint">{entry.milestone ? `Jalon #${entry.milestone.card.number}` : '—'}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
