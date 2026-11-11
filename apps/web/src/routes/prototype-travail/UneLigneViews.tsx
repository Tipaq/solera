/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * Les vues supplémentaires de Travail `une-ligne` (Affichage ▾), sur les mêmes filtres :
 * - **Graphe** : la base en tronc, chaque arbre et chaque branche en rameau, sa PR au bout ;
 * - **Par état** : un kanban des sessions (T'attend · Travaille · À relire · Terminées) ;
 * - **Frise** : une ligne par arbre ou branche sur l'axe du temps, les sessions en barres,
 *   les événements en points, « maintenant » marqué.
 */
import { GitPullRequest } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AgentKind, ConversationDto, JournalEntryDto, PullRequestBadgeState } from '@solera/protocol'
import { cx } from '@solera/ui'
import { AgentIcon } from '../../components/AgentIcon'
import { AskInbox, type InboxItem } from '../../components/prototype/AskInbox'
import type { ActivityRow } from '../../lib/activity-rows'
import { elapsed } from '../../lib/dates'
import { PR_LABEL, VERDICT_TONE } from '../prototype-code/ProjectCodePage'
import type { TreeRow } from '../prototype-code/data'
import { DAY } from '../prototype-milestones/model'
import { BRANCH_TONE, type BranchInfo } from './branches'
import type { LaneData } from './Couloirs'
import { shortBranch, type Travail } from './shared'

const PR_TEXT: Record<PullRequestBadgeState, string> = {
  draft: 'text-ink-faint',
  checks: 'text-ink-soft',
  failing: 'text-critical',
  ready: 'text-ink-soft',
  merged: 'text-ink-faint',
}

function PrMark({ pr }: { pr: { number: number; state: PullRequestBadgeState; url?: string } }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1 text-xs tabular-nums', PR_TEXT[pr.state])} title={`PR #${pr.number} · ${PR_LABEL[pr.state].label}`}>
      <GitPullRequest size={12} /> #{pr.number} <span className="hidden sm:inline">· {PR_LABEL[pr.state].label}</span>
    </span>
  )
}

