import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  CircleDot,
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
import { useNavigate } from 'react-router-dom'
import { CARD_COLUMNS, type CardDto, type CardLinkDto, type ConversationStatus } from '@solera/protocol'
import {
  Menu,
  MenuItem,
  PanelEmpty,
  PanelGroup,
  PanelNotice,
  PanelStatusIcon,
  PanelToolbar,
  cx,
  panelGestureClass,
  panelRowClass,
  panelToolClass,
  type StatusTone,
} from '@solera/ui'
import { useLiveConversations } from '../../lib/activity'
import { recentNotes } from '../../lib/card-sheet'
import { isLate, isOpen, type StatusOf } from '../../lib/card-state'
import { useCardNotes, useCardSubtasks, useCards, useCreateCard, useMoveCard } from '../../lib/cards'
import type { ChatItem } from '../../lib/chat-fold'
import { useAllConversations, useAttachCard } from '../../lib/conversations'
import { elapsed, relativeDate } from '../../lib/dates'
import { PR_TONE } from '../../lib/code-model'
import { conversationPath } from '../../lib/conversation-route'
import { useTranslate } from '../../lib/i18n'
import { beaconOf, beaconProgress, beaconWaves, currentWave } from '../../lib/milestone-beacon'
import { useLiveCardStatuses, useMilestones } from '../../lib/milestones'
import { setPanelTab } from '../../lib/panel'
import {
  otherActiveSessions,
  pullRequestChecks,
  readyCards,
  sessionInMilestone,
  sessionWorktree,
  suggestCard,
  visibleAgentPlan,
  type AgentPlan as AgentPlanData,
} from '../../lib/project-pane'
import { useProjects } from '../../lib/projects'
import { pullRequestFor, usePullRequests } from '../../lib/pull-requests'
import { useInbox } from '../../lib/use-inbox'
import { useWorktreeStatuses } from '../../lib/worktrees'
import { AgentIcon } from '../AgentIcon'
import { CardChooser } from '../board/CardChooser'
import { ColumnDot } from '../board/ColumnDot'
import { columnLabel } from '../board/columns'
import { CardSheet } from '../cards/CardSheet'
import { AskInbox } from '../inbox/AskInbox'

/** Ce que la vue lit de la session, tenu par la page de la conversation. */
export interface ProjectPaneSession {
  title: string
  /** La carte rattachée, telle que la conversation la connaît. */
  card: CardLinkDto | null
  items: ChatItem[]
  running: boolean
  /** Ce que fait l'agent en ce moment, dit comme sous le fil ; null au repos. */
  activity: string | null
  model: string | null
  /** Part de la fenêtre de contexte occupée, de 0 à 1, quand le CLI la donne. */
  contextRatio: number | null
}

/** Ce que l'onglet dit dans sa bande de retour : l'échec d'un geste. */
type ReportFailure = (message: string) => void

/**
 * L'onglet *Projet* du panneau d'une conversation (#229, PPR-1 à PPR-5), sur le cadre
 * commun : pas de carte bordée, des groupes en petites capitales, des lignes de 36 px.
 *
 * - *Cette session* : ce qu'elle fait, sa carte à plat (faits, gestes, sous-tâches,
 *   dépendances, sessions, notes), le plan de l'agent, sa branche et sa PR. Sans carte :
 *   une ligne, la suggestion, Rattacher / Créer.
 * - *Projet* : ce qui t'attend, le jalon en cours, les autres sessions actives, les
 *   cartes prêtes à partir, et les vues du projet.
 *
 * Une carte ouverte s'empile dans le panneau (« ‹ Projet ») : c'est la fiche sur place
 * (#199), jamais un second tiroir.
 */
