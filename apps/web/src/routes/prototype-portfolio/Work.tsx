/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Travail du portefeuille : les arbres et les branches de tous les projets, avec la même
 * ligne d'outils que Travail `une-ligne` d'un projet. Par projet (un groupe par projet),
 * Tableau (une seule table, colonne Projet), Par moment (le fil de tous les projets).
 */
import { Clock, FolderTree, Table2, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { ProjectAvatar } from '../../components/ProjectAvatar'
import { AskInbox } from '../../components/prototype/AskInbox'
import { FilterChip, MenuCheck, MenuHeading, toolbarButtonClass, useView, type ViewOption } from '../../components/prototype/ViewSwitch'
import { JOURNAL_KIND_ICONS, journalDestination, journalIconTone } from '../../components/journal/JournalView'
import { CleanDialog, VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import { formatBytes, isCleanable, type TreeVerdict } from '../prototype-code/data'
import { inProjects, usePortfolioV2, type PEvent, type PTree } from './data'
import { PortfolioToolbar, ProjectGroupHeader, ProjectPip, SectionTitle, toggled, useNotice } from './parts'

type View = 'projet' | 'tableau' | 'moment'
const VIEWS: ViewOption<View>[] = [
  { key: 'projet', label: 'Par projet', icon: <FolderTree size={14} /> },
  { key: 'tableau', label: 'Tableau', icon: <Table2 size={14} /> },
  { key: 'moment', label: 'Par moment', icon: <Clock size={14} /> },
]

type StateFilter = 'waiting' | 'active' | 'review' | 'clean'
const STATE_WORD: Record<StateFilter, string> = { waiting: 'T’attend', active: 'Travaille', review: 'À relire', clean: 'À nettoyer' }
const STATE_OF: Record<StateFilter, TreeVerdict[]> = {
  waiting: ['waiting'],
  active: ['active'],
  review: ['review'],
  clean: ['clean', 'empty', 'missing'],
}

const ROW = 'md:grid md:grid-cols-[0.5rem_10rem_minmax(0,1fr)_6rem_5rem_5rem_5rem_4rem] md:items-center md:gap-x-4'

export function PortfolioWork() {
  const data = usePortfolioV2()
  const navigate = useNavigate()
  const [notice, simulate] = useNotice()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [states, setStates] = useState<ReadonlySet<StateFilter>>(() => new Set())
  const [view, setView] = useView<View>('portfolio-travail', 'all', ['projet', 'tableau', 'moment'])
  const [showMerged, setShowMerged] = useState(false)
  const [cleaning, setCleaning] = useState<PTree[] | null>(null)
  const [cleaned, setCleaned] = useState<ReadonlySet<string>>(() => new Set())

  const query = search.trim().toLocaleLowerCase()
  const matchesTree = (tree: PTree) =>
    inProjects(selected, tree.project.id) &&
    !cleaned.has(`${tree.project.id}:${tree.key}`) &&
    (states.size === 0 || [...states].some((state) => STATE_OF[state].includes(tree.verdict))) &&
    (!query || `${tree.branch ?? ''} ${tree.reason} ${tree.card?.title ?? ''} #${tree.card?.number ?? ''} ${tree.project.name}`.toLocaleLowerCase().includes(query))

  const all = data.trees.filter(matchesTree)
  const cleanable = data.trees.filter((tree) => isCleanable(tree) && !cleaned.has(`${tree.project.id}:${tree.key}`) && inProjects(selected, tree.project.id))
  const hideMerged = !showMerged && !states.has('clean')
  const visible = hideMerged ? all.filter((tree) => !isCleanable(tree)) : all
  const folded = hideMerged ? all.filter((tree) => isCleanable(tree)) : []
  const totalSize = data.trees.reduce((sum, tree) => sum + tree.sizeBytes, 0)

  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const tree of data.trees) if (!tree.root) map.set(tree.project.id, (map.get(tree.project.id) ?? 0) + 1)
    return map
  }, [data.trees])

  const openTree = (tree: PTree) => {
    if (data.demo) return simulate(`ouvrirait l'arbre ${tree.branch} dans Travail de ${tree.project.name}`)
    navigate(`/p/${tree.project.id}/travail?arbre=${encodeURIComponent(tree.key)}`)
  }

  const inbox = data.inbox.filter((item) => inProjects(selected, item.project.id))
  const events = data.events.filter((event) => inProjects(selected, event.project.id) && (!query || `${event.title} ${event.project.name}`.toLocaleLowerCase().includes(query)))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PortfolioToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Chercher, #12, une branche"
        projects={data.projects}
        selected={selected}
        onSelected={setSelected}
        counts={counts}
        filterExtra={
          <>
            <MenuHeading>État</MenuHeading>
            {(Object.keys(STATE_WORD) as StateFilter[]).map((state) => (
              <MenuCheck key={state} checked={states.has(state)} onChange={() => setStates(toggled(states, state))}>
                {STATE_WORD[state]}
              </MenuCheck>
            ))}
          </>
        }
        extraActive={states.size}
        onClearExtra={() => setStates(new Set())}
        extraChips={[...states].map((state) => (
          <FilterChip key={state} onClear={() => setStates(toggled(states, state))}>{STATE_WORD[state]}</FilterChip>
        ))}
        views={VIEWS}
        view={view}
        onView={setView}
        displayExtra={
          view === 'moment' ? null : (
            <>
              <MenuHeading>Montrer</MenuHeading>
              <MenuCheck checked={showMerged} onChange={setShowMerged}>Arbres fusionnés et à nettoyer</MenuCheck>
            </>
          )
        }
        demo={data.demo}
        meta={`${data.trees.filter((tree) => !tree.root).length} arbres · ${formatBytes(totalSize)}`}
        action={
          cleanable.length > 0 ? (
            <button type="button" className={toolbarButtonClass(false)} onClick={() => setCleaning(cleanable)}>
              <Trash2 size={13} /> Nettoyer · {cleanable.length}
            </button>
          ) : null
        }
      />
      {notice}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 p-4 md:p-6">
          <AskInbox items={inbox} />

          {view === 'moment' ? (
            <Moments events={events} demo={data.demo} />
          ) : view === 'tableau' ? (
            <section className="flex flex-col">
              <TableHeader />
              <ul className="divide-y divide-line">
                {visible.map((tree) => <TreeRowLine key={`${tree.project.id}:${tree.key}`} tree={tree} withProject onOpen={openTree} />)}
              </ul>
              <Folded trees={folded} onClean={() => setCleaning(folded)} />
            </section>
          ) : (
            data.projects
              .filter((project) => inProjects(selected, project.id))
              .map((project) => {
                const trees = visible.filter((tree) => tree.project.id === project.id)
                const mergedHere = folded.filter((tree) => tree.project.id === project.id)
                const branches = data.branches.filter((branch) => branch.project.id === project.id)
                if (trees.length === 0 && mergedHere.length === 0) return null
                return (
                  <section key={project.id} className="flex flex-col gap-1">
                    <ProjectGroupHeader
                      project={project}
                      count={trees.filter((tree) => !tree.root).length}
                      aside={
                        branches.length > 0 ? (
                          <span className="text-xs text-ink-faint">{branches.length} branche{branches.length > 1 ? 's' : ''} sans arbre</span>
                        ) : null
                      }
                    />
                    <ul className="divide-y divide-line rounded-xl border border-line">
                      {trees.map((tree) => <TreeRowLine key={tree.key} tree={tree} onOpen={openTree} />)}
                    </ul>
                    <Folded trees={mergedHere} onClean={() => setCleaning(mergedHere)} />
                  </section>
                )
              })
          )}
        </div>
      </div>
      <CleanDialog
        trees={cleaning}
        onClose={() => setCleaning(null)}
        onConfirm={(trees) => {
          setCleaned(new Set([...cleaned, ...trees.map((tree) => `${(tree as PTree).project.id}:${tree.key}`)]))
          simulate(`${trees.length} arbre${trees.length > 1 ? 's' : ''} supprimé${trees.length > 1 ? 's' : ''}, ${formatBytes(trees.reduce((sum, tree) => sum + tree.sizeBytes, 0))} libérés.`)
          setCleaning(null)
        }}
      />
    </div>
  )
}