function Agents({ sessions }: { sessions: { id: string; agent: AgentKind; status: string }[] }) {
  if (sessions.length === 0) return null
  return (
    <span className="flex shrink-0 gap-0.5">
      {sessions.slice(0, 4).map((session) => (
        <span
          key={session.id}
          title={session.status === 'running' ? 'tourne' : 't’attend'}
          className={cx('flex size-5 items-center justify-center rounded', session.status === 'running' ? 'bg-accent/10 text-accent' : 'bg-caution/15 text-caution')}
        >
          <AgentIcon agent={session.agent} size={12} />
        </span>
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ Graphe */

const ROW_H = 56

export function GraphView({
  trees,
  branches,
  targetKey,
  onSelect,
}: {
  trees: TreeRow[]
  branches: BranchInfo[]
  targetKey: string | null
  onSelect: (key: string | null) => void
}) {
  const root = trees.find((tree) => tree.root) ?? null
  const rest = trees.filter((tree) => !tree.root)
  type Row = { kind: 'tree'; tree: TreeRow } | { kind: 'branch'; branch: BranchInfo }
  const rows: Row[] = [...rest.map((tree) => ({ kind: 'tree' as const, tree })), ...branches.map((branch) => ({ kind: 'branch' as const, branch }))]
  if (!root && rows.length === 0) return <p className="text-sm text-ink-faint">Aucun arbre ni branche dans ces filtres.</p>

  return (
    <ol className="flex flex-col">
      {root ? (
        <GraphRow first last={rows.length === 0} trunk active={targetKey === root.key} onClick={() => onSelect(targetKey === root.key ? null : root.key)}
          dot={<circle cx={12} cy={ROW_H / 2} r={6} className="fill-ink" />}
          name={root.branch ?? root.name}
          status={<span className="text-xs text-ink-faint">base · {root.uncommitted > 0 ? `${root.uncommitted} fichiers non commités` : 'propre'}</span>}
          aside={<Agents sessions={root.sessions} />}
        />
      ) : null}
      {rows.map((row, index) => {
        const last = index === rows.length - 1
        if (row.kind === 'tree') {
          const tone = VERDICT_TONE[row.tree.verdict]
          return (
            <GraphRow
              key={row.tree.key}
              first={!root && index === 0}
              last={last}
              active={targetKey === row.tree.key}
              onClick={() => onSelect(targetKey === row.tree.key ? null : row.tree.key)}
              dot={<circle cx={36} cy={ROW_H / 2} r={5.5} className={dotFill(tone.dot)} />}
              name={shortBranch(row.tree)}
              status={<span className={cx('text-xs', tone.text)}>{row.tree.reason}</span>}
              card={row.tree.card}
              aside={
                <>
                  <Agents sessions={row.tree.sessions} />
                  <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-faint">
                    {row.tree.ahead || row.tree.behind ? `↑${row.tree.ahead} ↓${row.tree.behind}` : ''}
                  </span>
                  <span className="w-36 shrink-0">{row.tree.pr ? <PrMark pr={row.tree.pr} /> : null}</span>
                </>
              }
            />
          )
        }
        const tone = BRANCH_TONE[row.branch.kind]
        return (
          <GraphRow
            key={row.branch.key}
            first={!root && index === 0}
            last={last}
            dashed
            active={targetKey === row.branch.key}
            onClick={() => onSelect(targetKey === row.branch.key ? null : row.branch.key)}
            dot={<circle cx={36} cy={ROW_H / 2} r={5} className={cx(dotFill(tone.dot), 'opacity-80')} />}
            name={row.branch.remoteOnly ? `origin/${row.branch.name}` : row.branch.name}
            status={<span className={cx('text-xs', tone.text)}>{tone.label} · sans arbre</span>}
            card={row.branch.card}
            aside={
              <>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums text-ink-faint">{row.branch.merged ? '' : `↑${row.branch.ahead} ↓${row.branch.behind}`}</span>
                <span className="w-36 shrink-0">{row.branch.pr ? <PrMark pr={row.branch.pr} /> : null}</span>
              </>
            }
          />
        )
      })}
    </ol>
  )
}

/** La pastille SVG reprend la couleur du verdict, écrite en `bg-…` pour le HTML. */
function dotFill(bg: string): string {
  if (bg.includes('caution')) return 'fill-caution'
  if (bg.includes('critical')) return 'fill-critical'
  if (bg.includes('positive')) return 'fill-positive'
  if (bg.includes('accent')) return bg.includes('pulse') ? 'fill-accent animate-pulse' : 'fill-accent'
  if (bg.includes('sky')) return 'fill-sky-400'
  if (bg.includes('border')) return 'fill-canvas stroke-ink-faint'
  return 'fill-ink-soft'
}

function GraphRow({
  first,
  last,
  trunk = false,
  dashed = false,
  active,
  onClick,
  dot,
  name,
  status,
  card,
  aside,
}: {
  first: boolean
  last: boolean
  trunk?: boolean
  dashed?: boolean
  active: boolean
  onClick: () => void
  dot: ReactNode
  name: string
  status: ReactNode
  card?: { number: number; title: string; milestone: { number: number; title: string } | null } | null
  aside?: ReactNode
}) {
  const mid = ROW_H / 2
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={active ? 'Retirer le filtre' : 'Filtrer sur cet arbre'}
        className={cx('flex w-full items-center gap-3 rounded-lg pr-2 text-left transition-colors', active ? 'bg-accent-wash/50 ring-1 ring-accent/40' : 'hover:bg-surface')}
        style={{ height: ROW_H }}
      >
        <svg width={44} height={ROW_H} className="shrink-0 overflow-visible" aria-hidden>
          <path d={`M12 ${first ? mid : 0} V${last ? mid : ROW_H}`} className="stroke-line-strong" strokeWidth={2} fill="none" />
          {trunk ? null : (
            <path d={`M12 ${mid - 16} Q12 ${mid} 28 ${mid} H31`} className="stroke-line-strong" strokeWidth={2} strokeDasharray={dashed ? '3 3' : undefined} fill="none" />
          )}
          {dot}
        </svg>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className={cx('min-w-0 truncate font-mono text-[13px]', trunk ? 'font-semibold text-ink' : 'text-ink-soft')}>{name}</span>
            {status}
          </span>
          {card ? (
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
              <span className="min-w-0 truncate">#{card.number} {card.title}</span>
              {card.milestone ? <span className="shrink-0 rounded bg-surface-high px-1.5 py-px">Jalon #{card.milestone.number}</span> : null}
            </span>
          ) : null}
        </span>
        {aside}
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ Par état */

interface SessionCard {
  key: string
  title: string
  agent: AgentKind
  tree: TreeRow | null
  card: { number: number; title: string } | null
  milestone: number | null
  at: number | null
  to: string | null
}

export function StateBoard({
  travail,
  trees,
  inbox,
  projectId,
  onSelectTree,
}: {
  travail: Travail
  /** Les arbres que les filtres gardent : en démo, leurs sessions font les colonnes. */
  trees: TreeRow[]
  inbox: InboxItem[]
  projectId: string
  onSelectTree: (key: string) => void
}) {
  const { model, code, conversations } = travail
  const demo = code.demo
  const now = Date.now()

  const fromRow = (row: ActivityRow): SessionCard => {
    const conversation = row.entry.conversation
    return {
      key: conversation.id,
      title: conversation.title,
      agent: conversation.agent,
      tree: travail.treeOfRow(row),
      card: conversation.card ? { number: conversation.card.number, title: conversation.card.title } : null,
      milestone: model.milestoneOfRow(row)?.number ?? null,
      at: conversation.updatedAt,
      to: `/p/${projectId}/c/${conversation.id}`,
    }
  }
  const fromTree = (tree: TreeRow, session: TreeRow['sessions'][number]): SessionCard => ({
    key: session.id,
    title: session.title,
    agent: session.agent,
    tree,
    card: tree.card ? { number: tree.card.number, title: tree.card.title } : null,
    milestone: tree.card?.milestone?.number ?? null,
    at: tree.lastUsedAt,
    to: null,
  })

  const working: SessionCard[] = demo
    ? trees.flatMap((tree) => tree.sessions.filter((session) => session.status === 'running').map((session) => fromTree(tree, session)))
    : model.live.filter((row) => row.group === 'running').map(fromRow)

  const review: SessionCard[] = demo
    ? trees
        .filter((tree) => tree.verdict === 'review')
        .map((tree) => ({
          key: `review-${tree.key}`,
          title: tree.pr ? `PR #${tree.pr.number} à relire` : `${shortBranch(tree)} à relire`,
          agent: tree.sessions[0]?.agent ?? ('claude' as AgentKind),
          tree,
          card: tree.card ? { number: tree.card.number, title: tree.card.title } : null,
          milestone: tree.card?.milestone?.number ?? null,
          at: tree.lastUsedAt,
          to: null,
        }))
    : model.live.filter((row) => row.group === 'review').map(fromRow)

  // Terminées : les trois derniers jours. En vrai, les conversations du projet au repos qui
  // ont bougé ; en démo, les sessions de l'historique simulé.
  const since = now - 3 * DAY
  const liveIds = new Set(model.live.map((row) => row.entry.conversation.id))
  const done: SessionCard[] = demo
    ? model.entries
        .filter((entry: JournalEntryDto) => entry.kind === 'session' && entry.at >= since)
        .map((entry) => ({
          key: entry.id,
          title: entry.title,
          agent: (entry.source as AgentKind) ?? 'claude',
          tree: travail.treeOfEntry(entry),
          card: entry.cardNumber !== null ? { number: entry.cardNumber, title: '' } : null,
          milestone: model.milestoneOfEntry(entry)?.number ?? null,
          at: entry.at,
          to: null,
        }))
    : conversations
        .filter((conversation: ConversationDto) => !liveIds.has(conversation.id) && conversation.archivedAt === null && conversation.status === 'idle' && conversation.updatedAt >= since)
        .filter((conversation) => trees.some((tree) => (tree.root ? conversation.worktreeId === null : conversation.worktreeId === tree.id)))
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12)
        .map((conversation) => ({
          key: conversation.id,
          title: conversation.title,
          agent: conversation.agent,
          tree: trees.find((tree) => (tree.root ? conversation.worktreeId === null : conversation.worktreeId === tree.id)) ?? null,
          card: conversation.card ? { number: conversation.card.number, title: conversation.card.title } : null,
          milestone: null,
          at: conversation.updatedAt,
          to: `/p/${projectId}/c/${conversation.id}`,
        }))

  const waitingCount = inbox.length
  return (
    <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-4">
      <Column title="T’attend" count={waitingCount} dot="bg-caution">
        {waitingCount > 0 ? <AskInbox items={inbox} bare /> : <Empty>Rien ne t’attend.</Empty>}
      </Column>
      <Column title="Travaille" count={working.length} dot="bg-accent">
        {working.length > 0 ? working.map((card) => <Card key={card.key} card={card} tone="running" onSelectTree={onSelectTree} />) : <Empty>Aucune session au travail.</Empty>}
      </Column>
      <Column title="À relire" count={review.length} dot="bg-accent/60">
        {review.length > 0 ? review.map((card) => <Card key={card.key} card={card} tone="review" onSelectTree={onSelectTree} />) : <Empty>Rien à relire.</Empty>}
      </Column>
      <Column title="Terminées récemment" count={done.length} dot="bg-positive">
        {done.length > 0 ? done.map((card) => <Card key={card.key} card={card} tone="done" onSelectTree={onSelectTree} />) : <Empty>Rien ces trois derniers jours.</Empty>}
      </Column>
    </div>
  )
}

function Column({ title, count, dot, children }: { title: string; count: number; dot: string; children: ReactNode }) {
  return (
    <section className="flex min-w-[16rem] flex-col gap-2 rounded-xl bg-surface/40 p-2">
      <header className="flex items-center gap-2 px-1.5 pt-1">
        <span aria-hidden className={cx('size-2 rounded-full', dot)} />
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-xs tabular-nums text-ink-faint">{count}</span>
      </header>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-1.5 py-2 text-xs text-ink-faint">{children}</p>
}

function Card({ card, tone, onSelectTree }: { card: SessionCard; tone: 'running' | 'review' | 'done'; onSelectTree: (key: string) => void }) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className={cx('flex size-5 shrink-0 items-center justify-center rounded', tone === 'running' ? 'bg-accent/10 text-accent' : tone === 'review' ? 'bg-surface-high text-accent' : 'bg-surface-high text-ink-faint')}>
          <AgentIcon agent={card.agent} size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">{card.title}</span>
        {card.at ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">{elapsed(card.at)}</span> : null}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 pl-7 text-xs text-ink-faint">
        {card.tree ? (
          <span
            role="button"
            tabIndex={0}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onSelectTree(card.tree!.key)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSelectTree(card.tree!.key)
            }}
            className="inline-flex max-w-[10rem] items-center gap-1 rounded bg-sunken px-1.5 font-mono text-[11px] hover:text-ink"
            title="Filtrer sur cet arbre"
          >
            <span aria-hidden className={cx('size-1.5 shrink-0 rounded-full', VERDICT_TONE[card.tree.verdict].dot)} />
            <span className="truncate">{card.tree.root ? 'racine' : shortBranch(card.tree)}</span>
          </span>
        ) : null}
        {card.card ? <span className="min-w-0 truncate">#{card.card.number}{card.card.title ? ` ${card.card.title}` : ''}</span> : null}
        {card.milestone ? <span className="shrink-0 rounded bg-surface-high px-1.5 py-px">Jalon #{card.milestone}</span> : null}
      </span>
    </>
  )
  const shape = 'flex flex-col gap-1 rounded-lg bg-canvas px-2.5 py-2 ring-1 ring-line'
  return card.to ? <Link to={card.to} className={cx(shape, 'hover:ring-line-strong')}>{body}</Link> : <div className={shape}>{body}</div>
}

/* ------------------------------------------------------------------ Frise */

const KIND_DOT: Record<string, string> = {
  session: 'bg-accent',
  branch: 'bg-ink-soft',
  cardOpened: 'bg-sky-400',
  cardClosed: 'bg-positive',
  note: 'bg-caution',
  run: 'bg-accent',
  audit: 'bg-ink-faint',
}

export function Timeline({
  lanes,
  branches,
  from,
  conversations,
  demo,
  targetKey,
  onSelect,
}: {
  lanes: LaneData[]
  branches: BranchInfo[]
  from: number
  conversations: ConversationDto[]
  demo: boolean
  targetKey: string | null
  onSelect: (key: string | null) => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const now = Date.now()
  const span = Math.max(now - from, DAY)
  const x = (at: number) => `${Math.min(100, Math.max(0, ((at - from) / span) * 100))}%`
  const days = Math.round(span / DAY)
  const ticks = Array.from({ length: Math.min(days, 14) + 1 }, (_, index) => from + (index * span) / Math.min(days, 14))

  const barsOf = (tree: TreeRow): { key: string; start: number; end: number; agent: AgentKind; status: string; title: string }[] => {
    if (demo) {
      const end = tree.lastUsedAt ?? now
      return tree.sessions.map((session, index) => ({
        key: session.id,
        start: end - (1.5 + index * 0.4) * DAY,
        end: session.status === 'running' || session.status === 'awaiting_input' ? now : end,
        agent: session.agent,
        status: session.status,
        title: session.title,
      }))
    }
    return conversations
      .filter((conversation) => (tree.root ? conversation.worktreeId === null : conversation.worktreeId === tree.id) && conversation.updatedAt >= from && conversation.archivedAt === null)
      .slice(0, 8)
      .map((conversation) => ({
        key: conversation.id,
        start: Math.max(conversation.createdAt, from),
        end: conversation.status === 'running' || conversation.status === 'awaiting_input' ? now : conversation.updatedAt,
        agent: conversation.agent,
        status: conversation.status,
        title: conversation.title,
      }))
  }

  const label = 'w-48 shrink-0 md:w-56'
  return (
    <div className="flex flex-col">
      {/* L'axe. */}
      <div className="sticky top-0 z-10 flex border-b border-line bg-canvas/95 py-1.5 text-[11px] text-ink-faint backdrop-blur">
        <span className={label} />
        <div className="relative h-4 flex-1">
          {ticks.map((at, index) => (
            <span key={at} className="absolute -translate-x-1/2 tabular-nums" style={{ left: x(at) }}>
              {index === ticks.length - 1 ? '' : new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
            </span>
          ))}
          <span className="absolute right-0 font-medium text-accent">maintenant</span>
        </div>
      </div>

      <ol className="flex flex-col">
        {lanes.map((lane) => {
          const tone = VERDICT_TONE[lane.tree.verdict]
          const bars = barsOf(lane.tree)
          const active = targetKey === lane.tree.key
          return (
            <li key={lane.tree.key} className={cx('flex items-center border-b border-line/60', active && 'bg-accent-wash/30')}>
              <button type="button" onClick={() => onSelect(active ? null : lane.tree.key)} className={cx(label, 'flex min-w-0 items-center gap-2 py-2.5 pr-3 text-left')} title={lane.tree.reason}>
                <span aria-hidden className={cx('size-2 shrink-0 rounded-full', tone.dot)} />
                <span className={cx('min-w-0 truncate font-mono text-[12px]', lane.tree.root && 'font-semibold')}>{lane.tree.root ? (lane.tree.branch ?? lane.tree.name) : shortBranch(lane.tree)}</span>
              </button>
              <div className="relative h-10 flex-1">
                {ticks.map((at) => (
                  <span key={at} aria-hidden className="absolute top-0 bottom-0 w-px bg-line/50" style={{ left: x(at) }} />
                ))}
                <span aria-hidden className="absolute top-0 bottom-0 right-0 w-0.5 bg-accent/60" />
                {bars.map((bar, index) => (
                  <span
                    key={bar.key}
                    title={`${bar.title} · ${bar.status === 'running' ? 'tourne' : bar.status === 'awaiting_input' ? 't’attend' : 'terminée'}`}
                    onMouseEnter={() => setHover(bar.key)}
                    onMouseLeave={() => setHover(null)}
                    className={cx(
                      'absolute flex h-4 items-center gap-1 overflow-hidden rounded px-1 text-[10px]',
                      bar.status === 'running' ? 'bg-accent/25 text-accent' : bar.status === 'awaiting_input' ? 'bg-caution/25 text-caution' : 'bg-surface-high text-ink-faint',
                      hover === bar.key && 'ring-1 ring-accent',
                    )}
                    style={{ left: x(bar.start), width: `max(1.25rem, calc(${x(bar.end)} - ${x(bar.start)}))`, top: 4 + (index % 2) * 18 }}
                  >
                    <AgentIcon agent={bar.agent} size={10} />
                  </span>
                ))}
                {lane.entries
                  .filter((entry) => entry.at >= from)
                  .map((entry) => (
                    <span
                      key={entry.id}
                      title={`${entry.title} · ${elapsed(entry.at)}`}
                      className={cx('absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-canvas', KIND_DOT[entry.kind] ?? 'bg-ink-faint')}
                      style={{ left: x(entry.at) }}
                    />
                  ))}
              </div>
            </li>
          )
        })}
        {branches.map((branch) => {
          const tone = BRANCH_TONE[branch.kind]
          const active = targetKey === branch.key
          return (
            <li key={branch.key} className={cx('flex items-center border-b border-line/60', active && 'bg-accent-wash/30')}>
              <button type="button" onClick={() => onSelect(active ? null : branch.key)} className={cx(label, 'flex min-w-0 items-center gap-2 py-2.5 pr-3 text-left')} title={tone.label}>
                <span aria-hidden className={cx('size-2 shrink-0 rounded-full opacity-80', tone.dot)} />
                <span className="min-w-0 truncate font-mono text-[12px] text-ink-soft">{branch.name}</span>
              </button>
              <div className="relative h-8 flex-1">
                {ticks.map((at) => (
                  <span key={at} aria-hidden className="absolute top-0 bottom-0 w-px bg-line/50" style={{ left: x(at) }} />
                ))}
                {branch.commits
                  .filter((commit) => commit.at >= from)
                  .map((commit) => (
                    <span key={commit.hash} title={`${commit.title} · ${elapsed(commit.at)}`} className="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-ink-soft" style={{ left: x(commit.at) }} />
                  ))}
                {branch.lastCommitAt < from ? <span className="absolute top-1/2 left-1 -translate-y-1/2 text-[10px] text-ink-faint">dernier commit {elapsed(branch.lastCommitAt)}</span> : null}
              </div>
            </li>
          )
        })}
      </ol>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-[11px] text-ink-faint">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-accent/25" /> session qui tourne</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-caution/25" /> t’attend</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-4 rounded bg-surface-high" /> terminée</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-positive" /> carte fermée</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-ink-soft" /> branche, PR, fusion</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 bg-ink-soft" /> commit</span>
        {demo ? <span className="text-fuchsia-600 dark:text-fuchsia-300">durées simulées</span> : null}
      </p>
    </div>
  )
}
