/* PROTOTYPE — jetable (branche proto/page-projet). Ne pas fusionner dans main.
 *
 * L'onglet *Projet* du panneau d'une conversation, refait sur `PanelTabFrame` (Agent et
 * Actions sont les références) : pas de carte bordée, des groupes en petites capitales,
 * des lignes de 36 px, le détail d'une carte **en pile** dans le panneau (« ‹ Projet »),
 * jamais un second tiroir.
 *
 * - *Cette session* : ce que fait la session, sa carte (faits, gestes), ses sous-tâches,
 *   ses dépendances, ses notes, puis sa branche (worktree, ↑↓, non commités) et sa PR.
 *   Sans carte : une ligne, la suggestion, Rattacher / Créer.
 * - *Projet* : ce qui t'attend (la liste unique), le jalon en cours, les autres sessions
 *   actives, les cartes prêtes à partir, et des liens vers les onglets du projet.
 *
 * **Les gestes qui écriraient sont simulés** : cocher une sous-tâche, changer de colonne,
 * détacher, rattacher, créer une carte. Chacun dit « Simulé : … » dans la bande de retour.
 */
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDot,
  Circle,
  FileDiff,
  Flag,
  GitBranch,
  GitPullRequest,
  Layers,
  Link2,
  Loader,
  MessageSquareText,
  Play,
  Plus,
  RotateCw,
  SquareKanban,
  Unlink,
} from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CARD_COLUMNS, type CardColumn, type CardDto, type CardNoteDto } from '@solera/protocol'
import { Menu, MenuItem, cx } from '@solera/ui'
import { useCardNotes, useCards } from '../../../lib/cards'
import { useAllConversations } from '../../../lib/conversations'
import { relativeDate, daysUntil, elapsed } from '../../../lib/dates'
import { setPanelTab } from '../../../lib/panel'
import { suggestCard, visibleAgentPlan, type AgentPlan as AgentPlanData } from '../../../lib/project-pane'
import { useProjects } from '../../../lib/projects'
import { pullRequestFor, usePullRequests } from '../../../lib/pull-requests'
import { useWorktreeStatuses } from '../../../lib/worktrees'
import { useLiveConversations } from '../../../lib/activity'
import { AgentIcon } from '../../AgentIcon'
import { CardChooser } from '../../board/CardChooser'
import { ColumnDot } from '../../board/ColumnDot'
import { columnLabel } from '../../board/columns'
import type { ProjectPaneSession } from '../../panel/ProjectPane'
import { AskInbox } from '../AskInbox'
import { toolbarButtonClass } from '../ViewSwitch'
import { useV2Data } from '../../../routes/prototype-overview/v2/data'
import { useProtoData } from '../../../routes/prototype-milestones/model'
import { PANEL_GESTURE, PANEL_ROW, PanelEmpty, PanelGroup, PanelIcon, PanelNotice, PanelStackHeader, PanelToolbar } from './PanelTabFrame'

export type { ProjectPaneSession }

type Simulate = (text: string) => void