export const ProjectPane = memo(function ProjectPane({
  projectId,
  conversationId,
  session,
}: {
  projectId: string
  conversationId: string
  session: ProjectPaneSession
}) {
  const t = useTranslate()
  const [segment, setSegment] = useState<'session' | 'project'>('session')
  const [stack, setStack] = useState<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const board = useCards(projectId)
  const cards = board.data ?? NO_CARDS
  const statusOf = useLiveCardStatuses(board.data)
  const current = session.card ? cards.find((card) => card.id === session.card?.id) ?? null : null
  const stacked = stack !== null ? cards.find((card) => card.number === stack) ?? null : null

  if (stacked) {
    return (
      <div className="flex min-h-0 flex-1 flex-col pb-safe">
        {/* Une fiche par carte : passer d'une carte à sa voisine n'y emporte rien. */}
        <CardSheet
          key={stacked.id}
          open
          projectId={projectId}
          card={stacked}
          back={t('panel.project.title')}
          onClose={() => setStack(null)}
          onSelect={setStack}
        />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pb-safe">
      <PanelToolbar title={t('panel.project.title')} meta={current ? `#${current.number}` : undefined}>
        <span role="radiogroup" aria-label={t('panel.project.segments')} className="flex items-center gap-1">
          <button type="button" role="radio" aria-checked={segment === 'session'} onClick={() => setSegment('session')} className={panelToolClass(segment === 'session')}>
            {session.running ? <Live /> : null}
            {t('panel.project.session')}
          </button>
          <button type="button" role="radio" aria-checked={segment === 'project'} onClick={() => setSegment('project')} className={panelToolClass(segment === 'project')}>
            {t('panel.project.project')}
          </button>
        </span>
      </PanelToolbar>
      {notice ? <PanelNotice tone="critical" onClose={() => setNotice(null)}>{notice}</PanelNotice> : null}
      <div className="@container min-h-0 flex-1 overflow-y-auto pb-3">
        {segment === 'session' ? (
          <SessionView
            projectId={projectId}
            conversationId={conversationId}
            session={session}
            cards={cards}
            current={current}
            statusOf={statusOf}
            loading={board.isPending}
            failed={board.isError}
            retry={() => void board.refetch()}
            onOpen={setStack}
            fail={setNotice}
          />
        ) : (
          <ProjectView projectId={projectId} conversationId={conversationId} cards={cards} current={current} statusOf={statusOf} onOpen={setStack} />
        )}
      </div>
    </div>
  )
})

const NO_CARDS: CardDto[] = []

function Live() {
  return (
    <span className="relative flex size-2 shrink-0" aria-hidden>
      <span className="absolute inset-0 animate-ping rounded-full bg-accent/50 motion-reduce:animate-none" />
      <span className="relative size-2 rounded-full bg-accent" />
    </span>
  )
}

/** L'état d'une session en mots et en point, dans une ligne. */
const SESSION_DOT: Partial<Record<ConversationStatus, StatusTone>> = {
  running: 'accent',
  awaiting_input: 'caution',
  error: 'critical',
}

/* -------------------------------------------------------------- la session ---- */

function SessionView({ projectId, conversationId, session, cards, current, statusOf, loading, failed, retry, onOpen, fail }: {
  projectId: string
  conversationId: string
  session: ProjectPaneSession
  cards: CardDto[]
  current: CardDto | null
  statusOf: StatusOf
  loading: boolean
  failed: boolean
  retry: () => void
  onOpen: (number: number) => void
  fail: ReportFailure
}) {
  const t = useTranslate()
  // Relu seulement quand le fil bouge : le panneau se redessine pour bien d'autres raisons.
  const plan = useMemo(() => visibleAgentPlan(session.items), [session.items])

  return (
    <>
      <ActivityRow session={session} />

      {loading ? (
        <PanelEmpty>{t('panel.project.loading')}</PanelEmpty>
      ) : failed ? (
        // Dit tel quel, et surtout pas « carte supprimée » : ce second message proposerait
        // de détacher une carte qui existe toujours.
        <PanelEmpty action={<button type="button" onClick={retry} className={panelGestureClass}><RotateCw size={13} aria-hidden /> {t('panel.project.retry')}</button>}>
          {t('panel.project.loadError')}
        </PanelEmpty>
      ) : current ? (
        <SessionCard card={current} projectId={projectId} conversationId={conversationId} statusOf={statusOf} onOpen={onOpen} fail={fail} />
      ) : session.card ? (
        <CardGone projectId={projectId} conversationId={conversationId} fail={fail} />
      ) : (
        <NoCard projectId={projectId} conversationId={conversationId} session={session} cards={cards} fail={fail} />
      )}

      {plan ? <AgentPlan plan={plan} /> : null}

      <BranchBlock projectId={projectId} conversationId={conversationId} />
    </>
  )
}

/** Ce que fait la session, en une ligne : l'état, le geste, le modèle et sa fenêtre. */
function ActivityRow({ session }: { session: ProjectPaneSession }) {
  const t = useTranslate()
  const details = [
    session.model,
    session.contextRatio !== null ? t('panel.project.context', { percent: Math.round(session.contextRatio * 100) }) : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className="flex h-11 items-center gap-2.5 border-b border-line px-3 md:h-9" role="status">
      {session.running
        ? <Loader size={13} className="shrink-0 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
        : <span aria-hidden className="ml-1 size-2 shrink-0 rounded-full bg-line-strong" />}
      <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
        <span className="font-medium text-ink">{session.running ? t('panel.project.running') : t('panel.project.idle')}</span>
        {session.running && session.activity ? <> · {session.activity}</> : null}
      </span>
      {details ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">{details}</span> : null}
    </div>
  )
}

/** Rattachée, mais la carte n'existe plus : la conversation lui a survécu. */
function CardGone({ projectId, conversationId, fail }: { projectId: string; conversationId: string; fail: ReportFailure }) {
  const t = useTranslate()
  const attach = useAttachCard(projectId)
  return (
    <section aria-label={t('panel.project.card')}>
      <PanelGroup title={t('panel.project.card')} />
      <PanelEmpty
        action={
          <button type="button" disabled={attach.isPending} className={panelGestureClass}
            onClick={() => attach.mutate({ id: conversationId, cardId: null }, { onError: () => fail(t('panel.project.detachError')) })}>
            <Unlink size={13} aria-hidden /> {t('panel.project.detach')}
          </button>
        }
      >
        {t('panel.project.cardGone')}
      </PanelEmpty>
    </section>
  )
}

/**
 * Sans carte : une ligne, de quoi en rattacher ou en créer une, et la suggestion — la
 * carte la plus citée dans le fil. Créer prend le titre de la session et pose la carte
 * en cours, puisque quelqu'un y travaille déjà.
 */
function NoCard({ projectId, conversationId, session, cards, fail }: {
  projectId: string
  conversationId: string
  session: ProjectPaneSession
  cards: CardDto[]
  fail: ReportFailure
}) {
  const t = useTranslate()
  const attach = useAttachCard(projectId)
  const create = useCreateCard(projectId)
  const suggestion = useMemo(() => suggestCard(session.items, cards), [session.items, cards])
  const busy = attach.isPending || create.isPending
  /**
   * La carte déjà créée par « Créer », si son rattachement a échoué. Recliquer la
   * rattache au lieu d'en créer une seconde : sans cette mémoire, chaque essai laisse
   * une carte orpheline de plus sur le tableau.
   */
  const [created, setCreated] = useState<CardDto | null>(null)
  const attachTo = (cardId: string, number?: number) =>
    attach.mutate({ id: conversationId, cardId }, {
      onError: () => fail(number !== undefined ? t('panel.project.attachCreatedError', { number }) : t('panel.project.attachError')),
    })
  const createAndAttach = () => {
    if (created) return attachTo(created.id, created.number)
    create.mutate({ title: session.title, column: 'in_progress' }, {
      onSuccess: (card) => { setCreated(card); attachTo(card.id, card.number) },
      onError: () => fail(t('panel.project.createError')),
    })
  }

  return (
    <section aria-label={t('panel.project.card')}>
      <PanelGroup title={t('panel.project.card')} />
      <PanelEmpty
        action={
          <span className="flex flex-wrap items-center gap-1">
            <CardChooser
              projectId={projectId}
              label={t('panel.project.attachCard')}
              excludeIds={suggestion ? [suggestion.card.id] : []}
              onPick={(picked) => attachTo(picked.id)}
              trigger={<button type="button" disabled={busy} className={panelToolClass()}><Link2 size={13} aria-hidden /> {t('panel.project.attach')}</button>}
            />
            <button type="button" disabled={busy} onClick={createAndAttach} title={t('panel.project.create.title')} className={panelToolClass()}>
              <Plus size={13} aria-hidden /> {t('panel.project.create')}
            </button>
          </span>
        }
      >
        {t('panel.project.noCard')}
      </PanelEmpty>
      {suggestion ? (
        <div className={panelRowClass}>
          <PanelStatusIcon icon={<SquareKanban size={14} aria-hidden />} dot="accent" />
          <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{suggestion.card.number}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{suggestion.card.title}</span>
          <span className="hidden shrink-0 text-xs text-ink-faint @min-[22rem]:inline">{t('panel.project.cited', { count: suggestion.mentions })}</span>
          <button type="button" disabled={busy} onClick={() => attachTo(suggestion.card.id)} className={cx(panelGestureClass, 'shrink-0 text-accent')}>
            {t('panel.project.attachNumber', { number: suggestion.card.number })}
          </button>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Le plan que l'agent s'est donné, lu à côté de ce que la carte demande. Celui d'un tour
 * déjà clos le dit, pour qu'on ne le prenne pas pour le programme de la demande en cours.
 */
function AgentPlan({ plan }: { plan: AgentPlanData }) {
  const t = useTranslate()
  const done = plan.steps.filter((step) => step.status === 'completed').length
  return (
    <section aria-label={t('panel.project.plan')}>
      <PanelGroup
        title={t('panel.project.plan')}
        aside={
          <span className="tabular-nums text-ink-faint">
            {plan.previousTurn ? `${t('panel.project.plan.previousTurn')} · ` : ''}{done}/{plan.steps.length}
          </span>
        }
      />
      <ul>
        {plan.steps.map((step, index) => {
          const Icon = step.status === 'completed' ? CircleCheck : step.status === 'in_progress' ? CircleDot : Circle
          return (
            <li key={index} className="flex min-h-9 items-start gap-2.5 px-3 py-1.5">
              <Icon size={14} aria-label={t(`plan.progress.${step.status}`)}
                className={cx('mt-0.5 shrink-0', step.status === 'completed' ? 'text-positive' : step.status === 'in_progress' ? 'text-accent' : 'text-ink-faint')} />
              <span className={cx('min-w-0 break-words text-sm', step.status === 'completed' ? 'text-ink-faint line-through' : 'text-ink')}>{step.text}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** La branche de la session : son worktree, son écart à la base, et sa PR. */
function BranchBlock({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const t = useTranslate()
  const { data: projects } = useProjects()
  const git = projects?.find((entry) => entry.id === projectId)?.git ?? false
  const { data: statuses } = useWorktreeStatuses(git ? projectId : undefined)
  const { data: prs } = usePullRequests(git ? projectId : undefined)
  const tree = sessionWorktree(statuses, conversationId)
  if (!git) return null

  if (!tree) {
    return (
      <section aria-label={t('panel.project.branch')}>
        <PanelGroup title={t('panel.project.branch')} />
        <PanelEmpty action={<button type="button" onClick={() => setPanelTab('git')} className={panelGestureClass}><FileDiff size={13} aria-hidden /> {t('panel.project.git')}</button>}>
          {t('panel.project.atRoot')}
        </PanelEmpty>
      </section>
    )
  }
  const pr = pullRequestFor(prs, tree.branch)
  const dirty = tree.modified + tree.untracked
  const checks = pr ? pullRequestChecks(pr) : null
  const facts = [
    [tree.ahead > 0 ? `↑${tree.ahead}` : '', tree.behind > 0 ? `↓${tree.behind}` : ''].filter(Boolean).join(' '),
    dirty > 0 ? t(dirty > 1 ? 'panel.project.dirty.many' : 'panel.project.dirty.one', { count: dirty }) : '',
    tree.conflicts ? t('panel.project.conflict') : '',
  ].filter(Boolean).join(' · ')
  return (
    <section aria-label={t('panel.project.branch')}>
      <PanelGroup title={t('panel.project.branch')} />
      <button type="button" onClick={() => setPanelTab('git')} className={panelRowClass} title={t('panel.project.toGit')}>
        <PanelStatusIcon icon={<GitBranch size={14} aria-hidden />} dot={tree.conflicts ? 'critical' : dirty > 0 ? 'caution' : undefined} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{tree.branch ?? tree.name}</span>
        {facts ? <span className={cx('shrink-0 text-xs tabular-nums', tree.conflicts ? 'text-critical' : 'text-ink-faint')}>{facts}</span> : null}
        <span className="hidden shrink-0 text-xs text-ink-faint group-hover:inline group-focus-visible:inline">{t('panel.project.gitArrow')}</span>
      </button>
      {pr ? (
        <a href={pr.url} target="_blank" rel="noreferrer" className={panelRowClass}>
          <PanelStatusIcon icon={<GitPullRequest size={14} aria-hidden />} dot={PR_TONE[pr.state]} />
          <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{pr.number}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{pr.title}</span>
          <span className={cx('shrink-0 text-xs', pr.state === 'failing' ? 'text-critical' : 'text-ink-faint')}>
            {t(`code.pr.${pr.state}`)}
            {checks ? ` · ${checks.passed}/${checks.total}` : ''}
          </span>
          <ArrowUpRight size={13} aria-hidden className="shrink-0 text-ink-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        </a>
      ) : (
        <PanelEmpty>{t('panel.project.noPr')}</PanelEmpty>
      )}
    </section>
  )
}

/* ------------------------------------------------------- la carte de la session ---- */

/**
 * La carte de la session, à plat (PPR-4) : ses faits et ses gestes, puis ses sous-tâches,
 * ses dépendances, ses sessions, ses notes. Le détail complet est la fiche, en pile.
 */
function SessionCard({ card, projectId, conversationId, statusOf, onOpen, fail }: {
  card: CardDto
  projectId: string
  conversationId: string
  statusOf: StatusOf
  onOpen: (number: number) => void
  fail: ReportFailure
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const move = useMoveCard()
  const attach = useAttachCard(projectId)
  const late = isLate(card)

  return (
    <>
      <section aria-label={t('panel.project.card')} className="flex flex-col gap-1.5 border-b border-line px-3 py-2.5">
        <button type="button" onClick={() => onOpen(card.number)} className="flex min-w-0 items-baseline gap-1.5 text-left hover:text-accent">
          <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{card.number}</span>
          <span className="min-w-0 text-sm font-medium text-ink">{card.title}</span>
        </button>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span className="inline-flex items-center gap-1.5"><ColumnDot column={card.column} />{columnLabel(card.column)}</span>
          {card.parent ? (
            <button type="button" onClick={() => navigate(`/p/${projectId}/timeline/${card.parent!.number}`)} className="inline-flex min-w-0 items-center gap-1 hover:text-ink hover:underline">
              <Flag size={12} aria-hidden className="shrink-0 text-ink-faint" />
              <span className="truncate">#{card.parent.number} {card.parent.title}</span>
            </button>
          ) : null}
          {card.dueAt !== null ? (
            <span className={late ? 'text-critical' : 'text-ink-faint'}>{t('panel.project.due', { when: relativeDate(card.dueAt) })}</span>
          ) : null}
          {card.toClarifySince !== null ? <span className="text-caution">{t('panel.project.toClarify')}</span> : null}
        </div>
        <div className="-ml-2.5 flex flex-wrap items-center gap-0.5">
          <button type="button" onClick={() => onOpen(card.number)} className={panelGestureClass}><SquareKanban size={13} aria-hidden /> {t('panel.project.openSheet')}</button>
          {/* La colonne d'un regroupement se déduit de ses enfants : elle ne se choisit pas. */}
          {card.children.length === 0 ? (
            <Menu trigger={<button type="button" disabled={move.isPending} className={panelGestureClass}>{t('panel.project.column')} <ChevronDown size={12} aria-hidden /></button>}>
              {CARD_COLUMNS.map((column) => (
                <MenuItem
                  key={column}
                  icon={card.column === column ? <Check size={13} /> : <span className="block size-[13px]" />}
                  onSelect={() => {
                    if (column !== card.column) move.mutate({ id: card.id, projectId, column }, { onError: () => fail(t('panel.project.moveError')) })
                  }}
                >
                  {columnLabel(column)}
                </MenuItem>
              ))}
            </Menu>
          ) : null}
          <button type="button" disabled={attach.isPending} className={panelGestureClass}
            onClick={() => attach.mutate({ id: conversationId, cardId: null }, { onError: () => fail(t('panel.project.detachError')) })}>
            <Unlink size={13} aria-hidden /> {t('panel.project.detach')}
          </button>
        </div>
      </section>

      <Subtasks card={card} projectId={projectId} fail={fail} />
      <Dependencies card={card} onOpen={onOpen} />
      <CardSessions card={card} projectId={projectId} statusOf={statusOf} />
      <Notes card={card} onOpen={() => onOpen(card.number)} />
    </>
  )
}

/** Les cases de la description, cochables d'ici, avec leur barre. */
function Subtasks({ card, projectId, fail }: { card: CardDto; projectId: string; fail: ReportFailure }) {
  const t = useTranslate()
  const { subtasks, done, check, pending } = useCardSubtasks(projectId, card)
  if (subtasks.length === 0) return null
  return (
    <section aria-label={t('panel.project.subtasks')}>
      <PanelGroup title={t('panel.project.subtasks')} aside={<span className="tabular-nums text-ink-faint">{done}/{subtasks.length}</span>} />
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={subtasks.length}
        aria-valuenow={done}
        aria-label={t('panel.project.subtasks')}
        className="mx-3 mb-1 h-1 overflow-hidden rounded-full bg-surface-high"
      >
        <div className="h-full rounded-full bg-positive transition-[width]" style={{ width: `${(done / subtasks.length) * 100}%` }} />
      </div>
      <ul>
        {subtasks.map((task) => (
          <li key={task.index}>
            <label className="flex min-h-9 cursor-pointer items-start gap-2.5 px-3 py-1.5 hover:bg-surface-high/50 pointer-coarse:min-h-11">
              <input
                type="checkbox"
                checked={task.checked}
                disabled={pending}
                onChange={(event) => check(task, event.target.checked, () => fail(t('panel.project.subtaskError')))}
                className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
              />
              <span className={cx('min-w-0 text-sm', task.checked ? 'text-ink-faint line-through' : 'text-ink')}>{task.label}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Ce qui bloque la carte et ce qu'elle bloque ; un clic ouvre la fiche de la voisine. */
function Dependencies({ card, onOpen }: { card: CardDto; onOpen: (number: number) => void }) {
  const t = useTranslate()
  const rows = [
    ...card.blockedBy.map((link) => ({ link, relation: 'blockedBy' as const })),
    ...card.blocks.map((link) => ({ link, relation: 'blocks' as const })),
  ]
  if (rows.length === 0) return null
  return (
    <section aria-label={t('panel.project.dependencies')}>
      <PanelGroup title={t('panel.project.dependencies')} count={rows.length} />
      <ul>
        {rows.map(({ link, relation }) => (
          <li key={`${relation}-${link.id}`}>
            <button type="button" onClick={() => onOpen(link.number)} className={panelRowClass}>
              <span className="w-20 shrink-0 truncate text-xs text-ink-faint">{t(`panel.project.relation.${relation}`)}</span>
              <ColumnDot column={link.column} />
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{link.number}</span>
              <span className={cx('min-w-0 flex-1 truncate text-sm', isOpen(link) ? 'text-ink' : 'text-ink-faint line-through')}>{link.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Les sessions de la carte, celle-ci comprise : une ligne chacune, clic → la session. */
function CardSessions({ card, projectId, statusOf }: { card: CardDto; projectId: string; statusOf: StatusOf }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const sessions = card.conversations.filter((entry) => entry.archivedAt === null)
  if (sessions.length === 0) return null
  return (
    <section aria-label={t('panel.project.sessions')}>
      <PanelGroup title={t('panel.project.sessions')} count={sessions.length} />
      <ul>
        {sessions.map((entry) => {
          const status = statusOf(entry)
          return (
            <li key={entry.id}>
              <button type="button" onClick={() => navigate(conversationPath({ id: entry.id, projectId }))} className={panelRowClass}>
                <PanelStatusIcon icon={<AgentIcon agent={entry.agent} size={14} decorative />} dot={SESSION_DOT[status]} pulse={status === 'running'} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{entry.title}</span>
                <span className={cx('shrink-0 text-xs', status === 'awaiting_input' ? 'text-caution' : status === 'error' ? 'text-critical' : 'text-ink-faint')}>
                  {t(`panel.project.status.${status}`)}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** Les trois notes les plus récentes ; « Tout voir » ouvre la fiche. */
function Notes({ card, onOpen }: { card: CardDto; onOpen: () => void }) {
  const t = useTranslate()
  const { data } = useCardNotes(card.id)
  const { shown, total } = recentNotes(data)
  if (shown.length === 0) return null
  return (
    <section aria-label={t('panel.project.notes')}>
      <PanelGroup
        title={t('panel.project.notes')}
        count={total}
        aside={total > shown.length ? (
          <button type="button" onClick={onOpen} className="text-xs text-ink-faint hover:text-ink">{t('panel.project.seeAll')}</button>
        ) : undefined}
      />
      <ul>
        {shown.map((note) => (
          <li key={note.id} className="flex items-start gap-2.5 px-3 py-1.5">
            <span className="mt-0.5 grid size-5 shrink-0 place-items-center text-ink-faint">
              {note.author.kind === 'agent' ? <AgentIcon agent={note.author.agent} size={14} decorative /> : <MessageSquareText size={14} aria-hidden />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="line-clamp-2 text-sm text-ink">{note.body}</span>
              <span className="text-xs text-ink-faint">
                {note.author.kind === 'agent' ? note.author.conversationTitle || t('panel.project.agent') : note.author.name} · {elapsed(note.createdAt)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ---------------------------------------------------------------- le projet ---- */

function ProjectView({ projectId, conversationId, cards, current, statusOf, onOpen }: {
  projectId: string
  conversationId: string
  cards: CardDto[]
  current: CardDto | null
  statusOf: StatusOf
  onOpen: (number: number) => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const inbox = useInbox({ projectId })

  return (
    <>
      {/* AskInbox porte déjà le nom de la région : la section ne le redit pas. */}
      <section>
        <PanelGroup title={t('panel.project.inbox')} count={inbox.length} />
        {inbox.length === 0 ? (
          <PanelEmpty>{t('panel.project.inbox.empty')}</PanelEmpty>
        ) : (
          <div className="px-1.5">
            <AskInbox items={inbox} bare />
          </div>
        )}
      </section>
      <CurrentMilestone projectId={projectId} current={current} />
      <OtherSessions projectId={projectId} conversationId={conversationId} />
      <ReadyCards projectId={projectId} cards={cards} statusOf={statusOf} onOpen={onOpen} />

      <nav aria-label={t('panel.project.views')} className="mt-2 flex flex-wrap items-center gap-0.5 border-t border-line px-1.5 pt-1.5">
        <button type="button" onClick={() => navigate(`/p/${projectId}/board`)} className={panelGestureClass}><SquareKanban size={13} aria-hidden /> {t('panel.project.view.board')}</button>
        <button type="button" onClick={() => navigate(`/p/${projectId}/timeline`)} className={panelGestureClass}><Flag size={13} aria-hidden /> {t('panel.project.view.milestones')}</button>
        <button type="button" onClick={() => navigate(`/p/${projectId}/travail`)} className={panelGestureClass}><Layers size={13} aria-hidden /> {t('panel.project.view.work')}</button>
      </nav>
    </>
  )
}

/** Le jalon en cours, lu comme le phare de l'Aperçu (#174) : avancement, vague, et la session. */
function CurrentMilestone({ projectId, current }: { projectId: string; current: CardDto | null }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const { entries } = useMilestones(projectId)
  const milestone = useMemo(() => beaconOf(entries).current, [entries])
  if (!milestone) {
    return (
      <section aria-label={t('panel.project.milestone')}>
        <PanelGroup title={t('panel.project.milestone')} />
        <PanelEmpty>{t('panel.project.milestone.none')}</PanelEmpty>
      </section>
    )
  }
  const progress = beaconProgress(milestone)
  const waves = beaconWaves(milestone)
  const index = currentWave(waves)
  const wave = index >= 0 ? waves[index]! : null
  const member = sessionInMilestone(milestone, current)
  const facts = [
    wave ? t('panel.project.milestone.wave', { number: index + 1, done: wave.done, total: wave.cards.length }) : t('panel.project.milestone.wavesDone'),
    member === true ? t('panel.project.milestone.in', { number: current!.number }) : member === false ? t('panel.project.milestone.out') : null,
  ].filter(Boolean).join(' · ')
  return (
    <section aria-label={t('panel.project.milestone')}>
      <PanelGroup title={t('panel.project.milestone')} aside={<span className="tabular-nums text-ink-faint">{progress.done}/{progress.total}</span>} />
      <button type="button" onClick={() => navigate(`/p/${projectId}/timeline/${milestone.card.number}`)} className={panelRowClass}>
        <PanelStatusIcon icon={<Flag size={14} aria-hidden />} dot={milestone.maturity === 'launched' ? 'accent' : undefined} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">{milestone.card.title}</span>
        <ArrowUpRight size={13} aria-hidden className="shrink-0 text-ink-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.done}
        aria-label={t('panel.project.milestone')}
        className="mx-3 mb-1 h-1 overflow-hidden rounded-full bg-surface-high"
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${progress.share * 100}%` }} />
      </div>
      <p className="px-3 pb-1.5 text-xs text-ink-faint">{facts}</p>
    </section>
  )
}

/** Les autres sessions actives du projet : celles qui attendent d'abord, six au plus. */
function OtherSessions({ projectId, conversationId }: { projectId: string; conversationId: string }) {
  const t = useTranslate()
  const navigate = useNavigate()
  const { data: conversations } = useAllConversations()
  const mine = useMemo(() => (conversations ?? []).filter((entry) => entry.projectId === projectId), [conversations, projectId])
  const live = useLiveConversations(mine)
  const rows = useMemo(() => otherActiveSessions(live, conversationId), [live, conversationId])
  return (
    <section aria-label={t('panel.project.others')}>
      <PanelGroup title={t('panel.project.others')} count={rows.length} />
      {rows.length === 0 ? (
        <PanelEmpty>{t('panel.project.others.none')}</PanelEmpty>
      ) : (
        <ul>
          {rows.slice(0, 6).map((row) => (
            <li key={row.id}>
              <button type="button" onClick={() => navigate(conversationPath({ id: row.id, projectId }))} className={panelRowClass}>
                <PanelStatusIcon icon={<AgentIcon agent={row.agent} size={14} decorative />} dot={row.awaiting ? 'caution' : 'accent'} pulse={!row.awaiting} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{row.title}</span>
                {row.card !== null ? <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{row.card}</span> : null}
                <span className={cx('shrink-0 text-xs', row.awaiting ? 'text-caution' : 'text-ink-faint')}>
                  {t(row.awaiting ? 'panel.project.status.awaiting_input' : 'panel.project.status.running')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Trois cartes prêtes à partir, dans l'ordre du tableau, et de quoi en lancer une. */
function ReadyCards({ projectId, cards, statusOf, onOpen }: {
  projectId: string
  cards: CardDto[]
  statusOf: StatusOf
  onOpen: (number: number) => void
}) {
  const t = useTranslate()
  const navigate = useNavigate()
  const ready = useMemo(() => readyCards(cards, statusOf), [cards, statusOf])
  return (
    <section aria-label={t('panel.project.ready')}>
      <PanelGroup title={t('panel.project.ready')} count={ready.length} />
      {ready.length === 0 ? (
        <PanelEmpty>{t('panel.project.ready.none')}</PanelEmpty>
      ) : (
        <ul>
          {ready.slice(0, 3).map((card) => (
            <li key={card.id} className={panelRowClass}>
              <button type="button" onClick={() => onOpen(card.number)} className="flex h-full min-w-0 flex-1 items-center gap-2.5 text-left">
                <ColumnDot column={card.column} />
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">#{card.number}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{card.title}</span>
              </button>
              <button
                type="button"
                onClick={() => navigate(`/p/${projectId}/c/new?card=${card.id}`)}
                className={cx(panelGestureClass, 'shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100')}
              >
                <Play size={12} aria-hidden /> {t('panel.project.launch')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