function TableHeader() {
  return (
    <div className={cx('hidden border-b border-line px-3 pb-2 text-meta font-medium tracking-wide text-ink-faint uppercase md:grid', ROW)}>
      <span />
      <span>Projet</span>
      <span>Branche · pourquoi elle est là</span>
      <span>Sessions</span>
      <span>PR</span>
      <span>Base</span>
      <span>Disque</span>
      <span className="text-right">Vu</span>
    </div>
  )
}

function TreeRowLine({ tree, withProject = false, onOpen }: { tree: PTree; withProject?: boolean; onOpen: (tree: PTree) => void }) {
  const tone = VERDICT_TONE[tree.verdict]
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(tree)}
        className={cx('flex w-full flex-col gap-1 px-3 py-2.5 text-left hover:bg-surface-high/40', ROW, !withProject && 'md:grid-cols-[0.5rem_minmax(0,1fr)_6rem_5rem_5rem_5rem_4rem]')}
      >
        <span aria-hidden className={cx('hidden size-2 rounded-full md:block', tone.dot)} />
        {withProject ? <ProjectPip project={tree.project} plain /> : null}
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-xs text-ink">{tree.root ? `${tree.branch} · racine` : tree.branch ?? tree.name}</span>
          <span className="truncate text-xs text-ink-faint">
            <span className={tone.text}>{tone.label}</span> · {tree.reason}
            {tree.card ? ` · #${tree.card.number} ${tree.card.title}` : ''}
            {tree.card?.milestone ? ` · Jalon #${tree.card.milestone.number}` : ''}
          </span>
        </span>
        <span className="flex items-center gap-1">{tree.sessions.map((session) => <AgentIcon key={session.id} agent={session.agent} size={13} />)}</span>
        <span className="text-xs tabular-nums text-ink-faint">{tree.pr ? `#${tree.pr.number}` : '—'}</span>
        <span className="text-xs tabular-nums text-ink-faint">{tree.root ? (tree.uncommitted > 0 ? `●${tree.uncommitted}` : '—') : `↑${tree.ahead} ↓${tree.behind}`}</span>
        <span className="text-xs tabular-nums text-ink-faint">{formatBytes(tree.sizeBytes)}</span>
        <span className="text-right text-xs tabular-nums text-ink-faint">{tree.lastUsedAt ? shortAgo(tree.lastUsedAt) : ''}</span>
      </button>
    </li>
  )
}