export const ProtoProjectPane = memo(function ProtoProjectPane({
  projectId,
  conversationId,
  session,
}: {
  projectId: string
  conversationId: string
  session: ProjectPaneSession
}) {
  const [segment, setSegment] = useState<'session' | 'project'>('session')
  const [stack, setStack] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const simulate: Simulate = (text) => setNotice(`Simulé : ${text}`)

  const proto = useProtoData(projectId)
  const board = useCards(proto.demo ? undefined : projectId)
  const cards = proto.cards
  // En démo, la session réelle n'a pas de carte du jeu : on lui prête la première carte en
  // cours qui a des sous-tâches, pour que l'onglet se juge rempli.
  const current = useMemo(() => {
    if (proto.demo) {
      return cards.find((card) => card.column === 'in_progress' && card.children.length === 0 && /- \[[ x]\]/.test(card.description))
        ?? cards.find((card) => card.column === 'in_progress' && card.children.length === 0)
        ?? null
    }
    return session.card ? cards.find((card) => card.id === session.card?.id) ?? null : null
  }, [proto.demo, cards, session.card])

  const stacked = stack !== null ? cards.find((card) => card.number === stack) ?? null : null

  if (stacked) {
    return (
      <div className="flex min-h-0 flex-1 flex-col pb-safe">
        <PanelStackHeader
          back="Projet"
          onBack={() => setStack(null)}
          title={<><span className="tabular-nums text-ink-faint">#{stacked.number}</span> {stacked.title}</>}
          meta={columnLabel(stacked.column)}
        />
        {notice ? <PanelNotice onClose={() => setNotice(null)}>{notice}</PanelNotice> : null}
        <div className="min-h-0 flex-1 overflow-y-auto pb-3">
          <CardBody key={stacked.id} card={stacked} projectId={projectId} cards={cards} demo={proto.demo} onOpen={setStack} simulate={simulate} full />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-safe">
      <PanelToolbar title="Projet" meta={current ? `#${current.number}` : undefined}>
        <span role="radiogroup" aria-label="Vue" className="flex items-center gap-1">
          <button type="button" role="radio" aria-checked={segment === 'session'} onClick={() => setSegment('session')} className={toolbarButtonClass(segment === 'session')}>
            {session.running ? <Live /> : null}
            Cette session
          </button>
          <button type="button" role="radio" aria-checked={segment === 'project'} onClick={() => setSegment('project')} className={toolbarButtonClass(segment === 'project')}>
            Projet
          </button>
        </span>
        {proto.demo ? <span className="ml-1 rounded border border-dashed border-fuchsia-500/60 px-1 text-meta text-fuchsia-700 dark:text-fuchsia-300">démo</span> : null}
      </PanelToolbar>
      {notice ? <PanelNotice onClose={() => setNotice(null)}>{notice}</PanelNotice> : null}
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {segment === 'session' ? (
          <SessionView
            projectId={projectId}
            conversationId={conversationId}
            session={session}
            cards={cards}
            current={current}
            demo={proto.demo}
            loading={!proto.demo && board.isPending}
            failed={!proto.demo && board.isError}
            retry={() => void board.refetch()}
            onOpen={setStack}
            simulate={simulate}
          />
        ) : (
          <ProjectView projectId={projectId} conversationId={conversationId} cards={cards} current={current} demo={proto.demo} onOpen={setStack} simulate={simulate} />
        )}
      </div>
    </div>
  )
})

function Live() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inset-0 animate-ping rounded-full bg-accent/50 motion-reduce:animate-none" />
      <span className="relative size-2 rounded-full bg-accent" />
    </span>
  )
}

/* -------------------------------------------------------------- la session ---- */

function SessionView({ projectId, conversationId, session, cards, current, demo, loading, failed, retry, onOpen, simulate }: {
  projectId: string
  conversationId: string
  session: ProjectPaneSession
  cards: CardDto[]
  current: CardDto | null
  demo: boolean
  loading: boolean
  failed: boolean
  retry: () => void
  onOpen: (number: number) => void
  simulate: Simulate
}) {
  const plan = useMemo(() => visibleAgentPlan(session.items), [session.items])

  return (
    <>
      <ActivityRow session={session} />

      {loading ? (
        <PanelEmpty>Lecture du tableau…</PanelEmpty>
      ) : failed ? (
        <PanelEmpty action={<button type="button" onClick={retry} className={PANEL_GESTURE}><RotateCw size={13} /> Réessayer</button>}>
          Le tableau n'a pas pu être lu.
        </PanelEmpty>
      ) : current ? (
        <CardBody card={current} projectId={projectId} cards={cards} demo={demo} onOpen={onOpen} simulate={simulate} session />
      ) : (
        <NoCard projectId={projectId} session={session} cards={cards} simulate={simulate} />
      )}

      {plan ? <AgentPlan plan={plan} /> : null}

      <BranchBlock projectId={projectId} conversationId={conversationId} demo={demo} />
    </>
  )
}

/** Ce que fait la session, en une ligne : l'état, le geste, le modèle et sa fenêtre. */
function ActivityRow({ session }: { session: ProjectPaneSession }) {
  const details = [session.model, session.contextRatio !== null ? `contexte ${Math.round(session.contextRatio * 100)} %` : null]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="flex h-11 items-center gap-2.5 border-b border-line px-3 md:h-9" role="status">
      {session.running
        ? <Loader size={13} className="shrink-0 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
        : <span aria-hidden className="ml-1 size-2 shrink-0 rounded-full bg-line-strong" />}
      <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
        <span className="font-medium text-ink">{session.running ? 'Travaille' : 'Au repos'}</span>
        {session.running && session.activity ? <> · {session.activity}</> : null}
      </span>
      {details ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">{details}</span> : null}
    </div>
  )
}

