/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * La vue **Graphe** de Travail `une-ligne` : le graphe façon GitKraken du panneau git
 * d'une conversation (`components/panel/git/`), repris tel quel à l'échelle du projet,
 * et doublé de ce que Solera sait des branches.
 *
 * - Les données sont réelles : `useGraph(projectScope(id))` sert `git log --all` sur le
 *   workspace du projet (branches locales, distantes, worktrees, remises), en fenêtre
 *   paginée. Rien ne manque côté serveur pour ce rendu.
 * - Les rangées sont celles du panneau (`GraphRow` : couloirs, nœuds, refs, message,
 *   fil, auteur, date, sha, menu) ; à droite, une colonne « Solera » : verdict de
 *   l'arbre, sessions vivantes, carte et jalon, PR.
 * - Les menus qui écrivent (basculer, fusionner, rebaser, reset, cherry-pick…) sont
 *   éteints : `locked`. Restent « copier le SHA » et « aller au fil ».
 * - `?demo=1` : les arbres de démo n'existent pas dans le dépôt ; un graphe simulé du
 *   même style est construit à partir d'eux (couloirs calculés ici), marqué.
 */
import { Loader } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { GraphDto, GraphNodeDto, GraphRefDto, PullRequestBadgeState } from '@solera/protocol'
import { Banner, cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { GitActionsProvider } from '../../components/panel/git/actions'
import { CommitDetail } from '../../components/panel/git/CommitDetail'
import { GraphHeader, GraphRow } from '../../components/panel/git/GraphRows'
import { RunHighlight, ROW_HEIGHT, runColor, useHoveredRun, useRunHover, type RunHover } from '../../components/panel/git/lanes'
import type { MenuContext } from '../../components/panel/git/menus'
import { GRAPH_PAGE, useGraph } from '../../components/panel/git/queries'
import { Drawer } from '../../components/prototype/Drawer'
import { relativeDate } from '../../lib/dates'
import { projectScope } from '../../lib/workspace-scope'
import { PR_LABEL, VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import { ServiceMark } from '../prototype-automations/served'
import type { TreeRow } from '../prototype-code/data'
import { BRANCH_TONE, type BranchInfo } from './branches'
import { CommitSessions } from './CommitSessions'
import type { InboxItem } from '../../components/prototype/AskInbox'

/** Ce qu'une branche du graphe est pour Solera : un arbre, ou une branche sans arbre. */
type Known = { kind: 'tree'; tree: TreeRow } | { kind: 'branch'; branch: BranchInfo }

const MERGED_TREE: ReadonlySet<TreeRow['verdict']> = new Set(['clean', 'empty', 'missing'])

/** `origin/feat/x` → `feat/x` : une distante et sa locale désignent la même branche. */
const bare = (name: string) => name.replace(/^[^/]+\/(?=(feat|fix|spike|chore|jalon|proto)\/)/, '').replace(/^origin\//, '')

export function ProjectGitGraph({
  projectId,
  demo,
  trees,
  branches,
  targetKey,
  from,
  showMerged,
  onSelect,
  onOpenTree,
  inbox = [],
}: {
  projectId: string
  demo: boolean
  trees: TreeRow[]
  branches: BranchInfo[]
  /** L'arbre ou la branche choisi dans les filtres : sa course est mise en avant. */
  targetKey: string | null
  /** Borne basse de la période, en ms ; null pour tout. */
  from: number | null
  /** Faux par défaut : les branches fusionnées perdent leurs étiquettes. */
  showMerged: boolean
  onSelect: (key: string | null) => void
  onOpenTree: (key: string) => void
  /** La liste unique des demandes, pour répondre sur place à une session du commit. */
  inbox?: InboxItem[]
}) {
  const navigate = useNavigate()
  const scope = projectScope(projectId)
  const [limit, setLimit] = useState(GRAPH_PAGE)
  const [commit, setCommit] = useState<string | null>(null)
  const since = from === null ? undefined : new Date(from).toISOString()
  const real = useGraph(scope, since ? { since } : {}, limit)

  const simulated = useMemo(() => (demo ? demoGraph(trees, branches, from) : null), [demo, trees, branches, from])
  const data: GraphDto | undefined = simulated ?? real.data

  /** Les branches que Solera connaît, par nom nu. */
  const known = useMemo(() => {
    const map = new Map<string, Known>()
    for (const branch of branches) map.set(branch.name, { kind: 'branch', branch })
    for (const tree of trees) if (tree.branch) map.set(tree.branch, { kind: 'tree', tree })
    return map
  }, [trees, branches])

  const isMerged = (entry: Known) => (entry.kind === 'tree' ? MERGED_TREE.has(entry.tree.verdict) : entry.branch.merged)

  const target = useMemo(() => {
    if (!targetKey) return null
    const tree = trees.find((entry) => entry.key === targetKey)
    if (tree) return tree.branch
    return branches.find((entry) => entry.key === targetKey)?.name ?? null
  }, [targetKey, trees, branches])

  const nodes = useMemo(() => {
    const raw = data?.nodes ?? []
    if (showMerged) return raw
    // Les fusionnées masquées : leurs étiquettes disparaissent, leurs commits restent —
    // ils sont dans l'histoire de la base, les retirer mentirait sur le graphe.
    return raw.map((node) => ({
      ...node,
      refs: node.refs.filter((ref) => {
        const entry = known.get(bare(ref.name))
        return !(entry && isMerged(entry))
      }),
    }))
  }, [data, showMerged, known])

  const runs = data?.runs ?? []
  const hover = useRunHover()
  const graphId = useId()
  const menus: MenuContext = {
    branch: data?.branch ?? null,
    locked: true,
    projectId,
    onOpenThread: (id) => navigate(`/p/${projectId}/c/${id}`),
    onRebase: () => undefined,
  }

  if (!simulated && real.isPending) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-ink-faint">
        <Loader size={13} className="animate-spin" /> Lecture du graphe…
      </p>
    )
  }
  if (!simulated && real.error) return <Banner>{real.error instanceof Error ? real.error.message : 'Le graphe n’a pas pu être lu.'}</Banner>
  if (data && data.nodes === null) return <p className="text-sm text-ink-faint">Ce projet n’est pas un dépôt git.</p>
  if (nodes.length === 0) return <p className="text-sm text-ink-faint">Aucun commit dans cette période.</p>

  return (
    <GitActionsProvider scope={scope} lock={null}>
      <div data-graph={graphId} className="@container flex min-w-0 flex-col rounded-lg border border-line">
        <RunHighlight scope={graphId} hover={hover} />
        <div className="sticky top-0 z-10 flex items-stretch border-b border-line bg-surface">
          <div className="min-w-0 flex-1">
            <Header lanes={data?.lanes ?? 1} runs={runs} hover={hover} />
          </div>
          <div className="hidden w-[24rem] shrink-0 items-center gap-2 border-l border-line px-3 text-micro font-semibold tracking-wide text-ink-faint uppercase lg:flex">
            Dans Solera
            {simulated ? <span className="rounded bg-fuchsia-500/15 px-1 normal-case tracking-normal text-fuchsia-700 dark:text-fuchsia-300">graphe simulé</span> : null}
          </div>
        </div>

        {nodes.map((node, index) => {
          const names = node.refs.filter((ref) => ref.kind === 'local' || ref.kind === 'remote' || ref.kind === 'worktree').map((ref) => bare(ref.name))
          const entries = [...new Set(names)].map((name) => known.get(name)).filter((entry): entry is Known => Boolean(entry))
          const runName = runs[node.run] ?? null
          const dim = target !== null && runName !== target && !names.includes(target)
          return (
            <div
              key={node.hash || `working-${index}`}
              className={cx('flex items-stretch border-b border-line/50 last:border-b-0 transition-opacity', dim && 'opacity-35 hover:opacity-100')}
            >
              <div className="min-w-0 flex-1">
                <GraphRow
                  node={node}
                  lanes={data?.lanes ?? 1}
                  runs={runs}
                  onHoverRun={hover.set}
                  selected={commit !== null && commit === node.hash}
                  onSelect={() => (node.kind === 'working' ? undefined : setCommit(node.hash))}
                  menus={menus}
                  onOpenThread={menus.onOpenThread}
                />
              </div>
              <div className="hidden w-[24rem] shrink-0 items-center gap-2 overflow-hidden border-l border-line/50 px-3 lg:flex" style={{ height: ROW_HEIGHT }}>
                {node.kind === 'working' ? (
                  <span className="truncate text-xs text-ink-faint">racine du projet · non commité</span>
                ) : entries.length > 0 ? (
                  <>
                    <Annotation
                      entry={entries[0]!}
                      active={target !== null && (entries[0]!.kind === 'tree' ? entries[0]!.tree.branch : entries[0]!.branch.name) === target}
                      onOpenTree={onOpenTree}
                      onSelect={onSelect}
                    />
                    {entries.length > 1 ? <span className="shrink-0 text-micro text-ink-faint">+{entries.length - 1}</span> : null}
                  </>
                ) : null}
              </div>
            </div>
          )
        })}

        {!simulated && data?.hasMore ? (
          <button
            type="button"
            onClick={() => setLimit((current) => current + GRAPH_PAGE)}
            disabled={real.isFetching}
            className="w-full px-3 py-2 text-xs text-ink-faint hover:text-ink disabled:opacity-45"
          >
            {real.isFetching ? 'Lecture…' : `${GRAPH_PAGE} commits de plus`}
          </button>
        ) : null}
      </div>

      <Drawer open={commit !== null} onClose={() => setCommit(null)} label="Détail du commit" width="wide">
        {commit !== null && nodes.find((node) => node.hash === commit) ? (
          <CommitSessions
            projectId={projectId}
            node={nodes.find((node) => node.hash === commit)!}
            runName={runs[nodes.find((node) => node.hash === commit)!.run] ?? null}
            trees={trees}
            branches={branches}
            inbox={inbox}
            demo={Boolean(simulated)}
            onOpenTree={(key) => {
              setCommit(null)
              onOpenTree(key)
            }}
          />
        ) : null}
        {commit !== null ? (
          simulated ? (
            <DemoCommit node={nodes.find((node) => node.hash === commit) ?? null} runs={runs} onClose={() => setCommit(null)} />
          ) : (
            <CommitDetail scope={scope} hash={commit} menus={menus} onBack={() => setCommit(null)} onOpenThread={menus.onOpenThread} beside />
          )
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

const PR_TONE: Record<string, string> = {
  neutral: 'text-ink-soft',
  accent: 'text-accent',
  positive: 'text-positive',
  caution: 'text-caution',
  critical: 'text-critical',
}

function PrMark({ pr }: { pr: { number: number; url: string; state: PullRequestBadgeState } }) {
  const label = PR_LABEL[pr.state]
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className={cx('shrink-0 text-xs tabular-nums hover:underline', PR_TONE[label.tone])}
      title={`PR #${pr.number} · ${label.label}`}
    >
      #{pr.number} {label.label}
    </a>
  )
}

/**
 * Ce que Solera sait d'une branche du graphe, sur sa rangée de tête : le verdict de
 * l'arbre (« t'attend » en ambre), ses sessions vivantes, la carte et le jalon, la PR.
 * Un clic sur la pastille ouvre le tiroir de l'arbre ; sur une branche sans arbre, il la
 * choisit dans les filtres.
 */
function Annotation({ entry, active, onOpenTree, onSelect }: {
  entry: Known
  active: boolean
  onOpenTree: (key: string) => void
  onSelect: (key: string | null) => void
}) {
  if (entry.kind === 'tree') {
    const { tree } = entry
    const tone = VERDICT_TONE[tree.verdict]
    const live = tree.sessions.filter((session) => session.status === 'running' || session.status === 'awaiting_input' || session.status === 'error')
    const waiting = tree.verdict === 'waiting'
    return (
      <>
        <button
          type="button"
          onClick={() => onOpenTree(tree.key)}
          title="Ouvrir l’arbre"
          className={cx(
            'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs transition-colors hover:border-line-strong',
            waiting ? 'border-caution/50 bg-caution/10 text-caution' : active ? 'border-accent/60 text-ink' : 'border-line text-ink-soft',
          )}
        >
          <span aria-hidden className={cx('size-1.5 rounded-full', tone.dot)} />
          {tone.label}
        </button>
        {live.length > 0 ? (
          <span className="flex shrink-0 items-center gap-0.5" title={live.map((session) => session.title).join(' · ')}>
            {live.slice(0, 3).map((session) => <AgentIcon key={session.id} agent={session.agent} size={13} />)}
          </span>
        ) : null}
        <CardMark card={tree.card} />
        {tree.pr ? <PrMark pr={tree.pr} /> : null}
        <ServiceMark treeKey={tree.key} />
      </>
    )
  }
  const { branch } = entry
  const tone = BRANCH_TONE[branch.kind]
  return (
    <>
      <button
        type="button"
        onClick={() => onSelect(active ? null : branch.key)}
        title={active ? 'Retirer le filtre' : 'Filtrer sur cette branche'}
        className={cx(
          'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-dashed px-1.5 py-0.5 text-xs transition-colors hover:border-line-strong',
          active ? 'border-accent/60 text-ink' : 'border-line text-ink-soft',
        )}
      >
        <span aria-hidden className={cx('size-1.5 rounded-full', tone.dot)} />
        sans arbre
      </button>
      <CardMark card={branch.card} />
      {branch.pr ? <PrMark pr={branch.pr} /> : null}
    </>
  )
}

function CardMark({ card }: { card: { number: number; title: string; milestone: { number: number; title: string } | null } | null }) {
  if (!card) return null
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs text-ink-faint" title={`#${card.number} ${card.title}${card.milestone ? ` · Jalon #${card.milestone.number} ${card.milestone.title}` : ''}`}>
      <span className="shrink-0 tabular-nums text-ink-soft">#{card.number}</span>
      {card.milestone ? <span className="truncate rounded bg-surface-high px-1 text-micro">Jalon #{card.milestone.number}</span> : null}
    </span>
  )
}

/** Le détail d'un commit simulé : ce que le vrai détail montrerait, sans diff. */
function DemoCommit({ node, runs, onClose }: { node: GraphNodeDto | null; runs: (string | null)[]; onClose: () => void }) {
  if (!node) return null
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{node.subject}</p>
          <p className="mt-0.5 text-xs text-ink-faint">
            <span className="font-mono">{node.shortHash}</span> · {node.agent ?? node.author} · {relativeDate(node.ts)} · {runs[node.run] ?? 'branche sans nom'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-md px-1.5 text-ink-faint hover:bg-surface-high hover:text-ink">✕</button>
      </div>
      <p className="rounded-md border border-dashed border-fuchsia-500/50 px-3 py-2 text-xs text-fuchsia-700 dark:text-fuchsia-300">
        Commit simulé : avec les vraies données, ce tiroir montre le détail du panneau git (fichiers, diff, menu du commit).
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ graphe simulé */

interface DemoCommitSpec {
  hash: string
  subject: string
  ts: number
  parents: string[]
  refs: GraphRefDto[]
  agent: string | null
  merge?: boolean
}

/** Un nombre stable tiré d'un texte : la simulation ne bouge pas d'un rendu à l'autre. */
function seed(text: string): number {
  let hash = 7
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return Math.abs(hash)
}

/**
 * Un dépôt crédible tiré des arbres et des branches de démo : la base en tronc, chaque
 * arbre et chaque branche non fusionnée en rameau qui part d'un commit de la base, les
 * fusionnées rentrées par un commit de fusion.
 */
function demoGraph(trees: TreeRow[], branches: BranchInfo[], from: number | null): GraphDto {
  const now = Date.now()
  const HOUR = 3_600_000
  const root = trees.find((tree) => tree.root)
  const base = root?.branch ?? 'main'
  const MAIN = 34
  const main: DemoCommitSpec[] = Array.from({ length: MAIN }, (_, index) => ({
    hash: `m${index.toString().padStart(3, '0')}aa1`,
    subject: MAIN_SUBJECTS[index % MAIN_SUBJECTS.length]!,
    ts: now - (index + 1) * 5 * HOUR,
    parents: index < MAIN - 1 ? [`m${(index + 1).toString().padStart(3, '0')}aa1`] : [],
    refs: index === 0 ? [{ name: base, kind: 'local' }, { name: `origin/${base}`, kind: 'remote' }] : [],
    agent: index % 3 === 0 ? null : 'Claude',
  }))

  type Spec = { name: string; ahead: number; merged: boolean; tree: TreeRow | null; remoteOnly: boolean }
  const specs: Spec[] = [
    ...trees.filter((tree) => !tree.root && tree.branch).map((tree) => ({
      name: tree.branch!,
      ahead: Math.max(1, Math.min(4, tree.ahead || 1 + (seed(tree.key) % 3))),
      merged: MERGED_TREE.has(tree.verdict),
      tree,
      remoteOnly: false,
    })),
    ...branches.map((branch) => ({
      name: branch.name,
      ahead: Math.max(1, Math.min(4, branch.ahead || 1 + (seed(branch.key) % 3))),
      merged: branch.merged,
      tree: null,
      remoteOnly: branch.remoteOnly,
    })),
  ]
  // Assez pour juger, pas au point de noyer : les vivantes d'abord, puis quelques fusionnées.
  const shown = [...specs.filter((spec) => !spec.merged).slice(0, 12), ...specs.filter((spec) => spec.merged).slice(0, 6)]

  const commits: DemoCommitSpec[] = [...main]
  const usedMerge = new Set<number>()
  for (const spec of shown) {
    const s = seed(spec.name)
    const refs: GraphRefDto[] = spec.remoteOnly
      ? [{ name: `origin/${spec.name}`, kind: 'remote' }]
      : [
          { name: spec.name, kind: 'local' },
          ...(spec.tree ? [{ name: spec.tree.name, kind: 'worktree' as const }] : []),
          ...(s % 2 === 0 ? [{ name: `origin/${spec.name}`, kind: 'remote' as const }] : []),
        ]
    const agent = spec.tree?.sessions[0]?.agent ?? (['Claude', 'Codex', 'Grok'][s % 3] as string)
    const label = spec.name.replace(/^(feat|fix|spike|chore)\/(\d+-)?/, '').replace(/-/g, ' ')
    if (spec.merged) {
      // Fourche plus bas, fusion plus haut, sur un commit de la base qui ne fusionne rien d'autre.
      let mergeAt = 2 + (s % 18)
      while (usedMerge.has(mergeAt) && mergeAt < MAIN - 6) mergeAt += 1
      usedMerge.add(mergeAt)
      const forkAt = Math.min(MAIN - 1, mergeAt + 2 + (s % 4))
      const low = main[forkAt]!.ts
      const high = main[mergeAt]!.ts
      const hashes = Array.from({ length: spec.ahead }, (_, index) => `b${(s % 99991).toString(16)}${index}`)
      hashes.forEach((hash, index) => {
        commits.push({
          hash,
          subject: `${label} : ${BRANCH_SUBJECTS[(s + index) % BRANCH_SUBJECTS.length]}`,
          ts: high - (index + 1) * ((high - low) / (spec.ahead + 1)),
          parents: [index === spec.ahead - 1 ? main[forkAt]!.hash : hashes[index + 1]!],
          refs: index === 0 ? refs : [],
          agent,
        })
      })
      const target = main[mergeAt]!
      target.parents = [...target.parents, hashes[0]!]
      target.merge = true
      target.subject = `Merge pull request from Tipaq/${spec.name}`
    } else {
      const forkAt = Math.min(MAIN - 1, 1 + (seed(`${spec.name}fork`) % 14))
      const low = main[forkAt]!.ts
      const tip = now - (1 + (s % 40)) * 0.3 * HOUR
      const high = Math.max(low + HOUR, tip)
      const hashes = Array.from({ length: spec.ahead }, (_, index) => `c${(s % 99991).toString(16)}${index}`)
      hashes.forEach((hash, index) => {
        commits.push({
          hash,
          subject: `${label} : ${BRANCH_SUBJECTS[(s + index * 3) % BRANCH_SUBJECTS.length]}`,
          ts: high - index * ((high - low) / (spec.ahead + 1)),
          parents: [index === spec.ahead - 1 ? main[forkAt]!.hash : hashes[index + 1]!],
          refs: index === 0 ? refs : [],
          agent,
        })
      })
    }
  }

  const working = root && root.uncommitted > 0
    ? [{ hash: '', subject: '', ts: now, parents: [main[0]!.hash], refs: [], agent: null } satisfies DemoCommitSpec]
    : []
  const ordered = [...working, ...commits.sort((a, b) => b.ts - a.ts)]
  const nodes = layout(ordered, root?.uncommitted ?? 0)
  const windowed = from === null ? nodes.nodes : nodes.nodes.filter((node) => node.kind === 'working' || node.ts >= from)
  return { nodes: windowed, lanes: nodes.lanes, runs: nodes.runs, hasMore: false, branch: base, filtered: false }
}

/**
 * Les couloirs, calculés comme le fait le serveur (`git-graph.ts`) : chaque couloir
 * attend un commit ; un commit attendu par plusieurs couloirs les fait retomber sur lui,
 * un commit qu'aucun n'attend ouvre une tête ; le premier parent garde le couloir, les
 * suivants (fusion) en rejoignent ou en ouvrent un.
 */
function layout(commits: DemoCommitSpec[], uncommitted: number): { nodes: GraphNodeDto[]; lanes: number; runs: (string | null)[] } {
  const active: (string | null)[] = []
  const activeRun: number[] = []
  const runs: (string | null)[] = []
  let lanes = 1
  const free = () => {
    const index = active.indexOf(null)
    return index === -1 ? active.length : index
  }
  const branchName = (refs: GraphRefDto[]) => refs.find((ref) => ref.kind === 'local')?.name ?? refs.find((ref) => ref.kind === 'remote')?.name.replace(/^origin\//, '') ?? null

  const nodes = commits.map((commit): GraphNodeDto => {
    const matches = active.flatMap((hash, index) => (hash !== null && hash === commit.hash ? [index] : []))
    const tip = matches.length === 0
    const lane = tip ? free() : matches[0]!
    if (tip) {
      runs.push(branchName(commit.refs))
      activeRun[lane] = runs.length - 1
    } else if (runs[activeRun[lane]!] === null && branchName(commit.refs)) {
      runs[activeRun[lane]!] = branchName(commit.refs)
    }
    const run = activeRun[lane]!
    const collapses = matches.slice(1)
    const collapseRuns = collapses.map((index) => activeRun[index]!)
    for (const index of collapses) active[index] = null
    const through = active.flatMap((hash, index) => (hash !== null && index !== lane && !matches.includes(index) ? [index] : []))
    const throughRuns = through.map((index) => activeRun[index]!)

    const [first, ...others] = commit.parents
    active[lane] = first ?? null
    const joins: number[] = []
    const joinRuns: number[] = []
    for (const parent of others) {
      let index = active.indexOf(parent)
      if (index === -1) {
        index = free()
        active[index] = parent
        runs.push(null)
        activeRun[index] = runs.length - 1
      }
      joins.push(index)
      joinRuns.push(activeRun[index]!)
    }
    lanes = Math.max(lanes, active.length, lane + 1)
    const working = commit.hash === ''
    return {
      kind: working ? 'working' : commit.merge ? 'merge' : 'commit',
      hash: commit.hash,
      shortHash: commit.hash.slice(0, 7),
      subject: commit.subject,
      author: 'Tim',
      agent: commit.agent,
      ts: commit.ts,
      parents: commit.parents,
      refs: commit.refs,
      thread: null,
      lane,
      through,
      joins,
      collapses,
      tip,
      root: commit.parents.length === 0,
      run,
      aboveRun: run,
      throughRuns,
      joinRuns,
      collapseRuns,
      working: working ? { files: uncommitted, added: uncommitted * 14, removed: uncommitted * 5 } : null,
    }
  })
  // Une course ouverte par la tête du nœud « en cours » est celle de la base.
  return { nodes, lanes, runs }
}

const MAIN_SUBJECTS = [
  'Comptes Claude : l’adresse vient de la jauge',
  'Réglages, étape b : suite de la revue',
  'Accès git : choisir sa forge',
  'Dev container sous Windows natif : chemins échangés',
  'Sessions autonomes confinées par défaut',
  'Services : une liste Environnements',
  'Un devcontainer.json géré par Solera',
  'Ports du dev container joignables depuis l’aperçu',
  'Se connecter à Claude, Codex et Grok sans terminal',
  'CI du jalon #136',
]

const BRANCH_SUBJECTS = [
  'premier jet',
  'les tests passent',
  'suite de la revue',
  'cas limite du téléphone',
  'retire le code mort',
  'renomme selon le glossaire',
]