function Folded({ trees, onClean }: { trees: PTree[]; onClean: () => void }) {
  if (trees.length === 0) return null
  const size = trees.reduce((sum, tree) => sum + tree.sizeBytes, 0)
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs text-ink-faint">
      <span aria-hidden className="size-2 rounded-full bg-positive/60" />
      {trees.length} arbre{trees.length > 1 ? 's' : ''} fusionné{trees.length > 1 ? 's' : ''} · {formatBytes(size)} · rien à perdre
      <button type="button" onClick={onClean} className="ml-2 rounded-md px-2 py-1 text-ink-soft hover:bg-surface-high hover:text-ink">Nettoyer</button>
    </div>
  )
}

function Moments({ events, demo }: { events: PEvent[]; demo: boolean }) {
  const days = new Map<string, PEvent[]>()
  for (const event of events) {
    const day = new Date(event.at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    days.set(day, [...(days.get(day) ?? []), event])
  }
  if (events.length === 0) return <p className="text-sm text-ink-faint">Rien sur la période.</p>
  return (
    <div className="flex flex-col gap-5">
      {[...days.entries()].map(([day, list]) => (
        <section key={day} className="flex flex-col gap-1">
          <SectionTitle count={list.length}><span className="first-letter:uppercase">{day}</span></SectionTitle>
          <ul className="flex flex-col border-l border-line pl-3">
            {list.map((event) => {
              const to = demo ? null : journalDestination(event)
              const body = (
                <>
                  <span className="w-11 shrink-0 text-xs tabular-nums text-ink-faint">{new Date(event.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span aria-hidden className={cx('shrink-0', journalIconTone(event))}>{JOURNAL_KIND_ICONS[event.kind]}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{event.title}</span>
                  <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-faint">
                    <ProjectAvatar project={event.project} className="size-3.5" /> <span className="hidden sm:inline">{event.project.name}</span>
                  </span>
                </>
              )
              const shape = 'flex min-h-9 items-center gap-2.5 rounded-md px-2'
              return <li key={event.id}>{to ? <Link to={to} className={cx(shape, 'hover:bg-surface-high/60')}>{body}</Link> : <div className={shape}>{body}</div>}</li>
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function shortAgo(ts: number): string {
  const minutes = Math.round((Date.now() - ts) / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.round(hours / 24)} j`
}