/** Sans carte : une ligne, la suggestion, et de quoi en rattacher ou en créer une. */
function NoCard({ projectId, session, cards, simulate }: {
  projectId: string
  session: ProjectPaneSession
  cards: CardDto[]
  simulate: Simulate
}) {
  const suggestion = useMemo(() => suggestCard(session.items, cards), [session.items, cards])
  return (
    <section>
      <PanelGroup title="Carte" />
      <PanelEmpty
        action={
          <span className="flex items-center gap-1">
            <CardChooser
              projectId={projectId}
              label="Rattacher une carte"
              excludeIds={suggestion ? [suggestion.card.id] : []}
              onPick={(picked) => simulate(`rattacherait la session à #${picked.number}`)}
              trigger={<button type="button" className={toolbarButtonClass(false)}><Link2 size={13} /> Rattacher</button>}
            />
            <button type="button" onClick={() => simulate(`créerait « ${session.title} » en cours, rattachée à la session`)} className={toolbarButtonClass(false)}>
              <Plus size={13} /> Créer depuis la session
            </button>
          </span>
        }
      >
        Pas de carte.
      </PanelEmpty>
      {suggestion ? (
        <div className={PANEL_ROW}>
          <PanelIcon icon={<SquareKanban size={14} />} dot="bg-accent" />
          <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{suggestion.card.number}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{suggestion.card.title}</span>
          <span className="hidden shrink-0 text-xs text-ink-faint @min-[22rem]:inline">citée {suggestion.mentions}×</span>
          <button type="button" onClick={() => simulate(`rattacherait la session à #${suggestion.card.number}`)} className={cx(PANEL_GESTURE, 'text-accent')}>
            Rattacher #{suggestion.card.number}
          </button>
        </div>
      ) : null}
    </section>
  )
}

