import { Loader } from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Banner, cx } from '@solera/ui'
import { AgentIcon } from '../AgentIcon'
import { PrTag } from '../code/PrTag'
import { BranchDot, VerdictDot, verdictLabel } from '../code/VerdictDot'
import { GitActionsProvider } from '../panel/git/actions'
import { CommitDetail } from '../panel/git/CommitDetail'
import { GraphHeader, GraphRow } from '../panel/git/GraphRows'
import { RunHighlight, ROW_HEIGHT, runColor, useHoveredRun, useRunHover, type RunHover } from '../panel/git/lanes'
import type { MenuContext } from '../panel/git/menus'
import { GRAPH_PAGE, useGraph } from '../panel/git/queries'
import { Drawer } from '../shell/Drawer'
import { withSheet } from '../../lib/card-sheet'
import type { BranchInfo, CodeCard, TreeRow } from '../../lib/code-model'
import { isDimmed, knownBranches, knownKey, knownName, knownOfNode, withoutMergedRefs, type GraphKnown } from '../../lib/graph-model'
import { useTranslate } from '../../lib/i18n'
import { projectScope } from '../../lib/workspace-scope'
import { CommitSessions, type CommitSessionSources } from './CommitSessions'

/** La colonne « Dans Solera », à partir de `lg`. */
const SOLERA_COLUMN = 'hidden w-[24rem] shrink-0 border-l lg:flex'

/**
 * La vue **Graphe** de Travail (`projet.md` T-7) : le graphe façon GitKraken du panneau
 * git, sur tout le dépôt du projet (`git log --all` de la portée projet), et en face de
 * chaque rangée ce que Solera sait de la branche dont elle porte la tête — l'arbre et
 * son verdict, ses sessions vivantes, la carte, le jalon, la PR.
 *
 * - L'arbre ou la branche choisi dans les filtres reste net, le reste s'estompe.
 * - La période des filtres borne le graphe (`since`) ; les branches fusionnées perdent
 *   leurs étiquettes, sauf quand on filtre sur « À nettoyer » ou « Fusionné ».
 * - Les menus qui écrivent sont éteints (`locked`) : on lit le dépôt de tout le projet,
 *   on ne bascule pas la racine depuis ici. Restent « copier le SHA » et « aller au fil ».
 * - Un commit s'ouvre dans le tiroir large : ses sessions, puis le détail du panneau.
 */
