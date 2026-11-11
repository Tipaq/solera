/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main. */
import { ChevronRight, FolderGit2, GitBranch, Layers, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { ProjectDto } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AskInbox } from '../../components/prototype/AskInbox'
import { KindFilter, SearchField } from '../prototype-activity/shared'
import { VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import { formatBytes, type TreeRow } from '../prototype-code/data'
import { Lane, ProjectLane, useLanes, type LaneData } from './Couloirs'
import { SessionDots, TreeSummary, inboxInTree, shortBranch, useTravail } from './shared'
import { BRANCH_TONE, BaseCard, BranchLane, IndexBranch, MergedBranches, isInteresting, useBranchInfos, type BranchInfo } from './branches'

/**
 * `hybride` et `hybride-filtre` — l'index de `maitre-detail` à gauche, les couloirs de
 * `couloirs` à droite. Tim hésitait entre les deux sans qu'aucune lui convienne
 * (2026-11-11) ; les deux variantes ne diffèrent que par le geste de l'index :
 *
 * - `scroll` : cliquer un arbre fait défiler jusqu'à son couloir, et l'index suit le
 *   défilement (l'arbre visible est surligné) ;
 * - `filter` : cliquer un arbre ne garde que son couloir (« Tous » pour revenir).
 *
 * Ce qui gênait dans les deux, corrigé : un couloir sans activité se réduit à son
 * en-tête, l'en-tête groupe son contenu à gauche avec les gestes au plus près, et la
 * carte et le jalon d'un arbre restent visibles dans l'index comme dans le couloir.
 */
type Mode = 'scroll' | 'filter'

/** Les entrées de l'index qui ne sont pas des arbres. */
const PROJECT_KEY = 'projet'
const CLEANUP_KEY = 'nettoyer'
const MERGED_KEY = 'branches-fusionnees'

const anchorOf = (key: string) => `couloir-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`

export function Hybride({ projectId, project, mode }: { projectId: string; project: ProjectDto; mode: Mode }) {
  const travail = useTravail(projectId, project)
  const { model, code, overview, scopes } = travail
  const lanes = useLanes(travail)
  const branchInfos = useBranchInfos(projectId, project, code)
  const liveBranches = useMemo(() => branchInfos.filter(isInteresting), [branchInfos])
  const mergedBranches = useMemo(() => branchInfos.filter((branch) => !isInteresting(branch)), [branchInfos])
  const [params, setParams] = useSearchParams()
  const scroller = useRef<HTMLDivElement>(null)

  // `filter` : la sélection vit dans l'adresse ; `scroll` : la surbrillance est passagère.
  const selected = mode === 'filter' ? params.get('arbre') : null
  const [spied, setSpied] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)

  const cleanupSize = lanes.cleanup.reduce((sum, lane) => sum + lane.tree.sizeBytes, 0)

  /* Le scroll-spy : le couloir dont le haut a passé le premier tiers est « visible ». */
  useEffect(() => {
    if (mode !== 'scroll') return
    const root = scroller.current
    if (!root) return
    const sections = Array.from(root.querySelectorAll<HTMLElement>('[data-tree]'))
    if (sections.length === 0) return
    const observer = new IntersectionObserver(
      (records) => {
        const visible = records.filter((record) => record.isIntersecting)
        if (visible.length === 0) return
        const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]!
        setSpied((top.target as HTMLElement).dataset.tree ?? null)
      },
      { root, rootMargin: '0px 0px -66% 0px', threshold: 0 },
    )
    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [mode, lanes, cleanupOpen, liveBranches])

  const choose = (key: string | null) => {
    if (mode === 'filter') {
      setParams((current) => {
        if (key) current.set('arbre', key)
        else current.delete('arbre')
        return current
      })
      scroller.current?.scrollTo({ top: 0 })
      return
    }
    if (key === null) {
      scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    if (key === CLEANUP_KEY) setCleanupOpen(true)
    // Le couloir à nettoyer peut n'être monté qu'après l'ouverture de sa section.
    requestAnimationFrame(() => {
      const target = scroller.current?.querySelector<HTMLElement>(`#${anchorOf(key)}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    setFlash(key)
    window.setTimeout(() => setFlash((current) => (current === key ? null : current)), 1600)
  }

  /* `filter` : ne garder que ce qui a été choisi, et les demandes de cet arbre. */
  const isCleanupLane = (lane: LaneData) => lanes.cleanup.includes(lane)
  type Shown = { active: LaneData[]; cleanup: LaneData[]; showProject: boolean; showCleanup: boolean; branches: BranchInfo[]; showMerged: boolean }
  const pick = (key: string | null): Shown => {
    const all: Shown = { active: lanes.active, cleanup: lanes.cleanup, showProject: true, showCleanup: true, branches: liveBranches, showMerged: true }
    const none: Shown = { active: [], cleanup: [], showProject: false, showCleanup: false, branches: [], showMerged: false }
    if (mode !== 'filter' || key === null) return all
    if (key === PROJECT_KEY) return { ...none, showProject: true }
    if (key === CLEANUP_KEY) return { ...none, cleanup: lanes.cleanup, showCleanup: true }
    if (key === MERGED_KEY) return { ...none, showMerged: true }
    const branch = liveBranches.find((entry) => entry.key === key)
    if (branch) return { ...none, branches: [branch] }
    const lane = [...lanes.active, ...lanes.cleanup].find((entry) => entry.tree.key === key)
    if (!lane) return all
    return isCleanupLane(lane) ? { ...none, cleanup: [lane], showCleanup: true } : { ...none, active: [lane] }
  }
  const shown = pick(selected)
  const inbox = useMemo(() => {
    if (mode !== 'filter' || !selected || selected === PROJECT_KEY || selected === CLEANUP_KEY || selected === MERGED_KEY || selected.startsWith('branche:')) return overview.inbox
    const scope = scopes.get(selected)
    return scope ? overview.inbox.filter((item) => inboxInTree(item, scope)) : overview.inbox
  }, [mode, selected, overview.inbox, scopes])

  if (model.isPending) return null
  const hasTrees = Boolean(project.git || code.demo)
  const current = mode === 'filter' ? selected : spied
  const highlightOf = (key: string) => (mode === 'scroll' ? flash === key : false)
  const cleanupForced = mode === 'filter' && selected !== null

  return (
    <div className="flex h-full min-h-0 flex-col lg:grid lg:grid-cols-[19rem_minmax(0,1fr)]">
      {/* L'index, au large : collant parce qu'il a son propre défilement. */}
      {hasTrees ? (
        <aside className="hidden min-h-0 flex-col border-r border-line lg:flex">
          <TreeIndex
            lanes={lanes}
            hasProject={lanes.loose.length > 0}
            cleanupSize={cleanupSize}
            branches={liveBranches}
            merged={mergedBranches}
            current={current}
            mode={mode}
            onChoose={choose}
            code={code}
          />
        </aside>
      ) : null}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-line bg-canvas/95 px-4 backdrop-blur md:px-6">
          <SearchField model={model} className="h-8 w-40 shrink-0 sm:w-64" />
          <KindFilter model={model} className="ml-auto" />
        </header>

        {/* Au doigt, l'index devient une rangée de puces collante sous la barre. */}
        {hasTrees ? (
          <nav aria-label="Arbres" className="sticky top-12 z-10 flex gap-1.5 overflow-x-auto border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur lg:hidden">
            {mode === 'filter' ? <Chip label="Tous" active={selected === null} onClick={() => choose(null)} /> : null}
            {lanes.active.map((lane) => (
              <Chip key={lane.tree.key} label={shortBranch(lane.tree)} dot={VERDICT_TONE[lane.tree.verdict].dot} active={current === lane.tree.key} onClick={() => choose(lane.tree.key)} />
            ))}
            {lanes.loose.length > 0 ? <Chip label="Projet" active={current === PROJECT_KEY} onClick={() => choose(PROJECT_KEY)} /> : null}
            {liveBranches.map((branch) => (
              <Chip key={branch.key} label={branch.name} dot={BRANCH_TONE[branch.kind].dot} active={current === branch.key} onClick={() => choose(branch.key)} />
            ))}
            {lanes.cleanup.length > 0 ? <Chip label={`À nettoyer · ${lanes.cleanup.length}`} dot="bg-positive" active={current === CLEANUP_KEY} onClick={() => choose(CLEANUP_KEY)} /> : null}
          </nav>
        ) : null}

        <div className="flex flex-col gap-5 px-4 pt-4 pb-28 md:px-6">
          {hasTrees && (mode === 'scroll' || selected === null) ? <BaseCard code={code} branches={branchInfos} /> : null}
          <AskInbox items={inbox} />

          {mode === 'filter' && selected ? (
            <button type="button" onClick={() => choose(null)} className="self-start rounded-md px-1 text-xs text-ink-faint hover:text-ink">
              ← Tous les arbres
            </button>
          ) : null}

          <div className="flex flex-col gap-2.5">
            {shown.active.map((lane) => (
              <Lane
                key={lane.tree.key}
                tree={lane.tree}
                live={lane.live}
                entries={lane.entries}
                travail={travail}
                projectId={projectId}
                dense
                anchorId={anchorOf(lane.tree.key)}
                highlight={highlightOf(lane.tree.key)}
              />
            ))}
          </div>

          {/* Les branches sans arbre qui portent du travail : un couloir chacune, après les arbres. */}
          {hasTrees && shown.branches.length > 0 ? (
            <section className="flex flex-col gap-2.5">
              <h3 className="flex items-center gap-2 px-1 text-xs font-medium tracking-wide text-ink-faint uppercase">
                <GitBranch size={12} /> Branches sans worktree
              </h3>
              {shown.branches.map((branch) => (
                <BranchLane key={branch.key} projectId={projectId} branch={branch} demo={code.demo} anchorId={anchorOf(branch.key)} highlight={highlightOf(branch.key)} />
              ))}
            </section>
          ) : null}

          {shown.showProject ? (
            <ProjectLane entries={lanes.loose} model={model} anchorId={anchorOf(PROJECT_KEY)} highlight={highlightOf(PROJECT_KEY)} />
          ) : null}

          {shown.showCleanup && shown.cleanup.length > 0 ? (
            <section id={anchorOf(CLEANUP_KEY)} data-tree={CLEANUP_KEY} className="flex scroll-mt-4 flex-col gap-2">
              <button
                type="button"
                onClick={() => setCleanupOpen((value) => !value)}
                aria-expanded={cleanupOpen || cleanupForced}
                className="flex items-center gap-2 self-start rounded-md px-1 py-1 text-sm text-ink-soft hover:text-ink"
              >
                <ChevronRight size={14} className={cx('transition-transform', (cleanupOpen || cleanupForced) && 'rotate-90')} />
                <Trash2 size={13} className="text-positive" />
                <span className="font-medium">À nettoyer</span>
                <span className="text-xs tabular-nums text-ink-faint">
                  {shown.cleanup.length} arbre{shown.cleanup.length > 1 ? 's' : ''} · {formatBytes(shown.cleanup.reduce((sum, lane) => sum + lane.tree.sizeBytes, 0))}
                </span>
              </button>
              {cleanupOpen || cleanupForced ? (
                <div className="flex flex-col gap-2.5">
                  {shown.cleanup.map((lane) => (
                    <Lane
                      key={lane.tree.key}
                      tree={lane.tree}
                      live={lane.live}
                      entries={lane.entries}
                      travail={travail}
                      projectId={projectId}
                      dense
                      dim
                      anchorId={anchorOf(lane.tree.key)}
                      highlight={highlightOf(lane.tree.key)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {hasTrees && shown.showMerged ? <MergedBranches branches={mergedBranches} anchorId={anchorOf(MERGED_KEY)} forceOpen={mode === 'filter' && selected === MERGED_KEY} /> : null}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ l'index */

function TreeIndex({
  lanes,
  hasProject,
  cleanupSize,
  branches,
  merged,
  current,
  mode,
  onChoose,
  code,
}: {
  lanes: { active: LaneData[]; cleanup: LaneData[] }
  hasProject: boolean
  cleanupSize: number
  branches: BranchInfo[]
  merged: BranchInfo[]
  current: string | null
  mode: Mode
  onChoose: (key: string | null) => void
  code: ReturnType<typeof useTravail>['code']
}) {
  const item = 'flex w-full min-w-0 items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors'
  const state = (key: string | null) => (current === key ? 'bg-surface-high' : 'hover:bg-surface-high/60')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-1 border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Arbres</h2>
        <TreeSummary code={code} />
      </header>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        <li>
          <button type="button" onClick={() => onChoose(null)} className={cx(item, mode === 'filter' ? state(null) : 'hover:bg-surface-high/60')}>
            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full border border-ink-faint" />
            <span className="min-w-0 flex-1 text-sm font-medium">Tous</span>
            <span className="text-xs text-ink-faint">{mode === 'filter' ? 'tous les couloirs' : 'en haut'}</span>
          </button>
        </li>
        {lanes.active.map((lane) => (
          <li key={lane.tree.key}>
            <IndexTree tree={lane.tree} className={cx(item, state(lane.tree.key))} onClick={() => onChoose(lane.tree.key)} />
          </li>
        ))}
        {branches.length > 0 || merged.length > 0 ? (
          <li className="mt-2 flex items-center gap-1.5 border-t border-line px-2 pt-3 pb-1 text-xs font-medium tracking-wide text-ink-faint uppercase">
            <GitBranch size={11} /> Branches
            <span className="ml-auto font-normal tracking-normal normal-case tabular-nums">sans worktree</span>
          </li>
        ) : null}
        {branches.map((branch) => (
          <li key={branch.key}>
            <IndexBranch branch={branch} className={cx(item, state(branch.key))} onClick={() => onChoose(branch.key)} />
          </li>
        ))}
        {merged.length > 0 ? (
          <li>
            <button type="button" onClick={() => onChoose(MERGED_KEY)} className={cx(item, state(MERGED_KEY))}>
              <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-positive" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm">
                  {merged.length} fusionnée{merged.length > 1 ? 's' : ''}
                </span>
                <span className="text-xs text-ink-faint">rien à perdre, supprimables</span>
              </span>
            </button>
          </li>
        ) : null}
        {hasProject ? (
          <li className="mt-2 border-t border-line pt-2">
            <button type="button" onClick={() => onChoose(PROJECT_KEY)} className={cx(item, state(PROJECT_KEY))}>
              <Layers size={13} className="mt-0.5 shrink-0 text-ink-faint" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">Projet</span>
                <span className="text-xs text-ink-faint">ce qui ne vit dans aucun arbre</span>
              </span>
            </button>
          </li>
        ) : null}
        {lanes.cleanup.length > 0 ? (
          <li className={cx(!hasProject && 'mt-2 border-t border-line pt-2')}>
            <button type="button" onClick={() => onChoose(CLEANUP_KEY)} className={cx(item, state(CLEANUP_KEY))}>
              <Trash2 size={13} className="mt-0.5 shrink-0 text-positive" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium">À nettoyer</span>
                <span className="text-xs tabular-nums text-ink-faint">
                  {lanes.cleanup.length} arbre{lanes.cleanup.length > 1 ? 's' : ''} · {formatBytes(cleanupSize)}
                </span>
              </span>
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  )
}

/** Une ligne de l'index : verdict, branche, raison, puis carte et jalon, sessions, taille. */
function IndexTree({ tree, className, onClick }: { tree: TreeRow; className: string; onClick: () => void }) {
  const tone = VERDICT_TONE[tree.verdict]
  return (
    <button type="button" onClick={onClick} className={className} title={tree.branch ?? tree.name}>
      <span aria-hidden className={cx('mt-1.5 size-2 shrink-0 rounded-full', tone.dot)} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          {tree.root ? <FolderGit2 size={12} className="shrink-0 text-ink-faint" /> : <GitBranch size={12} className="shrink-0 text-ink-faint" />}
          <span className={cx('min-w-0 truncate font-mono text-[13px]', tree.root && 'font-semibold')}>{tree.root ? (tree.branch ?? tree.name) : shortBranch(tree)}</span>
        </span>
        <span className={cx('min-w-0 truncate text-xs', tone.text)}>{tree.reason}</span>
        {/* Le lien arbre ↔ carte ↔ jalon, toujours visible. */}
        {tree.card ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-faint">
            <span className="min-w-0 truncate">#{tree.card.number} {tree.card.title}</span>
            {tree.card.milestone ? (
              <span className="shrink-0 rounded bg-surface-high px-1.5 py-px">Jalon #{tree.card.milestone.number}</span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-xs tabular-nums text-ink-faint">{tree.sizeBytes ? formatBytes(tree.sizeBytes) : ''}</span>
        <SessionDots tree={tree} max={2} />
      </span>
    </button>
  )
}

function Chip({ label, dot, active, onClick }: { label: string; dot?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex h-7 max-w-[12rem] shrink-0 items-center gap-1.5 rounded-full px-2.5 font-mono text-xs transition-colors',
        active ? 'bg-accent-wash text-ink ring-1 ring-accent/40' : 'bg-sunken text-ink-soft hover:text-ink',
      )}
    >
      {dot ? <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', dot)} /> : null}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}