/** Le plan que l'agent s'est donné, en lignes, à côté de ce que la carte demande. */
function AgentPlan({ plan }: { plan: AgentPlanData }) {
  const done = plan.steps.filter((step) => step.status === 'completed').length
  return (
    <section>
      <PanelGroup
        title="Plan de l'agent"
        count={undefined}
        aside={<span className="tabular-nums text-ink-faint">{plan.previousTurn ? 'tour précédent · ' : ''}{done}/{plan.steps.length}</span>}
      />
      <ul>
        {plan.steps.map((step, index) => {
          const Icon = step.status === 'completed' ? CircleCheck : step.status === 'in_progress' ? CircleDot : Circle
          return (
            <li key={index} className="flex min-h-9 items-start gap-2.5 px-3 py-1.5">
              <Icon size={14} className={cx('mt-0.5 shrink-0', step.status === 'completed' ? 'text-positive' : step.status === 'in_progress' ? 'text-accent' : 'text-ink-faint')} />
              <span className={cx('min-w-0 text-sm', step.status === 'completed' ? 'text-ink-faint line-through' : 'text-ink')}>{step.text}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** La branche de la session : son worktree, son écart à la base, et sa PR. */
function BranchBlock({ projectId, conversationId, demo }: { projectId: string; conversationId: string; demo: boolean }) {
  const { data: statuses } = useWorktreeStatuses(demo ? undefined : projectId)
  const { data: prs } = usePullRequests(demo ? undefined : projectId)
  const tree = demo
    ? { branch: 'feat/905-vue-horizon', ahead: 4, behind: 3, modified: 2, untracked: 0, conflicts: false, name: 'feat-905' }
    : statuses?.worktrees.find((entry) => entry.conversations.some((link) => link.id === conversationId)) ?? null
  const pr = demo
    ? { number: 214, title: 'Horizon des jalons', url: '#', state: 'checks' as const, checks: { passed: 6, pending: 2, failed: [] as string[] } }
    : tree ? pullRequestFor(prs, tree.branch) : null

  if (!tree) {
    return (
      <section>
        <PanelGroup title="Branche" />
        <PanelEmpty action={<button type="button" onClick={() => setPanelTab('git')} className={PANEL_GESTURE}><FileDiff size={13} /> Git</button>}>
          À la racine du projet.
        </PanelEmpty>
      </section>
    )
  }
  const dirty = tree.modified + tree.untracked
  const prWord = { draft: 'brouillon', checks: 'CI en cours', failing: 'CI rouge', ready: 'prête', merged: 'fusionnée' } as const
  const prDot = { draft: 'bg-line-strong', checks: 'bg-accent', failing: 'bg-critical', ready: 'bg-positive', merged: 'bg-ink-faint' } as const
  return (
    <section>
      <PanelGroup title="Branche" />
      <button type="button" onClick={() => setPanelTab('git')} className={PANEL_ROW} title="Voir dans l'onglet Git">
        <PanelIcon icon={<GitBranch size={14} />} dot={tree.conflicts ? 'bg-critical' : dirty > 0 ? 'bg-caution' : undefined} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{tree.branch ?? tree.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-ink-faint">
          {tree.ahead > 0 ? `↑${tree.ahead} ` : ''}{tree.behind > 0 ? `↓${tree.behind} ` : ''}
          {dirty > 0 ? `· ${dirty} non commité${dirty > 1 ? 's' : ''}` : ''}
          {tree.conflicts ? ' · conflit' : ''}
        </span>
        <span className="shrink-0 text-xs text-ink-faint opacity-0 group-hover:opacity-100">Git →</span>
      </button>
      {pr ? (
        <a href={pr.url} target="_blank" rel="noreferrer" className={PANEL_ROW}>
          <PanelIcon icon={<GitPullRequest size={14} />} dot={prDot[pr.state]} />
          <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{pr.number}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{pr.title}</span>
          <span className="shrink-0 text-xs text-ink-faint">
            {prWord[pr.state]}
            {pr.checks.pending > 0 || pr.checks.passed > 0 ? ` · ${pr.checks.passed}/${pr.checks.passed + pr.checks.pending + pr.checks.failed.length}` : ''}
          </span>
          <ArrowUpRight size={13} className="shrink-0 text-ink-faint opacity-0 group-hover:opacity-100" />
        </a>
      ) : (
        <div className={cx(PANEL_ROW, 'cursor-default hover:bg-transparent')}>
          <PanelIcon icon={<GitPullRequest size={14} />} />
          <span className="text-sm text-ink-faint">Pas de PR pour cette branche.</span>
        </div>
      )}
    </section>
  )
}

/* ---------------------------------------------------------------- une carte ---- */

interface Subtask {
  line: number
  text: string
  done: boolean
}

function subtasksOf(description: string): Subtask[] {
  return description.split('\n').flatMap((raw, line) => {
    const match = raw.match(/^\s*[-*] \[( |x|X)\] (.+)$/)
    return match ? [{ line, text: match[2]!.trim(), done: match[1] !== ' ' }] : []
  })
}

/** Ce qui reste de la description une fois les cases retirées : le texte de l'énoncé. */
function bodyOf(description: string): string {
  return description
    .split('\n')
    .filter((raw) => !/^\s*[-*] \[( |x|X)\] /.test(raw))
    .join('\n')
    .trim()
}

/**
 * La carte, à plat : ses faits et ses gestes, puis ses sous-tâches, ses dépendances, ses
 * sessions, ses notes. Sert à la carte de la session comme au détail empilé d'une autre.
 */
function CardBody({ card, projectId, cards, demo, onOpen, simulate, session = false, full = false }: {
  card: CardDto
  projectId: string
  cards: CardDto[]
  demo: boolean
  onOpen: (number: number) => void
  simulate: Simulate
  /** La carte de la session : gestes Détacher et Ouvrir la fiche. */
  session?: boolean
  /** Le détail empilé : description complète et toutes les notes. */
  full?: boolean
}) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [checked, setChecked] = useState<ReadonlyMap<number, boolean>>(() => new Map())
  const parent = card.parent ? cards.find((entry) => entry.id === card.parent?.id) ?? null : null
  const late = card.dueAt !== null && card.column !== 'done' && daysUntil(card.dueAt) < 0
  const subtasks = subtasksOf(card.description).map((task) => ({ ...task, done: checked.get(task.line) ?? task.done }))
  const doneCount = subtasks.filter((task) => task.done).length
  const body = bodyOf(card.description)
  const demoSuffix = params.get('demo') === '1' ? '?demo=1' : ''

  return (
    <>
      {/* L'en-tête de la carte : #, titre, colonne, jalon, échéance, puis les gestes. */}
      <section className="flex flex-col gap-1.5 border-b border-line px-3 py-2.5">
        {session ? (
          <button type="button" onClick={() => onOpen(card.number)} className="flex min-w-0 items-baseline gap-1.5 text-left hover:text-accent">
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{card.number}</span>
            <span className="min-w-0 text-sm font-medium text-ink">{card.title}</span>
          </button>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span className="inline-flex items-center gap-1.5"><ColumnDot column={card.column} />{columnLabel(card.column)}</span>
          {parent ? (
            <button type="button" onClick={() => navigate(`/p/${projectId}/timeline/${parent.number}${demoSuffix}`)} className="inline-flex min-w-0 items-center gap-1 hover:text-ink hover:underline">
              <Flag size={12} className="shrink-0 text-ink-faint" />
              <span className="truncate">#{parent.number} {parent.title}</span>
            </button>
          ) : null}
          {card.dueAt !== null ? (
            <span className={cx(late ? 'text-critical' : 'text-ink-faint')}>échéance {relativeDate(card.dueAt)}</span>
          ) : null}
          {card.toClarifySince !== null ? <span className="text-caution">à préciser</span> : null}
        </div>
        <div className="-ml-2.5 flex flex-wrap items-center gap-0.5">
          {session ? (
            <button type="button" onClick={() => onOpen(card.number)} className={PANEL_GESTURE}><SquareKanban size={13} /> Ouvrir la fiche</button>
          ) : (
            <button type="button" onClick={() => navigate(`/p/${projectId}/board?fiche=${card.number}${demo ? '&demo=1' : ''}`)} className={PANEL_GESTURE}><SquareKanban size={13} /> Dans le tableau</button>
          )}
          <Menu
            trigger={<button type="button" className={PANEL_GESTURE}>Colonne <ChevronDown size={12} /></button>}
          >
            {CARD_COLUMNS.map((column: CardColumn) => (
              <MenuItem key={column} icon={card.column === column ? <Check size={13} /> : <span className="size-[13px]" />} onSelect={() => simulate(`#${card.number} passerait en « ${columnLabel(column)} »`)}>
                {columnLabel(column)}
              </MenuItem>
            ))}
          </Menu>
          {session ? (
            <button type="button" onClick={() => simulate(`détacherait #${card.number} de cette session`)} className={PANEL_GESTURE}><Unlink size={13} /> Détacher</button>
          ) : null}
        </div>
      </section>

      {subtasks.length > 0 ? (
        <section>
          <PanelGroup title="Sous-tâches" aside={<span className="tabular-nums text-ink-faint">{doneCount}/{subtasks.length}</span>} />
          <div className="mx-3 mb-1 h-1 overflow-hidden rounded-full bg-surface-high">
            <div className="h-full rounded-full bg-positive transition-[width]" style={{ width: `${(doneCount / subtasks.length) * 100}%` }} />
          </div>
          <ul>
            {subtasks.map((task) => (
              <li key={task.line}>
                <label className="flex min-h-9 cursor-pointer items-start gap-2.5 px-3 py-1.5 hover:bg-surface-high/50">
                  <input
                    type="checkbox"
                    checked={task.done}
                    onChange={() => {
                      setChecked((previous) => new Map(previous).set(task.line, !task.done))
                      simulate(`${task.done ? 'décocherait' : 'cocherait'} « ${task.text} » sur #${card.number}`)
                    }}
                    className="mt-0.5 shrink-0 accent-[var(--color-accent)]"
                  />
                  <span className={cx('min-w-0 text-sm', task.done ? 'text-ink-faint line-through' : 'text-ink')}>{task.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Dependencies card={card} cards={cards} onOpen={onOpen} />

      <CardSessions card={card} projectId={projectId} demo={demo} />

      {full && body ? (
        <section>
          <PanelGroup title="Description" />
          <p className="px-3 pb-2 text-sm whitespace-pre-line text-ink-soft">{body}</p>
        </section>
      ) : null}

      <Notes card={card} demo={demo} full={full} onOpen={() => onOpen(card.number)} />
    </>
  )
}

function Dependencies({ card, cards, onOpen }: { card: CardDto; cards: CardDto[]; onOpen: (number: number) => void }) {
  const rows = [
    ...card.blockedBy.map((link) => ({ link, relation: 'bloquée par' })),
    ...card.blocks.map((link) => ({ link, relation: 'bloque' })),
  ]
  if (rows.length === 0) return null
  return (
    <section>
      <PanelGroup title="Dépendances" count={rows.length} />
      <ul>
        {rows.map(({ link, relation }) => {
          const target = cards.find((entry) => entry.id === link.id)
          const closed = link.column === 'done' || link.column === 'abandoned'
          return (
            <li key={`${relation}-${link.id}`}>
              <button type="button" onClick={() => onOpen(link.number)} disabled={!target} className={PANEL_ROW}>
                <span className="w-20 shrink-0 text-xs text-ink-faint">{relation}</span>
                <ColumnDot column={link.column} />
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{link.number}</span>
                <span className={cx('min-w-0 flex-1 truncate text-sm', closed ? 'text-ink-faint line-through' : 'text-ink')}>{link.title}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Les sessions de la carte : une ligne chacune, clic → la session. */
function CardSessions({ card, projectId, demo }: { card: CardDto; projectId: string; demo: boolean }) {
  const navigate = useNavigate()
  const sessions = card.conversations.filter((entry) => entry.archivedAt === null)
  if (sessions.length === 0) return null
  const word = (status: string) =>
    status === 'running' ? 'travaille' : status === 'awaiting_input' ? 't’attend' : status === 'error' ? 'en erreur' : 'au repos'
  const dot = (status: string) =>
    status === 'running' ? 'bg-accent' : status === 'awaiting_input' ? 'bg-caution' : status === 'error' ? 'bg-critical' : undefined
  return (
    <section>
      <PanelGroup title="Sessions" count={sessions.length} />
      <ul>
        {sessions.map((entry) => (
          <li key={entry.id}>
            <button type="button" onClick={() => navigate(`/p/${projectId}/c/${entry.id}${demo ? '?demo=1' : ''}`)} className={PANEL_ROW}>
              <PanelIcon icon={<AgentIcon agent={entry.agent} size={14} decorative />} dot={dot(entry.status)} />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.title}</span>
              <span className={cx('shrink-0 text-xs', entry.status === 'awaiting_input' ? 'text-caution' : 'text-ink-faint')}>{word(entry.status)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const DEMO_NOTES: CardNoteDto[] = [
  { id: 'n1', body: 'Le scroll-spy prend maintenant la dernière sous-catégorie visible en bas de page.', createdAt: Date.now() - 40 * 60_000, author: { kind: 'agent', agent: 'claude', conversationId: null, conversationTitle: 'Repenser la page projet' } },
  { id: 'n2', body: 'Décidé avec Tim : pas de second tiroir, le détail s’empile dans le panneau.', createdAt: Date.now() - 3 * 3_600_000, author: { kind: 'user', name: 'Tim' } },
  { id: 'n3', body: 'Les cartes ajoutées après le lancement entrent dans la file (adoptNewChildren).', createdAt: Date.now() - 26 * 3_600_000, author: { kind: 'agent', agent: 'codex', conversationId: null, conversationTitle: 'Pilotage des jalons' } },
  { id: 'n4', body: 'Première version du Gantt : barres de la création à l’échéance.', createdAt: Date.now() - 3 * 86_400_000, author: { kind: 'agent', agent: 'claude', conversationId: null, conversationTitle: 'Proto des jalons' } },
]

function Notes({ card, demo, full, onOpen }: { card: CardDto; demo: boolean; full: boolean; onOpen: () => void }) {
  const { data } = useCardNotes(demo ? undefined : card.id)
  const [all, setAll] = useState(full)
  const notes = [...(demo ? DEMO_NOTES : data ?? [])].sort((a, b) => b.createdAt - a.createdAt)
  if (notes.length === 0) return null
  const shown = all ? notes : notes.slice(0, 3)
  return (
    <section>
      <PanelGroup
        title="Notes"
        count={notes.length}
        aside={notes.length > 3 && !all ? (
          <button type="button" onClick={() => (full ? setAll(true) : onOpen())} className="text-xs text-ink-faint hover:text-ink">Tout voir</button>
        ) : undefined}
      />
      <ul>
        {shown.map((note) => (
          <li key={note.id} className="flex items-start gap-2.5 px-3 py-1.5">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-ink-faint">
              {note.author.kind === 'agent' ? <AgentIcon agent={note.author.agent} size={14} decorative /> : <MessageSquareText size={14} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={cx('text-sm text-ink', !all && 'line-clamp-2')}>{note.body}</span>
              <span className="text-xs text-ink-faint">
                {note.author.kind === 'agent' ? (note.author.conversationTitle || 'agent') : note.author.name} · {elapsed(note.createdAt)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------------------------------------------------------------- le projet ---- */

function ProjectView({ projectId, conversationId, cards, current, demo, onOpen, simulate }: {
  projectId: string
  conversationId: string
  cards: CardDto[]
  current: CardDto | null
  demo: boolean
  onOpen: (number: number) => void
  simulate: Simulate
}) {
  const navigate = useNavigate()
  const { data: projects } = useProjects()
  const project = projects?.find((entry) => entry.id === projectId)
  const suffix = demo ? '?demo=1' : ''

  return (
    <>
      {project ? <ProjectInbox projectId={projectId} project={project} /> : null}
      {project ? <CurrentMilestone projectId={projectId} project={project} current={current} suffix={suffix} /> : null}
      <OtherSessions projectId={projectId} conversationId={conversationId} cards={cards} demo={demo} />
      <ReadyCards projectId={projectId} cards={cards} demo={demo} onOpen={onOpen} simulate={simulate} />

      <div className="mt-2 flex flex-wrap items-center gap-0.5 border-t border-line px-1.5 pt-1.5">
        <button type="button" onClick={() => navigate(`/p/${projectId}/board${suffix}`)} className={PANEL_GESTURE}><SquareKanban size={13} /> Tableau</button>
        <button type="button" onClick={() => navigate(`/p/${projectId}/timeline${suffix}`)} className={PANEL_GESTURE}><Flag size={13} /> Jalons</button>
        <button type="button" onClick={() => navigate(`/p/${projectId}/travail${suffix}`)} className={PANEL_GESTURE}><Layers size={13} /> Travail</button>
      </div>
    </>
  )
}

/** « Ce qui t'attend » du projet : la liste unique, la même que l'Aperçu. */
function ProjectInbox({ projectId, project }: { projectId: string; project: NonNullable<ReturnType<typeof useProjects>['data']>[number] }) {
  const data = useV2Data(projectId, project)
  return (
    <section>
      <PanelGroup title="Ce qui t'attend" count={data.inbox.length} />
      {data.inbox.length === 0 ? (
        <PanelEmpty>Rien ne t'attend.</PanelEmpty>
      ) : (
        <div className="px-1.5">
          <AskInbox items={data.inbox} bare />
        </div>
      )}
    </section>
  )
}

function CurrentMilestone({ projectId, project, current, suffix }: {
  projectId: string
  project: NonNullable<ReturnType<typeof useProjects>['data']>[number]
  current: CardDto | null
  suffix: string
}) {
  const navigate = useNavigate()
  const data = useV2Data(projectId, project)
  const milestone = data.current
  if (!milestone) {
    return (
      <section>
        <PanelGroup title="Jalon en cours" />
        <PanelEmpty>Aucun jalon en cours.</PanelEmpty>
      </section>
    )
  }
  const { entry } = milestone
  const total = entry.cards.length
  const wave = milestone.waves.find((candidate) => candidate.open > 0) ?? null
  const inIt = current ? entry.cards.some((card) => card.id === current.id) : false
  return (
    <section>
      <PanelGroup title="Jalon en cours" aside={<span className="tabular-nums text-ink-faint">{entry.done}/{total}</span>} />
      <button type="button" onClick={() => navigate(`/p/${projectId}/timeline/${entry.card.number}${suffix}`)} className={PANEL_ROW}>
        <PanelIcon icon={<Flag size={14} />} dot={entry.maturity === 'launched' ? 'bg-accent' : undefined} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.card.title}</span>
        <ArrowUpRight size={13} className="shrink-0 text-ink-faint opacity-0 group-hover:opacity-100" />
      </button>
      <div className="mx-3 mb-1 h-1 overflow-hidden rounded-full bg-surface-high">
        <div className="h-full rounded-full bg-accent" style={{ width: `${milestone.progress * 100}%` }} />
      </div>
      <p className="px-3 pb-1.5 text-xs text-ink-faint">
        {wave ? `Vague ${wave.index + 1} · ${wave.cards.length - wave.open}/${wave.cards.length}` : 'Toutes les vagues sont passées'}
        {current ? (inIt ? ` · cette session y travaille (#${current.number})` : ' · cette session n’en fait pas partie') : ''}
      </p>
    </section>
  )
}

/** Les autres sessions actives du projet : une ligne chacune, clic → la session. */
function OtherSessions({ projectId, conversationId, cards, demo }: { projectId: string; conversationId: string; cards: CardDto[]; demo: boolean }) {
  const navigate = useNavigate()
  const { data: conversations } = useAllConversations()
  const mine = useMemo(
    () => (conversations ?? []).filter((entry) => entry.projectId === projectId && entry.id !== conversationId && entry.archivedAt === null),
    [conversations, projectId, conversationId],
  )
  const live = useLiveConversations(mine)
  const rows = demo
    ? cards.flatMap((card) =>
        card.conversations
          .filter((entry) => entry.status === 'running' || entry.status === 'awaiting_input')
          .map((entry) => ({ id: entry.id, title: entry.title, agent: entry.agent, awaiting: entry.status === 'awaiting_input', card: card.number })),
      )
    : live
        .filter((entry) => entry.running || entry.awaiting)
        .map((entry) => ({
          id: entry.conversation.id,
          title: entry.conversation.title,
          agent: entry.conversation.agent,
          awaiting: entry.awaiting,
          card: entry.conversation.card?.number ?? null,
        }))
  const sorted = [...rows].sort((a, b) => Number(b.awaiting) - Number(a.awaiting))
  return (
    <section>
      <PanelGroup title="Autres sessions actives" count={sorted.length} />
      {sorted.length === 0 ? (
        <PanelEmpty>Aucune autre session ne tourne.</PanelEmpty>
      ) : (
        <ul>
          {sorted.slice(0, 6).map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => navigate(`/p/${projectId}/c/${row.id}${demo ? '?demo=1' : ''}`)} className={PANEL_ROW}>
                <PanelIcon icon={<AgentIcon agent={row.agent} size={14} decorative />} dot={row.awaiting ? 'bg-caution' : 'bg-accent'} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{row.title}</span>
                {row.card !== null ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{row.card}</span> : null}
                <span className={cx('shrink-0 text-xs', row.awaiting ? 'text-caution' : 'text-ink-faint')}>{row.awaiting ? 't’attend' : 'travaille'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Les cartes prêtes à partir : à faire, acceptées, rien à préciser, aucun bloqueur
 * ouvert, aucune session vivante. Trois, dans l'ordre du tableau.
 */
function ReadyCards({ projectId, cards, demo, onOpen, simulate }: {
  projectId: string
  cards: CardDto[]
  demo: boolean
  onOpen: (number: number) => void
  simulate: Simulate
}) {
  const navigate = useNavigate()
  const closed = new Set(cards.filter((card) => card.column === 'done' || card.column === 'abandoned').map((card) => card.id))
  const ready = cards
    .filter(
      (card) =>
        card.children.length === 0 &&
        card.column === 'todo' &&
        card.acceptedAt !== null &&
        card.toClarifySince === null &&
        card.blockedBy.every((link) => closed.has(link.id) || link.column === 'done' || link.column === 'abandoned') &&
        !card.conversations.some((entry) => entry.status === 'running' || entry.status === 'awaiting_input'),
    )
    .sort((a, b) => a.position - b.position)
  return (
    <section>
      <PanelGroup title="Prêtes à partir" count={ready.length} />
      {ready.length === 0 ? (
        <PanelEmpty>Aucune carte prête.</PanelEmpty>
      ) : (
        <ul>
          {ready.slice(0, 3).map((card) => (
            <li key={card.id} className={PANEL_ROW}>
              <button type="button" onClick={() => onOpen(card.number)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <ColumnDot column={card.column} />
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{card.number}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{card.title}</span>
              </button>
              <button
                type="button"
                onClick={() => (demo ? simulate(`ouvrirait une session sur #${card.number}`) : navigate(`/p/${projectId}/c/new?card=${card.id}`))}
                className={cx(PANEL_GESTURE, 'shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100')}
              >
                <Play size={12} /> Lancer une session
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