export function ProjectGitGraph({
  projectId,
  trees,
  branches,
  targetKey,
  from,
  showMerged,
  onSelect,
  onOpenTree,
  sources,
}: {
  projectId: string
  trees: TreeRow[]
  branches: BranchInfo[]
  /** L'arbre ou la branche choisi dans les filtres (`?arbre=`) : le reste s'estompe. */
  targetKey: string | null
  /** Le début de la période, en ms ; null pour tout. */
  from: number | null
  /** Faux par défaut : les branches fusionnées perdent leurs étiquettes. */
  showMerged: boolean
  /** Choisit une branche sans arbre comme filtre, ou retire le filtre. */
  onSelect: (key: string | null) => void
  onOpenTree: (key: string) => void
  sources: CommitSessionSources
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const scope = projectScope(projectId)
  const [limit, setLimit] = useState(GRAPH_PAGE)
  const [commit, setCommit] = useState<string | null>(null)
  const since = from === null ? undefined : new Date(from).toISOString()
  const { data, error, isPending, isFetching } = useGraph(scope, since ? { since } : {}, limit)

  const known = useMemo(() => knownBranches(trees, branches), [trees, branches])
  const target = useMemo(() => {
    if (!targetKey) return null
    const entry = [...known.values()].find((value) => knownKey(value) === targetKey)
    return entry ? knownName(entry) : null
  }, [known, targetKey])
  const nodes = useMemo(() => {
    const raw = data?.nodes ?? []
    return showMerged ? raw : withoutMergedRefs(raw, known)
  }, [data, showMerged, known])

  const runs = data?.runs ?? []
  const lanes = data?.lanes ?? 1
  const hover = useRunHover()
  const graphId = useId()
  const menus: MenuContext = {
    branch: data?.branch ?? null,
    locked: true,
    projectId,
    onOpenThread: (id) => navigate(`/p/${projectId}/c/${id}`),
    onRebase: () => undefined,
  }
  const opened = commit === null ? undefined : nodes.find((node) => node.hash === commit)
  // Le dernier commit montré reste rendu le temps que le tiroir sorte de l'écran.
  const last = useRef(opened)
  if (opened) last.current = opened
  const shown = opened ?? last.current

  // Une relecture qui échoue garde le graphe déjà lu : la bannière n'a lieu que sans lui.
  if (isPending) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-ink-faint">
        <Loader size={13} className="animate-spin" /> {t('git.graph.loading')}
      </p>
    )
  }
  if (error && !data) return <Banner>{error instanceof Error ? error.message : t('git.graph.error')}</Banner>
  if (data?.nodes === null) return <p className="text-sm text-ink-faint">{t('travail.graph.noRepo')}</p>
  if (nodes.length === 0) return <p className="text-sm text-ink-faint">{t('travail.graph.empty')}</p>

  return (
    <GitActionsProvider scope={scope} lock={null}>
      <div data-graph={graphId} data-project-graph className="@container flex min-w-0 flex-col rounded-lg border border-line">
        <RunHighlight scope={graphId} hover={hover} />
        <div className="sticky top-0 z-10 flex items-stretch border-b border-line bg-surface">
          <div className="min-w-0 flex-1">
            <Header lanes={lanes} runs={runs} hover={hover} />
          </div>
          <div className={cx(SOLERA_COLUMN, 'items-center border-line px-3 text-micro font-semibold tracking-wide text-ink-faint uppercase')}>
            {t('travail.graph.column')}
          </div>
        </div>

        {nodes.map((node, index) => {
          const entries = knownOfNode(node, known)
          const first = entries[0]
          const dimmed = isDimmed(node, runs, target)
          return (
            <div
              key={node.hash || `working-${index}`}
              data-dimmed={dimmed || undefined}
              className={cx('flex items-stretch border-b border-line/50 transition-opacity last:border-b-0', dimmed && 'opacity-35 hover:opacity-100')}
            >
              <div className="min-w-0 flex-1">
                <GraphRow
                  node={node}
                  lanes={lanes}
                  runs={runs}
                  onHoverRun={hover.set}
                  selected={commit !== null && commit === node.hash}
                  onSelect={() => (node.kind === 'working' ? undefined : setCommit(node.hash))}
                  menus={menus}
                  onOpenThread={menus.onOpenThread}
                />
              </div>
              <div className={cx(SOLERA_COLUMN, 'items-center gap-2 overflow-hidden border-line/50 px-3')} style={{ height: ROW_HEIGHT }}>
                {node.kind === 'working' ? (
                  <span className="truncate text-xs text-ink-faint">{t('travail.graph.working')}</span>
                ) : first ? (
                  <>
                    <Annotation entry={first} active={target !== null && knownName(first) === target} onOpenTree={onOpenTree} onSelect={onSelect} />
                    {entries.length > 1 ? (
                      <span className="shrink-0 text-micro text-ink-faint" title={entries.slice(1).map(knownName).join(', ')}>
                        {t('travail.graph.others', { count: entries.length - 1 })}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          )
        })}

        {data?.hasMore ? (
          <button
            type="button"
            onClick={() => setLimit((current) => current + GRAPH_PAGE)}
            disabled={isFetching}
            className="w-full px-3 py-2 text-xs text-ink-faint hover:text-ink disabled:opacity-45"
          >
            {isFetching ? t('git.graph.loading') : t('travail.graph.more', { count: GRAPH_PAGE })}
          </button>
        ) : null}
      </div>

      <Drawer open={opened !== undefined} onClose={() => setCommit(null)} label={t('travail.commit.label')} width="wide">
        {shown ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <CommitSessions
              projectId={projectId}
              scope={scope}
              hash={shown.hash}
              runName={runs[shown.run] ?? null}
              known={known}
              sources={sources}
              onOpenTree={(key) => {
                setCommit(null)
                onOpenTree(key)
              }}
            />
            <div className="flex shrink-0 flex-col">
              <CommitDetail scope={scope} hash={shown.hash} menus={menus} onBack={() => setCommit(null)} onOpenThread={menus.onOpenThread} beside />
            </div>
          </div>
        ) : null}
      </Drawer>
    </GitActionsProvider>
  )
}

/** L'en-tête du panneau, seul abonné au survol : il nomme la branche du trait visé. */
function Header({ lanes, runs, hover }: { lanes: number; runs: (string | null)[]; hover: RunHover }) {
  const run = useHoveredRun(hover)
  return <GraphHeader lanes={lanes} hovered={run === null ? null : { name: runs[run] ?? null, color: runColor(run, runs) }} />
}

const PILL = 'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs transition-colors hover:border-line-strong'

/**
 * Ce que Solera sait d'une branche du graphe, sur la rangée de sa tête (T-7.2). Un arbre :
 * la pastille de son verdict (ambre s'il t'attend), qui ouvre son tiroir, ses sessions
 * vivantes, la carte et le jalon, la PR. Une branche sans arbre : une pastille pointillée
 * qui la choisit comme filtre, ou retire le filtre, la carte, la PR.
 */
function Annotation({ entry, active, onOpenTree, onSelect }: {
  entry: GraphKnown
  active: boolean
  onOpenTree: (key: string) => void
  onSelect: (key: string | null) => void
}) {
  const t = useTranslate()
  if (entry.kind === 'tree') {
    const { tree } = entry
    const waiting = tree.verdict === 'waiting'
    return (
      <>
        <button
          type="button"
          onClick={() => onOpenTree(tree.key)}
          title={t('travail.graph.openTree')}
          className={cx(PILL, waiting ? 'border-caution/50 bg-caution/10 text-caution' : active ? 'border-accent/60 text-ink' : 'border-line text-ink-soft')}
        >
          <VerdictDot verdict={tree.verdict} className="size-1.5" />
          {verdictLabel(t, tree.verdict)}
        </button>
        {tree.sessions.length > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5" title={t('travail.graph.sessions', { titles: tree.sessions.map((session) => session.title).join(' · ') })}>
            {tree.sessions.slice(0, 3).map((session) => (
              <AgentIcon key={session.id} agent={session.agent} size={13} decorative />
            ))}
          </span>
        ) : null}
        <CardMark card={tree.card} />
        {tree.pr ? <PrTag pr={tree.pr} /> : null}
      </>
    )
  }
  const { branch } = entry
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(active ? null : branch.key)}
        aria-pressed={active}
        title={t(active ? 'travail.graph.unfilter' : 'travail.graph.filterBranch')}
        className={cx(PILL, 'border-dashed', active ? 'border-accent/60 text-ink' : 'border-line text-ink-soft')}
      >
        <BranchDot kind={branch.kind} className="size-1.5" />
        {t('travail.graph.noTree')}
      </button>
      <CardMark card={branch.card} />
      {branch.pr ? <PrTag pr={branch.pr} /> : null}
    </>
  )
}

/** « #n » et « Jalon #m », serrés : la colonne n'a pas la place d'un titre. Ouvre la fiche. */
function CardMark({ card }: { card: CodeCard | null }) {
  const t = useTranslate()
  const [, setParams] = useSearchParams()
  if (!card) return null
  const title = card.source === 'name' ? `#${card.number} ${card.title} — ${t('travail.commit.cardDeduced')}` : `#${card.number} ${card.title}`
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-ink-faint">
      <button
        type="button"
        onClick={() => setParams((current) => withSheet(current, card.number))}
        title={title}
        className="shrink-0 rounded tabular-nums text-ink-soft hover:text-ink hover:underline"
      >
        #{card.number}
      </button>
      {card.milestone ? (
        <button
          type="button"
          onClick={() => setParams((current) => withSheet(current, card.milestone!.number))}
          title={card.milestone.title}
          className="truncate rounded bg-surface-high px-1 text-micro hover:text-ink"
        >
          {t('code.milestone', { number: card.milestone.number })}
        </button>
      ) : null}
    </span>
  )
}
